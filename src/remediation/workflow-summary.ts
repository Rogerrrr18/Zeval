/**
 * @fileoverview Resolve remediation workflow summary and blocker reasons from validation results.
 */

import type {
  RemediationPackageSnapshot,
  RemediationWorkflowBlocker,
  RemediationWorkflowStatus,
  RemediationWorkflowSummary,
} from "@/remediation/types";
import type {
  OfflineEvalCaseResult,
  OfflineEvalValidationSummary,
  ValidationRunSnapshot,
  ValidationTargetMetricResult,
} from "@/validation/types";

/**
 * Build one remediation workflow summary from the latest replay and offline validations.
 *
 * @param params Package and latest validation context.
 * @returns Workflow summary with actionable blockers and next step.
 */
export function buildRemediationWorkflowSummary(params: {
  packageSnapshot: RemediationPackageSnapshot;
  latestReplayValidation?: ValidationRunSnapshot | null;
  latestOfflineValidation?: ValidationRunSnapshot | null;
}): RemediationWorkflowSummary {
  const replayStatus = params.latestReplayValidation?.status ?? "not_run";
  const offlineStatus = params.latestOfflineValidation?.status ?? "not_run";
  const workflowStatus = resolveWorkflowStatus(params.latestReplayValidation, params.latestOfflineValidation);
  const blockers = [
    ...buildPackageBlockers(params.packageSnapshot, params.latestReplayValidation, params.latestOfflineValidation),
    ...buildReplayBlockers(params.latestReplayValidation),
    ...buildOfflineBlockers(params.latestOfflineValidation),
  ];

  return {
    schemaVersion: 1,
    packageId: params.packageSnapshot.packageId,
    workflowStatus,
    headline: buildWorkflowHeadline(workflowStatus, replayStatus, offlineStatus, blockers),
    nextAction: buildNextAction(workflowStatus, replayStatus, offlineStatus, blockers),
    replayStatus,
    offlineStatus,
    blockers,
  };
}

/**
 * Resolve workflow status from the latest validation runs.
 *
 * @param latestReplayValidation Latest replay validation snapshot.
 * @param latestOfflineValidation Latest offline validation snapshot.
 * @returns Workflow status label.
 */
function resolveWorkflowStatus(
  latestReplayValidation?: ValidationRunSnapshot | null,
  latestOfflineValidation?: ValidationRunSnapshot | null,
): RemediationWorkflowStatus {
  if (!latestReplayValidation && !latestOfflineValidation) {
    return "ready";
  }
  if (latestReplayValidation?.status === "passed" && latestOfflineValidation?.status === "passed") {
    return "passed";
  }
  if (latestReplayValidation?.status === "failed" || latestOfflineValidation?.status === "failed") {
    return "failed";
  }
  return "partial";
}

/**
 * Build package-level blockers before any validation-specific details.
 *
 * @param packageSnapshot Current remediation package snapshot.
 * @param latestReplayValidation Latest replay validation snapshot.
 * @param latestOfflineValidation Latest offline validation snapshot.
 * @returns Package-level blockers or warnings.
 */
function buildPackageBlockers(
  packageSnapshot: RemediationPackageSnapshot,
  latestReplayValidation?: ValidationRunSnapshot | null,
  latestOfflineValidation?: ValidationRunSnapshot | null,
): RemediationWorkflowBlocker[] {
  const blockers: RemediationWorkflowBlocker[] = [];

  if (packageSnapshot.acceptanceGate.replay.required && !latestReplayValidation) {
    blockers.push({
      scope: "package",
      severity: "warning",
      title: "Replay gate 尚未执行",
      detail: `请先基于 baseline ${packageSnapshot.acceptanceGate.replay.baselineRunId} 运行 replay validation，win rate 需要达到 ${packageSnapshot.acceptanceGate.replay.minWinRate.toFixed(4)}。`,
    });
  }

  if (packageSnapshot.acceptanceGate.offlineEval.required && !latestOfflineValidation) {
    blockers.push({
      scope: "package",
      severity: "warning",
      title: "Offline gate 尚未执行",
      detail:
        packageSnapshot.acceptanceGate.offlineEval.sampleBatchId === null
          ? "请先绑定 fixed sample batch，或显式接受退化到 package badcases，再执行 offline validation。"
          : `请执行 offline validation，确认 sample batch ${packageSnapshot.acceptanceGate.offlineEval.sampleBatchId} 没有新增 regression。`,
    });
  }

  return blockers;
}

