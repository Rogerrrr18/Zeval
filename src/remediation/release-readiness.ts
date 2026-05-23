/**
 * @fileoverview Resolve package-level release readiness from recent agent runs and validation links.
 */

import type { AgentRunIndexRow } from "@/agent-runs";
import type {
  RemediationReleaseReadinessGateStatus,
  RemediationReleaseReadinessStatus,
  RemediationReleaseReadinessSummary,
} from "@/remediation/types";
import type { ValidationRunIndexRow } from "@/validation/types";

type AgentRunDeltaKind = "improved" | "progressed" | "regressed" | "refreshed" | "unchanged";

/**
 * Build one package-level release readiness summary from recent agent runs.
 *
 * @param params Package-scoped execution and validation index rows.
 * @returns Release readiness summary for the current remediation package.
 */
export function buildRemediationReleaseReadinessSummary(params: {
  packageId: string;
  agentRuns: AgentRunIndexRow[];
  validationRuns: ValidationRunIndexRow[];
}): RemediationReleaseReadinessSummary {
  const recentAgentRuns = params.agentRuns.slice(0, 5);
  if (recentAgentRuns.length === 0) {
    return buildNoAgentRunSummary(params.packageId, params.validationRuns);
  }

  const deltas = recentAgentRuns.map((item) => resolveAgentRunDelta(item, params.validationRuns));
  const latestRun = recentAgentRuns[0];
  const latestReplayStatus = resolveValidationLinkStatus(
    latestRun.validationLinks.replayValidationRunId,
    params.validationRuns,
  );
  const latestOfflineStatus = resolveValidationLinkStatus(
    latestRun.validationLinks.offlineValidationRunId,
    params.validationRuns,
  );
  const improvedRunCount = deltas.filter((item) => item === "improved").length;
  const progressedRunCount = deltas.filter((item) => item === "progressed").length;
  const regressedRunCount = deltas.filter((item) => item === "regressed").length;
  const refreshedRunCount = deltas.filter((item) => item === "refreshed").length;
  const unchangedRunCount = deltas.filter((item) => item === "unchanged").length;
  const status = resolveReleaseReadinessStatus({
    latestReplayStatus,
    latestOfflineStatus,
    improvedRunCount,
    progressedRunCount,
    regressedRunCount,
  });

  return {
    schemaVersion: 1,
    packageId: params.packageId,
    status,
    headline: buildReleaseReadinessHeadline(status, recentAgentRuns.length),
    nextAction: buildReleaseReadinessNextAction(status),
    latestAgentRunId: latestRun.agentRunId,
    latestReplayStatus,
    latestOfflineStatus,
    recentAgentRunCount: recentAgentRuns.length,
    improvedRunCount,
    progressedRunCount,
    regressedRunCount,
    refreshedRunCount,
    unchangedRunCount,
  };
}

/**
 * Build one fallback readiness summary when no tracked agent runs exist yet.
 *
 * @param packageId Package identifier.
 * @param validationRuns Package-scoped validation runs.
 * @returns Readiness summary without execution history.
 */
function buildNoAgentRunSummary(
  packageId: string,
  validationRuns: ValidationRunIndexRow[],
): RemediationReleaseReadinessSummary {
  const latestReplayRun = validationRuns.find((item) => item.mode === "replay") ?? null;
  const latestOfflineRun = validationRuns.find((item) => item.mode === "offline_eval") ?? null;
  const latestReplayStatus = latestReplayRun?.status ?? "not_linked";
  const latestOfflineStatus = latestOfflineRun?.status ?? "not_linked";
  const status: RemediationReleaseReadinessStatus =
    latestReplayStatus === "passed" && latestOfflineStatus === "passed" ? "ready" : "stalled";

  return {
    schemaVersion: 1,
    packageId,
    status,
    headline:
      status === "ready"
        ? "当前 gate 已通过，但还没有 agent run timeline。"
        : "当前还没有可追踪的 execution timeline，暂时无法判断最近改动是否持续改善。",
    nextAction:
      status === "ready"
        ? "建议补一条 tracked agent run，开始记录执行因果，再推进 merge / release。"
        : "先创建 tracked agent run，并把后续 replay / offline validation 挂到这条执行记录上。",
    latestAgentRunId: null,
    latestReplayStatus,
    latestOfflineStatus,
    recentAgentRunCount: 0,
    improvedRunCount: 0,
    progressedRunCount: 0,
    regressedRunCount: 0,
    refreshedRunCount: 0,
    unchangedRunCount: 0,
  };
}

/**
 * Resolve one agent run delta kind from its starting and current validation links.
 *
 * @param agentRun Agent run index row.
 * @param validationRuns Package-scoped validation runs.
 * @returns Delta kind for release-readiness aggregation.
 */
