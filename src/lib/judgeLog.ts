/**
 * @fileoverview Append-only LLM judge call log for local observability.
 *
 * Each successful or failed judge call writes one JSONL line to
 * `.zeval-db/judge-logs.jsonl`. This makes it possible to audit:
 *   - LLM failure rates per stage
 *   - Retry patterns and latency
 *   - Model used on each attempt
 *
 * The log is written fire-and-forget (`void appendJudgeLog(...)`) so it
 * never blocks the evaluation pipeline. Write errors are silently swallowed.
 */

import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * One log entry emitted after each LLM judge call (success or failure).
 */
export type JudgeLogEntry = {
  /** ISO-8601 timestamp of the call completion. */
  ts: string;
  /** Pipeline stage name (e.g. "subjective_dimension_judge"). */
  stage: string;
  /** Evaluation run id, when available. */
  runId?: string;
  /** Session id, when available. */
  sessionId?: string;
  /** Model variant used for this attempt. */
  model: string;
  /** Wall-clock duration of this attempt in ms. */
  durationMs: number;
  /** 1-based attempt number within the retry loop. */
  attempt: number;
  /** Whether the call returned usable content. */
  success: boolean;
  /** Error message when success=false. */
  errorMessage?: string;
};

const LOG_PATH = path.join(process.cwd(), ".zeval-db", "judge-logs.jsonl");

/**
 * Append one judge call entry to the local JSONL log file.
 * Errors are swallowed so logging never interrupts the pipeline.
 *
 * @param entry Log entry to persist.
 */
export async function appendJudgeLog(entry: JudgeLogEntry): Promise<void> {
  try {
    await mkdir(path.dirname(LOG_PATH), { recursive: true });
    await appendFile(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch {
    // Intentionally silent — logging must not break evaluation.
  }
}
