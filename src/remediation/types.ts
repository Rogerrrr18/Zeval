/**
 * @fileoverview Contracts for agent-readable remediation packages.
 */

/**
 * Priority level for one remediation package.
 */
export type RemediationPriority = "P0" | "P1" | "P2";

/**
 * One editable layer the coding agent may touch.
 */
export type RemediationEditScope = "prompt" | "policy" | "orchestration" | "code";

/**
 * One target metric encoded into the package.
 */
export type RemediationTargetMetric = {
  metricId: string;
  displayName: string;
  currentValue: number;
  targetValue: number;
  direction: "increase" | "decrease";
  reason: string;
};

/**
 * Structured acceptance gate for replay and regression validation.
 */
export type RemediationAcceptanceGate = {
  replay: {
    required: boolean;
    baselineRunId: string;
    baselineCustomerId?: string | null;
    minWinRate: number;
  };
  offlineEval: {
    required: boolean;
    sampleBatchId: string | null;
    maxRegressions: number;
  };
  sandbox: {
    required: boolean;
    scenarios: string[];
  };
  guards: Record<string, boolean | number | string>;
};

/**
 * One concrete file artifact inside a remediation package.
 */
export type RemediationPackageFile = {
  fileName: "issue-brief.md" | "remediation-spec.yaml" | "badcases.jsonl" | "acceptance-gate.yaml";
  relativePath: string;
  content: string;
};

/**
 * One file inside the Claude Code / Codex skill bundle.
 */
export type RemediationSkillBundleFile = {
  fileName: string;
  relativePath: string;
  content: string;
  role: "overview" | "reference" | "readme";
};

/**
 * Claude Code / Codex skill-shaped remediation bundle.
 */
export type RemediationSkillBundle = {
  folderName: string;
  rootPath: string;
  skillFile: RemediationSkillBundleFile;
  readmeFile: RemediationSkillBundleFile;
  referenceFiles: RemediationSkillBundleFile[];
  files: RemediationSkillBundleFile[];
};

/**
 * One saved remediation package snapshot.
 */
export type RemediationPackageSnapshot = {
  schemaVersion: 1;
  packageId: string;
  createdAt: string;
  runId: string;
  title: string;
  priority: RemediationPriority;
  scenarioId?: string;
  sourceFileName?: string;
  selectedCaseKeys: string[];
  selectedCaseCount: number;
  dominantTags: string[];
  problemSummary: string[];
  editScope: RemediationEditScope[];
  constraints: string[];
  targetMetrics: RemediationTargetMetric[];
  acceptanceGate: RemediationAcceptanceGate;
  artifactDir: string;
  files: RemediationPackageFile[];
  skillFolder?: string;
  skillBundle?: RemediationSkillBundle;
};

/**
 * Result of attempting to build one remediation package.
 */
export type RemediationPackageBuildResult =
  | {
      skipped: false;
      package: RemediationPackageSnapshot;
    }
  | {
      skipped: true;
      reason: "no_bad_cases";
      message: string;
      package: null;
    };

/**
 * Lightweight index row for remediation package listing.
 */
export type RemediationPackageIndexRow = {
  packageId: string;
  createdAt: string;
  runId: string;
  title: string;
  priority: RemediationPriority;
  scenarioId?: string;
  selectedCaseCount: number;
  artifactDir: string;
  skillFolder?: string;
};

/**
 * One emitted task payload for a coding agent.
 */
export type RemediationAgentTask = {
  schemaVersion: 1;
  taskId: string;
  packageId: string;
  title: string;
  branchName: string;
  checklist: string[];
  validationPlan: string[];
  artifactPaths: string[];
  prompt: string;
};

/**
 * Workflow status label resolved from remediation validation gates.
 */
export type RemediationWorkflowStatus = "ready" | "partial" | "passed" | "failed";

/**
 * One actionable blocker or warning inside remediation workflow summary.
 */
export type RemediationWorkflowBlocker = {
  scope: "package" | "replay" | "offline_eval";
  severity: "error" | "warning";
  title: string;
  detail: string;
};

/**
 * One high-level workflow summary for a remediation package.
 */
export type RemediationWorkflowSummary = {
  schemaVersion: 1;
  packageId: string;
  workflowStatus: RemediationWorkflowStatus;
  headline: string;
  nextAction: string;
  replayStatus: "not_run" | "passed" | "failed";
  offlineStatus: "not_run" | "passed" | "failed";
  blockers: RemediationWorkflowBlocker[];
};

/**
 * One resolved validation-link state used in release readiness summaries.
 */
export type RemediationReleaseReadinessGateStatus = "not_linked" | "missing" | "failed" | "passed";

/**
 * Package-level release readiness label inferred from recent agent runs.
 */
export type RemediationReleaseReadinessStatus = "ready" | "improving" | "regressing" | "stalled";

/**
 * One package-level readiness summary derived from execution timeline changes.
 */
export type RemediationReleaseReadinessSummary = {
  schemaVersion: 1;
  packageId: string;
  status: RemediationReleaseReadinessStatus;
  headline: string;
  nextAction: string;
  latestAgentRunId: string | null;
  latestReplayStatus: RemediationReleaseReadinessGateStatus;
  latestOfflineStatus: RemediationReleaseReadinessGateStatus;
  recentAgentRunCount: number;
  improvedRunCount: number;
  progressedRunCount: number;
  regressedRunCount: number;
  refreshedRunCount: number;
  unchangedRunCount: number;
};

/**
 * One issue/PR/task-flow draft bundle derived from a remediation package.
 */
export type RemediationTaskFlowDraft = {
  schemaVersion: 1;
  packageId: string;
  workflowStatus: RemediationWorkflowStatus;
  taskSummary: string;
  workflowSummary: RemediationWorkflowSummary;
  releaseReadinessSummary: RemediationReleaseReadinessSummary;
  issueTitle: string;
  issueBody: string;
  prTitle: string;
  prBody: string;
};
