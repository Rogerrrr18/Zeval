/**
 * @fileoverview SimUser dynamic replay loop for intent pointer evaluation.
 *
 * Architecture:
 *   For each IntentSequenceDoc (one per session):
 *     For each IntentItem in intentSequence:
 *       Budget B_i = ceil(2 * historicalTurnsForIntent)
 *       For each replay turn (up to B_i):
 *         1. SimUser generates query via `simuser_query_generate`
 *         2. Agent endpoint responds
 *         3. Judge evaluates via `intent_completion_judge` → SATISFIED / NOT_SATISFIED / DEVIATION
 *         4. Stop early on SATISFIED; record SKIPPED_GEN_FAILURE on generation error
 *
 * Global budget: G_max total turns across all intents
 *   (env: ZEVAL_SIMUSER_GLOBAL_MAX, default 120).
 *
 * Return value: IntentRunLog[][] where outer array = per session.
 */

import { parseJsonObjectFromLlmOutput, readZevalEnvValue, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import { buildVersionedJudgeSystemPrompt } from "@/llm/judgeProfile";
import type { EnrichedChatlogRow, IntentJudgeLabel, IntentRunLog, IntentSequenceDoc } from "@/types/pipeline";

const DEFAULT_GLOBAL_MAX_TURNS = 120;

export type SimUserOptions = {
  agentApiEndpoint: string;
  runId?: string;
};

type JudgePayload = {
  label?: string;
  rationale?: string;
  evidenceQuote?: string;
};

const SIMUSER_GENERATE_SYSTEM_LINES = [
  "你是 Zeval 的 SimUser（模拟用户）。",
  "你的目标是扮演真实用户，继续追问 AI 助手以验证指定意图是否被满足。",
  "根据给定的意图描述和对话历史，生成一条自然的用户追问消息。",
  "消息应简洁、符合真实用户风格，不要暴露你是模拟器。",
  "你只输出 JSON，不要输出 markdown，不要补充解释。",
  '输出格式：{"query":"用户消息内容"}',
];

const INTENT_JUDGE_SYSTEM_LINES = [
  "你是 Zeval 的 Intent Completion Judge。",
  "给定意图描述、SimUser 追问和 Agent 回复，判断该意图是否已被满足。",
  "判断标准：",
  "  SATISFIED: Agent 回复充分满足了用户意图，用户无需再追问。",
  "  NOT_SATISFIED: Agent 回复未满足意图，需要继续追问。",
  "  DEVIATION: Agent 回复偏离了意图，或引导到了错误方向。",
  "rationale 是你的判断理由（一到两句话）。",
  "evidenceQuote 引用 Agent 回复中支持判断的原文片段（可为空字符串）。",
  "你只输出 JSON，不要输出 markdown，不要补充解释。",
  '输出格式：{"label":"SATISFIED","rationale":"回复直接给出了退款流程。","evidenceQuote":"退款将在3-5个工作日内到账"}',
];

/**
 * Run SimUser dynamic replay for all sessions' intent sequences.
 *
 * @param intentSequences Extracted intent sequences (one per session).
 * @param rows Enriched rows (for historical context).
 * @param useLlm Whether LLM is available.
 * @param options SimUser runtime options.
 * @returns Nested array: outer = per session, inner = all IntentRunLog entries for that session.
 */
export async function runSimUserReplay(
  intentSequences: IntentSequenceDoc[],
  rows: EnrichedChatlogRow[],
  useLlm: boolean,
  options: SimUserOptions,
): Promise<IntentRunLog[][]> {
  if (!useLlm || intentSequences.length === 0) {
    return [];
  }

  const globalMax = resolveGlobalMax();
  let globalTurnsUsed = 0;
  const rowsBySession = groupRowsBySession(rows);
  const allSessionLogs: IntentRunLog[][] = [];

  for (const seqDoc of intentSequences) {
    if (globalTurnsUsed >= globalMax) {
      console.warn(`[simUser] Global turn budget G_max=${globalMax} exhausted, stopping replay.`);
      break;
    }

    const sessionRows = rowsBySession.get(seqDoc.sessionId) ?? [];
    const sessionLogs = await replaySession(
      seqDoc,
      sessionRows,
      options,
      globalMax - globalTurnsUsed,
    );

    globalTurnsUsed += sessionLogs.length;
    allSessionLogs.push(sessionLogs);
  }

  return allSessionLogs;
}

async function replaySession(
  seqDoc: IntentSequenceDoc,
  sessionRows: EnrichedChatlogRow[],
  options: SimUserOptions,
  remainingGlobalBudget: number,
): Promise<IntentRunLog[]> {
  const sessionLogs: IntentRunLog[] = [];
  let sessionTurnsUsed = 0;

  for (const intent of seqDoc.intentSequence) {
    if (sessionTurnsUsed >= remainingGlobalBudget) break;

    const historicalTurns = estimateIntentHistoricalTurns(intent, sessionRows);
    const budget = Math.min(
      Math.ceil(2 * historicalTurns),
      remainingGlobalBudget - sessionTurnsUsed,
    );
    if (budget <= 0) break;

    const contextHistory = buildInitialContext(intent, sessionRows);
    let satisfied = false;

    for (let turn = 0; turn < budget; turn++) {
      if (sessionTurnsUsed >= remainingGlobalBudget) break;

      const events: string[] = [];

      // Step 1: SimUser generates query
      let userText: string;
      let generationFailed = false;
      try {
        userText = await generateSimUserQuery(intent, contextHistory, options.runId, seqDoc.sessionId);
      } catch (error) {
        console.error(`[simUser] SimUser gen failed intent=${intent.intentIndex} turn=${turn}:`, error);
        events.push("SIMUSER_GEN_FAILURE");
        // Record a skipped entry and abort this intent
        sessionLogs.push({
          sessionId: seqDoc.sessionId,
          intentIndex: intent.intentIndex,
          turnCount: turn,
          budget,
          userText: "",
          assistantText: "",
          judgeLabel: "SKIPPED_GEN_FAILURE",
          events,
        });
        sessionTurnsUsed += 1;
        generationFailed = true;
        break;
      }
      if (generationFailed) break;

      contextHistory.push({ role: "user", content: userText });

      // Step 2: Agent responds
      let assistantText: string;
      try {
        assistantText = await callAgentEndpoint(options.agentApiEndpoint, contextHistory);
      } catch (error) {
        console.error(`[simUser] Agent call failed intent=${intent.intentIndex} turn=${turn}:`, error);
        events.push("AGENT_CALL_FAILURE");
        sessionLogs.push({
          sessionId: seqDoc.sessionId,
          intentIndex: intent.intentIndex,
          turnCount: turn,
          budget,
          userText,
          assistantText: "",
          judgeLabel: "FALLBACK_NOT_SATISFIED",
          events,
        });
        sessionTurnsUsed += 1;
        break;
      }

      contextHistory.push({ role: "assistant", content: assistantText });

      // Step 3: Judge
      let judgeLabel: IntentJudgeLabel = "NOT_SATISFIED";
      let rationale: string | undefined;
      let evidenceQuote: string | undefined;
      try {
        const judgeResult = await judgeIntentCompletion(intent, userText, assistantText, options.runId, seqDoc.sessionId);
        judgeLabel = judgeResult.label;
        rationale = judgeResult.rationale;
        evidenceQuote = judgeResult.evidenceQuote;
      } catch (error) {
        console.error(`[simUser] Judge failed intent=${intent.intentIndex} turn=${turn}:`, error);
        events.push("JUDGE_FAILURE");
      }

      if (judgeLabel === "SATISFIED") {
        events.push("INTENT_SATISFIED");
        satisfied = true;
      }
      if (turn === budget - 1 && !satisfied) {
        events.push("BUDGET_EXHAUSTED");
      }

      sessionLogs.push({
        sessionId: seqDoc.sessionId,
        intentIndex: intent.intentIndex,
        turnCount: turn,
        budget,
        userText,
        assistantText,
        judgeLabel,
        rationale,
        evidenceQuote,
        events,
      });
      sessionTurnsUsed += 1;

      if (satisfied) break;
    }
  }

  return sessionLogs;
}

async function generateSimUserQuery(
  intent: { intentText: string; successCriteria: string; exampleUserQueries: string[] },
  conversationHistory: Array<{ role: string; content: string }>,
  runId?: string,
  sessionId?: string,
): Promise<string> {
  const recentHistory = conversationHistory
    .slice(-6)
    .map((m) => `[${m.role}] ${m.content}`)
    .join("\n");

  const userContent = [
    `意图：${intent.intentText}`,
    `满足标准：${intent.successCriteria}`,
    `示例追问：${intent.exampleUserQueries.join("；")}`,
    "近期对话历史：",
    recentHistory || "(无历史记录)",
    "请生成下一条 SimUser 追问消息（JSON）。",
  ].join("\n\n");

  const rawResponse = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("simuser_query_generate", SIMUSER_GENERATE_SYSTEM_LINES),
      },
      { role: "user", content: userContent },
    ],
    { stage: "simuser_query_generate", runId, sessionId },
  );

  const parsed = parseJsonObjectFromLlmOutput(rawResponse) as { query?: string };
  const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
  if (!query) {
    throw new Error("SimUser query generation returned empty string.");
  }
  return query;
}

