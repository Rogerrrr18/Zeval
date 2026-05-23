/**
 * @fileoverview Filesystem helpers for gold-set annotation APIs.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readJsonlFile, writeJsonlFile } from "@/calibration/jsonl";
import { resolveCalibrationPath, sanitizeCalibrationId } from "@/calibration/paths";
import type {
  GoldSetAnnotationTaskRecord,
  GoldSetCaseRecord,
  GoldSetLabelDraftRecord,
  GoldSetLabelRecord,
} from "@/calibration/types";

/**
 * Resolve and sanitize one gold-set version directory.
 *
 * @param version Raw version value from route params.
 * @returns Gold-set directory path and sanitized version.
 */
export function resolveGoldSetVersionDirectory(version: string): { version: string; directory: string } {
  const sanitizedVersion = sanitizeCalibrationId(version);
  return {
    version: sanitizedVersion,
    directory: resolveCalibrationPath("gold-sets", sanitizedVersion),
  };
}

/**
 * Read source cases for one gold-set version.
 *
 * @param version Gold-set version.
 * @returns Case records.
 */
export async function readGoldSetCases(version: string): Promise<GoldSetCaseRecord[]> {
  const { directory } = resolveGoldSetVersionDirectory(version);
  return readJsonlFile<GoldSetCaseRecord>(path.join(directory, "cases.jsonl"));
}

/**
 * Read annotation tasks for one gold-set version.
 *
 * @param version Gold-set version.
 * @returns Task records.
 */
export async function readGoldSetAnnotationTasks(version: string): Promise<GoldSetAnnotationTaskRecord[]> {
  const { directory } = resolveGoldSetVersionDirectory(version);
  return readJsonlFile<GoldSetAnnotationTaskRecord>(path.join(directory, "annotation-tasks.jsonl"));
}

/**
 * Write annotation tasks for one gold-set version.
 *
 * @param version Gold-set version.
 * @param tasks Task records.
 */
export async function writeGoldSetAnnotationTasks(
  version: string,
  tasks: GoldSetAnnotationTaskRecord[],
): Promise<void> {
  const { directory } = resolveGoldSetVersionDirectory(version);
  await writeJsonlFile(path.join(directory, "annotation-tasks.jsonl"), tasks);
}

/**
 * Read all label drafts from a gold-set version.
 *
 * @param version Gold-set version.
 * @returns Draft records.
 */
export async function readGoldSetLabelDrafts(version: string): Promise<GoldSetLabelDraftRecord[]> {
  const { directory } = resolveGoldSetVersionDirectory(version);
  const draftDirectory = path.join(directory, "label-drafts");
  const entries = await readdir(draftDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(draftDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const drafts: GoldSetLabelDraftRecord[] = [];
  for (const filePath of files) {
    drafts.push(JSON.parse(await readFile(filePath, "utf8")) as GoldSetLabelDraftRecord);
  }
  return drafts;
}

/**
 * Read one label draft by task ID.
 *
 * @param version Gold-set version.
 * @param taskId Task ID.
 * @returns Draft record.
 */
export async function readGoldSetLabelDraft(version: string, taskId: string): Promise<GoldSetLabelDraftRecord> {
  const filePath = resolveGoldSetLabelDraftPath(version, taskId);
  return JSON.parse(await readFile(filePath, "utf8")) as GoldSetLabelDraftRecord;
}

/**
 * Save one label draft and keep the task index status aligned.
 *
 * @param version Gold-set version.
 * @param draft Draft record.
 * @returns Saved draft.
 */
export async function saveGoldSetLabelDraft(
  version: string,
  draft: GoldSetLabelDraftRecord,
): Promise<GoldSetLabelDraftRecord> {
  const filePath = resolveGoldSetLabelDraftPath(version, draft.taskId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  await syncTaskFromDraft(version, draft);
  return draft;
}

/**
 * Write canonical labels and import report.
 *
 * @param version Gold-set version.
 * @param labels Imported label records.
 * @param report Markdown import report.
 */
export async function writeGoldSetImportArtifacts(
  version: string,
  labels: GoldSetLabelRecord[],
  report: string,
): Promise<void> {
  const { directory } = resolveGoldSetVersionDirectory(version);
  await writeJsonlFile(path.join(directory, "labels.jsonl"), labels);
  await writeFile(path.join(directory, "import-report.md"), report, "utf8");
}

/**
 * Append one new case, annotation task and label draft into a gold-set version.
 * If the case already exists, returns the existing task and draft instead.
 *
 * @param version Gold-set version.
 * @param candidate Candidate case, task and draft.
 * @returns Persisted records and duplicate flag.
 */
export async function appendGoldSetCandidate(version: string, candidate: {
  caseRecord: GoldSetCaseRecord;
  task: GoldSetAnnotationTaskRecord;
  draft: GoldSetLabelDraftRecord;
}): Promise<{
  caseRecord: GoldSetCaseRecord;
  task: GoldSetAnnotationTaskRecord;
  draft: GoldSetLabelDraftRecord;
  alreadyExists: boolean;
}> {
  const [cases, tasks, drafts] = await Promise.all([
    readGoldSetCases(version),
    readGoldSetAnnotationTasks(version),
    readGoldSetLabelDrafts(version),
  ]);
  const existingCase = cases.find((item) => item.caseId === candidate.caseRecord.caseId);
  if (existingCase) {
    const existingTask = tasks.find((item) => item.caseId === existingCase.caseId) ?? candidate.task;
    const existingDraft = drafts.find((item) => item.caseId === existingCase.caseId) ?? candidate.draft;
    return {
      caseRecord: existingCase,
      task: existingTask,
      draft: existingDraft,
      alreadyExists: true,
    };
  }

  const { directory } = resolveGoldSetVersionDirectory(version);
  await writeJsonlFile(path.join(directory, "cases.jsonl"), [...cases, candidate.caseRecord]);
  await writeGoldSetAnnotationTasks(version, [...tasks, candidate.task]);
  await saveGoldSetLabelDraft(version, candidate.draft);

  return {
    ...candidate,
    alreadyExists: false,
  };
}

/**
 * Resolve the draft JSON file for one task.
 *
 * @param version Gold-set version.
 * @param taskId Task ID.
 * @returns Draft JSON path.
 */
function resolveGoldSetLabelDraftPath(version: string, taskId: string): string {
  const { directory } = resolveGoldSetVersionDirectory(version);
  const safeTaskId = sanitizeCalibrationId(taskId);
  return path.join(directory, "label-drafts", `${safeTaskId}.json`);
}

/**
 * Keep `annotation-tasks.jsonl` useful as a lightweight work queue.
 *
 * @param version Gold-set version.
 * @param draft Saved draft.
 */
async function syncTaskFromDraft(version: string, draft: GoldSetLabelDraftRecord): Promise<void> {
  const tasks = await readGoldSetAnnotationTasks(version);
  const nextTasks = tasks.map((task) => {
    if (task.taskId !== draft.taskId) {
      return task;
    }
    return {
      ...task,
      status: draft.reviewStatus,
      assignee: draft.labeler?.trim() || task.assignee,
      reviewer: draft.reviewer?.trim() || task.reviewer,
      updatedAt: new Date().toISOString(),
    };
  });
  await writeGoldSetAnnotationTasks(version, nextTasks);
}
