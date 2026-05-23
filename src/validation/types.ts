/**
 * @fileoverview Contracts for persisted replay / offline validation runs.
 */

/**
 * Supported validation modes in the MVP loop.
 */
export type ValidationRunMode = "replay" | "offline_eval";

/**
 * Terminal validation result.
 */
export type ValidationRunStatus = "passed" | "failed";

/**
 * One target-metric comparison inside a replay validation.
 */
export type ValidationTargetMetricResult = {
  metricId: string;
  displayName: string;
  direction: "increase" | "decrease";
  baselineValue: number;
  currentValue: number | null;
  targetValue: number;
  improved: boolean;
  passed: boolean;
  detail: string;
};

/**
 * One guard check evaluated during validation.
 */
export type ValidationGuardResult = {
  guardKey: string;
  comparator: "gte" | "lte";
  threshold: boolean | number | string;
  currentValue: boolean | number | string | null;
  passed: boolean;
  detail: string;
};

/**
 * Replay validation summary saved for one run.
 */
export type ReplayValidationSummary = {
  type: "replay";
  baselineRunId: string;
  baselineCustomerId?: string | null;
  currentRunId: string;
  replyEndpoint: string;
  replayedRowCount: number;
  minWinRate: number;
  winRate: number;
  improvedMetricCount: number;
  regressedMetricCount: number;
  totalTargetMetricCount: number;
  targetMetricResults: ValidationTargetMetricResult[];
  guardResults: ValidationGuardResult[];
  warnings: string[];
};

/**
 * One per-case summary inside offline validation.
 */
export type OfflineEvalCaseResult = {
  caseId: string;
  label: string;
  baselineCaseScore: number;
  currentCaseScore: number | null;
  scoreDelta: number | null;
  isImproved: boolean;
  isRegressed: boolean;
  skipped: boolean;
  reason: string;
};

/**
 * Offline regression validation summary saved for one run.
 */
export type OfflineEvalValidationSummary = {
  type: "offline_eval";
  sampleBatchId: string | null;
  suiteSource: "sample_batch" | "package_badcases";
  totalCases: number;
  executedCases: number;
  skippedCases: number;
  improvedCases: number;
  regressedCases: number;
  maxRegressions: number;
  averageScoreDelta: number | null;
  caseResults: OfflineEvalCaseResult[];
  warnings: string[];
};

/**
 * Unified validation summary payload.
 */
export type ValidationRunSummary = ReplayValidationSummary | OfflineEvalValidationSummary;

/**
 * One concrete artifact file inside a validation run.
 */
export type ValidationRunFile = {
  fileName: "report.md";
  relativePath: string;
  content: string;
};

/**
 * Full persisted validation run snapshot.
 */
export type ValidationRunSnapshot = {
  schemaVersion: 1;
  validationRunId: string;
  packageId: string;
  mode: ValidationRunMode;
  status: ValidationRunStatus;
  createdAt: string;
  artifactDir: string;
  summary: ValidationRunSummary;
  files: ValidationRunFile[];
};

/**
 * Lightweight validation run index row.
 */
export type ValidationRunIndexRow = {
  validationRunId: string;
  packageId: string;
  mode: ValidationRunMode;
  status: ValidationRunStatus;
  createdAt: string;
  artifactDir: string;
};
