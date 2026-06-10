/**
 * @fileoverview Agent adapter types for Benchmark Mode.
 *
 * Each adapter translates a benchmark case input into an agent-specific
 * prompt, calls the remote LLM API, and normalizes the response into a
 * standard BenchmarkAgentSubmission.
 */

import type { BenchmarkAgentSubmission, BenchmarkCase, BenchmarkMatrixCell } from "@/benchmark/types";

export type AgentAdapterConfig = {
  apiKey: string;
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
};

export type AgentAdapterContext = {
  runId: string;
  benchmarkId: string;
  taskId: string;
  matrixCell: BenchmarkMatrixCell;
};

export interface AgentAdapter {
  readonly frameworkId: string;
  submit(
    taskCase: BenchmarkCase,
    context: AgentAdapterContext,
    config: AgentAdapterConfig,
  ): Promise<BenchmarkAgentSubmission>;
}

export type AgentAdapterFactory = (frameworkId: string) => AgentAdapter | undefined;