/**
 * Build replay-specific blockers and warnings.
 *
 * @param latestReplayValidation Latest replay validation snapshot.
 * @returns Replay blockers.
 */
function buildReplayBlockers(
  latestReplayValidation?: ValidationRunSnapshot | null,
): RemediationWorkflowBlocker[] {
  if (!latestReplayValidation || latestReplayValidation.summary.type !== "replay") {
    return [];
  }

  const summary = latestReplayValidation.summary;
  const blockers: RemediationWorkflowBlocker[] = [];
  if (latestReplayValidation.status === "failed") {
    if (summary.winRate < summary.minWinRate) {
      blockers.push({
        scope: "replay",
        severity: "error",
        title: "Replay win rate 未达 gate",
        detail: `当前 ${summary.winRate.toFixed(4)}，要求至少 ${summary.minWinRate.toFixed(4)}。当前只有 ${summary.improvedMetricCount}/${summary.totalTargetMetricCount} 个 target metrics 达成改善。`,
      });
    }

    summary.targetMetricResults
      .filter((item) => !item.passed)
      .slice(0, 3)
      .forEach((item) => {
        blockers.push({
          scope: "replay",
          severity: "error",
          title: `Replay metric 未达标: ${item.displayName}`,
          detail: formatReplayMetricDetail(item),
        });
      });

    summary.guardResults
      .filter((item) => !item.passed)
      .slice(0, 3)
      .forEach((item) => {
        blockers.push({
          scope: "replay",
          severity: "error",
          title: `Replay guard 未通过: ${item.guardKey}`,
          detail: `${item.comparator} ${String(item.threshold)}，当前 ${item.currentValue === null ? "--" : String(item.currentValue)}。${item.detail}`,
        });
      });
  }

  summary.warnings.forEach((warning) => {
    blockers.push({
      scope: "replay",
      severity: "warning",
      title: "Replay warning",
      detail: warning,
    });
  });

  return blockers;
}

/**
 * Build offline-specific blockers and warnings.
 *
 * @param latestOfflineValidation Latest offline validation snapshot.
 * @returns Offline blockers.
 */
function buildOfflineBlockers(
  latestOfflineValidation?: ValidationRunSnapshot | null,
): RemediationWorkflowBlocker[] {
  if (!latestOfflineValidation || latestOfflineValidation.summary.type !== "offline_eval") {
    return [];
  }

  const summary = latestOfflineValidation.summary;
  const blockers: RemediationWorkflowBlocker[] = [];
  if (latestOfflineValidation.status === "failed") {
    if (summary.executedCases === 0) {
      blockers.push({
        scope: "offline_eval",
        severity: "error",
        title: "Offline regression 没有可执行 case",
        detail: "当前无法证明修复有效，需要先补 transcript 完整的 case 或固定 sample batch。",
      });
    }

    if (summary.regressedCases > summary.maxRegressions) {
      blockers.push({
        scope: "offline_eval",
        severity: "error",
        title: "Offline regression 超过 gate",
        detail: `当前 regression=${summary.regressedCases}，允许上限为 ${summary.maxRegressions}，需要先消除回退案例。`,
      });
    }

    getTopRegressedCases(summary)
      .slice(0, 3)
      .forEach((item) => {
        blockers.push({
          scope: "offline_eval",
          severity: "error",
          title: `Offline case 回退: ${item.label}`,
          detail: `baseline ${item.baselineCaseScore.toFixed(4)} -> current ${item.currentCaseScore?.toFixed(4) ?? "--"}，delta ${item.scoreDelta?.toFixed(4) ?? "--"}。${item.reason}`,
        });
      });
  }

  summary.warnings.forEach((warning) => {
    blockers.push({
      scope: "offline_eval",
      severity: "warning",
      title: "Offline warning",
      detail: warning,
    });
  });

  return blockers;
}

