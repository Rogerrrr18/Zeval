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
  reviewerRationale?: string;
  evidenceUsed?: string[];
  boundaryType?: "clear_accept" | "clear_reject" | "uncertain" | "human_override";
  correctionType?: "agree_accept" | "agree_reject" | "false_positive" | "false_negative" | "needs_more_evidence";
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
    reviewerRationale?: string;
    evidenceUsed?: string[];
    boundaryType?: "clear_accept" | "clear_reject" | "uncertain" | "human_override";
    correctionType?: "agree_accept" | "agree_reject" | "false_positive" | "false_negative" | "needs_more_evidence";
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
      reviewerRationale: metricReview?.reviewerRationale ?? metricReview?.note ?? sessionReview.note,
      evidenceUsed: metricReview?.evidenceUsed ?? metricResult.evidence.slice(0, 4),
      boundaryType: metricReview?.boundaryType ?? inferBoundaryType(decision, confirmedScore, metricResult.confidence, passThreshold),
      correctionType: metricReview?.correctionType ?? inferCorrectionType(decision, metricResult.passed),
    });
  }

  return rows;
}

/**
 * Infer which human-judgment boundary a review represents.
 *
 * @param decision Human review decision.
 * @param confirmedScore Human-confirmed score.
 * @param confidence Automatic judge confidence.
 * @param passThreshold Rubric pass threshold.
 * @returns Boundary bucket for skill learning.
 */
function inferBoundaryType(
  decision: BenchmarkHumanReviewDecision,
  confirmedScore: number,
  confidence: number,
  passThreshold: number,
): "clear_accept" | "clear_reject" | "uncertain" | "human_override" {
  if (decision === "needs_evidence" || confidence < 0.65) return "uncertain";
  if (Math.abs(confirmedScore - passThreshold) <= 0.5) return "human_override";
  return confirmedScore >= passThreshold ? "clear_accept" : "clear_reject";
}

/**
 * Infer how the human review relates to the automatic evaluator verdict.
 *
 * @param decision Human review decision.
 * @param autoPassed Automatic pass/fail verdict.
 * @returns Correction type used by human-judgment skill learning.
 */
function inferCorrectionType(
  decision: BenchmarkHumanReviewDecision,
  autoPassed: boolean,
): "agree_accept" | "agree_reject" | "false_positive" | "false_negative" | "needs_more_evidence" {
  if (decision === "needs_evidence") return "needs_more_evidence";
  if (decision === "accepted") return autoPassed ? "agree_accept" : "false_positive";
  return autoPassed ? "false_negative" : "agree_reject";
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
