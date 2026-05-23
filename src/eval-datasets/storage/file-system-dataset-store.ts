/**
 * @fileoverview Filesystem-backed dataset storage adapter.
 */

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DatasetStore } from "@/eval-datasets/storage/dataset-store";
import { maybeWorkspacePath } from "@/workspaces/paths";
import type {
  CaseSetType,
  DatasetBaselineRecord,
  DatasetCaseRecord,
  DatasetRunResultRecord,
  DuplicateCheckResult,
  SampleBatchRecord,
} from "@/eval-datasets/storage/types";

const DATASET_ROOT = "eval-datasets";

/**
 * Filesystem implementation of the dataset store contract.
 *
 * This adapter keeps the current MVP lightweight while preserving the same
 * business-facing interface that a future database adapter can implement.
 */
export class FileSystemDatasetStore implements DatasetStore {
  private readonly rootDirectory: string;

  constructor(workspaceId?: string) {
    this.rootDirectory = maybeWorkspacePath(workspaceId, DATASET_ROOT);
  }

  /**
   * @inheritdoc
   */
  async createCase(record: DatasetCaseRecord): Promise<void> {
    const caseDirectory = this.getCaseDirectory(record.caseSetType, record.caseId);
    await mkdir(caseDirectory, { recursive: true });
    await writeJsonFile(path.join(caseDirectory, "case.json"), record);
    await appendCasesIndexRow(this.rootDirectory, record);
    await updateCaseSetManifest(this.rootDirectory, record.caseSetType);
  }

  /**
   * @inheritdoc
   */
  async updateCase(record: DatasetCaseRecord): Promise<void> {
    const existing = await this.getCaseById(record.caseId);
    if (!existing) {
      throw new Error(`未找到 dataset case: ${record.caseId}`);
    }
    await writeJsonFile(path.join(this.getCaseDirectory(existing.caseSetType, record.caseId), "case.json"), record);
  }

  /**
   * @inheritdoc
   */
  async saveBaseline(record: DatasetBaselineRecord): Promise<void> {
    const caseRecord = await this.getCaseById(record.caseId);
    if (!caseRecord) {
      throw new Error(`未找到 dataset case: ${record.caseId}`);
    }
    await writeJsonFile(path.join(this.getCaseDirectory(caseRecord.caseSetType, record.caseId), "baseline.json"), record);
  }

  /**
   * @inheritdoc
   */
  async getBaseline(caseId: string): Promise<DatasetBaselineRecord | null> {
    const caseRecord = await this.getCaseById(caseId);
    if (!caseRecord) {
      return null;
    }
    const filePath = path.join(this.getCaseDirectory(caseRecord.caseSetType, caseId), "baseline.json");
    try {
      return (await readJsonFile(filePath)) as DatasetBaselineRecord;
    } catch {
      return null;
    }
  }

  /**
   * @inheritdoc
   */
  async getCaseById(caseId: string): Promise<DatasetCaseRecord | null> {
    for (const caseSetType of ["goodcase", "badcase"] as const) {
      const filePath = path.join(this.getCaseDirectory(caseSetType, caseId), "case.json");
      try {
        return (await readJsonFile(filePath)) as DatasetCaseRecord;
      } catch {
        continue;
      }
    }
    return null;
  }

