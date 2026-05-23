/**
 * @fileoverview ZeroreDatabase-backed dataset storage adapter.
 */

import { createZeroreDatabase, type ZeroreDatabase } from "@/db";
import type { DatasetStore } from "@/eval-datasets/storage/dataset-store";
import type {
  DatasetBaselineRecord,
  DatasetCaseRecord,
  DatasetRunResultRecord,
  DuplicateCheckResult,
  SampleBatchRecord,
} from "@/eval-datasets/storage/types";

const DATASET_CASE_TYPE = "dataset_cases";
const DATASET_BASELINE_TYPE = "dataset_baselines";
const DATASET_RUN_RESULT_TYPE = "dataset_run_results";
const DATASET_SAMPLE_BATCH_TYPE = "dataset_sample_batches";

/**
 * DatasetStore implementation backed by the active ZeroreDatabase adapter.
 */
export class DatabaseDatasetStore implements DatasetStore {
  private readonly workspaceId: string;
  private database: Promise<ZeroreDatabase> | null = null;

  constructor(workspaceId?: string) {
    this.workspaceId = workspaceId ?? "default";
  }

  async createCase(record: DatasetCaseRecord): Promise<void> {
    await this.upsert(DATASET_CASE_TYPE, record.caseId, record, record.createdAt, record.updatedAt);
  }

  async updateCase(record: DatasetCaseRecord): Promise<void> {
    const existing = await this.getCaseById(record.caseId);
    if (!existing) {
      throw new Error(`未找到 dataset case: ${record.caseId}`);
    }
    await this.upsert(DATASET_CASE_TYPE, record.caseId, record, existing.createdAt, record.updatedAt);
  }

  async saveBaseline(record: DatasetBaselineRecord): Promise<void> {
    const caseRecord = await this.getCaseById(record.caseId);
    if (!caseRecord) {
      throw new Error(`未找到 dataset case: ${record.caseId}`);
    }
    await this.upsert(DATASET_BASELINE_TYPE, record.caseId, record, record.baselineGeneratedAt, record.baselineGeneratedAt);
  }

  async getBaseline(caseId: string): Promise<DatasetBaselineRecord | null> {
    const record = await (await this.getDatabase()).get(this.workspaceId, DATASET_BASELINE_TYPE, caseId);
    return record?.payload ? (record.payload as DatasetBaselineRecord) : null;
  }

  async getCaseById(caseId: string): Promise<DatasetCaseRecord | null> {
    const record = await (await this.getDatabase()).get(this.workspaceId, DATASET_CASE_TYPE, caseId);
    return record?.payload ? (record.payload as DatasetCaseRecord) : null;
  }

  async listCases(caseSetType?: "goodcase" | "badcase"): Promise<DatasetCaseRecord[]> {
    const records = await (await this.getDatabase()).list(this.workspaceId, DATASET_CASE_TYPE);
    return records
      .map((record) => record.payload as DatasetCaseRecord)
      .filter((record) => !caseSetType || record.caseSetType === caseSetType)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async checkDuplicate(input: {
    normalizedTranscriptHash: string;
    topicLabel: string;
    baselineCaseScore: number;
  }): Promise<DuplicateCheckResult> {
    const cases = await this.listCases();
    const exact = cases.find((item) => item.normalizedTranscriptHash === input.normalizedTranscriptHash);
    if (exact) {
      return {
        isDuplicate: true,
        reason: "exact_hash",
        matchedCaseId: exact.caseId,
        similarityScore: 1,
      };
    }

    const nearMatch = cases.find((item) => {
      const topicMatched = item.topicLabel === input.topicLabel;
      const scoreGap = Math.abs(item.baselineCaseScore - input.baselineCaseScore);
      return topicMatched && scoreGap <= 2;
    });
    if (nearMatch) {
      return {
        isDuplicate: true,
        reason: "near_duplicate",
        matchedCaseId: nearMatch.caseId,
        similarityScore: 0.84,
      };
    }

    return {
      isDuplicate: false,
      reason: "none",
    };
  }

  async saveRunResult(record: DatasetRunResultRecord): Promise<void> {
    const id = stableRecordId(record.runId, record.sampleBatchId, record.caseId);
    await this.upsert(DATASET_RUN_RESULT_TYPE, id, record, record.createdAt, record.createdAt);
  }

  async saveSampleBatch(record: SampleBatchRecord): Promise<void> {
    await this.upsert(DATASET_SAMPLE_BATCH_TYPE, record.sampleBatchId, record, record.createdAt, record.createdAt);
  }

  async getSampleBatch(sampleBatchId: string): Promise<SampleBatchRecord | null> {
    const record = await (await this.getDatabase()).get(this.workspaceId, DATASET_SAMPLE_BATCH_TYPE, sampleBatchId);
    return record?.payload ? (record.payload as SampleBatchRecord) : null;
  }

  async listSampleBatches(): Promise<SampleBatchRecord[]> {
    const records = await (await this.getDatabase()).list(this.workspaceId, DATASET_SAMPLE_BATCH_TYPE);
    return records
      .map((record) => record.payload as SampleBatchRecord)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  private async upsert(
    type: string,
    id: string,
    payload: unknown,
    createdAt: string,
    updatedAt: string,
  ): Promise<void> {
    await (await this.getDatabase()).upsert({
      id,
      projectId: this.workspaceId,
      type,
      payload,
      createdAt,
      updatedAt,
    });
  }

  private getDatabase(): Promise<ZeroreDatabase> {
    this.database ??= createZeroreDatabase();
    return this.database;
  }
}

function stableRecordId(...parts: string[]): string {
  return parts
    .join("_")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}
