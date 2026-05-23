/**
 * @fileoverview Pluggable dataset storage interface.
 */

import type {
  DatasetBaselineRecord,
  DatasetCaseRecord,
  DatasetRunResultRecord,
  DuplicateCheckResult,
  SampleBatchRecord,
} from "@/eval-datasets/storage/types";

/**
 * Unified storage contract for dataset persistence.
 *
 * Business modules should depend on this interface instead of touching
 * file paths or database tables directly, so storage can later switch
 * from filesystem to SQLite/Postgres with minimal impact.
 */
export interface DatasetStore {
  /**
   * Create one dataset case.
   * @param record Case record to persist.
   */
  createCase(record: DatasetCaseRecord): Promise<void>;

  /**
   * Update one dataset case.
   * @param record Full case record to persist.
   */
  updateCase(record: DatasetCaseRecord): Promise<void>;

  /**
   * Save one baseline snapshot.
   * @param record Baseline snapshot to persist.
   */
  saveBaseline(record: DatasetBaselineRecord): Promise<void>;

  /**
   * Read baseline snapshot for one case when present.
   * @param caseId Dataset case ID.
   * @returns Baseline record or null.
   */
  getBaseline(caseId: string): Promise<DatasetBaselineRecord | null>;

  /**
   * Read one case by ID.
   * @param caseId Dataset case ID.
   * @returns Stored case or null.
   */
  getCaseById(caseId: string): Promise<DatasetCaseRecord | null>;

  /**
   * Read all cases in one set.
   * @param caseSetType Optional case set filter.
   * @returns Case records.
   */
  listCases(caseSetType?: "goodcase" | "badcase"): Promise<DatasetCaseRecord[]>;

  /**
   * Check whether one candidate looks duplicated.
   * @param input Duplicate check input.
   * @returns Duplicate result.
   */
  checkDuplicate(input: {
    normalizedTranscriptHash: string;
    topicLabel: string;
    baselineCaseScore: number;
  }): Promise<DuplicateCheckResult>;

  /**
   * Save one run result row.
   * @param record Run result record.
   */
  saveRunResult(record: DatasetRunResultRecord): Promise<void>;

  /**
   * Save one fixed sample batch.
   * @param record Sample batch record.
   */
  saveSampleBatch(record: SampleBatchRecord): Promise<void>;

  /**
   * Read one saved sample batch by ID.
   * @param sampleBatchId Sample batch identifier.
   * @returns Stored sample batch or null.
   */
  getSampleBatch(sampleBatchId: string): Promise<SampleBatchRecord | null>;

  /**
   * List saved sample batches, newest first.
   *
   * @returns Stored sample batch records.
   */
  listSampleBatches(): Promise<SampleBatchRecord[]>;
}