async function judgeIntentCompletion(
  intent: { intentText: string; successCriteria: string },
  userText: string,
  assistantText: string,
  runId?: string,
  sessionId?: string,
): Promise<{ label: IntentJudgeLabel; rationale?: string; evidenceQuote?: string }> {
  const userContent = [
    `意图描述：${intent.intentText}`,
    `满足标准：${intent.successCriteria}`,
    `SimUser 追问：${userText}`,
    `Agent 回复：${assistantText}`,
    "请判断 Agent 回复是否满足了该意图（JSON）。",
  ].join("\n\n");

  const rawResponse = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("intent_completion_judge", INTENT_JUDGE_SYSTEM_LINES),
      },
      { role: "user", content: userContent },
    ],
    { stage: "intent_completion_judge", runId, sessionId },
  );

  const parsed = parseJsonObjectFromLlmOutput(rawResponse) as JudgePayload;
  const rawLabel = typeof parsed.label === "string" ? parsed.label.toUpperCase() : "";
  const label = validateIntentJudgeLabel(rawLabel);
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : undefined;
  const evidenceQuote = typeof parsed.evidenceQuote === "string" ? parsed.evidenceQuote.trim() : undefined;

  return { label, rationale, evidenceQuote };
}

async function callAgentEndpoint(
  agentApiEndpoint: string,
  conversationHistory: Array<{ role: string; content: string }>,
): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(agentApiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Agent endpoint returned HTTP ${response.status}`);
    }

    const body = (await response.json()) as { content?: string; message?: string; response?: string };
    const content = body.content ?? body.message ?? body.response;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Agent endpoint returned empty or non-string content.");
    }
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}

function buildInitialContext(
  intent: { turnSpanUserTurns: [number, number] },
  sessionRows: EnrichedChatlogRow[],
): Array<{ role: string; content: string }> {
  const [startTurn, endTurn] = intent.turnSpanUserTurns;
  return sessionRows
    .filter((row) => row.turnIndex >= startTurn && row.turnIndex <= endTurn)
    .map((row) => ({ role: row.role, content: row.content }));
}

function estimateIntentHistoricalTurns(
  intent: { turnSpanUserTurns: [number, number] },
  sessionRows: EnrichedChatlogRow[],
): number {
  const [startTurn, endTurn] = intent.turnSpanUserTurns;
  const count = sessionRows.filter((row) => row.turnIndex >= startTurn && row.turnIndex <= endTurn).length;
  return Math.max(1, count);
}

function validateIntentJudgeLabel(value: string): IntentJudgeLabel {
  if (
    value === "SATISFIED" ||
    value === "NOT_SATISFIED" ||
    value === "DEVIATION" ||
    value === "FALLBACK_NOT_SATISFIED" ||
    value === "SKIPPED_GEN_FAILURE"
  ) {
    return value;
  }
  return "NOT_SATISFIED";
}

function resolveGlobalMax(): number {
  const parsed = Number.parseInt(readZevalEnvValue(["ZEVAL_SIMUSER_GLOBAL_MAX"]) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GLOBAL_MAX_TURNS;
}

function groupRowsBySession(rows: EnrichedChatlogRow[]): Map<string, EnrichedChatlogRow[]> {
  const grouped = new Map<string, EnrichedChatlogRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId)!.push(row);
  }
  return grouped;
}
