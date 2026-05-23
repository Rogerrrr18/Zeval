/**
 * @fileoverview Shared concurrency utilities for the evaluation pipeline.
 */

import { readZevalEnvValue } from "@/lib/siliconflow";

export const DEFAULT_LLM_CONCURRENCY = 4;

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
 * Resolve the session-level LLM judge concurrency from the environment.
 * Reads ZEVAL_JUDGE_SESSION_CONCURRENCY first; falls back to DEFAULT_LLM_CONCURRENCY.
 *
 * @returns Positive integer concurrency limit.
 */
export function resolveJudgeConcurrency(): number {
  const parsed = Number.parseInt(
    readZevalEnvValue(["ZEVAL_JUDGE_SESSION_CONCURRENCY"]) ?? "",
    10,
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_CONCURRENCY;
}
