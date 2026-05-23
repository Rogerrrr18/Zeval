/**
 * @fileoverview Intent sequence extraction using LLM.
 *
 * Stage: intent_sequence_extract
 * Temperature: ≤ 0.3, seed: 42 (deterministic extraction for reproducibility).
 * Failure policy: retry once; skip session on second failure.
 *
 * Output: array of IntentSequenceDoc (one per session).
 */

import { mapWithConcurrency, DEFAULT_LLM_CONCURRENCY } from "@/lib/concurrency";
import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import {
  buildVersionedJudgeSystemPrompt,
  ZEVAL_INTENT_EXTRACT_SEED,
  ZEVAL_INTENT_EXTRACT_TEMPERATURE,
} from "@/llm/judgeProfile";
import type { EnrichedChatlogRow, IntentItem, IntentSequenceDoc } from "@/types/pipeline";

type RawIntentItem = {
  intentIndex?: number;
  intentText?: string;
  turnSpanUserTurns?: [number, number];
  exampleUserQueries?: string[];
  successCriteria?: string;
  dependsOn?: number[];
};

type RawIntentPayload = {
  intentSequence?: RawIntentItem[];
};

const INTENT_EXTRACT_SCHEMA_VERSION = "2.0.0";

const INTENT_EXTRACT_SYSTEM_LINES = [
  "你是 Zeval 意图序列提取 Judge。",
  "给定单个 session 的对话内容，提取用户的意图序列（按对话顺序）。",
  "每个意图是用户在对话中追求的一个独立目标。",
  "intentIndex 从 1 开始递增。",
  "turnSpanUserTurns 是该意图所覆盖的用户发言轮次范围 [startTurnIndex, endTurnIndex]（含）。",
  "exampleUserQueries 是用于 SimUser 回放的典型追问示例（2-3 条）。",
  "successCriteria 是判断该意图被满足的具体标准（一句话）。",
  "dependsOn 是当前意图依赖的其他意图的 intentIndex 列表（无依赖则为空数组）。",
  "你只输出 JSON，不要输出 markdown，不要补充解释。",
  '输出格式：{"intentSequence":[{"intentIndex":1,"intentText":"了解退款政策","turnSpanUserTurns":[0,2],"exampleUserQueries":["退款需要多久？","如何申请退款？"],"successCriteria":"Agent 给出了明确的退款时间和申请方式","dependsOn":[]}]}',
];

/**
 * Extract intent sequences for all sessions from enriched rows.
 *
 * @param rows Enriched rows (all sessions combined).
 * @param useLlm Whether LLM is available.
 * @param runId Optional run ID for tracing.
 * @returns Array of IntentSequenceDoc, one per session (failed sessions are skipped).
 */
export async function extractIntentSequences(
  rows: EnrichedChatlogRow[],
  useLlm: boolean,
  runId?: string,
): Promise<IntentSequenceDoc[]> {
  const grouped = groupRowsBySession(rows);
  if (!useLlm || grouped.size === 0) {
    return [];
  }

  const docs = await mapWithConcurrency(
    [...grouped.entries()],
    DEFAULT_LLM_CONCURRENCY,
    ([sessionId, sessionRows]) => extractSessionIntentSequence(sessionId, sessionRows, runId),
  );
  return docs.filter((doc): doc is IntentSequenceDoc => doc !== null);
}

/**
 * Extract intents for one session.
 *
 * HTTP-level retries (including model-variant cycling) are handled by
 * requestSiliconFlowChatCompletion. This function adds one extra retry only
 * for the JSON-parse / empty-sequence case, which is a distinct failure mode.
 */
async function extractSessionIntentSequence(
  sessionId: string,
  rows: EnrichedChatlogRow[],
  runId?: string,
): Promise<IntentSequenceDoc | null> {
  const transcript = buildIntentExtractTranscript(sessionId, rows);

  const callLlm = () =>
    requestSiliconFlowChatCompletion(
      [
        {
          role: "system",
          content: buildVersionedJudgeSystemPrompt("intent_sequence_extract", INTENT_EXTRACT_SYSTEM_LINES),
        },
        { role: "user", content: transcript },
      ],
      {
        stage: "intent_sequence_extract",
        runId,
        sessionId,
        temperature: ZEVAL_INTENT_EXTRACT_TEMPERATURE,
        seed: ZEVAL_INTENT_EXTRACT_SEED,
      },
    );

  try {
    const rawResponse = await callLlm();
    const parsed = parseJsonObjectFromLlmOutput(rawResponse) as RawIntentPayload;
    const intentSequence = parseIntentSequence(parsed);

    if (intentSequence.length === 0) {
      // Empty sequence: retry once in case the model produced a vacuous JSON.
      console.warn(`[intentExtract] Empty sequence on first attempt for session=${sessionId}, retrying.`);
      const rawRetry = await callLlm();
      const parsedRetry = parseJsonObjectFromLlmOutput(rawRetry) as RawIntentPayload;
      const retrySequence = parseIntentSequence(parsedRetry);
      if (retrySequence.length === 0) {
        console.warn(`[intentExtract] Still empty after retry for session=${sessionId}, skipping.`);
        return null;
      }
      return { schemaVersion: INTENT_EXTRACT_SCHEMA_VERSION, sessionId, schemaLockRevision: 0, lockStatus: "draft", intentSequence: retrySequence, refillables: [] };
    }

    return {
      schemaVersion: INTENT_EXTRACT_SCHEMA_VERSION,
      sessionId,
      schemaLockRevision: 0,
      lockStatus: "draft",
      intentSequence,
      refillables: [],
    };
  } catch (error) {
    console.error(`[intentExtract] Failed to extract intents for session=${sessionId}:`, error);
    return null;
  }
}

function buildIntentExtractTranscript(sessionId: string, rows: EnrichedChatlogRow[]): string {
  const turns = rows
    .map((row) => `[turn ${row.turnIndex}] [${row.role}] ${row.content}`)
    .join("\n");

  return [
    `sessionId=${sessionId}`,
    `totalTurns=${rows.length}`,
    "对话内容：",
    turns,
    "请提取该 session 的完整意图序列。",
  ].join("\n\n");
}

function parseIntentSequence(payload: RawIntentPayload): IntentItem[] {
  if (!Array.isArray(payload.intentSequence)) return [];

  return payload.intentSequence
    .filter(
      (item): item is RawIntentItem & { intentIndex: number; intentText: string } =>
        typeof item.intentIndex === "number" &&
        typeof item.intentText === "string" &&
        item.intentText.length > 0,
    )
    .map((item) => ({
      intentIndex: item.intentIndex,
      intentText: item.intentText,
      turnSpanUserTurns: parseTurnSpan(item.turnSpanUserTurns),
      exampleUserQueries: Array.isArray(item.exampleUserQueries)
        ? item.exampleUserQueries.filter((q) => typeof q === "string")
        : [],
      successCriteria: typeof item.successCriteria === "string" ? item.successCriteria : "",
      dependsOn: Array.isArray(item.dependsOn)
        ? item.dependsOn.filter((d) => typeof d === "number")
        : [],
    }));
}

function parseTurnSpan(raw: unknown): [number, number] {
  if (Array.isArray(raw) && raw.length >= 2) {
    const start = Number(raw[0]);
    const end = Number(raw[1]);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return [start, end];
    }
  }
  return [0, 0];
}

function groupRowsBySession(rows: EnrichedChatlogRow[]): Map<string, EnrichedChatlogRow[]> {
  const grouped = new Map<string, EnrichedChatlogRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId)!.push(row);
  }
  return grouped;
}
