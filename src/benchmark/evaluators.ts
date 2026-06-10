/**
 * @fileoverview Metric evaluator registry for Benchmark Mode.
 */

import {
  shouldBlockMaxScoreWithoutEvidence,
  snapScoreToRubricLevels,
} from "@/benchmark/rubric-judge";
import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkLlmJudge,
  BenchmarkMetricEvaluationResult,
  BenchmarkRubricMetric,
} from "@/benchmark/types";

export type BenchmarkEvaluatorContext = {
  llmJudge?: BenchmarkLlmJudge;
};

/**
 * Evaluate one approved rubric metric against one agent submission.
 */
export async function evaluateBenchmarkMetric(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
  context: BenchmarkEvaluatorContext = {},
): Promise<BenchmarkMetricEvaluationResult> {
  try {
    if (submission.status !== "completed") {
      return buildResult(metric, taskCase, submission, {
        score: metric.scale.min,
        status: "error",
        reason: `Submission status is ${submission.status}.`,
        evidence: submission.error ? [submission.error] : [],
        confidence: 1,
        expected: undefined,
        actual: undefined,
      });
    }

    switch (metric.evaluatorType) {
      case "exact_match":
        return evaluateExactMatch(metric, taskCase, submission);
      case "regex_match":
        return evaluateRegexMatch(metric, taskCase, submission);
      case "numeric_tolerance":
        return evaluateNumericTolerance(metric, taskCase, submission);
      case "f1_match":
        return evaluateF1Match(metric, taskCase, submission);
      case "llm_judge":
        return evaluateLlmJudge(metric, taskCase, submission, context);
      case "human_label":
        return evaluateHumanLabel(metric, taskCase, submission);
      case "code_exec":
      case "unit_test":
      case "environment_state_test":
        return evaluateExternalArtifact(metric, taskCase, submission);
      case "hybrid":
        return buildResult(metric, taskCase, submission, {
          score: metric.scale.min,
          status: "unsupported",
          reason: "Hybrid metrics are computed at the runner aggregation layer, not as standalone metrics yet.",
          evidence: [],
          confidence: 0,
          expected: undefined,
          actual: undefined,
        });
    }
  } catch (error) {
    return buildResult(metric, taskCase, submission, {
      score: metric.scale.min,
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
      evidence: [],
      confidence: 0,
      expected: undefined,
      actual: undefined,
    });
  }
}

function evaluateExactMatch(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
): BenchmarkMetricEvaluationResult {
  const expected = getExpectedValue(taskCase, metric.config?.expectedPath);
  const actual = getSubmissionValue(submission, metric.config?.outputPath);
  const expectedNorm = normalizeScalar(expected);
  const actualNorm = normalizeScalar(actual);
  if (expectedNorm === "" && actualNorm === "") {
    return buildResult(metric, taskCase, submission, {
      score: metric.scale.min,
      status: "blocked",
      reason: "Exact match blocked: expected and actual are both missing.",
      evidence: [`expected=${String(expected)}`, `actual=${String(actual)}`],
      confidence: 0,
      expected,
      actual,
      needsHumanReview: true,
    });
  }
  const matched = actualNorm === expectedNorm;
  return buildResult(metric, taskCase, submission, {
    score: matched ? metric.scale.max : metric.scale.min,
    status: "scored",
    reason: matched ? "Exact match." : "Actual value does not match expected value.",
    evidence: [`expected=${String(expected)}`, `actual=${String(actual)}`],
    confidence: 1,
    expected,
    actual,
  });
}

function evaluateRegexMatch(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
): BenchmarkMetricEvaluationResult {
  const pattern = metric.config?.pattern;
  if (!pattern) {
    return buildResult(metric, taskCase, submission, {
      score: metric.scale.min,
      status: "error",
      reason: "regex_match metric is missing config.pattern.",
      evidence: [],
      confidence: 1,
      expected: undefined,
      actual: submission.rawOutput,
    });
  }
  const target = String(getSubmissionValue(submission, metric.config?.outputPath) ?? submission.rawOutput);
  const matched = new RegExp(pattern).test(target);
  return buildResult(metric, taskCase, submission, {
    score: matched ? metric.scale.max : metric.scale.min,
    status: "scored",
    reason: matched ? "Regex matched." : "Regex did not match.",
    evidence: matched ? [`pattern=${pattern}`] : [`pattern=${pattern}`, `target=${target.slice(0, 300)}`],
    confidence: 1,
    expected: pattern,
    actual: target,
  });
}

