/**
 * @fileoverview Benchmark Mode scoring runner.
 */

import { evaluateBenchmarkMetric, type BenchmarkEvaluatorContext } from "@/benchmark/evaluators";
import { getApprovedRubricMetrics, validateApprovedRubric } from "@/benchmark/rubric";
import type {
  AgentFrameworkId,
  BenchmarkAgentSubmission,
  BenchmarkCapabilityDimension,
  BenchmarkCapabilityScore,
  BenchmarkCase,
  BenchmarkCaseScore,
  BenchmarkLeaderboardRow,
  BenchmarkMatrixCell,
  BenchmarkMetricEvaluationResult,
  BenchmarkModelId,
  BenchmarkRunResult,
  BenchmarkTaskPackage,
} from "@/benchmark/types";

export type RunBenchmarkEvaluationInput = {
  runId: string;
  task: BenchmarkTaskPackage;
  cases: BenchmarkCase[];
  submissions: BenchmarkAgentSubmission[];
  matrix: BenchmarkMatrixCell[];
  evaluatorContext?: BenchmarkEvaluatorContext;
  badcaseThreshold?: number;
  goldencaseThreshold?: number;
  /** Called after each metric is evaluated for progress tracking. */
  onMetricEvaluated?: (result: BenchmarkMetricEvaluationResult) => void;
};

/**
 * Score one benchmark task package across a matrix of Agent framework/model submissions.
 */
export async function runBenchmarkEvaluation(
  input: RunBenchmarkEvaluationInput,
): Promise<BenchmarkRunResult> {
  const rubricErrors = validateApprovedRubric(input.task.rubric);
  if (rubricErrors.length > 0) {
    throw new Error(`Benchmark rubric is not runnable: ${rubricErrors.join("; ")}`);
  }

  const approvedMetrics = getApprovedRubricMetrics(input.task.rubric);
  const caseById = new Map(input.cases.map((taskCase) => [taskCase.caseId, taskCase]));
  const metricResults: BenchmarkMetricEvaluationResult[] = [];

  for (const submission of input.submissions) {
    const taskCase = caseById.get(submission.caseId);
    if (!taskCase) {
      continue;
    }
    for (const metric of approvedMetrics) {
      const metricResult = await evaluateBenchmarkMetric(metric, taskCase, submission, input.evaluatorContext);
      metricResults.push(metricResult);
      input.onMetricEvaluated?.(metricResult);
    }
  }

  const caseScores = buildBenchmarkCaseScores(metricResults);
  const leaderboard = buildBenchmarkLeaderboard(caseScores);
  const averageScore = caseScores.length
    ? round2(caseScores.reduce((sum, row) => sum + row.taskScore, 0) / caseScores.length)
    : 0;
  const badcaseThreshold = input.badcaseThreshold ?? 60;
  const goldencaseThreshold = input.goldencaseThreshold ?? 90;

  return {
    runId: input.runId,
    benchmarkId: input.task.benchmarkId,
    taskId: input.task.taskId,
    rubricId: input.task.rubric.rubricId,
    matrix: input.matrix,
    cases: input.cases,
    submissions: input.submissions,
    metricResults,
    caseScores,
    leaderboard,
    summary: {
      averageScore,
      caseCount: input.cases.length,
      submissionCount: input.submissions.length,
      metricResultCount: metricResults.length,
      badcaseCandidateCount: metricResults.filter((result) => result.normalizedScore < badcaseThreshold).length,
      goldencaseCandidateCount: metricResults.filter((result) => result.normalizedScore >= goldencaseThreshold).length,
      needsHumanReviewCount: metricResults.filter((result) => result.needsHumanReview || result.status === "needs_human_review").length,
    },
    generatedAt: new Date().toISOString(),
  };
}

function buildBenchmarkCaseScores(
  metricResults: BenchmarkMetricEvaluationResult[],
): BenchmarkCaseScore[] {
  const grouped = groupBy(metricResults, (result) =>
    [
      result.runId,
      result.benchmarkId,
      result.taskId,
      result.caseId,
      result.submissionId,
      result.agentFramework,
      result.model,
    ].join("::"),
  );

  return [...grouped.values()].map((results) => {
    const first = results[0];
    const capabilityScores = buildCapabilityScores(results);
    const weighted = weightedAverage(capabilityScores.map((score) => ({
      value: score.score,
      weight: score.weight,
    })));
    const taskScore = round2(weighted);
    return {
      runId: first.runId,
      benchmarkId: first.benchmarkId,
      taskId: first.taskId,
      caseId: first.caseId,
      submissionId: first.submissionId,
      agentFramework: first.agentFramework,
      model: first.model,
      taskScore,
      passed: taskScore >= 60,
      capabilityScores,
      metricResults: results,
    };
  });
}

function buildCapabilityScores(
  metricResults: BenchmarkMetricEvaluationResult[],
): BenchmarkCapabilityScore[] {
  const grouped = groupBy(metricResults, (result) => result.capability);
  return [...grouped.entries()].map(([capability, results]) => {
    const weights = results.map((result) => ({
      value: result.normalizedScore,
      weight: findMetricWeight(result),
    }));
    return {
      capability: capability as BenchmarkCapabilityDimension,
      score: round2(weightedAverage(weights)),
      weight: weights.reduce((sum, item) => sum + item.weight, 0),
      metricCount: results.length,
      passedMetricCount: results.filter((result) => result.passed).length,
      evidence: results.flatMap((result) => result.evidence).slice(0, 5),
    };
  });
}

function buildBenchmarkLeaderboard(caseScores: BenchmarkCaseScore[]): BenchmarkLeaderboardRow[] {
  const grouped = groupBy(caseScores, (score) => [score.agentFramework, score.model].join("::"));
  const rows = [...grouped.values()].map((scores) => {
    const first = scores[0];
    return {
      agentFramework: first.agentFramework as AgentFrameworkId,
      model: first.model as BenchmarkModelId,
      averageScore: round2(scores.reduce((sum, row) => sum + row.taskScore, 0) / scores.length),
      taskCount: new Set(scores.map((row) => row.taskId)).size,
      caseCount: scores.length,
      passRate: round2(scores.filter((row) => row.passed).length / scores.length),
      capabilityScores: aggregateCapabilityScores(scores.flatMap((row) => row.capabilityScores)),
    };
  });

  rows.sort((left, right) => right.averageScore - left.averageScore);
  return rows;
}

function aggregateCapabilityScores(scores: BenchmarkCapabilityScore[]): BenchmarkCapabilityScore[] {
  const grouped = groupBy(scores, (score) => score.capability);
  return [...grouped.entries()].map(([capability, rows]) => ({
    capability: capability as BenchmarkCapabilityDimension,
    score: round2(rows.reduce((sum, row) => sum + row.score, 0) / rows.length),
    weight: rows.reduce((sum, row) => sum + row.weight, 0),
    metricCount: rows.reduce((sum, row) => sum + row.metricCount, 0),
    passedMetricCount: rows.reduce((sum, row) => sum + row.passedMetricCount, 0),
    evidence: rows.flatMap((row) => row.evidence).slice(0, 5),
  }));
}

function findMetricWeight(result: BenchmarkMetricEvaluationResult): number {
  return result.metricWeight;
}

function weightedAverage(items: Array<{ value: number; weight: number }>): number {
  const valid = items.filter((item) => Number.isFinite(item.value) && item.weight > 0);
  const totalWeight = valid.reduce((sum, item) => sum + item.weight, 0);
  if (totalWeight === 0) return 0;
  return valid.reduce((sum, item) => sum + item.value * item.weight, 0) / totalWeight;
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(item);
  }
  return grouped;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
