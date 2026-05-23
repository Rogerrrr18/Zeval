/**
 * @fileoverview Agent execution trace contracts for tool and span-level evaluation.
 */

/**
 * Supported execution span kinds.
 */
export type EvalTraceSpanType = "agent" | "llm" | "retriever" | "tool" | "base";

/**
 * Execution span status.
 */
export type EvalTraceSpanStatus = "success" | "error" | "in_progress" | "warning";

/**
 * One span inside an agent execution trace.
 */
export type EvalTraceSpan = {
  spanId: string;
  parentSpanId?: string;
  type: EvalTraceSpanType;
  name: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  status: EvalTraceSpanStatus;
  input?: unknown;
  output?: unknown;
  error?: string;
  metadata?: Record<string, unknown>;
};

/**
 * One trace attached to an evaluation case or run.
 */
export type EvalTrace = {
  traceId: string;
  name?: string;
  sessionId?: string;
  userId?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  spans: EvalTraceSpan[];
};
