/**
 * @fileoverview File-system persistence for completed evaluate responses.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvaluateResponse } from "@/types/pipeline";

const EVALUATE_RUNS_ROOT = "eval-runs";

export type EvaluateRunIndexRow = {
  runId: string;
  generatedAt: string;
  updatedAt: string;
  sessions: number;
  messages: number;
  savedEvaluatePath: string;
  scenarioId?: string;
  scenarioLabel?: string;
  warningCount: number;
};

/**
 * Persist one completed evaluate response as a replayable JSON artifact.
 *
 * @param response Completed evaluate response.
 * @returns Relative artifact path.
 */
export async function persistEvaluateResult(response: EvaluateResponse): Promise<string> {
  const runId = sanitizeRunId(response.runId);
  const runDirectory = path.join(EVALUATE_RUNS_ROOT, runId);
  const outputPath = path.join(runDirectory, "evaluate.json");
  response.meta.savedEvaluatePath = outputPath;
  await mkdir(runDirectory, { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(response, null, 2)}\n`, "utf8");
  return outputPath;
}

/**
 * Read one persisted evaluate response by run id.
 *
 * @param runId Raw run id from API or browser state.
 * @returns Evaluate response when the artifact exists, otherwise null.
 */
export async function readPersistedEvaluateResult(runId: string): Promise<EvaluateResponse | null> {
  const outputPath = path.join(EVALUATE_RUNS_ROOT, sanitizeRunId(runId), "evaluate.json");
  try {
    const raw = await readFile(outputPath, "utf8");
    const response = JSON.parse(raw) as EvaluateResponse;
    response.meta.savedEvaluatePath = response.meta.savedEvaluatePath ?? outputPath;
    return response;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}

/**
 * List recently persisted evaluate runs without loading them into browser state.
 *
 * @param limit Maximum number of rows returned.
 * @returns Lightweight run index rows sorted by generation time descending.
 */
export async function listPersistedEvaluateRuns(limit: number): Promise<EvaluateRunIndexRow[]> {
  let entries: Array<{ isDirectory(): boolean; name: string }>;
  try {
    entries = await readdir(EVALUATE_RUNS_ROOT, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }

  const rows: EvaluateRunIndexRow[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const outputPath = path.join(EVALUATE_RUNS_ROOT, entry.name, "evaluate.json");
    try {
      const raw = await readFile(outputPath, "utf8");
      const response = JSON.parse(raw) as EvaluateResponse;
      const fileStat = await stat(outputPath);
      rows.push(projectEvaluateRunIndexRow(response, outputPath, fileStat.mtime.toISOString()));
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) {
        console.warn(`[EVALUATE_RUN_STORE] index read failed path=${outputPath}`, error);
      }
    }
  }

  return rows
    .sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt))
    .slice(0, Math.max(1, limit));
}

/**
 * Project one full evaluate response into the lightweight browser history row.
 *
 * @param response Completed evaluate response.
 * @param savedEvaluatePath Relative JSON artifact path.
 * @param updatedAt Last file modification time.
 * @returns Minimal run metadata safe to send to the frontend.
 */
function projectEvaluateRunIndexRow(
  response: EvaluateResponse,
  savedEvaluatePath: string,
  updatedAt: string,
): EvaluateRunIndexRow {
  return {
    runId: response.runId,
    generatedAt: response.meta.generatedAt,
    updatedAt,
    sessions: response.meta.sessions,
    messages: response.meta.messages,
    savedEvaluatePath: response.meta.savedEvaluatePath ?? savedEvaluatePath,
    scenarioId: response.scenarioEvaluation?.scenarioId,
    scenarioLabel: response.scenarioEvaluation?.displayName,
    warningCount: response.meta.warnings.length,
  };
}

/**
 * Sanitize a run id before using it as a local directory name.
 *
 * @param value Raw run id.
 * @returns Safe local path segment.
 */
function sanitizeRunId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/^-+|-+$/g, "") || `run-${Date.now()}`;
}

/**
 * Check a Node.js file-system error code without losing type safety.
 *
 * @param error Unknown error thrown by fs/promises.
 * @param code Expected Node error code.
 * @returns Whether the error has the expected code.
 */
function isNodeErrorCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
