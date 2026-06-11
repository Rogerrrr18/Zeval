/**
 * @fileoverview Rubric module/metric grouping normalization tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BenchmarkRubricMetric, BenchmarkRubricModule } from "./types.ts";
import {
  averageMetricsPerModule,
  consolidateSparseLlmModules,
} from "./rubric-structure.ts";

function makeMetric(metricKey: string, capability: BenchmarkRubricMetric["capability"]): BenchmarkRubricMetric {
  return {
    metricKey,
    capability,
    displayName: metricKey,
    description: `评估 ${metricKey}`,
    evaluatorType: "llm_judge",
    weight: 2,
    scale: { min: 0, max: 5, passThreshold: 3 },
    approvalStatus: "candidate",
    evidenceRequired: true,
    humanApprovalRequired: false,
    failureTags: [`${metricKey}_failed`],
    config: { criteria: "test" },
  };
}

function makeModule(
  capability: BenchmarkRubricModule["capability"],
  displayName: string,
  metrics: BenchmarkRubricMetric[],
): BenchmarkRubricModule {
  return {
    capability,
    displayName,
    description: displayName,
    weight: 3,
    metrics,
  };
}

describe("consolidateSparseLlmModules", () => {
  it("keeps healthy multi-metric modules unchanged", () => {
    const modules = [
      makeModule("task_completion", "任务完成", [
        makeMetric("intent_match", "task_completion"),
        makeMetric("solution_quality", "task_completion"),
      ]),
      makeModule("factual_grounding", "事实依据", [
        makeMetric("fact_consistency", "factual_grounding"),
        makeMetric("reference_match", "factual_grounding"),
      ]),
    ];

    const result = consolidateSparseLlmModules(modules);
    assert.equal(result.consolidated, false);
    assert.equal(result.modules.length, 2);
    assert.equal(averageMetricsPerModule(result.modules), 2);
  });

  it("merges duplicate capability modules before theme regrouping", () => {
    const modules = [
      makeModule("business_judgment", "情绪安抚", [makeMetric("empathy", "business_judgment")]),
      makeModule("business_judgment", "转人工控制", [makeMetric("handover", "business_judgment")]),
    ];

    const result = consolidateSparseLlmModules(modules);
    assert.equal(result.modules.length, 1);
    assert.equal(result.modules[0]?.metrics.length, 2);
  });

  it("regroups many single-metric modules into fewer parent modules", () => {
    const modules = [
      makeModule("task_completion", "解决方案", [makeMetric("solution_exec", "task_completion")]),
      makeModule("business_judgment", "情绪安抚", [makeMetric("empathy", "business_judgment")]),
      makeModule("business_judgment", "转人工", [makeMetric("handover", "business_judgment")]),
      makeModule("factual_grounding", "事实准确", [makeMetric("fact_match", "factual_grounding")]),
      makeModule("instruction_following", "指令遵循", [makeMetric("instruction", "instruction_following")]),
      makeModule("format_compliance", "格式合规", [makeMetric("format", "format_compliance")]),
    ];

    const result = consolidateSparseLlmModules(modules);
    assert.equal(result.consolidated, true);
    assert.ok(result.modules.length <= 4);
    assert.ok(averageMetricsPerModule(result.modules) >= 1.5);
    assert.equal(
      result.modules.reduce((count, module) => count + module.metrics.length, 0),
      6,
    );
  });
});
