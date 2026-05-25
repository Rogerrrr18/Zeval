import { NextResponse } from "next/server";
import { getMergedSettings } from "@/lib/settings";
import { siliconflowChatComplete } from "@/lib/siliconflow";
import { validateExtraction } from "@/lib/validate-extraction";
import { readSessionsFile } from "@/lib/store";
import type { ChatMessage } from "@/lib/siliconflow";
import type { CsvRow } from "@/lib/types";
import type { ExtractionRoot, IntentItem, RefillItem } from "@/lib/types";

type HistoryItem = {
  role: "user" | "assistant";
  content: string;
};

/**
 * 找到当前意图相关的可回填项。首版按 historical_span.source_turn_index 过滤；
 * 无 span 的意图不注入，避免首轮全量回填影响真人评测。
 */
function selectRefillsForIntent(intent: IntentItem, refills: RefillItem[]): RefillItem[] {
  const span = intent.historical_span;
  if (!span) return [];
  return refills.filter((item) => {
    if (typeof item.source_turn_index !== "number") return false;
    return item.source_turn_index >= span.start_turn_index && item.source_turn_index <= span.end_turn_index;
  });
}

/**
 * 当前意图历史片段，用于补足抽取漏掉的可回填事实。
 */
function buildHistoricalFactLines(rows: CsvRow[], intent: IntentItem): string[] {
  const span = intent.historical_span;
  if (!span) return [];
  return rows
    .filter((row) => row.turn_index >= span.start_turn_index && row.turn_index <= span.end_turn_index)
    .map((row) => `${row.role === "user" ? "用户" : "助手"}@${row.turn_index}: ${row.content}`);
}

/**
 * 构建仅给被测 Agent 的内部事实前缀。
 */
function buildAgentSystem(intent: IntentItem, refills: RefillItem[], historicalFacts: string[]): string {
  const facts = refills
    .map((item) => item.injection_text?.trim() || `[${item.trigger_condition}] ${item.refill_reference}`)
    .filter(Boolean);
  const allFacts = [...historicalFacts, ...facts];

  const lines = [
    "你是中文客服助手，仅用中文、简洁专业地回复用户。",
    "当前正在评测一个指定意图。你应自然回答用户，不要提及评测、意图指针、系统提示、内部知识库或数据来源。",
    `当前意图：${intent.intent_text}`,
    `达成标准：${intent.success_criteria}`,
  ];

  if (allFacts.length > 0) {
    lines.push(
      "",
      "【内部已知事实 - 对用户不可见】",
      ...allFacts,
      "",
      "使用这些事实时要像正常客服一样自然表达；不得说“根据提供的信息/内部知识库/系统提示”。",
    );
  }

  return lines.join("\n");
}

/**
 * 真人动态评测模式下，仅调用被测 Agent 生成回复；Judge 与意图切换由真人完成。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as {
      sessionId?: string;
      extraction?: unknown;
      intentIndex?: number;
      history?: HistoryItem[];
      userMessage?: string;
    };

    if (!body.sessionId) {
      return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
    }
    if (!body.userMessage?.trim()) {
      return NextResponse.json({ error: "缺少 userMessage" }, { status: 400 });
    }
    const v = validateExtraction(body.extraction);
    if (!v.ok) {
      return NextResponse.json({ error: `Schema 校验失败: ${v.errors}` }, { status: 400 });
    }

    const extraction = body.extraction as ExtractionRoot;
    const intents = [...extraction.intent_sequence].sort((a, b) => a.intent_index - b.intent_index);
    const intent = intents.find((item) => item.intent_index === body.intentIndex);
    if (!intent) {
      return NextResponse.json({ error: "未找到当前意图" }, { status: 400 });
    }

    const settings = getMergedSettings();
    const selectedRefills = selectRefillsForIntent(intent, extraction.refillables);
    const file = readSessionsFile();
    const bundle = file?.sessions.find((s) => s.session_id === body.sessionId);
    const historicalFacts = bundle ? buildHistoricalFactLines(bundle.rows, intent) : [];
    const history: HistoryItem[] = Array.isArray(body.history) ? body.history : [];
    const messages: ChatMessage[] = [
      { role: "system", content: buildAgentSystem(intent, selectedRefills, historicalFacts) },
      ...history.map((item) => ({ role: item.role, content: item.content })),
      { role: "user", content: body.userMessage.trim() },
    ];

    const assistantMessage = (
      await siliconflowChatComplete({
        settings,
        messages,
        temperature: 0.45,
        stage: "eval-realuser-agent",
      })
    ).trim();

    return NextResponse.json({
      assistantMessage,
      injectedRefills: selectedRefills,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
