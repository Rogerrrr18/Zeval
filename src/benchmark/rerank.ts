/**
 * @fileoverview Good-case re-ranking from per-metric scores and confidence.
 */

export type QualityTier = "gold" | "silver" | "borderline";

export type RerankMetricInput = {
  score: number;
  weight: number;
  confidence: number;
  capabilityWeight?: number;
  scale?: { min: number; max: number };
};

export type RerankCaseInput = {
  caseId: string;
  submissionId: string;
  passed: boolean;
  metrics: Record<string, RerankMetricInput>;
  judgeVariance?: number;
  metricDisagreement?: number;
};

export type RerankCaseResult = RerankCaseInput & {
  qualityScore: number;
  qualityTier: QualityTier;
  rankInRun: number;
  qualityPercentile: number;
  metricVector: Record<string, number>;
  confVector: Record<string, number>;
};

const DEFAULT_SCALE = { min: 1, max: 5 };
const LAMBDA_VARIANCE = 0.15;
const LAMBDA_DISAGREEMENT = 0.1;
const VARIANCE_THRESHOLD = 0.35;

/**
 * Normalize a raw metric score to 0–1 using its scale.
 *
 * @param score Raw metric score.
 * @param scale Scoring scale bounds.
 * @returns Normalized value in [0, 1].
 */
export function normalizeMetricScore(
  score: number,
  scale: { min: number; max: number } = DEFAULT_SCALE,
): number {
  if (scale.max === scale.min) return 0;
  return clamp((score - scale.min) / (scale.max - scale.min), 0, 1);
}

/**
 * Compute case-level quality score Q from weighted metrics.
 *
 * @param input Case metrics and penalty signals.
 * @returns Quality score in roughly [0, 1].
 */
export function computeQualityScore(input: RerankCaseInput): number {
  const entries = Object.values(input.metrics);
  if (entries.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;
  for (const metric of entries) {
    const capWeight = metric.capabilityWeight ?? 1;
    const combinedWeight = metric.weight * capWeight;
    const norm = normalizeMetricScore(metric.score, metric.scale ?? DEFAULT_SCALE);
    weightedSum += combinedWeight * norm * clamp(metric.confidence, 0, 1);
    totalWeight += combinedWeight;
  }

  const base = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const variancePenalty = (input.judgeVariance ?? 0) >= VARIANCE_THRESHOLD ? 1 : 0;
  const disagreementPenalty = clamp(input.metricDisagreement ?? 0, 0, 1);
  return round4(
    base - LAMBDA_VARIANCE * variancePenalty - LAMBDA_DISAGREEMENT * disagreementPenalty,
  );
}

/**
 * Build metric/confidence vectors for a case.
 *
 * @param input Case metric inputs.
 * @returns Normalized metric vector and confidence vector.
 */
export function buildMetricVectors(input: RerankCaseInput): {
  metricVector: Record<string, number>;
  confVector: Record<string, number>;
} {
  const metricVector: Record<string, number> = {};
  const confVector: Record<string, number> = {};
  for (const [key, metric] of Object.entries(input.metrics)) {
    metricVector[key] = normalizeMetricScore(metric.score, metric.scale ?? DEFAULT_SCALE);
    confVector[key] = clamp(metric.confidence, 0, 1);
  }
  return { metricVector, confVector };
}

/**
 * Compute percentile rank of a score within a batch (0 = lowest, 1 = highest).
 *
 * @param score Target score.
 * @param batch All scores in the run batch.
 * @returns Percentile in [0, 1].
 */
export function computeQualityPercentile(score: number, batch: number[]): number {
  if (batch.length <= 1) return 1;
  const less = batch.filter((value) => value < score).length;
  return round4(less / (batch.length - 1));
}

/**
 * Assign quality tiers to passed cases: gold top 25%, silver 25–70%, borderline rest.
 *
 * @param cases Passed case inputs for one benchmark run.
 * @returns Ranked cases with qualityScore, tier, and rankInRun.
 */
export function assignQualityTiers(cases: RerankCaseInput[]): RerankCaseResult[] {
  const passed = cases.filter((row) => row.passed);
  const scored = passed.map((row) => ({
    row,
    qualityScore: computeQualityScore(row),
    ...buildMetricVectors(row),
  }));

  scored.sort((left, right) => {
    if (right.qualityScore !== left.qualityScore) {
      return right.qualityScore - left.qualityScore;
    }
    return left.row.submissionId.localeCompare(right.row.submissionId);
  });

  const allScores = scored.map((row) => row.qualityScore);
  const n = scored.length;

  return scored.map((item, index) => {
    const percentile = n <= 1 ? 1 : index / (n - 1);
    const qualityTier = tierFromPercentile(percentile);
    return {
      ...item.row,
      qualityScore: item.qualityScore,
      qualityTier,
      rankInRun: index + 1,
      qualityPercentile: computeQualityPercentile(item.qualityScore, allScores),
      metricVector: item.metricVector,
      confVector: item.confVector,
    };
  });
}

/**
 * Rank passed cases by a single metric key (descending).
 *
 * @param cases Case inputs.
 * @param metricKey Metric to sort by.
 * @returns Cases sorted best-first for the given metric.
 */
export function rankCasesByMetric(
  cases: RerankCaseInput[],
  metricKey: string,
): RerankCaseInput[] {
  return [...cases].sort((left, right) => {
    const leftMetric = left.metrics[metricKey];
    const rightMetric = right.metrics[metricKey];
    const leftNorm = leftMetric
      ? normalizeMetricScore(leftMetric.score, leftMetric.scale ?? DEFAULT_SCALE)
      : 0;
    const rightNorm = rightMetric
      ? normalizeMetricScore(rightMetric.score, rightMetric.scale ?? DEFAULT_SCALE)
      : 0;
    if (rightNorm !== leftNorm) return rightNorm - leftNorm;
    return left.caseId.localeCompare(right.caseId);
  });
}

/**
 * Map percentile rank to tier bucket.
 *
 * @param percentile Rank percentile where 0 is best.
 * @returns Quality tier label.
 */
function tierFromPercentile(percentile: number): QualityTier {
  if (percentile <= 0.25) return "gold";
  if (percentile <= 0.7) return "silver";
  return "borderline";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
