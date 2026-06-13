/**
 * @fileoverview Cooperative cancellation for in-flight benchmark runs.
 */

import { benchmarkProgress } from "@/benchmark/progress";

/** Thrown when a benchmark run receives a user cancel request. */
export class BenchmarkRunCancelledError extends Error {
  readonly runId: string;

  /**
   * @param runId Cancelled benchmark run id.
   */
  constructor(runId: string) {
    super(`Benchmark run ${runId} was cancelled`);
    this.name = "BenchmarkRunCancelledError";
    this.runId = runId;
  }
}

/**
 * Register a cancel request for an active benchmark run.
 *
 * @param runId Benchmark run id.
 */
export function requestBenchmarkRunCancel(runId: string): void {
  benchmarkProgress.requestCancel(runId);
}

/**
 * Abort the current step when the run has been cancelled.
 *
 * @param runId Benchmark run id.
 */
export function assertBenchmarkRunActive(runId: string): void {
  if (benchmarkProgress.isCancelled(runId)) {
    throw new BenchmarkRunCancelledError(runId);
  }
}

/**
 * Mark a run as interrupted and persist the latest checkpoint snapshot.
 *
 * @param runId Benchmark run id.
 * @param message User-facing interruption reason.
 */
export function interruptBenchmarkRun(runId: string, message: string): void {
  benchmarkProgress.interrupt(runId, message);
}
