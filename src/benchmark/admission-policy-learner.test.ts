/**
 * @fileoverview Module 3 — Policy learner unit tests (TDD).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { evaluatePolicyHoldoutAgreement } from "./admission-policy-holdout.ts";
import { learnAdmissionPolicy, percentile } from "./admission-policy-learner.ts";
import type { AdmissionLabelRow } from "./admission-policy-types.ts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");

function loadLabels(): AdmissionLabelRow[] {
  return JSON.parse(
    readFileSync(join(fixtureDir, "human-labels-mock-100.json"), "utf8"),
  ) as AdmissionLabelRow[];
}

describe("percentile", () => {
  it("M3-01: computes P20 and P80", () => {
    const values = [1, 2, 3, 4, 5];
    assert.equal(percentile(values, 0.2), 1.8);
    assert.equal(percentile(values, 0.8), 4.2);
  });
});

describe("learnAdmissionPolicy", () => {
  it("M3-02: builds policy from 100 labels", () => {
    const labels = loadLabels();
    const policy = learnAdmissionPolicy(labels, { projectId: "test" });
    assert.equal(policy.labelCount, 100);
    assert.ok(policy.channels.ch_task_completion);
    assert.ok(policy.channels.ch_task_completion.acceptRules.length > 0);
  });

  it("M3-03: matches policy-golden-v1 snapshot", () => {
    const labels = loadLabels();
    const policy = learnAdmissionPolicy(labels, {
      projectId: "golden",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const golden = JSON.parse(
      readFileSync(join(fixtureDir, "policy-golden-v1.json"), "utf8"),
    ) as { channels: typeof policy.channels; labelCount: number };
    assert.deepEqual(policy.channels, golden.channels);
    assert.equal(policy.labelCount, golden.labelCount);
  });

  it("M3-03b: same input yields same rules (excluding generatedAt)", () => {
    const labels = loadLabels();
    const left = learnAdmissionPolicy(labels, {
      projectId: "test",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    const right = learnAdmissionPolicy(labels, {
      projectId: "test",
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.deepEqual(left.channels, right.channels);
  });

  it("M3-09: holdout agreement is at least 70%", () => {
    const labels = loadLabels();
    const result = evaluatePolicyHoldoutAgreement(labels, {
      trainRatio: 0.8,
      seed: 42,
      generatedAt: "2026-01-01T00:00:00.000Z",
    });
    assert.ok(result.holdoutCount >= 10);
    assert.ok(result.agreementRate >= 0.7, `holdout agreement ${result.agreementRate}`);
  });

  it("M3-10: sampleRateForHuman derived from agreement rate", () => {
    const labels = loadLabels();
    const policy = learnAdmissionPolicy(labels);
    const channel = policy.channels.ch_task_completion;
    const expected = Math.max(0.1, Math.min(0.5, 1 - channel.stats.agreementRate));
    assert.equal(channel.sampleRateForHuman, round2(expected));
  });
});

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
