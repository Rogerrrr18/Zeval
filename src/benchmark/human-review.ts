/**
 * @fileoverview Session-level and metric-level human review helpers for the benchmark workbench.
 */

import type { BenchmarkHumanReviewDecision } from "@/benchmark/case-admission";
import type { BenchmarkHumanReviewRecord } from "@/benchmark/session-store";
import type { BenchmarkMetricEvaluationResult, BenchmarkRubricMetric } from "@/benchmark/types";

/** Synthetic metric key used to store session-level channel on a review record. */
export const SESSION_REVIEW_METRIC_KEY = "__session__";

/**
 * Find the session-level review record (channel tag) for one submission.
 *
 * @param records Human review records for the current run.
 * @param runId Benchmark run id.
 * @param submissionId Submission id for the session.
 * @returns Session review record when present.
 */
export function findSessionReviewRecord(
  records: BenchmarkHumanReviewRecord[],
  runId: string,
  submissionId: string,
): BenchmarkHumanReviewRecord | undefined {
  return records.find(
    (record) =>
      record.runId === runId &&
      record.submissionId === submissionId &&
      record.metricKey === SESSION_REVIEW_METRIC_KEY,
  );
}

/**
 * Find a metric-level human review record.
 *
 * @param records Human review records for the current run.
 * @param runId Benchmark run id.
 * @param result Metric evaluation result.
 * @returns Metric review record when present.
 */
export function findMetricReviewRecord(
  records: BenchmarkHumanReviewRecord[],
  runId: string,
  result: BenchmarkMetricEvaluationResult,
): BenchmarkHumanReviewRecord | undefined {
  return records.find(
    (record) =>
      record.runId === runId &&
      record.submissionId === result.submissionId &&
      record.metricKey === result.metricKey,
  );
}

/**
 * Whether a metric review has a human-confirmed rubric score.
 *
 * @param record Metric review record.
 * @returns True when `confirmedScore` is set.
 */
export function isMetricReviewConfirmed(record: BenchmarkHumanReviewRecord | undefined): boolean {
  return typeof record?.confirmedScore === "number" && Number.isFinite(record.confirmedScore);
}

/**
 * Resolve pass threshold for one rubric metric.
 *
 * @param metric Rubric metric definition.
 * @returns Discrete pass threshold score.
 */
export function resolveMetricPassThreshold(metric: BenchmarkRubricMetric | null | undefined): number {
  return metric?.scale?.passThreshold ?? 3;
}

/**
 * Infer admission decision from a human-confirmed rubric score.
 *
 * @param confirmedScore Human-selected discrete rubric score.
 * @param passThreshold Metric pass threshold from rubric scale.
 * @returns Accepted when score meets threshold, otherwise rejected.
 */
export function inferReviewDecisionFromScore(
  confirmedScore: number,
  passThreshold: number,
): BenchmarkHumanReviewDecision {
  return confirmedScore >= passThreshold ? "accepted" : "rejected";
}

/**
 * Effective confirmed score: explicit human choice, legacy decision fallback, or auto score.
 *
 * @param record Metric review record.
 * @param autoScore Automatic evaluator score.
 * @returns Score used for admission labels.
 */
export function resolveConfirmedScore(
  record: BenchmarkHumanReviewRecord | undefined,
  autoScore: number,
): number | undefined {
  if (typeof record?.confirmedScore === "number" && Number.isFinite(record.confirmedScore)) {
    return record.confirmedScore;
  }
  if (record?.decision === "accepted" || record?.decision === "rejected") {
    return autoScore;
  }
  return undefined;
}

/**
 * Build API-ready review rows for admit-cases from session + metric records.
 *
 * @param runId Benchmark run id.
 * @param submissionId Session submission id.
 * @param records All human review records for the run.
 * @param metricResults Metric results belonging to the session.
 * @param metricByKey Rubric metric lookup by metric key.
 * @returns Normalized review inputs; empty when session channel or metric confirmations are missing.
 */
export function buildSessionAdmitReviews(
  runId: string,
  submissionId: string,
  records: BenchmarkHumanReviewRecord[],
  metricResults: BenchmarkMetricEvaluationResult[],
  metricByKey: Map<string, BenchmarkRubricMetric>,
): Array<{
  submissionId: string;
  metricKey: string;
  decision: BenchmarkHumanReviewDecision;
  channel: string;
  reviewer?: string;
  note?: string;
  reviewedAt?: string;
  confirmedScore?: number;
}> {
  const sessionReview = findSessionReviewRecord(records, runId, submissionId);
  const channel = sessionReview?.channel?.trim();
  if (!sessionReview || !channel) {
    return [];
  }

  const rows: Array<{
    submissionId: string;
    metricKey: string;
    decision: BenchmarkHumanReviewDecision;
    channel: string;
    reviewer?: string;
    note?: string;
    reviewedAt?: string;
    confirmedScore?: number;
  }> = [];

  for (const metricResult of metricResults) {
    if (metricResult.status === "skipped" || metricResult.status === "unsupported") {
      continue;
    }
    const metricReview = findMetricReviewRecord(records, runId, metricResult);
    const confirmedScore = resolveConfirmedScore(metricReview, metricResult.score);
    if (confirmedScore === undefined) {
      return [];
    }
    const passThreshold = resolveMetricPassThreshold(metricByKey.get(metricResult.metricKey));
    const decision = metricReview?.decision
      && metricReview.decision !== "needs_evidence"
      ? metricReview.decision
      : inferReviewDecisionFromScore(confirmedScore, passThreshold);
    rows.push({
      submissionId,
      metricKey: metricResult.metricKey,
      decision,
      channel,
      reviewer: metricReview?.reviewer ?? sessionReview.reviewer,
      note: metricReview?.note ?? sessionReview.note,
      reviewedAt: metricReview?.reviewedAt ?? sessionReview.reviewedAt ?? new Date().toISOString(),
      confirmedScore,
    });
  }

  return rows;
}

/**
 * Count sessions that have channel + all metric confirmations for policy learning.
 *
 * @param runId Benchmark run id.
 * @param records Human review records.
 * @param submissionMetricCounts Map of submissionId → metric count per session.
 * @returns Number of fully labeled sessions.
 */
export function countLabeledSessions(
  runId: string,
  records: BenchmarkHumanReviewRecord[],
  submissionMetricCounts: Map<string, number>,
): number {
  let count = 0;
  for (const [submissionId, metricCount] of submissionMetricCounts.entries()) {
    const sessionReview = findSessionReviewRecord(records, runId, submissionId);
    if (!sessionReview?.channel) continue;
    const confirmedMetrics = records.filter(
      (record) =>
        record.runId === runId &&
        record.submissionId === submissionId &&
        record.metricKey !== SESSION_REVIEW_METRIC_KEY &&
        isMetricReviewConfirmed(record),
    ).length;
    if (confirmedMetrics >= metricCount && metricCount > 0) {
      count += 1;
    }
  }
  return count;
}
