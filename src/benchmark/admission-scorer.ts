/**
 * @fileoverview Score admission decisions from static channel policies.
 */

import type {
  AdmissionFeature,
  AdmissionRule,
  AdmissionScoreResult,
  ChannelPolicy,
} from "./admission-policy-types.ts";

/**
 * Evaluate one feature against a channel policy.
 *
 * Decision order: reject (OR) → accept (AND) → uncertainty (OR) → human default.
 *
 * @param feature Session×channel feature vector.
 * @param policy Channel policy rules.
 * @returns Admission decision with matched rule ids.
 */
export function scoreAdmission(
  feature: AdmissionFeature,
  policy: ChannelPolicy,
): AdmissionScoreResult {
  const matchedRejectRules = policy.rejectRules
    .filter((rule) => matchesRule(feature, rule))
    .map(ruleLabel);
  if (matchedRejectRules.length > 0) {
    return {
      decision: "reject",
      matchedAcceptRules: [],
      matchedRejectRules,
      matchedUncertaintyRules: [],
    };
  }

  const matchedAcceptRules = policy.acceptRules
    .filter((rule) => matchesRule(feature, rule))
    .map(ruleLabel);
  if (
    policy.acceptRules.length > 0
    && matchedAcceptRules.length === policy.acceptRules.length
  ) {
    return {
      decision: "accept",
      matchedAcceptRules,
      matchedRejectRules: [],
      matchedUncertaintyRules: [],
    };
  }

  const matchedUncertaintyRules = policy.uncertaintyRules
    .filter((rule) => matchesRule(feature, rule))
    .map(ruleLabel);
  if (matchedUncertaintyRules.length > 0) {
    return {
      decision: "human",
      matchedAcceptRules,
      matchedRejectRules: [],
      matchedUncertaintyRules,
    };
  }

  return {
    decision: "human",
    matchedAcceptRules,
    matchedRejectRules: [],
    matchedUncertaintyRules: [],
  };
}

/**
 * Check whether a feature satisfies one admission rule.
 *
 * @param feature Feature vector.
 * @param rule Policy rule definition.
 * @returns True when the rule matches.
 */
export function matchesRule(feature: AdmissionFeature, rule: AdmissionRule): boolean {
  switch (rule.type) {
    case "scoreGte":
      return feature.autoScore >= rule.scoreGte;
    case "scoreLte":
      return feature.autoScore <= rule.scoreLte;
    case "confidenceGte":
      return feature.confidence >= rule.confidenceGte;
    case "confidenceLt":
      return feature.confidence < rule.confidenceLt;
    case "qualityPercentileGte":
      return (feature.qualityPercentile ?? 0) >= rule.qualityPercentileGte;
    case "scoreBetween":
      return feature.autoScore >= rule.low && feature.autoScore <= rule.high;
    case "judgeVarianceGt":
      return (feature.judgeVariance ?? 0) > rule.judgeVarianceGt;
    default:
      return false;
  }
}

function ruleLabel(rule: AdmissionRule): string {
  return rule.type;
}
