/**
 * @fileoverview Storage contract for replay / offline validation runs.
 */

import type { ValidationRunIndexRow, ValidationRunSnapshot } from "@/validation/types";

/**
 * Unified persistence contract for validation runs.
 */
export interface ValidationRunStore {
  /**
   * Persist one validation run snapshot.
   *
   * @param snapshot Validation run snapshot.
   */
  save(snapshot: ValidationRunSnapshot): Promise<void>;

  /**
   * List saved validation runs, newest first.
   *
   * @param packageId Optional package filter.
   * @returns Validation run index rows.
   */
  list(packageId?: string): Promise<ValidationRunIndexRow[]>;

  /**
   * Read one validation run snapshot by id.
   *
   * @param validationRunId Validation run identifier.
   * @returns Snapshot or null.
   */
  read(validationRunId: string): Promise<ValidationRunSnapshot | null>;
}
