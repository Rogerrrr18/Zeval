/**
 * @fileoverview Session-level goal completion evaluation.
 *
 * 策略：规则硬信号优先，unclear 才调 LLM。
 * - achieved 硬信号：assistant 最后出现解决态 + 用户无进一步追问或明确致谢
 * - failed 硬信号：放弃词 / 转人工 / 重复提问 ≥ 3
 * - 否则 → intent 抽取（LLM）+ 终裁（LLM）
 */

import { mapWithConcurrency, DEFAULT_LLM_CONCURRENCY } from "@/lib/concurrency";
import { parseJsonObjectFromLlmOutput, readZevalEnvValue, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import { buildVersionedJudgeSystemPrompt } from "@/llm/judgeProfile";
import type {
  ChatRole,
  EnrichedChatlogRow,
  FieldSource,
  GoalCompletionResult,
  GoalCompletionStatus,
} from "@/types/pipeline";

const RESOLUTION_PATTERNS = [
  /(已经?为您|已[帮给]您)(处理|安排|解决|提交|下单|发送|操作)/,
  /(这就|马上|立刻)(帮您|给您|为您)(处理|安排|操作)/,
  /(已完成|已解决|已搞定|已结束|问题已经?解决)/,
  /(办好了|弄好了|处理好了|完成了|搞定了)/,
];

const APPRECIATION_PATTERNS = [
  /^(好的|行|ok|可以|谢谢|多谢|感谢|辛苦了|收到|明白了)/i,
  /(谢谢|感谢|辛苦)/,
];

const GIVE_UP_PATTERNS = [
  /^(算了|不用了|不聊了|不想再|放弃)/,
  /(别说了|不要再|浪费时间)/,
];

const ESCALATION_PATTERNS = [
  /(转人工|找客服|投诉|经理|主管)/,
];

const FAILURE_EXPRESSIONS = [
  /(还是不行|没解决|解决不了|没有用|搞不定|完全不对)/,
  /(你不明白|你没听懂|答非所问|驴唇不对马嘴)/,
];

type LlmIntentAndJudgePayload = {
  userIntent?: string;
  status?: string;
  score?: number;
  achievementEvidence?: string[];
  failureReasons?: string[];
  confidence?: number;
};

type GoalCompletionOptions = {
  judgeRequired?: boolean;
};

/**
 * Build goal completion results for every session in the enriched rows.
 *
 * @param rows Enriched rows.
 * @param useLlm Whether LLM fallback is enabled.
 * @param runId Optional run id for logging.
 * @param options Optional strict judge behavior.
 * @returns One goal completion result per session.
 */
export async function buildGoalCompletions(
  rows: EnrichedChatlogRow[],
  useLlm: boolean,
  runId?: string,
  options: GoalCompletionOptions = {},
): Promise<GoalCompletionResult[]> {
  const grouped = groupRowsBySession(rows);
  const concurrency = resolveGoalCompletionConcurrency();

  return mapWithConcurrency(
    [...grouped.entries()],
    concurrency,
    async ([sessionId, sessionRows]) => {
      const ruleResult = evaluateGoalCompletionByRule(sessionId, sessionRows);
      if (ruleResult.status !== "unclear" || !useLlm) {
        return ruleResult;
      }

      try {
        return await evaluateGoalCompletionWithLlm(sessionId, sessionRows, ruleResult, runId);
      } catch (error) {
        if (options.judgeRequired) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Goal completion LLM Judge 失败，session=${sessionId}：${message}`);
        }
        console.error("Goal completion LLM judge failed:", sessionId, error);
        return {
          ...ruleResult,
          triggeredRules: [...ruleResult.triggeredRules, "llm-fallback-failed"],
        };
      }
    },
  );
}

function resolveGoalCompletionConcurrency(): number {
  const parsed = Number.parseInt(
    readZevalEnvValue(["ZEVAL_JUDGE_SESSION_CONCURRENCY"]) ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_CONCURRENCY;
}

/**
 * Rule-based goal completion judgement.
 * Returns "unclear" when hard signals are ambiguous, so the caller can escalate to LLM.
 *
 * @param sessionId Session identifier.
 * @param rows Session rows sorted by turn index.
 * @returns A goal completion result.
 */
function evaluateGoalCompletionByRule(
  sessionId: string,
  rows: EnrichedChatlogRow[],
): GoalCompletionResult {
  const userRows = rows.filter((row) => row.role === "user");
  const assistantRows = rows.filter((row) => row.role === "assistant");
  const triggeredRules: string[] = [];
  const achievementEvidence: string[] = [];
  const failureReasons: string[] = [];

  const rawIntent = extractRawIntent(userRows);

  const failureHit = collectFailureSignals(userRows, assistantRows, triggeredRules, failureReasons);
  const achievementHit = collectAchievementSignals(rows, assistantRows, userRows, triggeredRules, achievementEvidence);

  if (failureHit && !achievementHit) {
    return finalize(sessionId, {
      status: "failed",
      score: failureReasons.length >= 2 ? 1 : 2,
      userIntent: rawIntent,
      intentSource: "rule",
      achievementEvidence,
      failureReasons,
      triggeredRules,
      confidence: 0.74,
      source: "rule",
    });
  }

  if (achievementHit && !failureHit) {
    return finalize(sessionId, {
      status: "achieved",
      score: achievementEvidence.length >= 2 ? 5 : 4,
      userIntent: rawIntent,
      intentSource: "rule",
      achievementEvidence,
      failureReasons,
      triggeredRules,
      confidence: 0.76,
      source: "rule",
    });
  }

  if (achievementHit && failureHit) {
    return finalize(sessionId, {
      status: "partial",
      score: 3,
      userIntent: rawIntent,
      intentSource: "rule",
      achievementEvidence,
      failureReasons,
      triggeredRules,
      confidence: 0.6,
      source: "rule",
    });
  }

  return finalize(sessionId, {
    status: "unclear",
    score: 3,
    userIntent: rawIntent,
    intentSource: "rule",
    achievementEvidence,
    failureReasons,
    triggeredRules,
    confidence: 0.45,
    source: "rule",
  });
}

/**
 * Collect hard failure signals.
 *
 * @param userRows User rows.
 * @param assistantRows Assistant rows.
 * @param triggeredRules Rule accumulator.
 * @param failureReasons Failure reason accumulator.
 * @returns Whether any failure signal is hit.
 */
function collectFailureSignals(
  userRows: EnrichedChatlogRow[],
  _assistantRows: EnrichedChatlogRow[],
  triggeredRules: string[],
  failureReasons: string[],
): boolean {
  let hit = false;

  const tailUserRows = userRows.slice(-2);
  const giveUp = tailUserRows.find((row) => matchAny(row.content, GIVE_UP_PATTERNS));
  if (giveUp) {
    triggeredRules.push("user-give-up");
    failureReasons.push(`用户在第 ${giveUp.turnIndex} 轮出现放弃表达：${truncate(giveUp.content, 60)}`);
    hit = true;
  }

  const escalation = userRows.find((row) => matchAny(row.content, ESCALATION_PATTERNS));
  if (escalation) {
    triggeredRules.push("escalation-keyword");
    failureReasons.push(`用户在第 ${escalation.turnIndex} 轮要求升级：${truncate(escalation.content, 60)}`);
    hit = true;
  }

  const explicitFailure = userRows.find((row) => matchAny(row.content, FAILURE_EXPRESSIONS));
  if (explicitFailure) {
    triggeredRules.push("explicit-failure-phrase");
    failureReasons.push(
      `用户在第 ${explicitFailure.turnIndex} 轮明确表达问题未解决：${truncate(explicitFailure.content, 60)}`,
    );
    hit = true;
  }

  const repeatCount = countRepeatedQuestions(userRows);
  if (repeatCount >= 3) {
    triggeredRules.push("user-repeat-question-3x");
    failureReasons.push(`用户重复提问 ${repeatCount} 次，意图未被有效响应。`);
    hit = true;
  }

  return hit;
}

/**
 * Collect achievement hard signals.
 *
 * @param rows All session rows.
 * @param assistantRows Assistant rows.
 * @param userRows User rows.
 * @param triggeredRules Rule accumulator.
 * @param achievementEvidence Evidence accumulator.
 * @returns Whether any achievement signal is hit.
 */
function collectAchievementSignals(
  rows: EnrichedChatlogRow[],
  assistantRows: EnrichedChatlogRow[],
  userRows: EnrichedChatlogRow[],
  triggeredRules: string[],
  achievementEvidence: string[],
): boolean {
  let hit = false;

  const resolutionAssistant = [...assistantRows].reverse().find((row) => matchAny(row.content, RESOLUTION_PATTERNS));
  if (resolutionAssistant) {
    const followingUserRows = userRows.filter((row) => row.turnIndex > resolutionAssistant.turnIndex);
    const noFollowUpQuestion = followingUserRows.every((row) => !row.isQuestion);
    if (noFollowUpQuestion) {
      triggeredRules.push("assistant-resolution-stated");
      achievementEvidence.push(
        `Assistant 第 ${resolutionAssistant.turnIndex} 轮：${truncate(resolutionAssistant.content, 80)}`,
      );
      hit = true;
    }
  }

  const lastUser = [...userRows].reverse()[0];
  if (lastUser && matchAny(lastUser.content, APPRECIATION_PATTERNS) && lastUser.content.trim().length <= 20) {
    triggeredRules.push("user-appreciation-close");
    achievementEvidence.push(`用户末轮致谢或确认：${truncate(lastUser.content, 60)}`);
    hit = true;
  }

  return hit;
}

/**
 * LLM fallback judgement for unclear sessions.
 *
 * @param sessionId Session identifier.
 * @param rows Session rows.
 * @param ruleResult Rule baseline (for fallback fields).
 * @param runId Optional run id.
 * @returns Refined goal completion result.
 */
async function evaluateGoalCompletionWithLlm(
  sessionId: string,
  rows: EnrichedChatlogRow[],
  ruleResult: GoalCompletionResult,
  runId?: string,
): Promise<GoalCompletionResult> {
  const transcript = buildTranscriptForLlm(rows);
  const firstUserTurns = rows
    .filter((row) => row.role === "user")
    .slice(0, 3)
    .map((row) => `[turn ${row.turnIndex}] ${row.content}`)
    .join("\n");

  const raw = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("goal_completion_judge", [
          "你是对话评估系统的 goal-completion Judge。",
          "任务：判断用户的最初意图在本 session 内是否被达成。",
          "只输出 JSON，不要 markdown，不要解释。",
          "status 只能是 achieved / partial / failed / unclear 之一。",
          "score 为 1 到 5 的整数，5 表示完全达成，1 表示完全未达成。",
          "userIntent 必须是从前 3 轮用户消息中抽取的 30 字以内的意图描述。",
          "achievementEvidence 与 failureReasons 是字符串数组，引用原文片段，不要编造。",
          "confidence 为 0-1 的小数。",
          '输出：{"userIntent":"...","status":"...","score":0,"achievementEvidence":[],"failureReasons":[],"confidence":0}',
        ]),
      },
      {
        role: "user",
        content: [
          `sessionId=${sessionId}`,
          "用户前 3 轮消息（用于抽取 intent）：",
          firstUserTurns || "(无)",
          "完整 session（按时间顺序）：",
          transcript,
          "请输出结构化 JSON。",
        ].join("\n\n"),
      },
    ],
    { stage: "goal_completion_judge", runId, sessionId },
  );

  const parsed = parseJsonObjectFromLlmOutput(raw) as LlmIntentAndJudgePayload;
  const status = normalizeStatus(parsed.status, ruleResult.status);
  const score = clampScore(typeof parsed.score === "number" ? parsed.score : ruleResult.score);
  const intent = normalizeText(parsed.userIntent, ruleResult.userIntent);
  const achievementEvidence = dedupeStrings([
    ...(parsed.achievementEvidence ?? []).filter(isNonEmptyString),
    ...ruleResult.achievementEvidence,
  ]).slice(0, 4);
  const failureReasons = dedupeStrings([
    ...(parsed.failureReasons ?? []).filter(isNonEmptyString),
    ...ruleResult.failureReasons,
  ]).slice(0, 4);
  const confidence = clampConfidence(
    typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
  );

  return {
    sessionId,
    status,
    score,
    userIntent: intent,
    intentSource: "llm",
    achievementEvidence,
    failureReasons,
    triggeredRules: [...ruleResult.triggeredRules, "llm-judge"],
    confidence,
    source: "llm",
  };
}

/**
 * Extract rough user intent from early user rows.
 *
 * @param userRows User rows.
 * @returns Short intent description.
 */
function extractRawIntent(userRows: EnrichedChatlogRow[]): string {
  const firstMeaningful = userRows.find((row) => row.content.trim().length >= 3) ?? userRows[0];
  if (!firstMeaningful) {
    return "(未识别到用户意图)";
  }
  return truncate(firstMeaningful.content.trim(), 30);
}

/**
 * Build a compact transcript for LLM context.
 *
 * @param rows Session rows.
 * @returns Newline-joined transcript.
 */
function buildTranscriptForLlm(rows: EnrichedChatlogRow[]): string {
  const maxTurns = 24;
  const slice = rows.length <= maxTurns ? rows : [...rows.slice(0, 8), ...rows.slice(-16)];
  return slice
    .map((row) => `[turn ${row.turnIndex}] [${row.role}] ${truncate(row.content, 160)}`)
    .join("\n");
}

/**
 * Count how many user questions repeat after normalization.
 *
 * @param userRows User rows.
 * @returns The maximum repeat count.
 */
function countRepeatedQuestions(userRows: EnrichedChatlogRow[]): number {
  const counts = new Map<string, number>();
  for (const row of userRows) {
    if (!row.isQuestion) continue;
    const normalized = row.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 20);
    if (normalized.length === 0) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.values()].reduce((max, value) => Math.max(max, value), 0);
}

/**
 * Final assembly helper.
 *
 * @param sessionId Session identifier.
 * @param input Partial fields.
 * @returns A goal completion result.
 */
function finalize(
  sessionId: string,
  input: {
    status: GoalCompletionStatus;
    score: number;
    userIntent: string;
    intentSource: FieldSource;
    achievementEvidence: string[];
    failureReasons: string[];
    triggeredRules: string[];
    confidence: number;
    source: FieldSource;
  },
): GoalCompletionResult {
  return {
    sessionId,
    status: input.status,
    score: clampScore(input.score),
    userIntent: input.userIntent,
    intentSource: input.intentSource,
    achievementEvidence: input.achievementEvidence.slice(0, 4),
    failureReasons: input.failureReasons.slice(0, 4),
    triggeredRules: input.triggeredRules,
    confidence: clampConfidence(input.confidence),
    source: input.source,
  };
}

/**
 * Group rows by sessionId preserving turn order.
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
    list.sort((a, b) => a.turnIndex - b.turnIndex);
  }
  return grouped;
}

function matchAny(value: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(value));
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function clampScore(score: number): number {
  return Math.max(1, Math.min(5, Math.round(score)));
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}

function normalizeText(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}

function normalizeStatus(value: string | undefined, fallback: GoalCompletionStatus): GoalCompletionStatus {
  if (value === "achieved" || value === "partial" || value === "failed" || value === "unclear") {
    return value;
  }
  return fallback;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

// Exported for test purposes.
export const __internals = {
  evaluateGoalCompletionByRule,
  RESOLUTION_PATTERNS,
  APPRECIATION_PATTERNS,
  GIVE_UP_PATTERNS,
  ESCALATION_PATTERNS,
  FAILURE_EXPRESSIONS,
};

// Silence unused-role import lint in strict mode when only referenced in types.
export type { ChatRole };
