/**
 * @fileoverview Feature extraction for harvested bad cases.
 */

import type { BadCaseFeatureSnapshot } from "@/badcase/types";
import type { DatasetCaseRecord } from "@/eval-datasets/storage/types";
import type { EvaluateResponse } from "@/types/pipeline";

const METRIC_KEYS = [
  "severity_score",
  "turn_count_norm",
  "low_emotion_rate",
  "avg_response_gap_norm",
  "topic_switch_rate_norm",
  "question_repeat_risk",
  "escalation_hit",
  "goal_failure_risk",
  "recovery_failure_risk",
  "understanding_barrier_risk",
  "emotion_recovery_failure_risk",
  "off_topic_badness",
  "empathy_gap",
  "preachiness_gap",
  "business_risk",
] as const;

/**
 * Build one feature snapshot from a harvested bad case asset.
 *
 * @param evaluate Full evaluate response that produced the asset.
 * @param assetIndex Index of the bad case asset in `evaluate.badCaseAssets`.
 * @returns Feature snapshot for later dedupe and clustering.
 */
export function buildBadCaseFeatureSnapshot(
  evaluate: EvaluateResponse,
  assetIndex: number,
): BadCaseFeatureSnapshot {
  const asset = evaluate.badCaseAssets[assetIndex];
  const sessionRows = evaluate.enrichedRows.filter((row) => row.sessionId === asset.sessionId);
  const userRows = sessionRows.filter((row) => row.role === "user");
  const gapRows = sessionRows
    .map((row) => row.responseGapSec)
    .filter((gap): gap is number => typeof gap === "number");
  const repeatedQuestions = findRepeatedQuestionCount(userRows.map((row) => row.content));
  const avgGap = gapRows.length > 0 ? gapRows.reduce((sum, gap) => sum + gap, 0) / gapRows.length : 0;
  const sessionTopicSwitches = 0;
  const goalCompletion = evaluate.subjectiveMetrics.goalCompletions.find((item) => item.sessionId === asset.sessionId);
  const recoveryTrace = evaluate.subjectiveMetrics.recoveryTraces.find((item) => item.sessionId === asset.sessionId);
  const understandingSignal =
    evaluate.subjectiveMetrics.signals.find(
      (item) => item.signalKey === "understandingBarrierRisk" && item.evidenceTurnRange.startsWith(`${asset.sessionId}:`),
    )?.score ?? 0;
  const recoverySignal = 0;
  const empathyScore =
    evaluate.subjectiveMetrics.dimensions.find((item) => item.dimension === "共情程度")?.score ?? 3;
  const offTopicScore =
    evaluate.subjectiveMetrics.dimensions.find((item) => item.dimension === "答非所问/无视风险")?.score ?? 3;
  const preachinessScore =
    evaluate.subjectiveMetrics.dimensions.find((item) => item.dimension === "说教感/压迫感")?.score ?? 3;
  const businessRisk = evaluate.scenarioEvaluation ? 1 - evaluate.scenarioEvaluation.averageScore : 0.5;

  const metricValues = new Map<string, number>([
    ["severity_score", asset.severityScore],
    ["turn_count_norm", clamp01(sessionRows.length / 20)],
    ["low_emotion_rate", 0],
    ["avg_response_gap_norm", clamp01(avgGap / 120)],
    ["topic_switch_rate_norm", clamp01(Math.max(0, sessionTopicSwitches) / 3)],
    ["question_repeat_risk", clamp01(repeatedQuestions / Math.max(1, userRows.length))],
    ["escalation_hit", asset.tags.includes("escalation_keyword") ? 1 : 0],
    ["goal_failure_risk", mapGoalStatusToRisk(goalCompletion?.status)],
    ["recovery_failure_risk", mapRecoveryStatusToRisk(recoveryTrace?.status)],
    ["understanding_barrier_risk", clamp01(understandingSignal)],
    ["emotion_recovery_failure_risk", clamp01(recoverySignal)],
    ["off_topic_badness", clamp01(1 - offTopicScore / 5)],
    ["empathy_gap", clamp01(1 - empathyScore / 5)],
    ["preachiness_gap", clamp01(1 - preachinessScore / 5)],
    ["business_risk", clamp01(businessRisk)],
  ]);

  const tagKeys = buildTagKeys(evaluate, assetIndex);
  const metricVector = METRIC_KEYS.map((key) => metricValues.get(key) ?? 0);
  const tagVector = tagKeys.map(() => 1);
  const textEmbedding = buildLexicalHashEmbedding(
    asset.evidence.length > 0 ? asset.evidence.map((item) => item.content).join("\n") : asset.transcript,
    64,
  );

  return {
    version: "badcase_feature_v1",
    metricKeys: [...METRIC_KEYS],
    metricVector,
    tagKeys,
    tagVector,
    textEmbedding,
    embeddingModel: "lexical_hash_v1",
  };
}

