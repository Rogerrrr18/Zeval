/**
 * @fileoverview Emit issue/PR/task-flow drafts from remediation packages.
 */

import type { AgentRunIndexRow } from "@/agent-runs";
import { buildRemediationReleaseReadinessSummary } from "@/remediation/release-readiness";
import type { RemediationPackageSnapshot, RemediationTaskFlowDraft } from "@/remediation/types";
import { buildRemediationWorkflowSummary } from "@/remediation/workflow-summary";
import type { ValidationRunIndexRow, ValidationRunSnapshot } from "@/validation/types";

/**
 * Emit one issue/PR/task-flow draft bundle from a remediation package.
 *
 * @param params Package and latest validation context.
 * @returns Draft bundle for external task systems.
 */
export function emitRemediationTaskFlowDraft(params: {
  packageSnapshot: RemediationPackageSnapshot;
  agentRuns: AgentRunIndexRow[];
  validationRuns: ValidationRunIndexRow[];
  latestReplayValidation?: ValidationRunSnapshot | null;
  latestOfflineValidation?: ValidationRunSnapshot | null;
}): RemediationTaskFlowDraft {
  const workflowSummary = buildRemediationWorkflowSummary(params);
  const releaseReadinessSummary = buildRemediationReleaseReadinessSummary({
    packageId: params.packageSnapshot.packageId,
    agentRuns: params.agentRuns,
    validationRuns: params.validationRuns,
  });
  const workflowStatus = workflowSummary.workflowStatus;
  const validationSummaryLines = buildValidationSummaryLines(params.latestReplayValidation, params.latestOfflineValidation);
  const blockerLines =
    workflowSummary.blockers.length > 0
      ? workflowSummary.blockers.map(
          (item) => `- [${item.severity.toUpperCase()}][${item.scope}] ${item.title}: ${item.detail}`,
        )
      : ["- 当前没有 blocker，可直接进入执行或继续观察。"];
  const releaseReadinessLines = [
    `- status: ${releaseReadinessSummary.status}`,
    `- headline: ${releaseReadinessSummary.headline}`,
    `- next_action: ${releaseReadinessSummary.nextAction}`,
    `- recent_agent_runs: ${releaseReadinessSummary.recentAgentRunCount}`,
    `- improved_runs: ${releaseReadinessSummary.improvedRunCount}`,
    `- progressed_runs: ${releaseReadinessSummary.progressedRunCount}`,
    `- regressed_runs: ${releaseReadinessSummary.regressedRunCount}`,
    `- refreshed_runs: ${releaseReadinessSummary.refreshedRunCount}`,
    `- unchanged_runs: ${releaseReadinessSummary.unchangedRunCount}`,
    `- latest_linked_replay: ${releaseReadinessSummary.latestReplayStatus}`,
    `- latest_linked_offline: ${releaseReadinessSummary.latestOfflineStatus}`,
  ];
  const targetMetricBlock =
    params.packageSnapshot.targetMetrics.length > 0
      ? params.packageSnapshot.targetMetrics
          .map(
            (item) =>
              `- ${item.displayName}: ${item.currentValue.toFixed(4)} -> ${item.targetValue.toFixed(4)} (${item.direction === "increase" ? "提高" : "降低"})`,
          )
          .join("\n")
      : "- 当前没有额外 target metrics，请以 replay / offline gate 为主。";
  const constraintBlock = params.packageSnapshot.constraints.map((item) => `- ${item}`).join("\n");
  const artifactBlock = params.packageSnapshot.files.map((file) => `- ${file.relativePath}`).join("\n");
  const taskSummary = `${params.packageSnapshot.title} · ${workflowStatus} · replay=${workflowSummary.replayStatus} · offline=${workflowSummary.offlineStatus}`;

  const issueTitle = `[${params.packageSnapshot.priority}] ${params.packageSnapshot.title}`;
  const prTitle = `Fix ${params.packageSnapshot.packageId}: ${params.packageSnapshot.title}`;

  const issueBody = [
    `# ${params.packageSnapshot.packageId}`,
    "",
    "## 当前状态",
    `- workflow_status: ${workflowStatus}`,
    ...validationSummaryLines.map((item) => `${item}`),
    "",
    "## Gate Blockers",
    `- headline: ${workflowSummary.headline}`,
    `- next_action: ${workflowSummary.nextAction}`,
    ...blockerLines,
    "",
    "## Release Readiness",
    ...releaseReadinessLines,
    "",
    "## 问题摘要",
    ...params.packageSnapshot.problemSummary.map((item) => `- ${item}`),
    "",
    "## 目标指标",
    targetMetricBlock,
    "",
    "## 约束条件",
    constraintBlock,
    "",
    "## Artifact Paths",
    artifactBlock,
    "",
    "## 执行要求",
    "- 仅做最小必要修改，不要无关重构。",
    `- 优先从 ${params.packageSnapshot.editScope.join(", ")} 层开始修改。`,
    "- 修改完成后必须回跑 replay gate 和 offline gate。",
  ].join("\n");

  const prBody = [
    `## Summary`,
    `- packageId: ${params.packageSnapshot.packageId}`,
    `- workflow_status_before: ${workflowStatus}`,
    `- replay_status_before: ${workflowSummary.replayStatus}`,
    `- offline_status_before: ${workflowSummary.offlineStatus}`,
    "",
    "## Package Goal",
    ...params.packageSnapshot.problemSummary.map((item) => `- ${item}`),
    "",
    "## Current Blockers",
    `- headline: ${workflowSummary.headline}`,
    `- next_action: ${workflowSummary.nextAction}`,
    ...blockerLines,
    "",
    "## Release Readiness",
    ...releaseReadinessLines,
    "",
    "## Acceptance Gates",
    `- replay.minWinRate = ${params.packageSnapshot.acceptanceGate.replay.minWinRate}`,
    `- offline.maxRegressions = ${params.packageSnapshot.acceptanceGate.offlineEval.maxRegressions}`,
    `- sampleBatchId = ${params.packageSnapshot.acceptanceGate.offlineEval.sampleBatchId ?? "未指定"}`,
    "",
    "## Checklist",
    "- [ ] 最小改动完成",
    "- [ ] 说明改动 why 与 expected behavior",
    "- [ ] replay validation 通过",
    "- [ ] offline validation 通过",
  ].join("\n");

  return {
    schemaVersion: 1,
    packageId: params.packageSnapshot.packageId,
    workflowStatus,
    taskSummary,
    workflowSummary,
    releaseReadinessSummary,
    issueTitle,
    issueBody,
    prTitle,
    prBody,
  };
}

/**
 * Build summary lines for latest validation states.
 *
 * @param latestReplayValidation Latest replay validation snapshot.
 * @param latestOfflineValidation Latest offline validation snapshot.
 * @returns Markdown-ready summary lines.
 */
function buildValidationSummaryLines(
  latestReplayValidation?: ValidationRunSnapshot | null,
  latestOfflineValidation?: ValidationRunSnapshot | null,
): string[] {
  return [
    `- replay: ${latestReplayValidation ? `${latestReplayValidation.status} (${latestReplayValidation.validationRunId})` : "not_run"}`,
    `- offline: ${latestOfflineValidation ? `${latestOfflineValidation.status} (${latestOfflineValidation.validationRunId})` : "not_run"}`,
  ];
}