  /**
   * @inheritdoc
   */
  async listCases(caseSetType?: "goodcase" | "badcase"): Promise<DatasetCaseRecord[]> {
    const targetSets = caseSetType ? [caseSetType] : (["goodcase", "badcase"] as const);
    const cases: DatasetCaseRecord[] = [];

    for (const currentSet of targetSets) {
      const casesDirectory = path.join(this.rootDirectory, currentSet, "cases");
      try {
        const directoryItems = await readdir(casesDirectory, { withFileTypes: true });
        for (const item of directoryItems) {
          if (!item.isDirectory()) {
            continue;
          }
          const filePath = path.join(casesDirectory, item.name, "case.json");
          try {
            cases.push((await readJsonFile(filePath)) as DatasetCaseRecord);
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }

    return cases;
  }

  /**
   * @inheritdoc
   */
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

  /**
   * @inheritdoc
   */
  async saveRunResult(record: DatasetRunResultRecord): Promise<void> {
    const runDirectory = path.join(this.rootDirectory, "runs", record.runId);
    await mkdir(runDirectory, { recursive: true });
    const line = `${JSON.stringify(record)}\n`;
    const filePath = path.join(runDirectory, "case-results.jsonl");
    await appendTextFile(filePath, line);
  }

  /**
   * @inheritdoc
   */
  async saveSampleBatch(record: SampleBatchRecord): Promise<void> {
    const samplesDirectory = path.join(this.rootDirectory, "samples");
    await mkdir(samplesDirectory, { recursive: true });
    await writeJsonFile(path.join(samplesDirectory, `${record.sampleBatchId}.json`), record);
  }

  /**
   * @inheritdoc
   */
  async getSampleBatch(sampleBatchId: string): Promise<SampleBatchRecord | null> {
    const filePath = path.join(this.rootDirectory, "samples", `${sampleBatchId}.json`);
    try {
      return (await readJsonFile(filePath)) as SampleBatchRecord;
    } catch {
      return null;
    }
  }

  /**
   * @inheritdoc
   */
  async listSampleBatches(): Promise<SampleBatchRecord[]> {
    const samplesDirectory = path.join(this.rootDirectory, "samples");
    let names: string[] = [];
    try {
      names = await readdir(samplesDirectory);
    } catch {
      return [];
    }

    const rows: Array<SampleBatchRecord & { mtimeMs: number }> = [];
    for (const fileName of names.filter((name) => name.endsWith(".json"))) {
      const filePath = path.join(samplesDirectory, fileName);
      try {
        const [raw, fileStat] = await Promise.all([readFile(filePath, "utf8"), stat(filePath)]);
        rows.push({
          ...(JSON.parse(raw) as SampleBatchRecord),
          mtimeMs: fileStat.mtimeMs,
        });
      } catch {
        continue;
      }
    }

    rows.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return rows.map((row) => {
      const { mtimeMs, ...record } = row;
      void mtimeMs;
      return record;
    });
  }

  /**
   * Get one case directory from set type and case ID.
   * @param caseSetType Dataset set type.
   * @param caseId Dataset case ID.
   * @returns Case directory path.
   */
  private getCaseDirectory(caseSetType: "goodcase" | "badcase", caseId: string): string {
    return path.join(this.rootDirectory, caseSetType, "cases", caseId);
  }
}

/**
 * Read one JSON file.
 * @param filePath File path.
 * @returns Parsed JSON content.
 */
async function readJsonFile(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8"));
}

/**
 * Write one JSON file with stable formatting.
 * @param filePath File path.
 * @param payload JSON payload.
 */
async function writeJsonFile(filePath: string, payload: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/**
 * Append text to a file, creating the parent directory if needed.
 * @param filePath File path.
 * @param content Text content.
 */
async function appendTextFile(filePath: string, content: string): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  let current = "";
  try {
    current = await readFile(filePath, "utf8");
  } catch {
    current = "";
  }
  await writeFile(filePath, `${current}${content}`, "utf8");
}

const CASES_INDEX_HEADER =
  "caseId,caseSetType,topicLabel,baselineCaseScore,baselineVersion,duplicateGroupKey,createdAt\n";

/**
 * Append one row to `indexes/cases.csv`, creating header when missing.
 * @param rootDirectory Dataset root directory.
 * @param record Case record for index columns.
 */
async function appendCasesIndexRow(rootDirectory: string, record: DatasetCaseRecord): Promise<void> {
  const indexPath = path.join(rootDirectory, "indexes", "cases.csv");
  await mkdir(path.dirname(indexPath), { recursive: true });
  const row =
    [
      csvEscapeCell(record.caseId),
      csvEscapeCell(record.caseSetType),
      csvEscapeCell(record.topicLabel),
      String(record.baselineCaseScore),
      csvEscapeCell(record.baselineVersion),
      csvEscapeCell(record.duplicateGroupKey ?? ""),
      csvEscapeCell(record.createdAt),
    ].join(",") + "\n";

  let existing = "";
  try {
    existing = await readFile(indexPath, "utf8");
  } catch {
    existing = "";
  }

  if (!existing.trim()) {
    await writeFile(indexPath, CASES_INDEX_HEADER + row, "utf8");
    return;
  }

  await appendTextFile(indexPath, row);
}

/**
 * Escape one CSV field when commas, quotes or newlines appear.
 * @param value Raw cell string.
 * @returns CSV-safe cell.
 */
function csvEscapeCell(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Keep the case-set manifest aligned with stored case directories.
 * @param rootDirectory Dataset root directory.
 * @param caseSetType Case-set type that changed.
 */
async function updateCaseSetManifest(rootDirectory: string, caseSetType: CaseSetType): Promise<void> {
  const manifestPath = path.join(rootDirectory, caseSetType, "manifest.json");
  const casesDirectory = path.join(rootDirectory, caseSetType, "cases");
  let caseCount = 0;
  try {
    const items = await readdir(casesDirectory, { withFileTypes: true });
    caseCount = items.filter((item) => item.isDirectory()).length;
  } catch {
    caseCount = 0;
  }

  let current: Record<string, unknown> = {};
  try {
    current = (await readJsonFile(manifestPath)) as Record<string, unknown>;
  } catch {
    current = {};
  }

  await writeJsonFile(manifestPath, {
    caseSetType,
    description: current.description ?? defaultCaseSetDescription(caseSetType),
    ...current,
    caseCount,
    updatedAt: new Date().toISOString(),
  });
}

/**
 * Default manifest description for newly created dataset sets.
 * @param caseSetType Case-set type.
 * @returns Human-readable description.
 */
function defaultCaseSetDescription(caseSetType: CaseSetType): string {
  if (caseSetType === "goodcase") {
    return "高质量案例集合，用于回归保持率验证。";
  }
  return "低质量案例集合，用于修复率和风险下降验证。";
}