function resolveAgentRunDelta(
  agentRun: AgentRunIndexRow,
  validationRuns: ValidationRunIndexRow[],
): AgentRunDeltaKind {
  const replayDelta = compareValidationLinkStatus(
    resolveValidationLinkStatus(agentRun.startingValidationLinks.replayValidationRunId, validationRuns),
    resolveValidationLinkStatus(agentRun.validationLinks.replayValidationRunId, validationRuns),
  );
  const offlineDelta = compareValidationLinkStatus(
    resolveValidationLinkStatus(agentRun.startingValidationLinks.offlineValidationRunId, validationRuns),
    resolveValidationLinkStatus(agentRun.validationLinks.offlineValidationRunId, validationRuns),
  );

  const hasRegressed = replayDelta === "regressed" || offlineDelta === "regressed";
  if (hasRegressed) {
    return "regressed";
  }

  const hasImproved = replayDelta === "improved" || offlineDelta === "improved";
  if (hasImproved) {
    return "improved";
  }

  const hasProgressed = replayDelta === "progressed" || offlineDelta === "progressed";
  if (hasProgressed) {
    return "progressed";
  }

  const hasRefreshed = replayDelta === "refreshed" || offlineDelta === "refreshed";
  if (hasRefreshed) {
    return "refreshed";
  }

  return "unchanged";
}

/**
 * Resolve a validation-link id into one readiness gate status.
 *
 * @param validationRunId Linked validation id.
 * @param validationRuns Package-scoped validation runs.
 * @returns Gate status label.
 */
function resolveValidationLinkStatus(
  validationRunId: string | null,
  validationRuns: ValidationRunIndexRow[],
): RemediationReleaseReadinessGateStatus {
  if (!validationRunId) {
    return "not_linked";
  }
  const validationRun = validationRuns.find((item) => item.validationRunId === validationRunId);
  if (!validationRun) {
    return "missing";
  }
  return validationRun.status;
}

/**
 * Compare one validation-link status transition.
 *
 * @param previousStatus Starting gate status.
 * @param currentStatus Current gate status.
 * @returns Delta classification.
 */
function compareValidationLinkStatus(
  previousStatus: RemediationReleaseReadinessGateStatus,
  currentStatus: RemediationReleaseReadinessGateStatus,
): AgentRunDeltaKind {
  const previousRank = getValidationStatusRank(previousStatus);
  const currentRank = getValidationStatusRank(currentStatus);

  if (currentRank < previousRank) {
    return "regressed";
  }
  if (previousRank === 1 && currentRank === 2) {
    return "improved";
  }
  if (previousRank === 0 && currentRank > 0) {
    return "progressed";
  }
  if (previousRank === currentRank && previousStatus !== currentStatus) {
    return "refreshed";
  }
  return "unchanged";
}

/**
 * Convert one readiness gate status into an ordinal rank for trend comparison.
 *
 * @param status Gate status.
 * @returns Numeric rank.
 */
function getValidationStatusRank(status: RemediationReleaseReadinessGateStatus): number {
  if (status === "passed") {
    return 2;
  }
  if (status === "failed") {
    return 1;
  }
  return 0;
}

/**
 * Resolve the overall package-level readiness label.
 *
 * @param params Aggregated gate trend signals.
 * @returns Readiness label.
 */
function resolveReleaseReadinessStatus(params: {
  latestReplayStatus: RemediationReleaseReadinessGateStatus;
  latestOfflineStatus: RemediationReleaseReadinessGateStatus;
  improvedRunCount: number;
  progressedRunCount: number;
  regressedRunCount: number;
}): RemediationReleaseReadinessStatus {
  if (params.latestReplayStatus === "passed" && params.latestOfflineStatus === "passed") {
    return "ready";
  }
  if (params.regressedRunCount > params.improvedRunCount + params.progressedRunCount) {
    return "regressing";
  }
  if (params.improvedRunCount + params.progressedRunCount > 0) {
    return "improving";
  }
  return "stalled";
}

/**
 * Build one short headline for the current readiness summary.
 *
 * @param status Readiness label.
 * @param recentAgentRunCount Number of recent agent runs included.
 * @returns Headline text.
 */
function buildReleaseReadinessHeadline(
  status: RemediationReleaseReadinessStatus,
  recentAgentRunCount: number,
): string {
  if (status === "ready") {
    return `最近 ${recentAgentRunCount} 次 agent run 后，release gate 已达到可发布状态。`;
  }
  if (status === "improving") {
    return `最近 ${recentAgentRunCount} 次 agent run 显示 gate 正在改善，但还没有 fully passed。`;
  }
  if (status === "regressing") {
    return `最近 ${recentAgentRunCount} 次 agent run 出现了 gate regression，需要先止损。`;
  }
  return `最近 ${recentAgentRunCount} 次 agent run 没有带来明显的发布准备度提升。`;
}

/**
 * Build one next-step recommendation for the readiness summary.
 *
 * @param status Readiness label.
 * @returns Recommended next action.
 */
function buildReleaseReadinessNextAction(status: RemediationReleaseReadinessStatus): string {
  if (status === "ready") {
    return "可以准备 merge / release，但仍建议保留 replay 与 offline gate 作为合并前门禁。";
  }
  if (status === "improving") {
    return "继续沿当前修改方向迭代，并把新的 replay / offline 结果持续挂回最新 agent run。";
  }
  if (status === "regressing") {
    return "先定位最近哪次执行引入了 regression，必要时回滚或缩小 edit scope，再重跑验证。";
  }
  return "优先调整修复策略或 edit scope，避免继续重复没有 gate 变化的执行。";
}
