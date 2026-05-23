/**
 * @fileoverview Read-only projections over saved evaluate run baselines.
 */

import type { WorkbenchBaselineStore } from "@/workbench";
import type { EvaluateResponse } from "@/types/pipeline";

export type EvaluateRunTrendPoint = {
  runId: string;
  createdAt: string;
  label?: string;
  emotionScore: number | null;
  goalCompletionRate: number | null;
  badCaseCount: number;
  businessKpiScore: number | null;
};

/**
 * List recent evaluate run trend points for one customer/project.
 *
 * @param store Workbench baseline store.
 * @param customerId Customer identifier.
 * @param limit Max number of runs to load.
 * @returns Chronological trend points, oldest first.
 */
export async function listRecentEvaluateRunTrends(
  store: WorkbenchBaselineStore,
  customerId: string,
  limit: number,
): Promise<EvaluateRunTrendPoint[]> {
  const rows = await store.list(customerId);
  const selected = rows.slice(0, Math.max(1, Math.min(limit, 20)));
  const points: EvaluateRunTrendPoint[] = [];
  for (const row of selected) {
    const snapshot = await store.read(customerId, row.runId);
    if (!snapshot) {
      continue;
    }
    points.push(projectEvaluateTrendPoint(snapshot.evaluate, {
      createdAt: snapshot.createdAt,
      label: snapshot.label ?? snapshot.sourceFileName,
    }));
  }
  return points.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

/**
 * Project one evaluate response into dashboard trend metrics.
 *
 * @param evaluate Completed evaluate response.
 * @param meta Baseline metadata.
 * @returns Trend point.
 */
export function projectEvaluateTrendPoint(
  evaluate: EvaluateResponse,
  meta: { createdAt: string; label?: string },
): EvaluateRunTrendPoint {
  const goalRows = evaluate.subjectiveMetrics.goalCompletions;
  const achieved = goalRows.filter((item) => item.status === "achieved").length;
  return {
    runId: evaluate.runId,
    createdAt: meta.createdAt,
    label: meta.label,
    emotionScore: null,
    goalCompletionRate: goalRows.length ? Number(((achieved / goalRows.length) * 100).toFixed(1)) : null,
    badCaseCount: evaluate.badCaseAssets.length,
    businessKpiScore: evaluate.scenarioEvaluation
      ? Number((evaluate.scenarioEvaluation.averageScore * 100).toFixed(1))
      : null,
  };
}

