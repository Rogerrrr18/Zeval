/**
 * @fileoverview Rubric validation guards for benchmark runs.
 */

import type { BenchmarkRubricSet } from "@/benchmark/types";

export const MIN_APPROVED_METRICS = 3;
export const RECOMMENDED_APPROVED_METRICS = 6;

/**
 * Count non-rejected metrics in a rubric draft.
 *
 * @param rubric Rubric set to inspect.
 * @returns Candidate metric count.
 */
export function countCandidateMetrics(rubric: BenchmarkRubricSet): number {
  return rubric.modules
    .flatMap((module) => module.metrics)
    .filter((metric) => metric.approvalStatus !== "rejected")
    .length;
}

/**
 * Build advisory warnings when a rubric is too sparse for discrimination.
 *
 * @param rubric Rubric set to inspect.
 * @returns Human-readable warnings; empty when metric count is sufficient.
 */
export function buildRubricMetricCountWarnings(rubric: BenchmarkRubricSet | null): string[] {
  if (!rubric) return [];
  const count = countCandidateMetrics(rubric);
  if (count < RECOMMENDED_APPROVED_METRICS) {
    return [
      `当前 rubric 仅有 ${count} 个指标，建议至少 ${RECOMMENDED_APPROVED_METRICS} 个以提升区分度；最低可运行门槛为 ${MIN_APPROVED_METRICS} 个。`,
    ];
  }
  return [];
}

/**
 * Ensure a runnable rubric has enough approved secondary metrics.
 *
 * @param approvedCount Number of approved metrics in the rubric.
 * @throws Error when the rubric is too sparse for meaningful evaluation.
 */
export function assertMinimumApprovedMetrics(
  approvedCount: number,
  minimum: number = MIN_APPROVED_METRICS,
): void {
  if (approvedCount < minimum) {
    throw new Error(
      `Benchmark rubric is too sparse: at least ${minimum} approved metrics are required, got ${approvedCount}.`,
    );
  }
}
