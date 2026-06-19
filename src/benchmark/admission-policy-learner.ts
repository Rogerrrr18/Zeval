/**
 * @fileoverview Learn static channel admission policies from human labels.
 */

import type {
  AdmissionLabelRow,
  AdmissionPolicy,
  AdmissionRule,
  ChannelPolicy,
  HumanJudgmentChannelGuide,
  HumanJudgmentSkill,
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
    humanSkill: buildHumanJudgmentSkill(labels, channelPolicies, {
      generatedAt: options.generatedAt,
      policyId: options.policyId,
    }),
  };
}

/**
 * Build a reusable human judgment skill from review labels.
 *
 * The skill captures reviewer behavior and boundary cases so downstream judges
 * and samplers can generalize beyond static score thresholds. When labels lack
 * notes or evidence, it degrades to score/confidence-derived guidance.
 *
 * @param labels Human review labels joined with automatic signals.
 * @param channelPolicies Learned quantitative policy by channel.
 * @param options Optional deterministic metadata.
 * @returns Human judgment skill embedded into the admission policy.
 */
export function buildHumanJudgmentSkill(
  labels: AdmissionLabelRow[],
  channelPolicies: Record<string, ChannelPolicy>,
  options: { generatedAt?: string; policyId?: string } = {},
): HumanJudgmentSkill {
  const labelsByChannel = new Map<string, AdmissionLabelRow[]>();
  for (const label of labels) {
    if (!labelsByChannel.has(label.channel)) labelsByChannel.set(label.channel, []);
    labelsByChannel.get(label.channel)!.push(label);
  }

  const channelGuides: Record<string, HumanJudgmentChannelGuide> = {};
  for (const [channel, rows] of labelsByChannel.entries()) {
    channelGuides[channel] = buildChannelGuide(channel, rows, channelPolicies[channel]);
  }

  return {
    skillId: `${options.policyId ?? "admission-policy-v1"}:human-judgment-skill`,
    version: "v1",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    labelCount: labels.length,
    purpose: "Generalize human benchmark admission behavior into channel-level review guidance for judge calibration, sampling and case-pool admission.",
    channelGuides,
  };
}

/**
 * Build one channel guide from human labels and learned quantitative rules.
 *
 * @param channel Admission channel id.
 * @param rows Labels assigned to this channel.
 * @param policy Learned channel policy, when available.
 * @returns Human-readable and machine-storable channel guide.
 */
function buildChannelGuide(
  channel: string,
  rows: AdmissionLabelRow[],
  policy?: ChannelPolicy,
): HumanJudgmentChannelGuide {
  const accepted = rows.filter((row) => row.decision === "accepted");
  const rejected = rows.filter((row) => row.decision === "rejected");
  const uncertain = rows.filter((row) => row.decision === "needs_evidence");
  const correctionCounts = countCorrections(rows);
  const rationales = rows
    .map((row) => row.reviewerRationale?.trim())
    .filter((text): text is string => Boolean(text))
    .slice(0, 8);
  const evidenceHeuristics = summarizeEvidenceHeuristics(rows);
  const acceptMedian = percentile(accepted.map((row) => row.autoScore), 0.5);
  const rejectMedian = percentile(rejected.map((row) => row.autoScore), 0.5);
  const confidenceMedian = percentile(rows.map((row) => row.confidence), 0.5);
  const uncertaintyConfidenceLt = findConfidenceLtRule(policy?.uncertaintyRules);

  return {
    channel,
    labelCount: rows.length,
    objective: `复现人类在 ${channel} channel 中对 case 是否值得沉淀入池的判断。`,
    acceptBoundary: accepted.length
      ? `通常接受：人工确认达到 rubric 通过边界，自动分数中位约 ${acceptMedian}，且证据能支撑当前 channel 的核心能力。`
      : "当前缺少接受样本；默认交给人工继续积累正例。",
    rejectBoundary: rejected.length
      ? `通常拒绝或反向入池：人工推翻或确认失败，自动分数中位约 ${rejectMedian}，存在关键遗漏、误判或证据不足。`
      : "当前缺少拒绝样本；默认避免自动拒绝。",
    uncertaintyBoundary: uncertain.length
      ? `存疑边界：已有 ${uncertain.length} 条 needs_evidence，低置信、证据冲突或 judge variance 高时继续交给人工。`
      : `存疑边界：置信度低于 ${uncertaintyConfidenceLt ?? Math.min(0.65, confidenceMedian)} 或评审分歧明显时交给人工。`,
    commonCorrections: correctionCounts,
    evidenceHeuristics,
    reviewerRationales: rationales,
    samplingGuidance: `后续抽样优先覆盖 ${channel} 中低置信、分数边界和人机不一致样本；建议人工抽样率 ${Math.round((policy?.sampleRateForHuman ?? 0.3) * 100)}%。`,
  };
}

/**
 * Read the confidenceLt uncertainty threshold from channel rules.
 *
 * @param rules Admission rules from one channel policy.
 * @returns Configured threshold, or undefined when absent.
 */
function findConfidenceLtRule(rules: AdmissionRule[] | undefined): number | undefined {
  const rule = rules?.find((item): item is Extract<AdmissionRule, { type: "confidenceLt" }> => item.type === "confidenceLt");
  return rule?.confidenceLt;
}

/**
 * Count reviewer correction types for one channel.
 *
 * @param rows Labels in one channel.
 * @returns Ranked correction counts.
 */
function countCorrections(rows: AdmissionLabelRow[]): Array<{ correctionType: string; count: number }> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const type = row.correctionType ?? inferCorrectionType(row);
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([correctionType, count]) => ({ correctionType, count }));
}

/**
 * Summarize evidence usage from human labels.
 *
 * @param rows Labels in one channel.
 * @returns Compact evidence heuristics.
 */
function summarizeEvidenceHeuristics(rows: AdmissionLabelRow[]): string[] {
  const evidenceSamples = rows.flatMap((row) => row.evidenceUsed ?? []).filter(Boolean).slice(0, 8);
  const heuristics = [
    "优先引用原始 transcript、验收标准和被测输出中的可复核片段。",
    "如果 evidence 无法支撑人工调分或推翻 judge，保持 needs_evidence。",
  ];
  if (evidenceSamples.length > 0) {
    heuristics.push(`近期人工常用证据片段：${evidenceSamples.join(" | ")}`);
  }
  return heuristics;
}

/**
 * Infer correction behavior when the client did not provide an explicit type.
 *
 * @param row Human label row.
 * @returns Stable correction type.
 */
function inferCorrectionType(row: AdmissionLabelRow): NonNullable<AdmissionLabelRow["correctionType"]> {
  if (row.decision === "needs_evidence") return "needs_more_evidence";
  if (row.decision === "accepted") return row.autoPassed ? "agree_accept" : "false_positive";
  return row.autoPassed ? "false_negative" : "agree_reject";
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
