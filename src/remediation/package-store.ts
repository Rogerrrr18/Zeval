/**
 * @fileoverview Storage contract for remediation package artifacts.
 */

import type { RemediationPackageIndexRow, RemediationPackageSnapshot } from "@/remediation/types";

/**
 * Unified persistence contract for remediation packages.
 */
export interface RemediationPackageStore {
  /**
   * Persist one remediation package snapshot and its file artifacts.
   *
   * @param snapshot Built remediation package.
   */
  save(snapshot: RemediationPackageSnapshot): Promise<void>;

  /**
   * List saved remediation packages, newest first.
   *
   * @returns Package index rows.
   */
  list(): Promise<RemediationPackageIndexRow[]>;

  /**
   * Read one saved remediation package.
   *
   * @param packageId Package identifier.
   * @returns Snapshot or `null`.
   */
  read(packageId: string): Promise<RemediationPackageSnapshot | null>;
}
