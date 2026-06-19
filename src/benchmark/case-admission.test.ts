/**
 * @fileoverview Tests for benchmark human-review admission semantics.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildBenchmarkDatasetCaseCandidatesFromReviews } from "./case-admission.ts";
import type { BenchmarkMetricEvaluationResult, BenchmarkRunResult } from "./types.ts";

function metricResult(overrides: Partial<BenchmarkMetricEvaluationResult>): BenchmarkMetricEvaluationResult {
  return {
    runId: "run_1",
    benchmarkId: "bench_1",
    taskId: "task_1",
    caseId: "case_1",
    submissionId: "sub_1",
    agentFramework: "zeval",
    model: "test-model",
    metricKey: "task_success",
    metricWeight: 1,
    capability: "task_completion",
    evaluatorType: "llm_judge",
    score: 2,
    normalizedScore: 40,
    passed: false,
    status: "scored",
    reason: "auto reason",
    evidence: ["evidence"],
    confidence: 0.8,
    needsHumanReview: false,
    failureTags: ["task_failed"],
    ...overrides,
  };
}

function runResult(metric: BenchmarkMetricEvaluationResult): BenchmarkRunResult {
  return {
    runId: "run_1",
    benchmarkId: "bench_1",
    taskId: "task_1",
    rubricId: "rubric_1",
    matrix: [],
    cases: [{ caseId: metric.caseId, taskId: "task_1", input: { transcript: "USER: hi" }, expected: {} }],
    submissions: [{
      submissionId: metric.submissionId,
      runId: "run_1",
      benchmarkId: "bench_1",
      taskId: "task_1",
      caseId: metric.caseId,
      agentFramework: "zeval",
      model: "test-model",
      startedAt: "2026-01-01T00:00:00.000Z",
      completedAt: "2026-01-01T00:00:01.000Z",
      durationMs: 1000,
      status: "completed",
      rawOutput: "ACTUAL",
    }],
    metricResults: [metric],
    caseScores: [],
    leaderboard: [],
    summary: {
      averageScore: metric.normalizedScore,
      caseCount: 1,
      submissionCount: 1,
      metricResultCount: 1,
      badcaseCandidateCount: 0,
      goldencaseCandidateCount: 0,
      needsHumanReviewCount: 0,
    },
    generatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("buildBenchmarkDatasetCaseCandidatesFromReviews", () => {
  it("treats accepted as human pass even when the automatic evaluator failed", () => {
    const metric = metricResult({ passed: false, score: 2, normalizedScore: 40 });
    const [candidate] = buildBenchmarkDatasetCaseCandidatesFromReviews(runResult(metric), [{
      submissionId: metric.submissionId,
      metricKey: metric.metricKey,
      decision: "accepted",
      channel: "ch_task_completion",
    }]);

    assert.equal(candidate.caseSetType, "goodcase");
    assert.equal(candidate.source, "manual_fp");
    assert.equal(candidate.metadata.false_positive, true);
  });

  it("treats rejected as human fail even when the automatic evaluator passed", () => {
    const metric = metricResult({ passed: true, score: 4, normalizedScore: 80 });
    const [candidate] = buildBenchmarkDatasetCaseCandidatesFromReviews(runResult(metric), [{
      submissionId: metric.submissionId,
      metricKey: metric.metricKey,
      decision: "rejected",
      channel: "ch_task_completion",
    }]);

    assert.equal(candidate.caseSetType, "badcase");
    assert.equal(candidate.source, "auto_disagreement");
    assert.equal(candidate.metadata.humanReviewDecision, "rejected");
  });
});
