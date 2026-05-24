/**
 * @fileoverview Local file store for online evaluation replay run results.
 *
 * Each replay run is persisted to `.zeval-db/online-eval-runs/{runId}.json`
 * immediately after the evaluate pipeline completes.  The route handler writes
 * fire-and-forget (`void saveOnlineEvalRun(...)`) so persistence never blocks
 * the HTTP response.
 *
 * Listing returns only summary metadata (the `evaluate` payload is stripped)
 * so it remains fast even when individual run files are large.
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvaluateResponse } from "@/types/pipeline";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Full on-disk record for one replay run. */
export type OnlineEvalRunRecord = {
  /** Unique run id (matches evaluate.runId). */
  runId: string;
  /** ISO-8601 timestamp when the run was saved. */
  createdAt: string;
  /** Reply endpoint used for this run. */
  replyEndpoint: string;
  /** Total replayed row count. */
  replayedRowCount: number;
  /** Baseline runId, when the run used a workbench baseline. */
  baselineRunId?: string;
  /** Sample batch id, when the run used a dataset sample batch. */
  sampleBatchId?: string;
  /** Full evaluate pipeline result. */
  evaluate: EvaluateResponse;
};

/** Lightweight summary (no evaluate payload) returned by listOnlineEvalRuns. */
export type OnlineEvalRunSummary = Omit<OnlineEvalRunRecord, "evaluate">;

// ── Storage paths ─────────────────────────────────────────────────────────────

const RUNS_DIR = path.join(process.cwd(), ".zeval-db", "online-eval-runs");

function runFilePath(runId: string): string {
  // Sanitise runId to prevent path traversal.
  const safe = runId.replace(/[^a-zA-Z0-9_\-]/g, "_");
  return path.join(RUNS_DIR, `${safe}.json`);
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Persist one replay run record to disk.
 * Errors are swallowed so the caller can fire-and-forget.
 *
 * @param record Full run record to save.
 */
export async function saveOnlineEvalRun(record: OnlineEvalRunRecord): Promise<void> {
  try {
    await mkdir(RUNS_DIR, { recursive: true });
    await writeFile(runFilePath(record.runId), JSON.stringify(record, null, 2), "utf8");
  } catch {
    // Intentionally silent — persistence must not block the HTTP response.
  }
}

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Load one full run record by runId.
 *
 * @param runId Run id to load.
 * @returns Record, or null when the file does not exist.
 */
export async function getOnlineEvalRun(runId: string): Promise<OnlineEvalRunRecord | null> {
  try {
    const text = await readFile(runFilePath(runId), "utf8");
    return JSON.parse(text) as OnlineEvalRunRecord;
  } catch {
    return null;
  }
}

/**
 * List all persisted run summaries, newest first.
 * Corrupted or missing files are silently skipped.
 *
 * @returns Array of run summaries (no evaluate payload).
 */
export async function listOnlineEvalRuns(): Promise<OnlineEvalRunSummary[]> {
  try {
    await mkdir(RUNS_DIR, { recursive: true });
    const files = (await readdir(RUNS_DIR)).filter((f) => f.endsWith(".json"));
    const summaries: OnlineEvalRunSummary[] = [];
    for (const file of files) {
      try {
        const text = await readFile(path.join(RUNS_DIR, file), "utf8");
        const record = JSON.parse(text) as OnlineEvalRunRecord;
        // Strip the large evaluate payload before returning.
        const { evaluate: _evaluate, ...summary } = record;
        summaries.push(summary);
      } catch {
        // Skip corrupted files.
      }
    }
    return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch {
    return [];
  }
}
