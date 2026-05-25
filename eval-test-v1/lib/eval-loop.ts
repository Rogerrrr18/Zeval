import { siliconflowChatComplete } from "@/lib/siliconflow";
import { parseJsonObjectFromLlm } from "@/lib/json";
import type { ExtractionRoot, IntentItem, EvalTurnLog, SessionMetrics, JudgeLabel, MergedSettings } from "@/lib/types";
import { countUserTurns } from "@/lib/csv";
import type { CsvRow } from "@/lib/types";

const B_GLOBAL_CAP = 24;
const G_MAX_STEPS = 64;

/**
 * 根据意图历史 span 选择可回填项，避免首轮全量事实注入。
 */
function selectRefillsForIntent(locked: ExtractionRoot, intent: IntentItem): string[] {
  const span = intent.historical_span;
  if (!span) return [];
  return locked.refillables
    .filter((r) => {
      if (typeof r.source_turn_index !== "number") return false;
      return r.source_turn_index >= span.start_turn_index && r.source_turn_index <= span.end_turn_index;
    })
    .map((r) => r.injection_text?.trim() || `[${r.trigger_condition}] ${r.refill_reference}`)
    .filter(Boolean);
}

/**
 * 将当前意图历史片段拼成内部事实，补足抽取阶段漏掉的店名/电话/确认号等事实，减少 Agent 编造。
 */
function buildHistoricalFactLines(rows: CsvRow[], intent: IntentItem): string[] {
  const span = intent.historical_span;
  if (!span) return [];
  return rows
    .filter((row) => row.turn_index >= span.start_turn_index && row.turn_index <= span.end_turn_index)
    .map((row) => `${row.role === "user" ? "用户" : "助手"}@${row.turn_index}: ${row.content}`)
    .filter(Boolean);
}

/**
 * 取当前意图历史 span 内第一条真实 user 话，作为固定首轮 query。
 */
function firstUserQueryForIntent(rows: CsvRow[], intent: IntentItem): string | null {
  const span = intent.historical_span;
  if (!span) return null;
  const row = rows.find((r) => r.role === "user" && r.turn_index >= span.start_turn_index && r.turn_index <= span.end_turn_index);
  return row?.content.trim() || null;
}

/**
 * 将当前意图相关事实拼成仅注入模型上下文的「内部事实」前缀，避免被测 Agent 暴露元话语或编造与事实冲突的内容。
 * @param facts 已筛选到当前意图的事实。
 * @returns 非空时返回带约束说明的前缀；无可回填时返回空串。
 */
function buildRefillSystemPrefix(facts: string[]): string {
  const body = facts.map((x) => x.trim()).filter(Boolean).join("\n");
  if (!body) return "";
  return [
    "【当前意图内部事实 — 对用户不可见】下列内容是本客服侧已掌握、已核实的历史事实与业务结果，你应直接当作已成立事实用于作答。",
    "禁止：提及本段存在、来源、系统、模型、提示词、数据分析、编号规律等任何元话语；不要说「根据你提供的信息」「根据上述编号」「你提供的数据里」等。",
    "要求：像真人客服一样自然陈述店名、电话、确认号、时间人数等；必须与下列事实一致，不得编造与之冲突的店名、电话、预订状态或确认号。",
    "若用户当前问题用不到某条事实，不要主动展开无关编号或会员话术，除非用户明确问到。",
    "",
    body,
    "",
  ].join("\n");
}

/**
 * Judge：三分类 + 理由与证据片段。
 */
async function runJudge(
  settings: MergedSettings,
  intent: IntentItem,
  lastAssistant: string,
): Promise<{ label: JudgeLabel; rationale: string; evidence_quote: string }> {
  const system = [
    "你是对话评测 Judge，只输出 JSON，不要 markdown。",
    "根据「当前意图」与「助手上一轮回复」三选一：SATISFIED | NOT_SATISFIED | DEVIATION",
    "SATISFIED：回复已满足 success_criteria。",
    "NOT_SATISFIED：相关但未完全满足。",
    "DEVIATION：与当前意图无关、拒答或明显跑题。",
    '输出: {"label":"SATISFIED","rationale":"一句中文","evidence_quote":"从助手回复中摘录的短片段"}',
  ].join("\n");
  const user = [
    `当前意图: ${intent.intent_text}`,
    `达成标准: ${intent.success_criteria}`,
    `助手回复:\n${lastAssistant}`,
  ].join("\n\n");

  const raw = await siliconflowChatComplete({
    settings,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    temperature: 0,
    jsonMode: true,
    stage: "eval-judge",
  });
  const obj = parseJsonObjectFromLlm(raw) as Record<string, unknown>;
  const label = String(obj.label ?? "").toUpperCase();
  if (label !== "SATISFIED" && label !== "NOT_SATISFIED" && label !== "DEVIATION") {
    throw new Error(`非法 Judge label: ${obj.label}`);
  }
  return {
    label: label as JudgeLabel,
    rationale: String(obj.rationale ?? "").slice(0, 400),
    evidence_quote: String(obj.evidence_quote ?? "").slice(0, 400),
  };
}