function evaluateNumericTolerance(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
): BenchmarkMetricEvaluationResult {
  const expected = Number(getExpectedValue(taskCase, metric.config?.expectedPath));
  const actual = Number(getSubmissionValue(submission, metric.config?.outputPath));
  const tolerance = metric.config?.tolerance ?? 0;
  if (!Number.isFinite(expected) || !Number.isFinite(actual)) {
    return buildResult(metric, taskCase, submission, {
      score: metric.scale.min,
      status: "error",
      reason: "Numeric evaluator received non-numeric expected or actual value.",
      evidence: [`expected=${String(expected)}`, `actual=${String(actual)}`],
      confidence: 1,
      expected,
      actual,
    });
  }
  const matched = Math.abs(actual - expected) <= tolerance;
  return buildResult(metric, taskCase, submission, {
    score: matched ? metric.scale.max : metric.scale.min,
    status: "scored",
    reason: matched ? "Numeric value is within tolerance." : "Numeric value is outside tolerance.",
    evidence: [`expected=${expected}`, `actual=${actual}`, `tolerance=${tolerance}`],
    confidence: 1,
    expected,
    actual,
  });
}

function evaluateF1Match(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
): BenchmarkMetricEvaluationResult {
  const expectedItems = toStringSet(getExpectedValue(taskCase, metric.config?.expectedItemsPath));
  const predictedItems = toStringSet(getSubmissionValue(submission, metric.config?.predictedItemsPath));
  if (expectedItems.size === 0 && predictedItems.size === 0) {
    return buildResult(metric, taskCase, submission, {
      score: metric.scale.max,
      status: "scored",
      reason: "Both expected and predicted sets are empty.",
      evidence: [],
      confidence: 1,
      expected: [],
      actual: [],
    });
  }

  let truePositive = 0;
  for (const item of predictedItems) {
    if (expectedItems.has(item)) truePositive++;
  }
  const precision = predictedItems.size ? truePositive / predictedItems.size : 0;
  const recall = expectedItems.size ? truePositive / expectedItems.size : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  const score = metric.scale.min + f1 * (metric.scale.max - metric.scale.min);

  return buildResult(metric, taskCase, submission, {
    score,
    status: "scored",
    reason: `F1=${round4(f1)}, precision=${round4(precision)}, recall=${round4(recall)}.`,
    evidence: [
      `expected=${JSON.stringify([...expectedItems])}`,
      `predicted=${JSON.stringify([...predictedItems])}`,
    ],
    confidence: 1,
    expected: [...expectedItems],
    actual: [...predictedItems],
  });
}

async function evaluateLlmJudge(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
  context: BenchmarkEvaluatorContext,
): Promise<BenchmarkMetricEvaluationResult> {
  if (!context.llmJudge) {
    return buildResult(metric, taskCase, submission, {
      score: metric.scale.min,
      status: "needs_human_review",
      reason: "LLM Judge is not configured. Human label is required in the calibration phase.",
      evidence: [],
      confidence: 0,
      expected: taskCase.expected,
      actual: submission.parsedOutput ?? submission.rawOutput,
      needsHumanReview: true,
    });
  }

  const judged = await context.llmJudge({ metric, taskCase, submission });
  const snappedScore = snapScoreToRubricLevels(
    judged.score,
    metric.config?.rubricForm,
    metric.scale,
  );
  if (
    shouldBlockMaxScoreWithoutEvidence(
      snappedScore,
      judged.evidence,
      metric.scale,
      metric.evidenceRequired,
    )
  ) {
    return buildResult(metric, taskCase, submission, {
      score: metric.scale.min,
      status: "blocked",
      reason: "LLM judge blocked: top rubric score requires non-empty evidence.",
      evidence: judged.evidence,
      confidence: 0,
      expected: taskCase.expected,
      actual: submission.parsedOutput ?? submission.rawOutput,
      needsHumanReview: true,
    });
  }

  return buildResult(metric, taskCase, submission, {
    score: snappedScore,
    status: "scored",
    reason: judged.reason,
    evidence: judged.evidence,
    confidence: clamp(judged.confidence, 0, 1),
    expected: taskCase.expected,
    actual: submission.parsedOutput ?? submission.rawOutput,
    needsHumanReview: metric.humanApprovalRequired,
  });
}

function evaluateHumanLabel(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
): BenchmarkMetricEvaluationResult {
  const humanLabel = taskCase.humanLabels?.[metric.metricKey];
  if (!humanLabel) {
    return buildResult(metric, taskCase, submission, {
      score: metric.scale.min,
      status: "needs_human_review",
      reason: "Human label is missing for this metric.",
      evidence: [],
      confidence: 0,
      expected: taskCase.expected,
      actual: submission.parsedOutput ?? submission.rawOutput,
      needsHumanReview: true,
    });
  }

  return buildResult(metric, taskCase, submission, {
    score: clamp(humanLabel.score, metric.scale.min, metric.scale.max),
    status: "scored",
    reason: humanLabel.reason,
    evidence: humanLabel.evidence ? [humanLabel.evidence] : [],
    confidence: 1,
    expected: taskCase.expected,
    actual: submission.parsedOutput ?? submission.rawOutput,
    humanLabel,
  });
}

