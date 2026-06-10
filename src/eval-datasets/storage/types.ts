/**
 * @fileoverview Shared contracts for dataset storage adapters.
 */

import type { BadCaseFeatureSnapshot } from "@/badcase/types";

/**
 * Supported dataset case set types.
 */
export type CaseSetType = "goodcase" | "badcase";

/**
 * How a dataset case entered the pool.
 *
 * - `auto_tp`           : Rule / subjective judge both flagged bad (true positive).
 * - `manual_fp`         : System flagged bad, human review confirmed OK; stored as a goodcase control sample (false positive override).
 * - `auto_fn`           : System judged OK but downstream behavioural signals (dropoff, repeated questions, negative tail) indicate a real problem (false negative harvest).
 * - `auto_tn`           : Stratified-sampled high-quality session used as a golden positive baseline.
 * - `auto_uncertainty`  : Judge confidence ∈ [0.4, 0.6]; high-information boundary case pending human review.
 * - `auto_disagreement` : Rule verdict and LLM judge verdict disagree; surfaces evaluator reliability gaps.
 * - `manual_gold`       : Human-approved golden case used as a regression guard.
 * - `synthesized`       : LLM-assisted synthetic sample. Must NOT feed into baseline or online eval statistics.
 * - `imported`          : Batch-imported from an external system.
 *
 * Legacy values `auto_admission` and `manual` are mapped to `auto_tp` and `imported` respectively during reads.
 */
export type DatasetCaseSource =
  | "auto_tp"
  | "manual_fp"
  | "auto_fn"
  | "auto_tn"
  | "auto_uncertainty"
  | "auto_disagreement"
  | "manual_gold"
  | "synthesized"
  | "imported";

/**
 * Lightweight human review verdict for auto-captured cases.
 */
export type DatasetCaseHumanVerdict = "valid_bad_case" | "false_positive" | "unclear";

/**
 * Review lifecycle for a dataset case.
 */
export type DatasetCaseReviewStatus =
  | "auto_captured"
  | "human_reviewed"
  | "gold_candidate"
  | "gold"
  | "regression_active";

/**
 * Minimal dataset case record stored in the evaluation dataset.
 */
export type DatasetCaseRecord = {
  caseId: string;
  caseSetType: CaseSetType;
  /** Admission channel that produced this case. See {@link DatasetCaseSource}. */
  source?: DatasetCaseSource;
  sessionId: string;
  topicSegmentId: string;
  topicIndex?: number;
  topicRange?: { startTurn: number; endTurn: number };
  topicLabel: string;
  topicSummary: string;
  normalizedTranscriptHash: string;
  duplicateGroupKey?: string;
  baselineVersion: string;
  baselineCaseScore: number;
  tags: string[];
  title?: string;
  transcript?: string;
  suggestedAction?: string;
  humanVerdict?: DatasetCaseHumanVerdict;
  failureType?: string;
  expectedBehavior?: string;
  reviewNotes?: string;
  manualOverrides?: Array<{
    type: "false_positive";
    note?: string;
    createdAt: string;
  }>;
  autoSignals?: Array<Record<string, unknown>>;
  reviewer?: string;
  reviewedAt?: string;
  reviewStatus?: DatasetCaseReviewStatus;
  scenarioId?: string;
  /**
   * Capability dimension this case exercises (e.g. "multi_turn_coherence",
   * "instruction_following"). Optional at MVP — when present enables
   * dimension-filtered browsing and targeted sample-batch extraction.
   */
  capabilityDimension?: string;
  sourceRunId?: string;
  harvestedAt?: string;
  failureSeverityScore?: number;
  featureSnapshot?: BadCaseFeatureSnapshot;
  /**
   * Freeform metadata bag.
   * - `false_positive: true` — human marked this case as a false positive;
   *   the admission pipeline will never re-admit the same session via TP rules.
   * - `near_duplicate_of: string` — caseId of the similar existing case.
   */
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

/**
 * Baseline snapshot stored with one dataset case.
 */
export type DatasetBaselineRecord = {
  caseId: string;
  baselineCaseScore: number;
  baselineObjectiveScore: number;
  baselineSubjectiveScore: number;
  baselineRiskPenaltyScore: number;
  baselineSignals: Array<{
    signalKey: string;
    score: number;
    severity: string;
  }>;
  baselineGeneratedAt: string;
  baselineProductVersion: string;
};

/**
 * One case-level run result for a sampled evaluation run.
 */
export type DatasetRunResultRecord = {
  runId: string;
  sampleBatchId: string;
  caseId: string;
  baselineCaseScore: number;
  currentCaseScore: number;
  scoreDelta: number;
  isImproved: boolean;
  isRegressed: boolean;
  judgeReason: string;
  createdAt: string;
};

/**
 * One saved sample batch used for stable version comparison.
 */
export type SampleBatchRecord = {
  sampleBatchId: string;
  caseIds: string[];
  requestedGoodcaseCount: number;
  requestedBadcaseCount: number;
  strategy: string;
  targetVersion?: string;
  createdAt: string;
  /** 实际入批的 goodcase 数量（可能小于请求值）。 */
  actualGoodcaseCount?: number;
  /** 实际入批的 badcase 数量（可能小于请求值）。 */
  actualBadcaseCount?: number;
  /** 抽样不足量、去重压缩等可观测提示。 */
  warnings?: string[];
};

/**
 * Duplicate check result returned by the storage adapter.
 */
export type DuplicateCheckResult = {
  isDuplicate: boolean;
  reason: "exact_hash" | "near_duplicate" | "none";
  matchedCaseId?: string;
  similarityScore?: number;
};
