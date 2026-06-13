/**
 * @fileoverview Learn static channel admission policies from human labels.
 */

import type {
  AdmissionLabelRow,
  AdmissionPolicy,
  AdmissionRule,
  ChannelPolicy,
  LearnPolicyOptions,
} from "./admission-policy-types.ts";

/**
 * Minimum accept/reject samples per channel before quantile rules are emitted.
 * Lowered to 3 so a 20-label batch (spread across up to 5 channels) can still
 * produce usable per-channel accept/reject rules instead of only uncertainty.
 */
const DEFAULT_MIN_SAMPLES = 3;

/**
 * Compute linear-interpolation percentile of a numeric array.
 *
 * @param values Sample values.
 * @param q Quantile in [0, 1].
 * @returns Interpolated percentile value.
 */
export function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0];
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return round2(sorted[lower]);
  const weight = position - lower;
  return round2(sorted[lower] * (1 - weight) + sorted[upper] * weight);
}

/**
 * Learn a versioned admission policy from labeled rows.
 *
 * @param labels Human review labels joined with auto metric scores.
 * @param options Learning configuration.
 * @returns Static admission policy JSON.
 */
export function learnAdmissionPolicy(
  labels: AdmissionLabelRow[],
  options: LearnPolicyOptions = {},
): AdmissionPolicy {
  const minSamples = options.minSamplesPerGroup ?? DEFAULT_MIN_SAMPLES;
  const channels = new Map<string, AdmissionLabelRow[]>();
  for (const row of labels) {
    if (!channels.has(row.channel)) channels.set(row.channel, []);
    channels.get(row.channel)!.push(row);
  }

  const channelPolicies: Record<string, ChannelPolicy> = {};
  let agreementMatches = 0;
  for (const row of labels) {
    if (row.decision === "needs_evidence") continue;
    const humanPassed = row.decision === "accepted";
    if (humanPassed === row.autoPassed) agreementMatches += 1;
  }
  const agreementDenominator = labels.filter((row) => row.decision !== "needs_evidence").length;
  const globalAgreement = agreementDenominator > 0 ? agreementMatches / agreementDenominator : 0;

  for (const [channel, rows] of channels.entries()) {
    channelPolicies[channel] = learnChannelPolicy(rows, minSamples, globalAgreement);
  }

  return {
    policyId: options.policyId ?? "admission-policy-v1",
    projectId: options.projectId ?? "default",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    labelCount: labels.length,
    channels: channelPolicies,
  };
}

/**
 * Fit per-channel accept/reject/uncertainty rules.
 *
 * @param rows Labels for one channel.
 * @param minSamples Minimum samples per accept/reject group.
 * @param agreementRate Global human/auto agreement rate.
 * @returns Channel policy rules.
 */
function learnChannelPolicy(
  rows: AdmissionLabelRow[],
  minSamples: number,
  agreementRate: number,
): ChannelPolicy {
  const acceptRows = rows.filter((row) => row.decision === "accepted");
  const rejectRows = rows.filter((row) => row.decision === "rejected");
  const acceptScores = acceptRows.map((row) => row.autoScore);
  const rejectScores = rejectRows.map((row) => row.autoScore);
  const acceptConfidence = acceptRows.map((row) => row.confidence);
  const acceptQuality = acceptRows
    .map((row) => row.qualityScore)
    .filter((value): value is number => typeof value === "number");

  const minSamplesMet =
    acceptRows.length >= minSamples && rejectRows.length >= minSamples;

  const acceptRules: AdmissionRule[] = [];
  const rejectRules: AdmissionRule[] = [];
  const uncertaintyRules: AdmissionRule[] = [];

  if (minSamplesMet) {
    const scoreGte = percentile(acceptScores, 0.2);
    const scoreLte = percentile(rejectScores, 0.8);
    const confidenceGte = median(acceptConfidence);
    acceptRules.push({ type: "scoreGte", scoreGte });
    acceptRules.push({ type: "confidenceGte", confidenceGte: round2(confidenceGte) });
    if (acceptQuality.length >= minSamples) {
      acceptRules.push({
        type: "qualityPercentileGte",
        qualityPercentileGte: percentile(acceptQuality, 0.3),
      });
    }
    rejectRules.push({ type: "scoreLte", scoreLte });
    if (scoreLte < scoreGte) {
      uncertaintyRules.push({ type: "scoreBetween", low: scoreLte, high: scoreGte });
    }
    uncertaintyRules.push({ type: "confidenceLt", confidenceLt: round2(confidenceGte) });
    uncertaintyRules.push({ type: "judgeVarianceGt", judgeVarianceGt: 0.35 });
  } else {
    uncertaintyRules.push({ type: "judgeVarianceGt", judgeVarianceGt: 0.35 });
    uncertaintyRules.push({ type: "confidenceLt", confidenceLt: 0.65 });
  }

  const channelAgreementMatches = rows.filter((row) => {
    if (row.decision === "needs_evidence") return false;
    return (row.decision === "accepted") === row.autoPassed;
  }).length;
  const channelAgreementDenominator = rows.filter((row) => row.decision !== "needs_evidence").length;
  const channelAgreement = channelAgreementDenominator > 0
    ? channelAgreementMatches / channelAgreementDenominator
    : agreementRate;

  return {
    acceptRules,
    rejectRules,
    uncertaintyRules,
    sampleRateForHuman: round2(clamp(1 - channelAgreement, 0.1, 0.5)),
    stats: {
      acceptN: acceptRows.length,
      rejectN: rejectRows.length,
      agreementRate: round2(channelAgreement),
      minSamplesMet,
    },
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
