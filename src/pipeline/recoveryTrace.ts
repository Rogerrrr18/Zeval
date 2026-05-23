/**
 * @fileoverview Session-level recovery trace extraction.
 */

import { mapWithConcurrency, DEFAULT_LLM_CONCURRENCY } from "@/lib/concurrency";
import { parseJsonObjectFromLlmOutput, readZevalEnvValue, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import { buildVersionedJudgeSystemPrompt } from "@/llm/judgeProfile";
import type {
  EnrichedChatlogRow,
  FieldSource,
  GoalCompletionResult,
  RecoveryFailureType,
  RecoveryTraceResult,
} from "@/types/pipeline";

const APOLOGY_PATTERNS = [/(抱歉|不好意思|对不起|让你困扰了)/, /(sorry|apologize)/i];
const REPHRASE_PATTERNS = [/(换个说法|我换个方式|重新解释|重新说明)/, /(let me rephrase|let me explain differently)/i];
const CLARIFICATION_PATTERNS = [/(我先确认一下|我理解的是|你是想说)/, /(let me confirm|if i understand correctly)/i];
const CONFUSION_PATTERNS = [/(什么意思|不懂|你是说|再说一遍|没明白|怎么理解)/];

type RecoverySummaryPayload = {
  repairStrategy?: string;
  confidence?: number;
};

type FailureCandidate = {
  turnIndex: number;
  failureType: RecoveryFailureType;
  triggeredRule: string;
  evidenceRows: EnrichedChatlogRow[];
};

type RecoveryTraceOptions = {
  judgeRequired?: boolean;
};

/**
 * Build one recovery trace result per session.
 *
 * @param rows Enriched rows.
 * @param goalCompletions Session-level goal completion results.
 * @param useLlm Whether LLM summarization is enabled.
 * @param runId Optional run id.
 * @param options Optional strict judge behavior.
 * @returns Recovery traces.
 */
export async function buildRecoveryTraces(
  rows: EnrichedChatlogRow[],
  goalCompletions: GoalCompletionResult[],
  useLlm: boolean,
  runId?: string,
  options: RecoveryTraceOptions = {},
): Promise<RecoveryTraceResult[]> {
  const grouped = groupRowsBySession(rows);
  const goalCompletionMap = new Map(goalCompletions.map((item) => [item.sessionId, item]));
  const concurrency = resolveRecoveryConcurrency();

  return mapWithConcurrency(
    [...grouped.entries()],
    concurrency,
    async ([sessionId, sessionRows]) => {
      const trace = buildRecoveryTraceByRule(sessionId, sessionRows, goalCompletionMap.get(sessionId));
      if (trace.status !== "completed" || !useLlm) {
        return trace;
      }

      try {
        return await enhanceRecoveryTraceWithLlm(trace, sessionRows, runId);
      } catch (error) {
        if (options.judgeRequired) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Recovery trace LLM Judge 失败，session=${sessionId}：${message}`);
        }
        console.error("Recovery trace LLM summary failed:", sessionId, error);
        return {
          ...trace,
          triggeredRules: [...trace.triggeredRules, "repair-strategy-llm-failed"],
        };
      }
    },
  );
}

function resolveRecoveryConcurrency(): number {
  const parsed = Number.parseInt(
    readZevalEnvValue(["ZEVAL_JUDGE_SESSION_CONCURRENCY"]) ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_CONCURRENCY;
}

/**
 * Extract one rule-based recovery trace from a session.
 *
 * @param sessionId Session identifier.
 * @param rows Session rows.
 * @param goalCompletion Optional goal completion result.
 * @returns Recovery trace.
 */
function buildRecoveryTraceByRule(
  sessionId: string,
  rows: EnrichedChatlogRow[],
  goalCompletion?: GoalCompletionResult,
): RecoveryTraceResult {
  const candidate = detectFailureCandidate(rows);
  if (!candidate) {
    return finalizeTrace({
      sessionId,
      status: "none",
      failureTurn: null,
      recoveryTurn: null,
      spanTurns: null,
      failureType: "unknown",
      repairStrategy: null,
      repairStrategySource: "fallback",
      qualityScore: 0,
      evidence: [],
      triggeredRules: [],
      confidence: 0.45,
    });
  }

  const recoveryRow = detectRecoveryPoint(rows, candidate, goalCompletion);
  if (!recoveryRow) {
    return finalizeTrace({
      sessionId,
      status: "failed",
      failureTurn: candidate.turnIndex,
      recoveryTurn: null,
      spanTurns: null,
      failureType: candidate.failureType,
      repairStrategy: null,
      repairStrategySource: "rule",
      qualityScore: 1.6,
      evidence: buildEvidenceRows(rows, candidate.turnIndex, null),
      triggeredRules: [candidate.triggeredRule, "recovery-not-found"],
      confidence: 0.72,
    });
  }

  const spanTurns = recoveryRow.turnIndex - candidate.turnIndex;
  return finalizeTrace({
    sessionId,
    status: "completed",
    failureTurn: candidate.turnIndex,
    recoveryTurn: recoveryRow.turnIndex,
    spanTurns,
    failureType: candidate.failureType,
    repairStrategy: buildRepairStrategyByRule(recoveryRow, candidate.failureType),
    repairStrategySource: "rule",
    qualityScore: buildQualityScore(spanTurns, goalCompletion?.status),
    evidence: buildEvidenceRows(rows, candidate.turnIndex, recoveryRow.turnIndex),
    triggeredRules: [candidate.triggeredRule, detectRecoveryTrigger(recoveryRow)],
    confidence: 0.79,
  });
}

/**
 * Summarize the repair strategy with an LLM for completed traces only.
 *
 * @param trace Rule-based trace.
 * @param rows Session rows.
 * @param runId Optional run id.
 * @returns Trace with LLM repair strategy.
 */
async function enhanceRecoveryTraceWithLlm(
  trace: RecoveryTraceResult,
  rows: EnrichedChatlogRow[],
  runId?: string,
): Promise<RecoveryTraceResult> {
  if (trace.status !== "completed" || trace.failureTurn === null || trace.recoveryTurn === null) {
    return trace;
  }
  const failureTurn = trace.failureTurn;
  const recoveryTurn = trace.recoveryTurn;

  const transcript = rows
    .filter((row) => row.turnIndex >= failureTurn && row.turnIndex <= recoveryTurn)
    .map((row) => `[turn ${row.turnIndex}] [${row.role}] ${truncate(row.content, 180)}`)
    .join("\n");

  const raw = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("recovery_trace_strategy", [
          "你是对话评估系统中的 recovery-trace Judge。",
          "你的任务不是重新判断是否恢复成功，而是总结 Agent 采用了什么修复策略。",
          "只输出 JSON，不要 markdown，不要解释。",
          "repairStrategy 用 12 字以内中文短语表示，例如：apology + rephrase、先道歉再澄清、问题重述后给解决动作。",
          "confidence 为 0-1 的小数。",
          '输出：{"repairStrategy":"...","confidence":0.82}',
        ]),
      },
      {
        role: "user",
        content: [
          `sessionId=${trace.sessionId}`,
          `failureType=${trace.failureType}`,
          `failureTurn=${failureTurn}`,
          `recoveryTurn=${recoveryTurn}`,
          "请基于以下失败到恢复片段总结修复策略：",
          transcript,
        ].join("\n\n"),
      },
    ],
    {
      stage: "recovery_trace_strategy",
      runId,
      sessionId: trace.sessionId,
    },
  );

  const parsed = parseJsonObjectFromLlmOutput(raw) as RecoverySummaryPayload;
  const repairStrategy = normalizeText(parsed.repairStrategy, trace.repairStrategy ?? "恢复策略待补充");
  const confidence = clampConfidence(
    typeof parsed.confidence === "number" ? parsed.confidence : Math.max(trace.confidence, 0.78),
  );

  return {
    ...trace,
    repairStrategy,
    repairStrategySource: "llm",
    confidence,
    triggeredRules: [...trace.triggeredRules, "repair-strategy-llm"],
  };
}

/**
 * Detect the earliest meaningful failure candidate in a session.
 *
 * @param rows Session rows.
 * @returns Failure candidate when found.
 */
function detectFailureCandidate(rows: EnrichedChatlogRow[]): FailureCandidate | null {
  const candidates: FailureCandidate[] = [];

  const confusionRow = rows.find((row) => row.role === "user" && matchAny(row.content, CONFUSION_PATTERNS));
  if (confusionRow) {
    candidates.push({
      turnIndex: confusionRow.turnIndex,
      failureType: "understanding-barrier",
      triggeredRule: "user-confusion-expression",
      evidenceRows: [confusionRow],
    });
  }

  if (candidates.length === 0) {
    return null;
  }

  return candidates.sort((left, right) => left.turnIndex - right.turnIndex)[0] ?? null;
}

/**
 * Detect a recovery point within four turns after a failure candidate.
 *
 * @param rows Session rows.
 * @param candidate Failure candidate.
 * @param goalCompletion Optional goal completion result.
 * @returns Recovery row or null.
 */
function detectRecoveryPoint(
  rows: EnrichedChatlogRow[],
  candidate: FailureCandidate,
  goalCompletion?: GoalCompletionResult,
): EnrichedChatlogRow | null {
  const windowRows = rows.filter(
    (row) => row.turnIndex > candidate.turnIndex && row.turnIndex <= candidate.turnIndex + 4,
  );

  for (const row of windowRows) {
    if (row.role !== "assistant") {
      continue;
    }
    const repairSignal =
      matchAny(row.content, APOLOGY_PATTERNS) ||
      matchAny(row.content, REPHRASE_PATTERNS) ||
      matchAny(row.content, CLARIFICATION_PATTERNS);
    if (repairSignal) {
      return row;
    }
  }

  if (goalCompletion?.status === "achieved" || goalCompletion?.status === "partial") {
    return [...windowRows].reverse().find((row) => row.role === "assistant") ?? null;
  }

  return null;
}

/**
 * Build a rule-based repair strategy string.
 *
 * @param recoveryRow Recovery row.
 * @param failureType Failure type.
 * @returns Repair strategy label.
 */
function buildRepairStrategyByRule(
  recoveryRow: EnrichedChatlogRow,
  failureType: RecoveryFailureType,
): string {
  if (matchAny(recoveryRow.content, APOLOGY_PATTERNS) && matchAny(recoveryRow.content, REPHRASE_PATTERNS)) {
    return "先道歉再重述";
  }
  if (matchAny(recoveryRow.content, CLARIFICATION_PATTERNS)) {
    return "澄清后重新推进";
  }
  if (matchAny(recoveryRow.content, APOLOGY_PATTERNS)) {
    return "道歉止损";
  }
  if (recoveryRow.isQuestion) {
    return "追问澄清";
  }
  if (failureType === "ignore") {
    return "回到用户原问题";
  }
  if (failureType === "understanding-barrier") {
    return "重新解释与确认";
  }
  return "恢复策略待补充";
}

/**
 * Build a recovery quality score.
 *
 * @param spanTurns Number of turns between failure and recovery.
 * @param goalStatus Goal completion status.
 * @returns Quality score in the 1-5 range.
 */
function buildQualityScore(
  spanTurns: number,
  goalStatus: GoalCompletionResult["status"] | undefined,
): number {
  let score = 5 - spanTurns * 0.5;
  if (goalStatus === "achieved") {
    score += 1;
  } else if (goalStatus === "partial") {
    score += 0.5;
  } else if (goalStatus === "failed") {
    score -= 0.6;
  }
  return clampScore(score);
}

/**
 * Build evidence rows around the failure and optional recovery span.
 *
 * @param rows Session rows.
 * @param failureTurn Failure turn.
 * @param recoveryTurn Optional recovery turn.
 * @returns Evidence rows.
 */
function buildEvidenceRows(
  rows: EnrichedChatlogRow[],
  failureTurn: number,
  recoveryTurn: number | null,
): RecoveryTraceResult["evidence"] {
  const endTurn = recoveryTurn ?? Math.min(failureTurn + 2, rows[rows.length - 1]?.turnIndex ?? failureTurn);
  return rows
    .filter((row) => row.turnIndex >= Math.max(1, failureTurn - 1) && row.turnIndex <= endTurn)
    .slice(0, 5)
    .map((row) => ({
      turnIndex: row.turnIndex,
      role: row.role,
      content: truncate(row.content, 120),
    }));
}

/**
 * Detect which rule closed the recovery.
 *
 * @param recoveryRow Recovery row.
 * @returns Rule label.
 */
function detectRecoveryTrigger(recoveryRow: EnrichedChatlogRow): string {
  if (matchAny(recoveryRow.content, APOLOGY_PATTERNS)) {
    return "assistant-apology";
  }
  if (matchAny(recoveryRow.content, REPHRASE_PATTERNS)) {
    return "assistant-rephrase";
  }
  if (matchAny(recoveryRow.content, CLARIFICATION_PATTERNS)) {
    return "assistant-clarification";
  }
  return "recovery-window-hit";
}

/**
 * Finalize one trace with clamped fields.
 *
 * @param input Trace input.
 * @returns Structured trace result.
 */
function finalizeTrace(input: {
  sessionId: string;
  status: RecoveryTraceResult["status"];
  failureTurn: number | null;
  recoveryTurn: number | null;
  spanTurns: number | null;
  failureType: RecoveryFailureType;
  repairStrategy: string | null;
  repairStrategySource: FieldSource;
  qualityScore: number;
  evidence: RecoveryTraceResult["evidence"];
  triggeredRules: string[];
  confidence: number;
}): RecoveryTraceResult {
  return {
    sessionId: input.sessionId,
    status: input.status,
    failureTurn: input.failureTurn,
    recoveryTurn: input.recoveryTurn,
    spanTurns: input.spanTurns,
    failureType: input.failureType,
    repairStrategy: input.repairStrategy,
    repairStrategySource: input.repairStrategySource,
    qualityScore: clampScore(input.qualityScore),
    evidence: input.evidence,
    triggeredRules: input.triggeredRules,
    confidence: clampConfidence(input.confidence),
  };
}

/**
 * Group rows by session while preserving order.
 *
 * @param rows Enriched rows.
 * @returns Session map.
 */
function groupRowsBySession(rows: EnrichedChatlogRow[]): Map<string, EnrichedChatlogRow[]> {
  const grouped = new Map<string, EnrichedChatlogRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) {
      grouped.set(row.sessionId, []);
    }
    grouped.get(row.sessionId)?.push(row);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => left.turnIndex - right.turnIndex);
  }
  return grouped;
}

/**
 * Check whether a string matches one of the supplied patterns.
 *
 * @param value Raw string.
 * @param patterns Pattern list.
 * @returns Whether any pattern matches.
 */
function matchAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

/**
 * Clamp a quality score into the 0-5 range with one decimal precision.
 *
 * @param value Raw score.
 * @returns Clamped score.
 */
function clampScore(value: number): number {
  return Math.max(0, Math.min(5, Number(value.toFixed(1))));
}

/**
 * Clamp confidence into the 0-1 range.
 *
 * @param value Raw confidence.
 * @returns Clamped confidence.
 */
function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

/**
 * Normalize a possibly empty string.
 *
 * @param value Candidate string.
 * @param fallback Fallback string.
 * @returns Non-empty string.
 */
function normalizeText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

/**
 * Truncate text for compact evidence display.
 *
 * @param value Raw text.
 * @param max Maximum length.
 * @returns Truncated string.
 */
function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}…`;
}
