/**
 * @fileoverview Benchmark metric evaluation retry helpers for transient LLM failures.
 */

import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkMetricEvaluationResult,
  BenchmarkRubricMetric,
} from "@/benchmark/types";
import {
  evaluateBenchmarkMetric,
  type BenchmarkEvaluatorContext,
} from "@/benchmark/evaluators";

const DEFAULT_METRIC_RETRY_ATTEMPTS = 3;

/**
 * Decide whether a metric evaluation failure is transient enough to retry.
 * @param message Error reason or thrown error message.
 * @returns Whether the metric evaluation should be retried.
 */
export function isRetryableBenchmarkMetricError(message: string): boolean {
  return (
    /abort|timeout|timed out|fetch failed|network/i.test(message) ||
    /SiliconFlow 未返回有效内容/.test(message) ||
    /SiliconFlow 请求失败: (408|409|425|429|5\d\d)/.test(message) ||
    /非 JSON 响应: (408|409|425|429|5\d\d)/.test(message)
  );
}

/**
 * Sleep for a bounded retry delay between metric evaluation attempts.
 * @param ms Delay in milliseconds.
 * @returns Promise resolved after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Build backoff delay between whole-metric retries; 429 uses longer waits.
 * @param attempt Current 1-based attempt number.
 * @param message Last failure message.
 * @returns Delay in milliseconds.
 */
function buildMetricRetryDelayMs(attempt: number, message: string): number {
  const isRateLimited = /SiliconFlow 请求失败: 429/.test(message);
  const base = isRateLimited
    ? Math.min(45000, 3000 * 2 ** Math.max(0, attempt - 1))
    : Math.min(8000, 1000 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 300);
}

/**
 * Resolve how many times one metric evaluation may be retried after transient failures.
 * @returns Positive integer retry attempt count.
 */
function resolveMetricRetryAttempts(): number {
  const raw = Number.parseInt(process.env.ZEVAL_BENCHMARK_METRIC_RETRY_ATTEMPTS ?? "", 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_METRIC_RETRY_ATTEMPTS;
}

/**
 * Evaluate one rubric metric with bounded retries for transient LLM/provider errors.
 * Non-retryable failures and exhausted retries return `status: "error"` instead of throwing.
 * @param metric Approved rubric metric definition.
 * @param taskCase Benchmark case being scored.
 * @param submission Agent submission for the case.
 * @param context Evaluator context including optional LLM judge.
 * @returns Metric evaluation result; throws only when caller should abort the whole run.
 */
export async function evaluateBenchmarkMetricWithRetry(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
  context: BenchmarkEvaluatorContext = {},
): Promise<BenchmarkMetricEvaluationResult> {
  const maxAttempts = resolveMetricRetryAttempts();
  let lastResult: BenchmarkMetricEvaluationResult | undefined;
  let lastMessage = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await evaluateBenchmarkMetric(metric, taskCase, submission, context);
      if (result.status !== "error") {
        return result;
      }
      lastResult = result;
      lastMessage = result.reason;
      if (attempt >= maxAttempts || !isRetryableBenchmarkMetricError(result.reason)) {
        return result;
      }
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
      if (attempt >= maxAttempts || !isRetryableBenchmarkMetricError(lastMessage)) {
        throw error;
      }
    }
    await sleep(buildMetricRetryDelayMs(attempt, lastMessage));
  }

  return lastResult ?? (await evaluateBenchmarkMetric(metric, taskCase, submission, context));
}
