/**
 * @fileoverview Module 2 — ReRank unit tests (TDD).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assignQualityTiers,
  computeQualityPercentile,
  computeQualityScore,
  rankCasesByMetric,
  type RerankCaseInput,
} from "./rerank.ts";

function makeCase(
  caseId: string,
  metrics: Record<string, { score: number; weight: number; confidence: number; capabilityWeight?: number }>,
  extras?: Partial<RerankCaseInput>,
): RerankCaseInput {
  return {
    caseId,
    submissionId: `sub_${caseId}`,
    passed: true,
    metrics,
    judgeVariance: 0,
    ...extras,
  };
}

describe("computeQualityScore", () => {
  it("M2-01: higher metric scores yield higher Q", () => {
    const high = makeCase("high", {
      task_success: { score: 5, weight: 3, confidence: 0.9, capabilityWeight: 3 },
    });
    const low = makeCase("low", {
      task_success: { score: 1, weight: 3, confidence: 0.9, capabilityWeight: 3 },
    });
    const qHigh = computeQualityScore(high);
    const qLow = computeQualityScore(low);
    assert.ok(qHigh > qLow, `expected Q(high)=${qHigh} > Q(low)=${qLow}`);
  });

  it("M2-02: judge variance penalty lowers Q", () => {
    const stable = makeCase("stable", {
      m1: { score: 4, weight: 1, confidence: 0.8 },
    }, { judgeVariance: 0.1 });
    const volatile = makeCase("volatile", {
      m1: { score: 4, weight: 1, confidence: 0.8 },
    }, { judgeVariance: 0.5 });
    assert.ok(
      computeQualityScore(stable) > computeQualityScore(volatile),
      "lower variance should yield higher Q",
    );
  });
});

describe("assignQualityTiers", () => {
  it("M2-03: assigns gold/silver/borderline for 8 passed cases", () => {
    const cases = Array.from({ length: 8 }, (_, index) =>
      makeCase(`case_${index + 1}`, {
        m: { score: 1 + index * 0.5, weight: 1, confidence: 0.8 },
      }),
    );
    const ranked = assignQualityTiers(cases);
    const tiers = ranked.map((row) => row.qualityTier);
    assert.equal(tiers.filter((tier) => tier === "gold").length, 2);
    assert.equal(tiers.filter((tier) => tier === "silver").length, 3);
    assert.equal(tiers.filter((tier) => tier === "borderline").length, 3);
  });

  it("M2-04: top 25% are gold when N=20", () => {
    const cases = Array.from({ length: 20 }, (_, index) =>
      makeCase(`case_${index + 1}`, {
        m: { score: 1 + index * 0.2, weight: 1, confidence: 0.75 },
      }),
    );
    const ranked = assignQualityTiers(cases);
    assert.equal(ranked.filter((row) => row.qualityTier === "gold").length, 5);
  });

  it("M2-06: equal Q scores use stable submissionId tie-break and assign borderline-heavy tiers", () => {
    const cases = [
      makeCase("case_b", { m: { score: 3, weight: 1, confidence: 0.8 } }),
      makeCase("case_a", { m: { score: 3, weight: 1, confidence: 0.8 } }),
    ];
    const ranked = assignQualityTiers(cases);
    assert.equal(ranked[0].submissionId, "sub_case_a");
    assert.equal(ranked[0].qualityTier, "gold");
    assert.equal(ranked[1].qualityTier, "borderline");
  });
});

describe("rankCasesByMetric", () => {
  it("M2-05: ranks by single metric normalized score", () => {
    const cases = [
      makeCase("c1", { task_success: { score: 2, weight: 1, confidence: 1 } }),
      makeCase("c2", { task_success: { score: 5, weight: 1, confidence: 1 } }),
      makeCase("c3", { task_success: { score: 3, weight: 1, confidence: 1 } }),
    ];
    const order = rankCasesByMetric(cases, "task_success").map((row) => row.caseId);
    assert.deepEqual(order, ["c2", "c3", "c1"]);
  });
});

describe("computeQualityPercentile", () => {
  it("returns percentile rank within batch", () => {
    const scores = [0.2, 0.5, 0.8];
    assert.equal(computeQualityPercentile(0.8, scores), 1);
    assert.equal(computeQualityPercentile(0.2, scores), 0);
  });
});
