/**
 * @fileoverview Workbench baseline storage factory.
 */

import type { WorkbenchBaselineStore } from "@/workbench/baseline-store";
import { DatabaseWorkbenchBaselineStore } from "@/workbench/baseline-database-store";
import { FileSystemWorkbenchBaselineStore } from "@/workbench/baseline-file-store";

/**
 * Create the active workbench baseline store.
 *
 * @returns Active store implementation.
 */
export function createWorkbenchBaselineStore(options?: { workspaceId?: string }): WorkbenchBaselineStore {
  const provider = (process.env.WORKBENCH_BASELINE_STORE_PROVIDER ?? "filesystem").trim().toLowerCase();
  if (provider === "database") {
    return new DatabaseWorkbenchBaselineStore(options?.workspaceId);
  }
  if (provider === "filesystem") {
    return new FileSystemWorkbenchBaselineStore(options?.workspaceId);
  }
  throw new Error(`暂不支持的 workbench baseline store provider: ${provider}`);
}

export type { WorkbenchBaselineStore } from "@/workbench/baseline-store";
export type { WorkbenchBaselineIndexRow, WorkbenchBaselineLookup, WorkbenchBaselineSnapshot } from "@/workbench/types";
