/**
 * @fileoverview Shared types for judge calibration datasets and reports.
 */

import type {
  GoalCompletionStatus,
  RawChatlogRow,
  RecoveryTraceResult,
  SubjectiveDimensionResult,
} from "../types/pipeline";

/**
 * One gold-set case record used for judge calibration.
 */
export type GoldSetCaseRecord = {
  caseId: string;
  sceneId: string;
  sessionId: string;
  tags: string[];
  rawRows: RawChatlogRow[];
  notes?: string;
};

/**
 * Review lifecycle for one human annotation task.
 */
export type GoldSetReviewStatus =
  | "draft"
  | "ready_for_review"
  | "changes_requested"
  | "approved"
  | "imported";

/**
 * One assignable annotation task generated from a gold-set case.
 */
export type GoldSetAnnotationTaskRecord = {
  taskId: string;
  goldSetVersion: string;
  caseId: string;
  sceneId: string;
  sessionId: string;
  tags: string[];
  priority: "P0" | "P1" | "P2";
  status: GoldSetReviewStatus;
  assignee?: string;
  reviewer?: string;
  sourceCasesPath: string;
  labelDraftPath: string;
  transcriptPreview: string[];
  checklist: {
    hasRawRows: boolean;
    hasNotes: boolean;
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
  };
  createdAt: string;
  updatedAt: string;
};

/**
 * One labeled dimension row from human review.
 */
export type GoldSetDimensionLabel = {
  dimension: string;
  score: number;
  evidence?: string;
  notes?: string;
};

/**
 * Human label record for one calibration case.
 */
export type GoldSetLabelRecord = {
  caseId: string;
  dimensions: GoldSetDimensionLabel[];
  goalCompletion: {
    status: GoalCompletionStatus;
    score: number;
    evidence: string[];
  };
  recoveryTrace: {
    status: RecoveryTraceResult["status"];
    qualityScore: number;
    notes?: string;
  };
  labeler: string;
  reviewedAt: string;
};

/**
 * Editable label draft used before approved labels are imported into
 * `labels.jsonl`. Null values are intentional placeholders for humans.
 */
export type GoldSetLabelDraftRecord = {
  taskId: string;
  goldSetVersion: string;
  caseId: string;
  reviewStatus: GoldSetReviewStatus;
  dimensions: Array<{
    dimension: string;
    score: number | null;
    evidence?: string;
    notes?: string;
  }>;
  goalCompletion: {
    status: GoalCompletionStatus | null;
    score: number | null;
    evidence: string[];
  };
  recoveryTrace: {
    status: RecoveryTraceResult["status"] | null;
    qualityScore: number | null;
    notes?: string;
  };
  labeler?: string;
  reviewer?: string;
  reviewedAt?: string;
  reviewNotes?: string;
  autoPrefill?: {
    source: string;
    generatedAt: string;
    reasons: string[];
  };
};

/**
 * One persisted judge-run row for a gold-set case.
 */
export type JudgeRunRecord = {
  caseId: string;
  sceneId: string;
  sessionId: string;
  judgeId: string;
  model: string;
  judgeProfile?: {
    profileVersion: string;
    provider: string;
    promptVersions: Record<string, string>;
  };
  useLlm: boolean;
  runAt: string;
  dimensions: SubjectiveDimensionResult[];
  goalCompletion: {
    status: GoalCompletionStatus;
    score: number;
    userIntent: string;
    confidence: number;
  } | null;
  recoveryTrace: {
    status: RecoveryTraceResult["status"];
    qualityScore: number;
    repairStrategy: string | null;
    confidence: number;
  } | null;
  warnings: string[];
  error?: string;
};

/**
 * Scalar agreement metrics for one score-based label family.
 */
export type CalibrationScoreMetrics = {
  sampleCount: number;
  mae: number | null;
  rmse: number | null;
  spearman: number | null;
  kappa: number | null;
};

/**
 * One score + status agreement block.
 */
export type CalibrationAgreementBlock = {
  score: CalibrationScoreMetrics;
  statusAccuracy: number | null;
  statusKappa: number | null;
};

/**
 * Aggregated agreement report for one judge run.
 */
export type CalibrationAgreementReport = {
  judgeId: string;
  generatedAt: string;
  dimensionMetrics: Array<{
    dimension: string;
    score: CalibrationScoreMetrics;
  }>;
  goalCompletion: CalibrationAgreementBlock;
  recoveryTrace: CalibrationAgreementBlock;
  overall: CalibrationScoreMetrics;
};

/**
 * Drift report for comparing two judge runs.
 */
export type JudgeDriftReport = {
  baselineJudgeId: string;
  candidateJudgeId: string;
  generatedAt: string;
  comparedCaseCount: number;
  dimensionAverageDeltas: Array<{
    dimension: string;
    averageDelta: number;
    maxDelta: number;
  }>;
  goalCompletionAverageDelta: number | null;
  recoveryTraceAverageDelta: number | null;
  significantDriftWarnings: string[];
};
