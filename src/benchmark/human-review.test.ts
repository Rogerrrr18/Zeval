/**
 * @fileoverview Tests for session-level human review helpers.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  SESSION_REVIEW_METRIC_KEY,
  buildSessionAdmitReviews,
  countLabeledSessions,
  inferReviewDecisionFromScore,
  isMetricReviewConfirmed,
} from "./human-review.ts";
import type { BenchmarkHumanReviewRecord } from "./session-store.ts";
import type { BenchmarkMetricEvaluationResult, BenchmarkRubricMetric } from "./types.ts";

function metricResult(overrides: Partial<BenchmarkMetricEvaluationResult>): BenchmarkMetricEvaluationResult {
  return {
    runId: "run_1",
    benchmarkId: "bench_1",
    taskId: "task_1",
    caseId: "case_1",
    submissionId: "sub_1",
    agentFramework: "zeval",
    model: "test-model",
    metricKey: "metric",
    metricWeight: 1,
    capability: "task_completion",
    evaluatorType: "llm_judge",
    score: 3,
    normalizedScore: 60,
    passed: true,
    status: "scored",
    confidence: 0.9,
    evidence: [],
    reason: "ok",
    needsHumanReview: false,
    failureTags: [],
    ...overrides,
  };
}

describe("human-review", () => {
  it("builds admit rows only when session channel and all metric scores are confirmed", () => {
    const runId = "run_1";
    const submissionId = "sub_1";
    const metricResults = [
      metricResult({
        runId,
        submissionId,
        caseId: "case_1",
        metricKey: "intent_accuracy",
        score: 5,
        normalizedScore: 100,
        passed: true,
        reason: "ok",
      }),
      metricResult({
        runId,
        submissionId,
        caseId: "case_1",
        metricKey: "format_compliance",
        score: 1,
        normalizedScore: 20,
        passed: false,
        reason: "bad",
      }),
    ];
    const records: BenchmarkHumanReviewRecord[] = [
      {
        runId,
        submissionId,
        metricKey: SESSION_REVIEW_METRIC_KEY,
        channel: "ch_format_compliance",
        reviewer: "tester",
      },
      {
        runId,
        submissionId,
        metricKey: "intent_accuracy",
        confirmedScore: 5,
        decision: "accepted",
      },
    ];
    const metricByKey = new Map<string, BenchmarkRubricMetric>([
      ["intent_accuracy", { metricKey: "intent_accuracy", scale: { passThreshold: 3 } } as BenchmarkRubricMetric],
      ["format_compliance", { metricKey: "format_compliance", scale: { passThreshold: 3 } } as BenchmarkRubricMetric],
    ]);

    assert.equal(buildSessionAdmitReviews(runId, submissionId, records, metricResults, metricByKey).length, 0);

    records.push({
      runId,
      submissionId,
      metricKey: "format_compliance",
      confirmedScore: 1,
      decision: "rejected",
    });

    const rows = buildSessionAdmitReviews(runId, submissionId, records, metricResults, metricByKey);
    assert.equal(rows.length, 2);
    assert.ok(rows.every((row) => row.channel === "ch_format_compliance"));
    assert.equal(rows[1]?.decision, "rejected");
  });

  it("counts labeled sessions by channel plus confirmed metrics", () => {
    const runId = "run_1";
    const records: BenchmarkHumanReviewRecord[] = [
      { runId, submissionId: "sub_1", metricKey: SESSION_REVIEW_METRIC_KEY, channel: "ch_human_gold" },
      { runId, submissionId: "sub_1", metricKey: "m1", confirmedScore: 5 },
      { runId, submissionId: "sub_1", metricKey: "m2", confirmedScore: 3 },
    ];
    const counts = new Map([["sub_1", 2]]);
    assert.equal(countLabeledSessions(runId, records, counts), 1);
  });

  it("infers accepted/rejected from rubric threshold", () => {
    assert.equal(inferReviewDecisionFromScore(5, 3), "accepted");
    assert.equal(inferReviewDecisionFromScore(1, 3), "rejected");
    assert.equal(isMetricReviewConfirmed({ confirmedScore: 3 } as BenchmarkHumanReviewRecord), true);
    assert.equal(isMetricReviewConfirmed({ decision: "accepted" } as BenchmarkHumanReviewRecord), false);
  });
});
