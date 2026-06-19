/**
 * @fileoverview Module 1 — Evaluator unit tests (TDD).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBenchmarkMetric } from "./evaluators.ts";
import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkRubricMetric,
} from "./types.ts";
import { assertMinimumApprovedMetrics } from "./rubric-guards.ts";

const scale = { min: 1, max: 5, passThreshold: 3 };

function baseMetric(overrides: Partial<BenchmarkRubricMetric> = {}): BenchmarkRubricMetric {
  return {
    metricKey: "decision_accuracy",
    capability: "task_completion",
    displayName: "筛选决策准确率",
    description: "test",
    evaluatorType: "exact_match",
    weight: 1,
    scale,
    approvalStatus: "approved",
    evidenceRequired: false,
    humanApprovalRequired: false,
    failureTags: [],
    config: {},
    ...overrides,
  };
}

function baseCase(expected: Record<string, unknown> = {}): BenchmarkCase {
  return {
    caseId: "case_001",
    taskId: "task_001",
    input: {},
    expected,
  };
}

function baseSubmission(parsedOutput: Record<string, unknown> = {}): BenchmarkAgentSubmission {
  return {
    submissionId: "sub_001",
    runId: "run_001",
    benchmarkId: "bench_001",
    taskId: "task_001",
    caseId: "case_001",
    agentFramework: "zeval",
    model: "test-model",
    status: "completed",
    rawOutput: JSON.stringify(parsedOutput),
    parsedOutput,
  };
}

describe("evaluateExactMatch", () => {
  it("M1-01: blocks when expected and actual are both empty", async () => {
    const result = await evaluateBenchmarkMetric(
      baseMetric({ evaluatorType: "exact_match" }),
      baseCase(),
      baseSubmission(),
    );
    assert.equal(result.status, "blocked");
    assert.notEqual(result.score, scale.max);
    assert.match(result.reason, /missing|blocked|expected/i);
  });

  it("M1-02: matches when expected and actual are equal", async () => {
    const result = await evaluateBenchmarkMetric(
      baseMetric({
        evaluatorType: "exact_match",
        config: { expectedPath: "expected.answer", outputPath: "parsedOutput.answer" },
      }),
      baseCase({ answer: "yes" }),
      baseSubmission({ answer: "yes" }),
    );
    assert.equal(result.status, "scored");
    assert.equal(result.score, scale.max);
  });
});

describe("objective evaluator guardrails", () => {
  it("blocks regex metrics that are missing a pattern", async () => {
    const result = await evaluateBenchmarkMetric(
      baseMetric({ evaluatorType: "regex_match", config: {} }),
      baseCase(),
      baseSubmission({ answer: "ok" }),
    );
    assert.equal(result.status, "blocked");
    assert.equal(result.needsHumanReview, true);
  });

  it("blocks numeric metrics with missing numeric fields", async () => {
    const result = await evaluateBenchmarkMetric(
      baseMetric({
        evaluatorType: "numeric_tolerance",
        config: { expectedPath: "expected.score", outputPath: "parsedOutput.score" },
      }),
      baseCase(),
      baseSubmission({ answer: "ok" }),
    );
    assert.equal(result.status, "blocked");
    assert.equal(result.needsHumanReview, true);
  });

  it("blocks standalone hybrid metrics instead of reporting unsupported", async () => {
    const result = await evaluateBenchmarkMetric(
      baseMetric({ evaluatorType: "hybrid", config: { childMetricKeys: ["a", "b"] } }),
      baseCase(),
      baseSubmission({ answer: "ok" }),
    );
    assert.equal(result.status, "blocked");
    assert.equal(result.needsHumanReview, true);
  });
});

describe("evaluateLlmJudge", () => {
  it("M1-03: uses multi-level judge score", async () => {
    const result = await evaluateBenchmarkMetric(
      baseMetric({
        metricKey: "task_success",
        evaluatorType: "llm_judge",
      }),
      baseCase(),
      baseSubmission(),
      {
        llmJudge: async () => ({
          score: 3,
          reason: "mock",
          evidence: ["e1"],
          confidence: 0.72,
        }),
      },
    );
    assert.equal(result.score, 3);
    assert.equal(result.normalizedScore, 50);
    assert.equal(result.status, "scored");
  });
});

describe("evaluateLlmJudge guards", () => {
  it("M1-04: blocks top score when evidence is empty", async () => {
    const result = await evaluateBenchmarkMetric(
      baseMetric({
        metricKey: "empathy",
        evaluatorType: "llm_judge",
        evidenceRequired: true,
        config: {
          rubricForm: [
            { score: 5, label: "优秀", description: "充分共情" },
            { score: 3, label: "合格", description: "基本共情" },
            { score: 1, label: "不合格", description: "缺乏共情" },
          ],
        },
      }),
      baseCase(),
      baseSubmission({ answer: "ok" }),
      {
        llmJudge: async () => ({
          score: 5,
          reason: "mock max",
          evidence: [],
          confidence: 0.9,
        }),
      },
    );
    assert.equal(result.status, "blocked");
    assert.notEqual(result.score, scale.max);
  });

  it("M1-07: converts rejected llm judge into error metric instead of throwing", async () => {
    const result = await evaluateBenchmarkMetric(
      baseMetric({
        metricKey: "empathy",
        evaluatorType: "llm_judge",
      }),
      baseCase(),
      baseSubmission({ answer: "ok" }),
      {
        llmJudge: async () => {
          throw new Error("SiliconFlow 请求失败: 429");
        },
      },
    );
    assert.equal(result.status, "error");
    assert.match(result.reason, /429/);
  });

  it("M1-06: score distribution is not degenerate", async () => {
    const mockScores = [1, 1, 3, 3, 5, 5, 3, 1];
    const normalizedScores: number[] = [];
    for (const score of mockScores) {
      const result = await evaluateBenchmarkMetric(
        baseMetric({
          metricKey: `metric_${score}`,
          evaluatorType: "llm_judge",
          config: {
            rubricForm: [
              { score: 5, label: "优秀", description: "优秀" },
              { score: 3, label: "合格", description: "合格" },
              { score: 1, label: "不合格", description: "不合格" },
            ],
          },
        }),
        baseCase(),
        baseSubmission({ answer: `case-${score}` }),
        {
          llmJudge: async () => ({
            score,
            reason: "mock",
            evidence: ["excerpt"],
            confidence: 0.8,
          }),
        },
      );
      normalizedScores.push(result.normalizedScore);
    }
    assert.ok(stdDev(normalizedScores) > 5);
  });
});

describe("assertMinimumApprovedMetrics", () => {
  it("M1-05: rejects rubrics with fewer than 3 approved metrics", () => {
    assert.throws(
      () => assertMinimumApprovedMetrics(2),
      /at least 3/i,
    );
    assert.doesNotThrow(() => assertMinimumApprovedMetrics(3));
  });
});

function stdDev(values: number[]): number {
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
