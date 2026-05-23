/**
 * @fileoverview Remediation package factory and exports.
 */

import type { RemediationPackageStore } from "@/remediation/package-store";
import { FileSystemRemediationPackageStore } from "@/remediation/file-system-package-store";

/**
 * Create the active remediation package store.
 *
 * @returns Active store implementation.
 */
export function createRemediationPackageStore(): RemediationPackageStore {
  const provider = (process.env.REMEDIATION_PACKAGE_STORE_PROVIDER ?? "filesystem").trim().toLowerCase();
  if (provider === "filesystem") {
    return new FileSystemRemediationPackageStore();
  }
  throw new Error(`暂不支持的 remediation package store provider: ${provider}`);
}

export { buildRemediationPackage } from "@/remediation/builder";
export { emitRemediationAgentTask } from "@/remediation/agent-task";
export { buildRemediationReleaseReadinessSummary } from "@/remediation/release-readiness";
export { emitRemediationTaskFlowDraft } from "@/remediation/task-flow";
export { buildRemediationWorkflowSummary } from "@/remediation/workflow-summary";
export type { RemediationPackageStore } from "@/remediation/package-store";
export type {
  RemediationAgentTask,
  RemediationAcceptanceGate,
  RemediationEditScope,
  RemediationPackageBuildResult,
  RemediationPackageFile,
  RemediationPackageIndexRow,
  RemediationPackageSnapshot,
  RemediationPriority,
  RemediationSkillBundle,
  RemediationSkillBundleFile,
  RemediationReleaseReadinessGateStatus,
  RemediationReleaseReadinessStatus,
  RemediationReleaseReadinessSummary,
  RemediationTaskFlowDraft,
  RemediationTargetMetric,
  RemediationWorkflowBlocker,
  RemediationWorkflowStatus,
  RemediationWorkflowSummary,
} from "@/remediation/types";