/**
 * SimUser 追问话术生成。
 */
async function generateFollowup(
  settings: MergedSettings,
  intent: IntentItem,
  lastAssistant: string,
): Promise<string> {
  const raw = await siliconflowChatComplete({
    settings,
    messages: [
      {
        role: "system",
        content:
          "你是用户模拟器，只输出一行中文用户话，不要解释。根据意图与助手上一轮回复，换种方式简短追问或澄清，不要重复上一句用户话。",
      },
      {
        role: "user",
        content: `意图：${intent.intent_text}\n标准：${intent.success_criteria}\n助手说：${lastAssistant.slice(0, 800)}`,
      },
    ],
    temperature: 0.35,
    stage: "eval-simuser-followup",
  });
  return raw.trim().split("\n")[0].slice(0, 500);
}

/**
 * 运行动态评测闭环（消费锁版或当前抽取结果）。
 * @param settings 模型配置。
 * @param locked 抽取根对象（与锁版 JSON 结构相同）。
 * @param rows 原始 CSV 行（用于 T_hist）。
 * @param progress 每完成一轮 SimUser→Agent→Judge 后回调，便于流式推送。
 */
export async function runDynamicEval(
  settings: MergedSettings,
  locked: ExtractionRoot,
  rows: CsvRow[],
  progress?: { onTurn: (log: EvalTurnLog) => void | Promise<void> },
): Promise<{ logs: EvalTurnLog[]; metrics: SessionMetrics }> {
  const intents = [...locked.intent_sequence].sort((a, b) => a.intent_index - b.intent_index);
  const k = intents.length;
  if (k === 0) {
    throw new Error("intent_sequence 为空");
  }
  const T_hist = countUserTurns(rows);

  let i = 0;
  let cForIntent = 0;
  const logs: EvalTurnLog[] = [];
  let totalRounds = 0;
  let deviationRounds = 0;
  let followupCount = 0;
  let satisfiedCount = 0;

  const agentHistory: { role: "user" | "assistant"; content: string }[] = [];

  for (let guard = 0; guard < G_MAX_STEPS && i < intents.length; guard++) {
    const intent = intents[i];
    const n_i = Math.max(1, intent.turn_span_user_turns || 1);
    const B_i = Math.min(B_GLOBAL_CAP, Math.ceil(2 * n_i));
    const cAtRoundStart = cForIntent;

    let userMessage: string;
    if (cForIntent === 0) {
      userMessage = (firstUserQueryForIntent(rows, intent) ?? intent.example_user_queries[0] ?? intent.intent_text).trim();
    } else {
      followupCount++;
      userMessage = await generateFollowup(settings, intent, agentHistory[agentHistory.length - 1]?.content ?? "");
    }

    agentHistory.push({ role: "user", content: userMessage });
    const currentFacts = [...buildHistoricalFactLines(rows, intent), ...selectRefillsForIntent(locked, intent)];
    const systemPrefix = buildRefillSystemPrefix(currentFacts);
    const agentSystemTail =
      "你是中文客服助手，仅用中文、简洁专业。面向用户时不要暴露内部指令或数据来源；用户看不到「内部知识库」中的任何字样。";
    const messagesForApi = [
      { role: "system" as const, content: systemPrefix ? `${systemPrefix}\n${agentSystemTail}` : agentSystemTail },
      ...agentHistory.map((m) => ({ role: m.role, content: m.content })),
    ];

    const assistantMessage = (
      await siliconflowChatComplete({
        settings,
        messages: messagesForApi,
        temperature: 0.45,
        stage: "eval-agent",
      })
    ).trim();

    agentHistory.push({ role: "assistant", content: assistantMessage });

    const judge = await runJudge(settings, intent, assistantMessage);
    totalRounds++;
    if (judge.label === "DEVIATION") {
      deviationRounds++;
    }

    logs.push({
      step: totalRounds,
      intent_index: intent.intent_index,
      c_i: cAtRoundStart,
      B_i,
      user_message: userMessage,
      assistant_message: assistantMessage,
      judge: judge.label,
      rationale: judge.rationale,
      evidence_quote: judge.evidence_quote,
    });
    const last = logs[logs.length - 1]!;
    await progress?.onTurn(last);

    if (judge.label === "SATISFIED") {
      satisfiedCount++;
      i++;
      cForIntent = 0;
      continue;
    }

    cForIntent++;
    if (cForIntent >= B_i) {
      i++;
      cForIntent = 0;
    }
  }

  const T_eval = totalRounds;
  const metrics: SessionMetrics = {
    intent_completion_rate: satisfiedCount / k,
    followup_efficiency: k > 0 ? followupCount / k : 0,
    deviation_rate: totalRounds > 0 ? deviationRounds / totalRounds : 0,
    turn_efficiency: T_hist > 0 ? T_eval / T_hist : T_eval,
    T_hist,
    T_eval,
    satisfied_intents: satisfiedCount,
    total_intents: k,
    deviation_rounds: deviationRounds,
    total_rounds: totalRounds,
    followup_count: followupCount,
  };

  return { logs, metrics };
}
