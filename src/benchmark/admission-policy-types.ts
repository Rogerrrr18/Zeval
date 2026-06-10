/**
 * @fileoverview Types for static channel admission policies.
 */

export type HumanReviewDecision = "accepted" | "rejected" | "needs_evidence";

export type AdmissionLabelRow = {
  sessionId: string;
  caseId: string;
  channel: string;
  metricKey: string;
  decision: HumanReviewDecision;
  autoScore: number;
  confidence: number;
  qualityScore?: number;
  qualityTier?: string;
  autoPassed: boolean;
  judgeVariance?: number;
};

export type AdmissionRule =
  | { type: "scoreGte"; scoreGte: number }
  | { type: "scoreLte"; scoreLte: number }
  | { type: "confidenceGte"; confidenceGte: number }
  | { type: "confidenceLt"; confidenceLt: number }
  | { type: "qualityPercentileGte"; qualityPercentileGte: number }
  | { type: "scoreBetween"; low: number; high: number }
  | { type: "judgeVarianceGt"; judgeVarianceGt: number };

export type ChannelPolicy = {
  acceptRules: AdmissionRule[];
  rejectRules: AdmissionRule[];
  uncertaintyRules: AdmissionRule[];
  sampleRateForHuman: number;
  stats: {
    acceptN: number;
    rejectN: number;
    agreementRate: number;
    minSamplesMet: boolean;
  };
};

export type AdmissionPolicy = {
  policyId: string;
  projectId: string;
  generatedAt: string;
  labelCount: number;
  channels: Record<string, ChannelPolicy>;
};

export type AdmissionFeature = {
  sessionId: string;
  caseId: string;
  channel: string;
  metricKey: string;
  autoScore: number;
  confidence: number;
  qualityScore?: number;
  qualityPercentile?: number;
  judgeVariance?: number;
};

export type AdmissionDecision = "accept" | "reject" | "human";

export type AdmissionScoreResult = {
  decision: AdmissionDecision;
  matchedAcceptRules: string[];
  matchedRejectRules: string[];
  matchedUncertaintyRules: string[];
};

export type LearnPolicyOptions = {
  projectId?: string;
  policyId?: string;
  minSamplesPerGroup?: number;
  generatedAt?: string;
};
