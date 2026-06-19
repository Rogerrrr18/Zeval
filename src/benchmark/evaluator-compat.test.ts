/**
 * @fileoverview Generic transcript evaluator compatibility tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  adaptMetricForGenericTranscriptHarness,
  adaptRubricForGenericTranscriptHarness,
  summarizeGenericTranscriptEvaluatorAdaptations,
} from "./evaluator-compat.ts";
import type {
  BenchmarkEvaluatorType,
  BenchmarkRubricMetric,
  BenchmarkRubricSet,
} from "./types.ts";

const scale = { min: 0, max: 5, passThreshold: 3 };

function metric(evaluatorType: BenchmarkEvaluatorType): BenchmarkRubricMetric {
  return {
    metricKey: `${evaluatorType}_metric`,
    capability: "task_completion",
    displayName: `${evaluatorType} 指标`,
    description: "测试指标",
    evaluatorType,
    weight: 1,
    scale,
    approvalStatus: "approved",
    evidenceRequired: false,
    humanApprovalRequired: false,
    failureTags: [],
    config: {
      criteria: "原始评分准则",
      outputPath: "parsedOutput.answer",
      expectedPath: "expected.answer",
      predictedItemsPath: "parsedOutput.items",
      expectedItemsPath: "expected.items",
      childMetricKeys: ["a", "b"],
    },
  };
}

describe("generic transcript evaluator compatibility", () => {
  it("adapts structured and artifact evaluators to llm_judge", () => {
    const unsafeTypes: BenchmarkEvaluatorType[] = [
      "exact_match",
      "numeric_tolerance",
      "f1_match",
      "code_exec",
      "unit_test",
      "environment_state_test",
      "hybrid",
    ];

    for (const evaluatorType of unsafeTypes) {
      const adapted = adaptMetricForGenericTranscriptHarness(metric(evaluatorType));
      assert.equal(adapted.metric.evaluatorType, "llm_judge");
      assert.equal(adapted.metric.evidenceRequired, true);
      assert.equal(adapted.adaptation?.from, evaluatorType);
      assert.match(adapted.metric.config?.criteria ?? "", /generic transcript harness/);
    }
  });

  it("keeps already runnable semantic evaluators unchanged", () => {
    for (const evaluatorType of ["llm_judge", "human_label", "regex_match"] as BenchmarkEvaluatorType[]) {
      const adapted = adaptMetricForGenericTranscriptHarness(metric(evaluatorType));
      assert.equal(adapted.metric.evaluatorType, evaluatorType);
      assert.equal(adapted.adaptation, undefined);
    }
  });

  it("returns observable adaptation summaries for a rubric", () => {
    const rubric: BenchmarkRubricSet = {
      rubricId: "rubric_test",
      version: "0.1.0",
      title: "测试评分标准",
      description: "测试",
      domain: "custom",
      modules: [
        {
          capability: "task_completion",
          displayName: "任务完成",
          description: "测试",
          weight: 1,
          metrics: [metric("exact_match"), metric("llm_judge")],
        },
      ],
      generatedBy: "copilot",
      approvalStatus: "candidate",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const adapted = adaptRubricForGenericTranscriptHarness(rubric);
    assert.equal(adapted.adaptations.length, 1);
    assert.equal(adapted.rubric.modules[0]?.metrics[0]?.evaluatorType, "llm_judge");
    assert.match(summarizeGenericTranscriptEvaluatorAdaptations(adapted.adaptations), /exact_match 1 个/);
  });
});