/**
 * Read one stored feature snapshot from a dataset case record when present.
 *
 * @param record Dataset case record.
 * @returns Feature snapshot or `null`.
 */
export function getCaseFeatureSnapshot(record: DatasetCaseRecord): BadCaseFeatureSnapshot | null {
  return record.featureSnapshot ?? null;
}

/**
 * Build tag keys including failure tags and optional scenario / KPI context.
 *
 * @param evaluate Evaluate response.
 * @param assetIndex Bad case asset index.
 * @returns Ordered tag keys.
 */
function buildTagKeys(evaluate: EvaluateResponse, assetIndex: number): string[] {
  const asset = evaluate.badCaseAssets[assetIndex];
  const keys = asset.tags.map((tag) => `failure:${tag}`);

  if (evaluate.scenarioEvaluation) {
    keys.push(`scenario:${evaluate.scenarioEvaluation.scenarioId}`);
    evaluate.scenarioEvaluation.kpis
      .filter((item) => item.status !== "healthy")
      .forEach((item) => {
        keys.push(`kpi:${item.id}:${item.status}`);
      });
  }

  return [...new Set(keys)].sort();
}

/**
 * Build a deterministic lexical hash embedding without external APIs.
 * This is a temporary MVP embedding used for semantic dedupe bootstrapping.
 *
 * @param text Source text.
 * @param dimensions Embedding size.
 * @returns L2-normalized embedding vector.
 */
function buildLexicalHashEmbedding(text: string, dimensions: number): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);

  tokens.forEach((token) => {
    const index = hashToken(token, dimensions);
    vector[index] += 1;
  });

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => Number((value / norm).toFixed(6)));
}

/**
 * Map goal completion status to one risk score.
 *
 * @param status Goal status.
 * @returns Normalized risk.
 */
function mapGoalStatusToRisk(status?: EvaluateResponse["subjectiveMetrics"]["goalCompletions"][number]["status"]): number {
  if (status === "failed") {
    return 1;
  }
  if (status === "partial") {
    return 0.6;
  }
  if (status === "unclear") {
    return 0.35;
  }
  return 0;
}

/**
 * Map recovery trace status to one risk score.
 *
 * @param status Recovery status.
 * @returns Normalized risk.
 */
function mapRecoveryStatusToRisk(status?: EvaluateResponse["subjectiveMetrics"]["recoveryTraces"][number]["status"]): number {
  if (status === "failed") {
    return 1;
  }
  if (status === "completed") {
    return 0.2;
  }
  return 0;
}

/**
 * Count coarse repeated questions in one user-message list.
 *
 * @param questions User question strings.
 * @returns Number of repeated question hits.
 */
function findRepeatedQuestionCount(questions: string[]): number {
  const counts = new Map<string, number>();
  questions.forEach((question) => {
    const normalized = question.replace(/[？?，,。.!！\s]/g, "").slice(0, 18);
    if (!normalized) {
      return;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  });

  return [...counts.values()].reduce((sum, count) => sum + (count >= 2 ? count - 1 : 0), 0);
}

/**
 * Tokenize one transcript into coarse lexical units.
 *
 * @param text Source text.
 * @returns Token list.
 */
function tokenize(text: string): string[] {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[，。！？、；：“”‘’（）【】《》.,!?;:'"()[\]<>/_-]/g, " ")
    .trim();
  const parts = normalized.split(/\s+/).filter(Boolean);

  if (parts.length > 0) {
    return parts.flatMap((part) => (part.length <= 2 ? [part] : buildCharacterNgrams(part, 2)));
  }

  return buildCharacterNgrams(normalized, 2);
}

/**
 * Build fixed-size character ngrams from one token.
 *
 * @param value Source string.
 * @param n Ngram size.
 * @returns Ngram list.
 */
function buildCharacterNgrams(value: string, n: number): string[] {
  if (value.length <= n) {
    return value ? [value] : [];
  }

  const grams: string[] = [];
  for (let index = 0; index <= value.length - n; index += 1) {
    grams.push(value.slice(index, index + n));
  }
  return grams;
}

/**
 * Hash one token into a fixed embedding bucket.
 *
 * @param token Token string.
 * @param dimensions Embedding size.
 * @returns Bucket index.
 */
function hashToken(token: string, dimensions: number): number {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % dimensions;
}

/**
 * Clamp a normalized score.
 *
 * @param value Raw score.
 * @returns Safe score.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
