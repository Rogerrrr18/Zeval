/**
 * @fileoverview Dataset storage factory exports.
 */

import type { DatasetStore } from "@/eval-datasets/storage/dataset-store";
import { DatabaseDatasetStore } from "@/eval-datasets/storage/database-dataset-store";
import { FileSystemDatasetStore } from "@/eval-datasets/storage/file-system-dataset-store";

/**
 * Create the current dataset storage adapter.
 * @returns Active dataset store implementation.
 */
export function createDatasetStore(options?: { workspaceId?: string }): DatasetStore {
  const provider = (process.env.DATASET_STORE_PROVIDER ?? "filesystem").trim().toLowerCase();
  if (provider === "database") {
    return new DatabaseDatasetStore(options?.workspaceId);
  }
  if (provider !== "filesystem") {
    throw new Error(`暂不支持的 dataset store provider: ${provider}`);
  }
  return new FileSystemDatasetStore(options?.workspaceId);
}

export type { DatasetStore } from "@/eval-datasets/storage/dataset-store";
export type {
  CaseSetType,
  DatasetBaselineRecord,
  DatasetCaseRecord,
  DatasetRunResultRecord,
  DuplicateCheckResult,
  SampleBatchRecord,
} from "@/eval-datasets/storage/types";
