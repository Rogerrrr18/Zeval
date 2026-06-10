/**
 * @fileoverview Holdout evaluation for learned admission policies.
 */

import { learnAdmissionPolicy } from "./admission-policy-learner.ts";
import type {
  AdmissionDecision,
  AdmissionFeature,
  AdmissionLabelRow,
  AdmissionRule,
  ChannelPolicy,
} from "./admission-policy-types.ts";
import { scoreAdmission } from "./admission-scorer.ts";

export type HoldoutEvaluationResult = {
  agreementRate: number;
  trainCount: number;
  holdoutCount: number;
  matchedCount: number;
};

/**
 * Evaluate holdout agreement after training on a stratified per-channel split.
 *
 * @param labels Full labeled dataset.
 * @param options Train ratio, shuffle seed, and learner options.
 * @returns Holdout agreement metrics.
 */
export function evaluatePolicyHoldoutAgreement(
  labels: AdmissionLabelRow[],
  options: {
    trainRatio?: number;
    seed?: number;
    generatedAt?: string;
    minSamplesPerGroup?: number;
  } = {},
): HoldoutEvaluationResult {
  const trainRatio = options.trainRatio ?? 0.8;
  const seed = options.seed ?? 42;
  const { train, holdout } = stratifiedTrainHoldoutSplit(labels, trainRatio, seed);
  const policy = learnAdmissionPolicy(train, {
    generatedAt: options.generatedAt ?? "2026-01-01T00:00:00.000Z",
    minSamplesPerGroup: options.minSamplesPerGroup ?? 5,
  });

  let matchedCount = 0;
  for (const row of holdout) {
    const channelPolicy = policy.channels[row.channel];
    if (!channelPolicy) continue;
    const feature = labelRowToFeature(row);
    const scored = scoreAdmission(feature, channelPolicy);
    if (policyDecisionMatchesHuman(scored.decision, row.decision, feature, channelPolicy)) {
      matchedCount += 1;
    }
  }

  return {
    agreementRate: holdout.length > 0 ? matchedCount / holdout.length : 0,
    trainCount: train.length,
    holdoutCount: holdout.length,
    matchedCount,
  };
}

/**
 * Compare a policy decision with a human review label.
 *
 * Policy `human` counts as a match for accepted/rejected rows when the feature
 * legitimately hits an uncertainty rule, instead of penalizing conservative routing.
 *
 * @param policyDecision Learned policy decision.
 * @param humanDecision Human review label.
 * @param feature Holdout feature vector.
 * @param channelPolicy Channel policy used for scoring.
 * @returns True when the decisions align.
 */
export function policyDecisionMatchesHuman(
  policyDecision: AdmissionDecision,
  humanDecision: AdmissionLabelRow["decision"],
  feature?: AdmissionFeature,
  channelPolicy?: Pick<ChannelPolicy, "uncertaintyRules">,
): boolean {
  if (humanDecision === "needs_evidence") {
    return policyDecision === "human";
  }
  if (humanDecision === "accepted") {
    if (policyDecision === "accept") return true;
    if (policyDecision === "human" && feature && channelPolicy) {
      return channelPolicy.uncertaintyRules.some((rule) => matchesUncertaintyRule(feature, rule));
    }
    return false;
  }
  if (policyDecision === "reject") return true;
  if (policyDecision === "human" && feature && channelPolicy) {
    return channelPolicy.uncertaintyRules.some((rule) => matchesUncertaintyRule(feature, rule));
  }
  return false;
}

function matchesUncertaintyRule(feature: AdmissionFeature, rule: AdmissionRule): boolean {
  switch (rule.type) {
    case "scoreBetween":
      return feature.autoScore >= rule.low && feature.autoScore <= rule.high;
    case "confidenceLt":
      return feature.confidence < rule.confidenceLt;
    case "judgeVarianceGt":
      return (feature.judgeVariance ?? 0) > rule.judgeVarianceGt;
    default:
      return false;
  }
}

function labelRowToFeature(row: AdmissionLabelRow): AdmissionFeature {
  return {
    sessionId: row.sessionId,
    caseId: row.caseId,
    channel: row.channel,
    metricKey: row.metricKey,
    autoScore: row.autoScore,
    confidence: row.confidence,
    qualityScore: row.qualityScore,
    qualityPercentile: row.qualityScore,
    judgeVariance: row.judgeVariance,
  };
}

function stratifiedTrainHoldoutSplit(
  labels: AdmissionLabelRow[],
  trainRatio: number,
  seed: number,
): { train: AdmissionLabelRow[]; holdout: AdmissionLabelRow[] } {
  const byChannel = new Map<string, AdmissionLabelRow[]>();
  for (const row of labels) {
    if (!byChannel.has(row.channel)) byChannel.set(row.channel, []);
    byChannel.get(row.channel)!.push(row);
  }

  const train: AdmissionLabelRow[] = [];
  const holdout: AdmissionLabelRow[] = [];
  let channelIndex = 0;
  for (const rows of byChannel.values()) {
    const shuffled = deterministicShuffle(rows, seed + channelIndex * 9973);
    const splitIndex = Math.max(1, Math.floor(shuffled.length * trainRatio));
    train.push(...shuffled.slice(0, splitIndex));
    holdout.push(...shuffled.slice(splitIndex));
    channelIndex += 1;
  }

  return { train, holdout };
}

function deterministicShuffle<T>(items: T[], seed: number): T[] {
  const copy = [...items];
  let state = seed >>> 0;
  for (let index = copy.length - 1; index > 0; index -= 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    const swapIndex = state % (index + 1);
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}
