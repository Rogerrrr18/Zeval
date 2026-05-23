/**
 * @fileoverview Validation run factory and exports.
 */

import type { ValidationRunStore } from "@/validation/validation-run-store";
import { FileSystemValidationRunStore } from "@/validation/file-system-validation-run-store";

/**
 * Create the active validation run store.
 *
 * @returns Active store implementation.
 */
export function createValidationRunStore(): ValidationRunStore {
  const provider = (process.env.VALIDATION_RUN_STORE_PROVIDER ?? "filesystem").trim().toLowerCase();
  if (provider === "filesystem") {
    return new FileSystemValidationRunStore();
  }
  throw new Error(`暂不支持的 validation run store provider: ${provider}`);
}

export {
  runOfflineEvalValidation,
  runReplayValidation,
} from "@/validation/runner";
export { buildValidationRunFiles } from "@/validation/reporter";
export type { ValidationRunStore } from "@/validation/validation-run-store";
export type {
  OfflineEvalCaseResult,
  OfflineEvalValidationSummary,
  ReplayValidationSummary,
  ValidationGuardResult,
  ValidationRunIndexRow,
  ValidationRunFile,
  ValidationRunMode,
  ValidationRunSnapshot,
  ValidationRunStatus,
  ValidationRunSummary,
  ValidationTargetMetricResult,
} from "@/validation/types";
