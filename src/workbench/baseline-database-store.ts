/**
 * @fileoverview ZeroreDatabase-backed workbench baseline store.
 */

import { createZeroreDatabase, type ZeroreDatabase } from "@/db";
import type { WorkbenchBaselineStore } from "@/workbench/baseline-store";
import { sanitizeRunIdForFile } from "@/workbench/baseline-file-store";
import type { WorkbenchBaselineIndexRow, WorkbenchBaselineLookup, WorkbenchBaselineSnapshot } from "@/workbench/types";

const WORKBENCH_BASELINE_TYPE = "workbench_baselines";

/**
 * WorkbenchBaselineStore implementation backed by the active ZeroreDatabase adapter.
 */
export class DatabaseWorkbenchBaselineStore implements WorkbenchBaselineStore {
  private readonly workspaceId: string;
  private database: Promise<ZeroreDatabase> | null = null;

  constructor(workspaceId?: string) {
    this.workspaceId = workspaceId ?? "default";
  }

  async save(snapshot: WorkbenchBaselineSnapshot): Promise<void> {
    await (await this.getDatabase()).upsert({
      id: baselineRecordId(snapshot.customerId, snapshot.runId),
      projectId: this.workspaceId,
      type: WORKBENCH_BASELINE_TYPE,
      payload: snapshot,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.createdAt,
    });
  }

  async list(customerId: string): Promise<WorkbenchBaselineIndexRow[]> {
    const records = await (await this.getDatabase()).list(this.workspaceId, WORKBENCH_BASELINE_TYPE);
    return records
      .map((record) => record.payload as WorkbenchBaselineSnapshot)
      .filter((snapshot) => snapshot.customerId === customerId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .map((snapshot) => ({
        runId: snapshot.runId,
        createdAt: snapshot.createdAt,
        label: snapshot.label,
        sourceFileName: snapshot.sourceFileName,
        fileName: `${sanitizeRunIdForFile(snapshot.runId)}.json`,
      }));
  }

  async read(customerId: string, runId: string): Promise<WorkbenchBaselineSnapshot | null> {
    const record = await (await this.getDatabase()).get(
      this.workspaceId,
      WORKBENCH_BASELINE_TYPE,
      baselineRecordId(customerId, runId),
    );
    return record?.payload ? (record.payload as WorkbenchBaselineSnapshot) : null;
  }

  async findByRunId(runId: string): Promise<WorkbenchBaselineLookup | null> {
    const records = await (await this.getDatabase()).list(this.workspaceId, WORKBENCH_BASELINE_TYPE);
    const snapshot = records.map((record) => record.payload as WorkbenchBaselineSnapshot).find((item) => item.runId === runId);
    return snapshot
      ? {
          customerId: snapshot.customerId,
          snapshot,
        }
      : null;
  }

  private getDatabase(): Promise<ZeroreDatabase> {
    this.database ??= createZeroreDatabase();
    return this.database;
  }
}

function baselineRecordId(customerId: string, runId: string): string {
  return `${safeId(customerId)}_${safeId(runId)}`;
}

function safeId(value: string): string {
  return (
    value
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 160) || "unknown"
  );
}
