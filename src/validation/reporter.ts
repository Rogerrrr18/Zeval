/**
 * @fileoverview Render persisted validation artifacts for replay and offline runs.
 */

import type {
  OfflineEvalValidationSummary,
  ReplayValidationSummary,
  ValidationRunFile,
  ValidationRunSnapshot,
} from "@/validation/types";

/**
 * Build artifact files for one validation run snapshot.
 *
 * @param snapshot Validation run snapshot.
 * @returns Persisted validation files.
 */
export function buildValidationRunFiles(snapshot: {
  validationRunId: string;
  packageId: string;
  mode: ValidationRunSnapshot["mode"];
  status: ValidationRunSnapshot["status"];
  createdAt: string;
  artifactDir: string;
  summary: ValidationRunSnapshot["summary"];
}): ValidationRunFile[] {
  return [
    {
      fileName: "report.md",
      relativePath: `${snapshot.artifactDir}/report.md`,
      content: buildValidationReportMarkdown(snapshot),
    },
  ];
}

/**
 * Build one Markdown validation report from a replay/offline snapshot.
 *
 * @param snapshot Validation run snapshot-like input.
 * @returns Markdown report content.
 */
function buildValidationReportMarkdown(snapshot: {
  validationRunId: string;
  packageId: string;
  mode: ValidationRunSnapshot["mode"];
  status: ValidationRunSnapshot["status"];
  createdAt: string;
  summary: ValidationRunSnapshot["summary"];
}): string {
  return snapshot.summary.type === "replay"
    ? buildReplayValidationReport(snapshot, snapshot.summary)
    : buildOfflineValidationReport(snapshot, snapshot.summary);
}

/**
 * Render replay validation into a Markdown report.
 *
 * @param snapshot Validation snapshot metadata.
 * @param summary Replay validation summary.
 * @returns Markdown report.
 */
function buildReplayValidationReport(
  snapshot: {
    validationRunId: string;
    packageId: string;
    mode: ValidationRunSnapshot["mode"];
    status: ValidationRunSnapshot["status"];
    createdAt: string;
  },
  summary: ReplayValidationSummary,
): string {
  const metricBlock = summary.targetMetricResults
    .map(
      (item) =>
        `- ${item.displayName}: baseline=${item.baselineValue.toFixed(4)}, current=${item.currentValue?.toFixed(4) ?? "--"}, target=${item.targetValue.toFixed(4)}, improved=${item.improved}, passed=${item.passed}`,
    )
    .join("\n");
  const guardBlock = summary.guardResults
    .map(
      (item) =>
        `- ${item.guardKey}: ${item.comparator} ${String(item.threshold)}, current=${item.currentValue === null ? "--" : String(item.currentValue)}, passed=${item.passed}`,
    )
    .join("\n");
  const warningBlock = summary.warnings.length > 0 ? summary.warnings.map((item) => `- ${item}`).join("\n") : "- 无";

  return [
    `# ${snapshot.validationRunId}`,
    "",
    "## 概览",
    `- packageId: ${snapshot.packageId}`,
    `- mode: ${snapshot.mode}`,
    `- status: ${snapshot.status}`,
    `- createdAt: ${snapshot.createdAt}`,
    "",
    "## Replay Gate",
    `- baselineRunId: ${summary.baselineRunId}`,
    `- baselineCustomerId: ${summary.baselineCustomerId ?? "未设置"}`,
    `- currentRunId: ${summary.currentRunId}`,
    `- replyEndpoint: ${summary.replyEndpoint}`,
    `- minWinRate: ${summary.minWinRate}`,
    `- winRate: ${summary.winRate}`,
    `- replayedRowCount: ${summary.replayedRowCount}`,
    "",
    "## Target Metrics",
    metricBlock || "- 无",
    "",
    "## Guards",
    guardBlock || "- 无",
    "",
    "## Warnings",
    warningBlock,
  ].join("\n");
}

/**
 * Render offline validation into a Markdown report.
 *
 * @param snapshot Validation snapshot metadata.
 * @param summary Offline validation summary.
 * @returns Markdown report.
 */
function buildOfflineValidationReport(
  snapshot: {
    validationRunId: string;
    packageId: string;
    mode: ValidationRunSnapshot["mode"];
    status: ValidationRunSnapshot["status"];
    createdAt: string;
  },
  summary: OfflineEvalValidationSummary,
): string {
  const caseBlock = summary.caseResults
    .map(
      (item) =>
        `- ${item.label}: baseline=${item.baselineCaseScore.toFixed(4)}, current=${item.currentCaseScore?.toFixed(4) ?? "--"}, delta=${item.scoreDelta?.toFixed(4) ?? "--"}, improved=${item.isImproved}, regressed=${item.isRegressed}, skipped=${item.skipped}`,
    )
    .join("\n");
  const warningBlock = summary.warnings.length > 0 ? summary.warnings.map((item) => `- ${item}`).join("\n") : "- 无";

  return [
    `# ${snapshot.validationRunId}`,
    "",
    "## 概览",
    `- packageId: ${snapshot.packageId}`,
    `- mode: ${snapshot.mode}`,
    `- status: ${snapshot.status}`,
    `- createdAt: ${snapshot.createdAt}`,
    "",
    "## Offline Gate",
    `- sampleBatchId: ${summary.sampleBatchId ?? "未指定"}`,
    `- suiteSource: ${summary.suiteSource}`,
    `- totalCases: ${summary.totalCases}`,
    `- executedCases: ${summary.executedCases}`,
    `- skippedCases: ${summary.skippedCases}`,
    `- improvedCases: ${summary.improvedCases}`,
    `- regressedCases: ${summary.regressedCases}`,
    `- maxRegressions: ${summary.maxRegressions}`,
    `- averageScoreDelta: ${summary.averageScoreDelta?.toFixed(4) ?? "--"}`,
    "",
    "## Case Results",
    caseBlock || "- 无",
    "",
    "## Warnings",
    warningBlock,
  ].join("\n");
}
