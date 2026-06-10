/**
 * @fileoverview Module 3 — Admission feature extractor unit tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  capabilityToAdmissionChannel,
  extractAdmissionFeatures,
} from "./admission-feature-extractor.ts";
import type { BenchmarkMetricEvaluationResult } from "./types.ts";

function metricResult(
  overrides: Partial<BenchmarkMetricEvaluationResult> = {},
): BenchmarkMetricEvaluationResult {
  return {
    runId: "run_001",
    benchmarkId: "bench_001",
    taskId: "task_001",
    caseId: "case_001",
    submissionId: "sub_001",
    agentFramework: "zeval",
    model: "test-model",
    metricKey: "task_success",
    metricWeight: 1,
    capability: "task_completion",
    evaluatorType: "llm_judge",
    score: 4,
    normalizedScore: 75,
    passed: true,
    status: "scored",
    reason: "mock",
    evidence: ["e1"],
    confidence: 0.8,
    needsHumanReview: false,
    failureTags: [],
    ...overrides,
  };
}

describe("extractAdmissionFeatures", () => {
  it("maps capability to channel and rerank stats", () => {
    const features = extractAdmissionFeatures(
      [metricResult()],
      new Map([
        ["sub_001", {
          qualityScore: 0.82,
          qualityTier: "gold",
          rankInRun: 1,
          qualityPercentile: 0.9,
          metricVector: { task_success: 0.75 },
          confVector: { task_success: 0.8 },
        }],
      ]),
      new Map([["case_001", "session_abc"]]),
    );

    assert.equal(features.length, 1);
    assert.equal(features[0].channel, capabilityToAdmissionChannel("task_completion"));
    assert.equal(features[0].sessionId, "session_abc");
    assert.equal(features[0].qualityPercentile, 0.9);
  });
});
