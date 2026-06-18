/**
 * @fileoverview Shared concurrency utilities for the evaluation pipeline.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export const DEFAULT_LLM_CONCURRENCY = 4;

const llmWaitQueue: Array<() => void> = [];
let activeLlmTasks = 0;

/**
 * Process items with bounded concurrency using a worker-pool pattern.
 * Results are returned in the same order as the input items.
 *
 * @param items Items to process.
 * @param concurrency Maximum simultaneous workers (clamped to [1, items.length]).
 * @param mapper Async transform applied to each item.
 * @returns Ordered results array.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Resolve the shared LLM judge concurrency from the environment.
 * Reads ZEVAL_JUDGE_CONCURRENCY first, then ZEVAL_JUDGE_SESSION_CONCURRENCY.
 *
 * @returns Positive integer concurrency limit.
 */
export function resolveJudgeConcurrency(): number {
  const parsed = Number.parseInt(
    readLocalEnvValue(["ZEVAL_JUDGE_CONCURRENCY", "ZEVAL_JUDGE_SESSION_CONCURRENCY"]) ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_CONCURRENCY;
}

/**
 * Run one LLM-bound task behind the shared judge concurrency gate.
 * The limit is read dynamically so local .env changes are picked up without code changes.
 *
 * @param task Async model request or request group to execute.
 * @returns The task result once a concurrency slot is available.
 */
export async function withLlmConcurrency<T>(task: () => Promise<T>): Promise<T> {
  await acquireLlmSlot();
  try {
    return await task();
  } finally {
    releaseLlmSlot();
  }
}

/**
 * Acquire one shared LLM concurrency slot.
 * @returns Promise resolved when the caller may start a model request.
 */
function acquireLlmSlot(): Promise<void> {
  const limit = Math.max(1, resolveJudgeConcurrency());
  if (activeLlmTasks < limit) {
    activeLlmTasks += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    llmWaitQueue.push(() => {
      activeLlmTasks += 1;
      resolve();
    });
  });
}

/**
 * Release one shared LLM concurrency slot and wake queued work when capacity exists.
 */
function releaseLlmSlot(): void {
  activeLlmTasks = Math.max(0, activeLlmTasks - 1);
  const limit = Math.max(1, resolveJudgeConcurrency());
  while (activeLlmTasks < limit) {
    const next = llmWaitQueue.shift();
    if (!next) return;
    next();
  }
}

/**
 * Read one local environment value without importing the LLM client.
 * This keeps the shared concurrency gate free of circular dependencies.
 *
 * @param keys Candidate keys in priority order.
 * @returns First non-empty configured value.
 */
function readLocalEnvValue(keys: string[]): string | undefined {
  const fileEnv = readRootEnvFile();
  for (const key of keys) {
    const value = process.env[key] ?? fileEnv[key];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

/**
 * Parse the workspace root .env file into a small key-value map.
 * @returns Parsed .env values, or an empty object when the file is absent.
 */
function readRootEnvFile(): Record<string, string> {
  const filePath = path.join(process.cwd(), ".env");
  if (!existsSync(filePath)) return {};
  const result: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    result[key] = rawValue.replace(/^['"]|['"]$/g, "").trim();
  }
  return result;
}
