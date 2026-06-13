/**
 * @fileoverview Helpers to keep benchmark submission counters consistent with checkpoint data.
 */

import type { MatrixProgressRow } from "@/benchmark/progress";
import type { BenchmarkAgentSubmission, BenchmarkMatrixCell, BenchmarkCase } from "@/benchmark/types";

export type SubmissionProgressCounts = {
  completedSubmissions: number;
  failedSubmissions: number;
  matrixProgress: MatrixProgressRow[];
};

/**
 * Derive submission counters from the current submission list instead of incrementing blindly.
 *
 * @param matrix Enabled benchmark matrix cells.
 * @param cases Benchmark cases in the run.
 * @param submissions Current submission records.
 * @returns Normalized submission progress counts.
 */
export function computeSubmissionProgressCounts(
  matrix: BenchmarkMatrixCell[],
  cases: BenchmarkCase[],
  submissions: BenchmarkAgentSubmission[],
): SubmissionProgressCounts {
  const caseCount = cases.length;
  let completedSubmissions = 0;
  let failedSubmissions = 0;

  for (const submission of submissions) {
    if (submission.status === "completed") {
      completedSubmissions += 1;
    } else if (submission.status === "failed") {
      failedSubmissions += 1;
    }
  }

  const matrixProgress = matrix.map((cell) => {
    const forCell = submissions.filter(
      (submission) => submission.agentFramework === cell.agentFramework && submission.model === cell.model,
    );
    return {
      agentFramework: cell.agentFramework,
      model: cell.model,
      total: caseCount,
      completed: forCell.filter((submission) => submission.status === "completed").length,
      failed: forCell.filter((submission) => submission.status === "failed").length,
    };
  });

  return { completedSubmissions, failedSubmissions, matrixProgress };
}
