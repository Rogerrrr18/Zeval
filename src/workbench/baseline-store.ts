/**
 * @fileoverview Pluggable workbench baseline storage contract.
 */

import type { WorkbenchBaselineIndexRow, WorkbenchBaselineLookup, WorkbenchBaselineSnapshot } from "@/workbench/types";

/**
 * Storage contract for workbench baseline snapshots.
 *
 * Business modules should depend on this interface instead of reading or
 * writing files directly, so the implementation can later switch to SQLite
 * or PostgreSQL without changing route logic.
 */
export interface WorkbenchBaselineStore {
  /**
   * Persist one baseline snapshot.
   *
   * @param snapshot Baseline snapshot.
   */
  save(snapshot: WorkbenchBaselineSnapshot): Promise<void>;

  /**
   * List saved baselines for one customer.
   *
   * @param customerId Customer identifier.
   * @returns Baseline index rows, newest first.
   */
  list(customerId: string): Promise<WorkbenchBaselineIndexRow[]>;

  /**
   * Read one saved baseline snapshot.
   *
   * @param customerId Customer identifier.
   * @param runId Run identifier.
   * @returns Baseline snapshot or null.
   */
  read(customerId: string, runId: string): Promise<WorkbenchBaselineSnapshot | null>;

  /**
   * Resolve one baseline snapshot by runId across customers.
   *
   * @param runId Run identifier.
   * @returns Matching customer + snapshot pair or null.
   */
  findByRunId(runId: string): Promise<WorkbenchBaselineLookup | null>;
}
