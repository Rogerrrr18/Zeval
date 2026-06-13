/**
 * @fileoverview Tests for the canonical admission channel taxonomy and the
 * 20-label small-sample policy generation path.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ADMISSION_CHANNELS,
  ADMISSION_CHANNEL_IDS,
  ADMISSION_POLICY_MIN_LABELS,
  admissionChannelLabel,
  isAdmissionChannel,
} from "./admission-channels.ts";
import { learnAdmissionPolicy } from "./admission-policy-learner.ts";
import type { AdmissionLabelRow } from "./admission-policy-types.ts";

describe("admission channels", () => {
  it("CH-01: exposes the fixed five-channel taxonomy", () => {
    assert.equal(ADMISSION_CHANNELS.length, 5);
    assert.ok(ADMISSION_CHANNEL_IDS.includes("ch_task_completion"));
    assert.ok(ADMISSION_CHANNEL_IDS.includes("ch_format_compliance"));
    assert.ok(ADMISSION_CHANNEL_IDS.includes("ch_decision_accuracy"));
    assert.ok(ADMISSION_CHANNEL_IDS.includes("ch_uncertainty"));
    assert.ok(ADMISSION_CHANNEL_IDS.includes("ch_human_gold"));
  });

  it("CH-02: policy label threshold is 20", () => {
    assert.equal(ADMISSION_POLICY_MIN_LABELS, 20);
  });

  it("CH-03: validates and labels channel ids", () => {
    assert.equal(isAdmissionChannel("ch_human_gold"), true);
    assert.equal(isAdmissionChannel("ch_unknown"), false);
    assert.equal(isAdmissionChannel(undefined), false);
    assert.equal(admissionChannelLabel("ch_task_completion"), "任务完成");
    assert.equal(admissionChannelLabel(undefined), "未选择");
    assert.equal(admissionChannelLabel("ch_custom"), "ch_custom");
  });
});

/**
 * Build N synthetic label rows for one channel with deterministic scores.
 */
function buildChannelLabels(
  channel: string,
  acceptCount: number,
  rejectCount: number,
): AdmissionLabelRow[] {
  const rows: AdmissionLabelRow[] = [];
  for (let index = 0; index < acceptCount; index += 1) {
    rows.push({
      sessionId: `${channel}_pos_${index}`,
      caseId: `${channel}_case_pos_${index}`,
      channel,
      metricKey: channel.replace("ch_", ""),
      decision: "accepted",
      autoScore: 4 + (index % 2) * 0.5,
      confidence: 0.8,
      qualityScore: 0.7,
      autoPassed: true,
    });
  }
  for (let index = 0; index < rejectCount; index += 1) {
    rows.push({
      sessionId: `${channel}_neg_${index}`,
      caseId: `${channel}_case_neg_${index}`,
      channel,
      metricKey: channel.replace("ch_", ""),
      decision: "rejected",
      autoScore: 1 + (index % 2) * 0.5,
      confidence: 0.6,
      autoPassed: false,
    });
  }
  return rows;
}

describe("learnAdmissionPolicy small-sample (20 labels)", () => {
  it("CH-04: generates per-channel accept/reject rules from a 20-label batch", () => {
    const labels = [
      ...buildChannelLabels("ch_task_completion", 8, 4),
      ...buildChannelLabels("ch_format_compliance", 5, 3),
    ];
    assert.equal(labels.length, 20);

    const policy = learnAdmissionPolicy(labels, { projectId: "small-sample" });
    assert.equal(policy.labelCount, 20);

    const taskChannel = policy.channels.ch_task_completion;
    assert.ok(taskChannel, "task completion channel exists");
    assert.equal(taskChannel.stats.minSamplesMet, true);
    assert.ok(taskChannel.acceptRules.length > 0, "accept rules present");
    assert.ok(taskChannel.rejectRules.length > 0, "reject rules present");

    const formatChannel = policy.channels.ch_format_compliance;
    assert.ok(formatChannel, "format compliance channel exists");
    assert.equal(formatChannel.stats.minSamplesMet, true);
    assert.ok(formatChannel.acceptRules.length > 0);
  });

  it("CH-05: channel with too few reject samples only emits uncertainty rules", () => {
    const labels = [
      ...buildChannelLabels("ch_task_completion", 8, 4),
      ...buildChannelLabels("ch_decision_accuracy", 6, 2),
    ];
    const policy = learnAdmissionPolicy(labels, { projectId: "thin" });
    const thinChannel = policy.channels.ch_decision_accuracy;
    assert.ok(thinChannel);
    assert.equal(thinChannel.stats.minSamplesMet, false);
    assert.equal(thinChannel.acceptRules.length, 0);
    assert.ok(thinChannel.uncertaintyRules.length > 0);
  });
});
