/**
 * @fileoverview Subjective metric aggregation with LLM judging.
 *
 * P1 重构：已移除 emotionCurve / emotionTurningPoints / topicSegmentId 依赖。
 * 评估维度从 4 个调整为 3 个（移除依赖 emotionScore 的"情绪恢复能力"）。
 */

import { mapWithConcurrency, resolveJudgeConcurrency } from "@/lib/concurrency";
import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import { buildVersionedJudgeSystemPrompt } from "@/llm/judgeProfile";
import { buildGoalCompletions } from "@/pipeline/goalCompletion";
import { buildRecoveryTraces } from "@/pipeline/recoveryTrace";
import { buildImplicitSignals } from "@/pipeline/signals";
import type {
  EnrichedChatlogRow,
  ImplicitSignal,
  SubjectiveDimensionResult,
  SubjectiveMetrics,
} from "@/types/pipeline";

const SUBJECTIVE_DIMENSIONS = ["共情程度", "答非所问/无视风险", "说教感/压迫感"] as const;

type SubjectiveMetricsOptions = {
  judgeRequired?: boolean;
};

type LlmJudgePayload = {
  dimensions?: Array<{
    dimension?: string;
    score?: number;
    reason?: string;
    evidence?: string;
    confidence?: number;
  }>;
};

type LlmJudgeDimensionPayload = NonNullable<LlmJudgePayload["dimensions"]>[number];

/**
 * Build subjective metrics from enriched rows.
 * @param rows Enriched rows.
 * @param useLlm Whether llm mode was requested.
 * @param runId Optional run id for logging.
 * @param options Optional strict judge behavior.
 * @returns Subjective metric summary.
 */
export async function buildSubjectiveMetrics(
  rows: EnrichedChatlogRow[],
  useLlm: boolean,
  runId?: string,
  options: SubjectiveMetricsOptions = {},
): Promise<SubjectiveMetrics> {
  const judgeRequired = options.judgeRequired ?? false;
  const signals = buildImplicitSignals(rows);
  const fallbackDimensions = buildRuleBasedDimensions(rows, signals);
  if (!useLlm && judgeRequired) {
    throw new Error("LLM Judge 是当前评估的强依赖，但本次请求关闭了 useLlm。");
  }

  // ① goalCompletions 必须先完成：recoveryTraces 以其结果为入参，强依赖。
  const goalCompletions = await buildGoalCompletions(rows, useLlm, runId, { judgeRequired });

  if (!useLlm) {
    // 降级路径：recoveryTraces 不调 LLM，顺序执行即可。
    const recoveryTraces = await buildRecoveryTraces(rows, goalCompletions, false, runId, { judgeRequired });
    return {
      status: "degraded",
      dimensions: fallbackDimensions,
      signals,
      goalCompletions,
      recoveryTraces,
    };
  }

  // LLM 路径：
  // ② recoveryTraces 依赖 goalCompletions（已完成），与 ③ 无交叉。
  // ③ sessionDimensionJudge 只依赖 rows + signals（均已就绪）。
  // → ② 和 ③ 可以并行，节省一整个维度判断阶段的等待时间。
  const grouped = groupRowsBySession(rows);

  try {
    const [recoveryTraces, sessionReviews] = await Promise.all([
      // ② recovery trace LLM 增强（仅 completed trace 才调 LLM）
      buildRecoveryTraces(rows, goalCompletions, useLlm, runId, { judgeRequired }),
      // ③ 三维度判断（每 session 一次 LLM call，并发上限由 resolveJudgeConcurrency 控制）
      mapWithConcurrency(
        [...grouped.entries()],
        resolveJudgeConcurrency(),
        async ([sessionId, sessionRows]) => {
          try {
            return {
              sessionId,
              dimensions: await judgeSessionDimensionsWithLlm(sessionRows, signals, runId, { requireComplete: judgeRequired }),
              weight: sessionRows.length,
              succeeded: true,
            };
          } catch (error) {
            if (judgeRequired) {
              const message = error instanceof Error ? error.message : String(error);
              throw new Error(`LLM Judge 失败，session=${sessionId}：${message}`);
            }
            console.error("Session subjective judge failed:", sessionId, error);
            return {
              sessionId,
              dimensions: buildRuleBasedDimensions(sessionRows, signals),
              weight: sessionRows.length,
              succeeded: false,
            };
          }
        },
      ),
    ]);

    return {
      status: sessionReviews.every((review) => review.succeeded) ? "ready" : "degraded",
      dimensions: aggregateDimensionReviews(
        sessionReviews.map((review) => review.dimensions),
        sessionReviews.map((review) => review.weight),
      ),
      signals,
      goalCompletions,
      recoveryTraces,
    };
  } catch (error) {
    if (judgeRequired) throw error;
    console.error("SiliconFlow subjective judge failed:", error);
    // 降级：Promise.all 失败时 recoveryTraces 可能未完成，以空数组兜底。
    // judgeRequired=true 时已在上方 rethrow，此处只处理可容忍失败路径。
    return {
      status: "degraded",
      dimensions: fallbackDimensions,
      signals,
      goalCompletions,
      recoveryTraces: [],
    };
  }
}

