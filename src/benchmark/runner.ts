/**
 * @fileoverview Benchmark Mode scoring runner.
 */

import { buildLlmJudgeMetricResult, type BenchmarkEvaluatorContext } from "@/benchmark/evaluators";
import { evaluateBenchmarkMetricWithRetry } from "@/benchmark/metric-eval-retry";
import { BenchmarkRunCancelledError } from "@/benchmark/run-cancellation";
import { assignQualityTiers, type RerankCaseInput } from "@/benchmark/rerank";
import { getApprovedRubricMetrics, validateApprovedRubric } from "@/benchmark/rubric";
import { assertMinimumApprovedMetrics, MIN_APPROVED_METRICS } from "@/benchmark/rubric-guards";
import { mapWithConcurrency } from "@/lib/concurrency";
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
  BenchmarkRubricMetric,
  BenchmarkTaskPackage,
} from "@/benchmark/types";

export type RunBenchmarkEvaluationInput = {
  runId: string;
  task: BenchmarkTaskPackage;
  cases: BenchmarkCase[];
  submissions: BenchmarkAgentSubmission[];
  matrix: BenchmarkMatrixCell[];
  evaluatorContext?: BenchmarkEvaluatorContext;
  existingMetricResults?: BenchmarkMetricEvaluationResult[];
  /** Mutable accumulator for incremental metric evaluation. */
  metricResults?: BenchmarkMetricEvaluationResult[];
  badcaseThreshold?: number;
  goldencaseThreshold?: number;
  /** Called after each metric is evaluated for progress tracking. */
  onMetricEvaluated?: (result: BenchmarkMetricEvaluationResult) => void;
  /** Called when a metric result is reused from a previous interrupted run. */
  onMetricReused?: (result: BenchmarkMetricEvaluationResult) => void;
  /** When true, abort before the next metric evaluation. */
  shouldCancel?: () => boolean;
  /** Maximum number of approved metrics to evaluate at the same time. */
  metricConcurrency?: number;
};

export type EvaluateSubmissionMetricsInput = {
  runId: string;
  task: BenchmarkTaskPackage;
  taskCase: BenchmarkCase;
  submission: BenchmarkAgentSubmission;
  evaluatorContext?: BenchmarkEvaluatorContext;
  existingMetricByKey: Map<string, BenchmarkMetricEvaluationResult>;
  metricResults: BenchmarkMetricEvaluationResult[];
  onMetricEvaluated?: (result: BenchmarkMetricEvaluationResult) => void;
  onMetricReused?: (result: BenchmarkMetricEvaluationResult) => void;
  shouldCancel?: () => boolean;
  /** Maximum number of approved metrics to evaluate at the same time. */
  metricConcurrency?: number;
};

/**
 * Evaluate all approved rubric metrics for one submission.
 * Skips metrics already present in `existingMetricByKey` and invokes `onMetricReused`.
 *
 * @param input Per-submission evaluation context.
 */
export async function evaluateSubmissionMetrics(input: EvaluateSubmissionMetricsInput): Promise<void> {
  const approvedMetrics = getApprovedRubricMetrics(input.task.rubric);
  const metricsToEvaluate: BenchmarkRubricMetric[] = [];

  for (const metric of approvedMetrics) {
    if (input.shouldCancel?.()) {
      throw new BenchmarkRunCancelledError(input.runId);
    }
    const cacheKey = metricCacheKey(input.submission.submissionId, metric.metricKey);
    const existingMetricResult = input.existingMetricByKey.get(cacheKey);
    if (existingMetricResult) {
      if (!input.metricResults.some((item) => metricCacheKey(item.submissionId, item.metricKey) === cacheKey)) {
        input.metricResults.push(existingMetricResult);
      }
      input.onMetricReused?.(existingMetricResult);
      continue;
    }
    metricsToEvaluate.push(metric);
  }

  const fallbackMetricKeys = await evaluateBatchJudgeMetrics(input, metricsToEvaluate);
  const metricConcurrency = Math.max(1, Math.floor(input.metricConcurrency ?? 1));
  const perMetricWork = metricsToEvaluate.filter(
    (metric) => !isBatchJudgeCandidate(input, metric) || fallbackMetricKeys.has(metric.metricKey),
  );

  await mapWithConcurrency(perMetricWork, metricConcurrency, async (metric) => {
    if (input.shouldCancel?.()) {
      throw new BenchmarkRunCancelledError(input.runId);
    }
    const cacheKey = metricCacheKey(input.submission.submissionId, metric.metricKey);
    if (input.existingMetricByKey.has(cacheKey) && !fallbackMetricKeys.has(metric.metricKey)) return;
    const metricResult = await evaluateBenchmarkMetricWithRetry(
      metric,
      input.taskCase,
      input.submission,
      input.evaluatorContext,
    );
    if (input.shouldCancel?.()) {
      throw new BenchmarkRunCancelledError(input.runId);
    }
    recordMetricResult(input, metricResult);
  });
}

