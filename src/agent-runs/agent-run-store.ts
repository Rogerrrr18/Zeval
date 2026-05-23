/**
 * @fileoverview Store contract for persisted agent run records.
 */

import type { AgentRunIndexRow, AgentRunSnapshot, AgentRunStatus } from "@/agent-runs/types";

/**
 * Abstract persistence contract for agent runs.
 */
export interface AgentRunStore {
  /**
   * Save one agent run snapshot.
   *
   * @param snapshot Agent run snapshot to persist.
   */
  save(snapshot: AgentRunSnapshot): Promise<void>;

  /**
   * List saved agent runs, optionally filtered by remediation package.
   *
   * @param packageId Optional package identifier filter.
   * @returns Agent run index rows in reverse chronological order.
   */
  list(packageId?: string): Promise<AgentRunIndexRow[]>;

  /**
   * Read one saved agent run by id.
   *
   * @param agentRunId Agent run identifier.
   * @returns Saved snapshot or null.
   */
  read(agentRunId: string): Promise<AgentRunSnapshot | null>;

  /**
   * Update one saved agent run status or notes.
   *
   * @param agentRunId Agent run identifier.
   * @param patch Mutable fields to persist.
   * @returns Updated snapshot or null when not found.
   */
  update(
    agentRunId: string,
    patch: {
      status?: AgentRunStatus;
      notes?: string;
      replayValidationRunId?: string | null;
      offlineValidationRunId?: string | null;
    },
  ): Promise<AgentRunSnapshot | null>;
}