async function judgeSessionDimensionsWithLlm(
  rows: EnrichedChatlogRow[],
  signals: ImplicitSignal[],
  runId?: string,
  options: { requireComplete?: boolean } = {},
): Promise<SubjectiveDimensionResult[]> {
  const fallbackDimensions = buildRuleBasedDimensions(rows, signals);
  const transcript = buildSessionJudgeTranscript(rows, signals);
  const rawResponse = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("subjective_dimension_judge", [
          "你是对话评估系统中的审稿型 Judge。",
          "输入已做了隐式信号提取，请基于原文评估以下三个维度。",
          "你只输出 JSON，不要输出 markdown，不要补充解释。",
          "请评估三个维度：共情程度、答非所问/无视风险、说教感/压迫感。",
          "score 必须是 1 到 5 的整数，分数越高越好。",
          "confidence 必须是 0 到 1 的小数。",
          "evidence 必须引用原始对话片段，不要编造。",
          '输出格式：{"dimensions":[{"dimension":"共情程度","score":4,"reason":"...","evidence":"...","confidence":0.82}]}',
        ]),
      },
      { role: "user", content: transcript },
    ],
    { stage: "subjective_dimension_judge", runId, sessionId: rows[0]?.sessionId },
  );

  const parsed = parseJsonObjectFromLlmOutput(rawResponse) as LlmJudgePayload;
  const byName = new Map(
    (parsed.dimensions ?? [])
      .filter((item) => typeof item.dimension === "string" && item.dimension.length > 0)
      .map((item) => [item.dimension as string, item]),
  );

  return SUBJECTIVE_DIMENSIONS.map((dimension, index) => {
    const fallback = fallbackDimensions[index];
    const candidate = byName.get(dimension);
    if (!candidate) {
      if (options.requireComplete) throw new Error(`LLM Judge 输出缺少维度：${dimension}`);
      return fallback;
    }
    if (options.requireComplete && !isCompleteDimensionPayload(candidate)) {
      throw new Error(`LLM Judge 输出维度不完整：${dimension}`);
    }
    return {
      dimension,
      score: clampScore(typeof candidate.score === "number" ? candidate.score : fallback.score),
      reason: normalizeText(candidate.reason, fallback.reason),
      evidence: normalizeText(candidate.evidence, fallback.evidence),
      confidence: clampConfidence(typeof candidate.confidence === "number" ? candidate.confidence : fallback.confidence),
    };
  });
}

function isCompleteDimensionPayload(value: LlmJudgeDimensionPayload): boolean {
  return (
    typeof value.score === "number" &&
    typeof value.reason === "string" && value.reason.trim().length > 0 &&
    typeof value.evidence === "string" && value.evidence.trim().length > 0 &&
    typeof value.confidence === "number"
  );
}


/**
 * Build the transcript sent to the LLM judge (no topic/emotion metadata).
 */
function buildSessionJudgeTranscript(rows: EnrichedChatlogRow[], signals: ImplicitSignal[]): string {
  const sessionId = rows[0]?.sessionId ?? "unknown";
  const relevantSignals = signals.filter((signal) => signal.evidenceTurnRange.startsWith(`${sessionId}:`));
  const turns = rows.map((row) => `[turn ${row.turnIndex}] [${row.role}] ${row.content}`).join("\n");

  return [
    `sessionId=${sessionId}`,
    "隐式推断信号：",
    relevantSignals.length
      ? relevantSignals.map((s) => `${s.signalKey} score=${s.score} severity=${s.severity} evidence=${s.evidenceTurnRange}`).join("\n")
      : "none",
    "对话内容：",
    turns,
    "请基于以上内容输出三个维度的结构化评估 JSON。",
  ].join("\n\n");
}

/**
 * Build rule-based dimensions as the degradation fallback.
 */
function buildRuleBasedDimensions(
  rows: EnrichedChatlogRow[],
  signals: ImplicitSignal[],
): SubjectiveDimensionResult[] {
  return [
    buildDimension("共情程度", scoreEmpathy(rows), "共情语句密度与安抚表达"),
    buildDimension("答非所问/无视风险", scoreOffTopic(rows, signals), "理解障碍信号与重复提问率"),
    buildDimension("说教感/压迫感", scorePreachiness(rows), "强指导词与命令式语气"),
  ];
}