function evaluateExternalArtifact(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
): BenchmarkMetricEvaluationResult {
  const evaluatorResults = submission.artifacts?.evaluatorResults;
  const result = isRecord(evaluatorResults) ? evaluatorResults[metric.metricKey] : undefined;
  if (!isRecord(result)) {
    return buildResult(metric, taskCase, submission, {
      score: metric.scale.min,
      status: "unsupported",
      reason: `${metric.evaluatorType} requires an external evaluator artifact.`,
      evidence: [],
      confidence: 0,
      expected: taskCase.expected,
      actual: submission.parsedOutput ?? submission.rawOutput,
    });
  }

  const score = typeof result.score === "number" ? result.score : metric.scale.min;
  const reason = typeof result.reason === "string" ? result.reason : "External evaluator result.";
  const evidence = Array.isArray(result.evidence) ? result.evidence.map(String) : [];

  return buildResult(metric, taskCase, submission, {
    score: clamp(score, metric.scale.min, metric.scale.max),
    status: "scored",
    reason,
    evidence,
    confidence: typeof result.confidence === "number" ? clamp(result.confidence, 0, 1) : 1,
    expected: taskCase.expected,
    actual: submission.parsedOutput ?? submission.rawOutput,
  });
}

function buildResult(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
  input: {
    score: number;
    status: BenchmarkMetricEvaluationResult["status"];
    reason: string;
    evidence: string[];
    confidence: number;
    expected?: unknown;
    actual?: unknown;
    humanLabel?: BenchmarkMetricEvaluationResult["humanLabel"];
    needsHumanReview?: boolean;
  },
): BenchmarkMetricEvaluationResult {
  const score = clamp(input.score, metric.scale.min, metric.scale.max);
  return {
    runId: submission.runId,
    benchmarkId: submission.benchmarkId,
    taskId: submission.taskId,
    caseId: taskCase.caseId,
    submissionId: submission.submissionId,
    agentFramework: submission.agentFramework,
    model: submission.model,
    metricKey: metric.metricKey,
    metricWeight: metric.weight,
    capability: metric.capability,
    evaluatorType: metric.evaluatorType,
    score,
    normalizedScore: normalizeScore(score, metric.scale),
    passed: score >= metric.scale.passThreshold,
    status: input.status,
    reason: input.reason,
    evidence: input.evidence,
    confidence: input.confidence,
    expected: input.expected,
    actual: input.actual,
    humanLabel: input.humanLabel,
    needsHumanReview: input.needsHumanReview ?? metric.humanApprovalRequired,
    failureTags: score >= metric.scale.passThreshold ? [] : metric.failureTags,
  };
}

function getExpectedValue(taskCase: BenchmarkCase, path: string | undefined): unknown {
  return getByPath({ expected: taskCase.expected, input: taskCase.input, metadata: taskCase.metadata }, path);
}

function getSubmissionValue(submission: BenchmarkAgentSubmission, path: string | undefined): unknown {
  const parsedOutput = submission.parsedOutput ?? parseJsonObject(submission.rawOutput);
  return getByPath({ ...submission, parsedOutput }, path);
}

function getByPath(source: Record<string, unknown>, path: string | undefined): unknown {
  if (!path) return undefined;
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
}

function parseJsonObject(raw: string): Record<string, unknown> | undefined {
  try {
    const trimmed = raw.trim();
    const jsonText = trimmed.startsWith("```")
      ? trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim()
      : trimmed;
    const parsed = JSON.parse(jsonText);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Normalize a rubric score into a 0–100 percentage.
 *
 * @param score Raw rubric score.
 * @param scale Metric scale bounds.
 * @returns Percentage in [0, 100].
 */
export function normalizeScore(score: number, scale: { min: number; max: number }): number {
  if (scale.max === scale.min) return 0;
  return round2(((score - scale.min) / (scale.max - scale.min)) * 100);
}

function normalizeScalar(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function toStringSet(value: unknown): Set<string> {
  if (Array.isArray(value)) {
    return new Set(value.map((item) => normalizeScalar(item)).filter(Boolean));
  }
  if (typeof value === "string") {
    return new Set(value.split(/[,\n;]/g).map((item) => normalizeScalar(item)).filter(Boolean));
  }
  return new Set();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