/**
 * Evaluate batch-eligible LLM metrics in one session-level judge call.
 * Missing or risky batch results are returned as fallback metric keys for per-metric recheck.
 *
 * @param input Per-submission evaluation context.
 * @param metrics Metrics not already satisfied by checkpoint cache.
 * @returns Metric keys that should be re-evaluated with the single-metric judge.
 */
async function evaluateBatchJudgeMetrics(
  input: EvaluateSubmissionMetricsInput,
  metrics: BenchmarkRubricMetric[],
): Promise<Set<string>> {
  const fallbackMetricKeys = new Set<string>();
  const batchMetrics = metrics.filter((metric) => isBatchJudgeCandidate(input, metric));
  if (batchMetrics.length <= 1) {
    for (const metric of batchMetrics) fallbackMetricKeys.add(metric.metricKey);
    return fallbackMetricKeys;
  }

  try {
    const verdictByMetric = await input.evaluatorContext!.llmJudgeBatch!({
      metrics: batchMetrics,
      taskCase: input.taskCase,
      submission: input.submission,
    });
    for (const metric of batchMetrics) {
      if (input.shouldCancel?.()) {
        throw new BenchmarkRunCancelledError(input.runId);
      }
      const judged = verdictByMetric.get(metric.metricKey);
      if (!judged) {
        fallbackMetricKeys.add(metric.metricKey);
        continue;
      }
      const result = buildLlmJudgeMetricResult(metric, input.taskCase, input.submission, judged);
      if (shouldRecheckBatchResult(result)) {
        fallbackMetricKeys.add(metric.metricKey);
        continue;
      }
      recordMetricResult(input, result);
    }
  } catch (error) {
    if (error instanceof BenchmarkRunCancelledError) throw error;
    for (const metric of batchMetrics) fallbackMetricKeys.add(metric.metricKey);
  }

  return fallbackMetricKeys;
}

/**
 * Decide whether one metric can use the session-level batch judge.
 * Batch mode is opt-in so high-stakes runs can keep the old per-metric path.
 *
 * @param input Per-submission evaluation context.
 * @param metric Candidate metric.
 * @returns True when the metric should be attempted in the batch call.
 */
function isBatchJudgeCandidate(input: EvaluateSubmissionMetricsInput, metric: BenchmarkRubricMetric): boolean {
  return (
    readBenchmarkJudgeMode() === "session_batch" &&
    metric.evaluatorType === "llm_judge" &&
    Boolean(input.evaluatorContext?.llmJudgeBatch)
  );
}

/**
 * Store one metric result and update the checkpoint cache.
 *
 * @param input Per-submission evaluation context.
 * @param metricResult Newly evaluated metric result.
 */
function recordMetricResult(
  input: EvaluateSubmissionMetricsInput,
  metricResult: BenchmarkMetricEvaluationResult,
): void {
  input.metricResults.push(metricResult);
  input.existingMetricByKey.set(metricCacheKey(metricResult.submissionId, metricResult.metricKey), metricResult);
  input.onMetricEvaluated?.(metricResult);
}

/**
 * Decide whether a fast batch verdict needs a precise single-metric recheck.
 *
 * @param result Batch-generated metric result.
 * @returns True when per-metric fallback should replace the batch verdict.
 */
function shouldRecheckBatchResult(result: BenchmarkMetricEvaluationResult): boolean {
  return (
    result.status !== "scored" ||
    result.confidence < readBatchRecheckConfidenceThreshold() ||
    Boolean(result.judge?.panelDisagree)
  );
}

/**
 * Resolve the benchmark judge mode.
 *
 * @returns Per-metric default mode or session-level batch mode.
 */
function readBenchmarkJudgeMode(): "per_metric" | "session_batch" {
  return process.env.ZEVAL_BENCHMARK_JUDGE_MODE === "session_batch" ? "session_batch" : "per_metric";
}

/**
 * Resolve the minimum batch confidence accepted without per-metric recheck.
 *
 * @returns Confidence threshold in [0, 1].
 */
function readBatchRecheckConfidenceThreshold(): number {
  const parsed = Number.parseFloat(process.env.ZEVAL_BENCHMARK_BATCH_RECHECK_CONFIDENCE ?? "");
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 1 ? parsed : 0.65;
}