function buildDimension(dimension: string, score: number, reason: string): SubjectiveDimensionResult {
  return {
    dimension,
    score,
    reason,
    evidence: "当前结果为规则降级模式，证据来自关键词与对话结构近似推断。",
    confidence: 0.58,
  };
}

function scoreEmpathy(rows: EnrichedChatlogRow[]): number {
  const assistantRows = rows.filter((row) => row.role === "assistant");
  if (assistantRows.length === 0) return 1;
  const hits = assistantRows.filter((row) => /(理解|明白|支持|陪你|辛苦|正常)/.test(row.content)).length;
  return clampScore((hits / assistantRows.length) * 5);
}

function scoreOffTopic(rows: EnrichedChatlogRow[], signals: ImplicitSignal[]): number {
  const understandingRisk = signals.find((s) => s.signalKey === "understandingBarrierRisk")?.score ?? 0;
  // Use repeat-question rate as a proxy for off-topic risk (no isTopicSwitch in new schema)
  const userRows = rows.filter((r) => r.role === "user" && r.isQuestion);
  const questionCount = userRows.length;
  const repeatedQuestionRate = questionCount > 1
    ? (() => {
        const counts = new Map<string, number>();
        userRows.forEach((r) => {
          const key = r.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 18);
          counts.set(key, (counts.get(key) ?? 0) + 1);
        });
        const repeated = [...counts.values()].filter((c) => c >= 2).length;
        return repeated / questionCount;
      })()
    : 0;
  return clampScore(5 - repeatedQuestionRate * 6 - understandingRisk * 2);
}

function scorePreachiness(rows: EnrichedChatlogRow[]): number {
  const assistantRows = rows.filter((row) => row.role === "assistant");
  if (assistantRows.length === 0) return 1;
  const preachyCount = assistantRows.filter((row) => /(应该|必须|你要|一定要)/.test(row.content)).length;
  return clampScore(5 - (preachyCount / assistantRows.length) * 10);
}

function clampScore(score: number): number {
  return Math.max(1, Math.min(5, Math.round(score)));
}

function clampConfidence(confidence: number): number {
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}

function normalizeText(value: string | undefined, fallback: string): string {
  const normalized = collapseRepeatedTokens(value?.trim() ?? "");
  const selected = normalized && normalized.length > 0 ? normalized : fallback;
  return selected.length <= 260 ? selected : `${selected.slice(0, 260)}…`;
}

function collapseRepeatedTokens(value: string): string {
  const tokens = value.split(/(\s+)/);
  let lastWord = "";
  let repeatCount = 0;
  return tokens
    .filter((token) => {
      if (/^\s+$/.test(token)) return true;
      if (token === lastWord) { repeatCount += 1; } else { lastWord = token; repeatCount = 1; }
      return repeatCount <= 3;
    })
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function aggregateDimensionReviews(
  dimensionSets: SubjectiveDimensionResult[][],
  weights: number[],
): SubjectiveDimensionResult[] {
  return SUBJECTIVE_DIMENSIONS.map((dimension) => {
    const items = dimensionSets.map((set, index) => ({
      item: set.find((c) => c.dimension === dimension),
      weight: weights[index] ?? 1,
    }));
    const totalWeight = items.reduce((sum, e) => sum + e.weight, 0);
    const weightedScore = totalWeight === 0
      ? 1
      : items.reduce((sum, e) => sum + (e.item?.score ?? 1) * e.weight, 0) / totalWeight;
    const firstItem = items.find((e) => e.item)?.item;
    const mergedEvidence = items
      .map((e) => e.item?.evidence)
      .filter((v): v is string => Boolean(v))
      .slice(0, 2)
      .join("；");
    const confidence = totalWeight === 0
      ? 0.58
      : items.reduce((sum, e) => sum + (e.item?.confidence ?? 0.58) * e.weight, 0) / totalWeight;

    return {
      dimension,
      score: clampScore(weightedScore),
      reason: firstItem?.reason ?? "当前结果为多 session 聚合后的近似评估。",
      evidence: mergedEvidence || "未提取到稳定证据。",
      confidence: clampConfidence(confidence),
    };
  });
}

function groupRowsBySession(rows: EnrichedChatlogRow[]): Map<string, EnrichedChatlogRow[]> {
  const grouped = new Map<string, EnrichedChatlogRow[]>();
  rows.forEach((row) => {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId)?.push(row);
  });
  return grouped;
}
