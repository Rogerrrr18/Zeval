/**
 * @fileoverview Module 3 — Admission scorer unit tests (TDD).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { learnAdmissionPolicy } from "./admission-policy-learner.ts";
import { scoreAdmission } from "./admission-scorer.ts";
import type { AdmissionFeature, AdmissionLabelRow } from "./admission-policy-types.ts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function loadLabels(): AdmissionLabelRow[] {
  return JSON.parse(
    readFileSync(join(fixtureDir, "human-labels-mock-100.json"), "utf8"),
  ) as AdmissionLabelRow[];
}

function feature(overrides: Partial<AdmissionFeature>): AdmissionFeature {
  return {
    sessionId: "s1",
    caseId: "c1",
    channel: "ch_task_completion",
    metricKey: "task_success",
    autoScore: 3,
    confidence: 0.7,
    ...overrides,
  };
}

describe("scoreAdmission", () => {
  const policy = learnAdmissionPolicy(loadLabels(), {
    generatedAt: "2026-01-01T00:00:00.000Z",
  });
  const channelPolicy = policy.channels.ch_task_completion;

  it("M3-05: high score + confidence accepts", () => {
    const result = scoreAdmission(
      feature({ autoScore: 5, confidence: 0.95, qualityPercentile: 0.9 }),
      channelPolicy,
    );
    assert.equal(result.decision, "accept");
  });

  it("M3-04: reject rules beat accept rules", () => {
    const strictPolicy = {
      ...channelPolicy,
      acceptRules: [{ type: "scoreGte" as const, scoreGte: 2 }],
      rejectRules: [{ type: "scoreLte" as const, scoreLte: 5 }],
    };
    const result = scoreAdmission(feature({ autoScore: 4, confidence: 0.9 }), strictPolicy);
    assert.equal(result.decision, "reject");
  });

  it("M3-07: low confidence routes to human", () => {
    const confidenceRule = channelPolicy.acceptRules.find((rule) => rule.type === "confidenceGte") as
      | { confidenceGte: number }
      | undefined;
    const result = scoreAdmission(
      feature({
        autoScore: 4,
        confidence: Math.max(0, (confidenceRule?.confidenceGte ?? 0.7) - 0.2),
      }),
      channelPolicy,
    );
    assert.equal(result.decision, "human");
  });

  it("M3-06: gray zone routes to human", () => {
    const result = scoreAdmission(
      feature({
        autoScore: (channelPolicy.acceptRules.find((rule) => rule.type === "scoreGte") as { scoreGte: number } | undefined)?.scoreGte ?? 3,
        confidence: 0.2,
      }),
      channelPolicy,
    );
    assert.equal(result.decision, "human");
  });

  it("M3-08: unmatched features default to human", () => {
    const emptyPolicy = {
      ...channelPolicy,
      acceptRules: [],
      rejectRules: [],
      uncertaintyRules: [],
    };
    const result = scoreAdmission(feature({ autoScore: 99 }), emptyPolicy);
    assert.equal(result.decision, "human");
  });
});