/**
 * Format one replay metric failure into a concise detail string.
 *
 * @param metric Replay metric result.
 * @returns Human-readable metric detail.
 */
function formatReplayMetricDetail(metric: ValidationTargetMetricResult): string {
  return `baseline ${metric.baselineValue.toFixed(4)} -> current ${metric.currentValue?.toFixed(4) ?? "--"}，target ${metric.targetValue.toFixed(4)}，方向=${metric.direction}。${metric.detail}`;
}

/**
 * Pick the most negative offline regression cases first.
 *
 * @param summary Offline validation summary.
 * @returns Sorted regressed cases.
 */
function getTopRegressedCases(summary: OfflineEvalValidationSummary): OfflineEvalCaseResult[] {
  return [...summary.caseResults]
    .filter((item) => item.isRegressed)
    .sort((left, right) => (left.scoreDelta ?? 0) - (right.scoreDelta ?? 0));
}

/**
 * Build one short headline for the current workflow summary.
 *
 * @param workflowStatus Workflow status.
 * @param replayStatus Replay status.
 * @param offlineStatus Offline status.
 * @param blockers Resolved blockers.
 * @returns Headline text.
 */
function buildWorkflowHeadline(
  workflowStatus: RemediationWorkflowStatus,
  replayStatus: RemediationWorkflowSummary["replayStatus"],
  offlineStatus: RemediationWorkflowSummary["offlineStatus"],
  blockers: RemediationWorkflowBlocker[],
): string {
  if (workflowStatus === "passed") {
    return "Replay 与 offline gate 都已通过，可以进入 issue / PR 执行流。";
  }

  if (workflowStatus === "failed") {
    const firstError = blockers.find((item) => item.severity === "error");
    return firstError?.title ?? "当前至少有一个 gate 未通过。";
  }

  if (workflowStatus === "partial") {
    if (replayStatus === "passed" && offlineStatus === "not_run") {
      return "Replay 已通过，但 offline regression 还没跑。";
    }
    if (offlineStatus === "passed" && replayStatus === "not_run") {
      return "Offline regression 已通过，但 replay gate 还没跑。";
    }
    return "当前只完成了部分 gate，闭环还没有跑满。";
  }

  return "调优包已生成，但还没有进入 validation loop。";
}

/**
 * Build the next recommended action for the current workflow state.
 *
 * @param workflowStatus Workflow status.
 * @param replayStatus Replay status.
 * @param offlineStatus Offline status.
 * @param blockers Resolved blockers.
 * @returns Next action text.
 */
function buildNextAction(
  workflowStatus: RemediationWorkflowStatus,
  replayStatus: RemediationWorkflowSummary["replayStatus"],
  offlineStatus: RemediationWorkflowSummary["offlineStatus"],
  blockers: RemediationWorkflowBlocker[],
): string {
  if (workflowStatus === "passed") {
    return "可以把 issue / PR draft 发给执行者，并要求继续保持 replay 与 offline gate 通过。";
  }

  if (workflowStatus === "failed") {
    const firstReplayError = blockers.find((item) => item.scope === "replay" && item.severity === "error");
    if (firstReplayError) {
      return "先修 replay blocker，再重新运行 replay validation，确认关键 target metrics 与 guards 回到 gate 内。";
    }
    return "先处理 offline regression 回退 case，再重新运行 offline validation，直到 regression 不超过 gate。";
  }

  if (workflowStatus === "partial") {
    if (replayStatus === "passed" && offlineStatus === "not_run") {
      return "下一步直接跑 offline validation，确认 fixed sample batch 没有回退。";
    }
    if (offlineStatus === "passed" && replayStatus === "not_run") {
      return "下一步直接跑 replay validation，确认线上 baseline replay 没有退化。";
    }
    return "继续把剩余 gate 跑完，再决定是否进入 issue / PR 执行流。";
  }

  return "先从 replay validation 开始；如果 replay 通过，再补 offline regression。";
}