/**
 * Assemble the final benchmark run result from submissions and metric results.
 *
 * @param input Run inputs plus collected metric results.
 * @returns Aggregated benchmark run result.
 */
export function assembleBenchmarkRunResult(
  input: Omit<RunBenchmarkEvaluationInput, "existingMetricResults" | "onMetricEvaluated" | "onMetricReused" | "shouldCancel" | "metricResults"> & {
    metricResults: BenchmarkMetricEvaluationResult[];
  },
): BenchmarkRunResult {
  const metricResults = input.metricResults;
  const caseScores = applyRerankToCaseScores(buildBenchmarkCaseScores(metricResults));
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
  const minimumMetrics = Number(process.env.ZEVAL_BENCHMARK_MIN_METRICS ?? MIN_APPROVED_METRICS);
  if (Number.isFinite(minimumMetrics) && minimumMetrics > 0) {
    assertMinimumApprovedMetrics(approvedMetrics.length, minimumMetrics);
  }
  const caseById = new Map(input.cases.map((taskCase) => [taskCase.caseId, taskCase]));
  const existingMetricByKey = new Map(
    (input.existingMetricResults ?? []).map((result) => [metricCacheKey(result.submissionId, result.metricKey), result]),
  );
  const metricResults = input.metricResults ?? [];

  for (const submission of input.submissions) {
    if (input.shouldCancel?.()) {
      throw new BenchmarkRunCancelledError(input.runId);
    }
    const taskCase = caseById.get(submission.caseId);
    if (!taskCase) {
      continue;
    }
    await evaluateSubmissionMetrics({
      runId: input.runId,
      task: input.task,
      taskCase,
      submission,
      evaluatorContext: input.evaluatorContext,
      existingMetricByKey,
      metricResults,
      onMetricEvaluated: input.onMetricEvaluated,
      onMetricReused: input.onMetricReused,
      shouldCancel: input.shouldCancel,
      metricConcurrency: input.metricConcurrency,
    });
  }

  return assembleBenchmarkRunResult({
    runId: input.runId,
    task: input.task,
    cases: input.cases,
    submissions: input.submissions,
    matrix: input.matrix,
    metricResults,
    badcaseThreshold: input.badcaseThreshold,
    goldencaseThreshold: input.goldencaseThreshold,
  });
}

/**
 * Attach re-rank tiers to passed benchmark case scores.
 *
 * @param caseScores Aggregated per-case scores.
 * @returns Case scores enriched with rerank metadata.
 */
function applyRerankToCaseScores(caseScores: BenchmarkCaseScore[]): BenchmarkCaseScore[] {
  const rerankInputs: RerankCaseInput[] = caseScores.map((row) => ({
    caseId: row.caseId,
    submissionId: row.submissionId,
    passed: row.passed,
    judgeVariance: readJudgeVariance(row.metricResults),
    metrics: Object.fromEntries(
      row.metricResults
        .filter((result) => result.status === "scored")
        .map((result) => [
          result.metricKey,
          {
            score: result.score,
            weight: result.metricWeight,
            confidence: result.confidence,
            capabilityWeight: findCapabilityWeight(row.capabilityScores, result.capability),
          },
        ]),
    ),
  }));

  const ranked = assignQualityTiers(rerankInputs);
  const rankedBySubmission = new Map(ranked.map((row) => [row.submissionId, row]));

  return caseScores.map((row) => {
    const rerank = rankedBySubmission.get(row.submissionId);
    if (!rerank) return row;
    return {
      ...row,
      rerank: {
        qualityScore: rerank.qualityScore,
        qualityTier: rerank.qualityTier,
        rankInRun: rerank.rankInRun,
        qualityPercentile: rerank.qualityPercentile,
        metricVector: rerank.metricVector,
        confVector: rerank.confVector,
      },
    };
  });
}

function readJudgeVariance(metricResults: BenchmarkMetricEvaluationResult[]): number {
  const values = metricResults
    .map((result) => result.judgeVariance)
    .filter((value): value is number => typeof value === "number");
  return values.length ? Math.max(...values) : 0;
}

function findCapabilityWeight(
  capabilityScores: BenchmarkCaseScore["capabilityScores"],
  capability: BenchmarkCapabilityDimension,
): number {
  return capabilityScores.find((row) => row.capability === capability)?.weight ?? 1;
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

function metricCacheKey(submissionId: string, metricKey: string): string {
  return `${submissionId}::${metricKey}`;
}
