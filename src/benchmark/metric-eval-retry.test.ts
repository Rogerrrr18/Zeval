/**
 * @fileoverview Benchmark metric retry unit tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { evaluateBenchmarkMetricWithRetry } from "./metric-eval-retry.ts";
import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkRubricMetric,
} from "./types.ts";

const scale = { min: 1, max: 5, passThreshold: 3 };

function baseMetric(): BenchmarkRubricMetric {
  return {
    metricKey: "empathy",
    capability: "empathy",
    displayName: "共情",
    description: "test",
    evaluatorType: "llm_judge",
    weight: 1,
    scale,
    approvalStatus: "approved",
    evidenceRequired: false,
    humanApprovalRequired: false,
    failureTags: [],
    config: {},
  };
}

function baseCase(): BenchmarkCase {
  return {
    caseId: "case_001",
    taskId: "task_001",
    input: {},
    expected: {},
  };
}

function baseSubmission(): BenchmarkAgentSubmission {
  return {
    submissionId: "sub_001",
    runId: "run_001",
    benchmarkId: "bench_001",
    taskId: "task_001",
    caseId: "case_001",
    agentFramework: "zeval",
    model: "test-model",
    status: "completed",
    rawOutput: "{}",
    parsedOutput: { answer: "ok" },
  };
}

describe("evaluateBenchmarkMetricWithRetry", () => {
  it("retries transient 429 failures before returning error", async () => {
    process.env.ZEVAL_BENCHMARK_METRIC_RETRY_ATTEMPTS = "3";
    let calls = 0;
    const result = await evaluateBenchmarkMetricWithRetry(
      baseMetric(),
      baseCase(),
      baseSubmission(),
      {
        llmJudge: async () => {
          calls += 1;
          if (calls < 3) {
            throw new Error("SiliconFlow 请求失败: 429");
          }
          return {
            score: 3,
            reason: "ok after retry",
            evidence: ["excerpt"],
            confidence: 0.8,
          };
        },
      },
    );
    assert.equal(calls, 3);
    assert.equal(result.status, "scored");
    assert.equal(result.score, 3);
    delete process.env.ZEVAL_BENCHMARK_METRIC_RETRY_ATTEMPTS;
  });
});
