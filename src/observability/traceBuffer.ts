/**
 * @fileoverview In-process ring buffer for the most recent ingested traces.
 *
 * MVP 阶段不直接接 Postgres，先用 in-memory ring buffer 提供实时观察能力，
 * 后续可替换为 Redis Stream / ClickHouse / OTel collector。
 */

import type { OtelGenAiTrace } from "@/types/otel-genai";

const BUFFER_SIZE = 200;

type StoredTrace = OtelGenAiTrace & {
  ingestedAt: string;
  workspaceId?: string;
};

const buffer: StoredTrace[] = [];

/**
 * Push one trace to the in-memory ring buffer.
 *
 * @param trace OTel-shaped trace.
 * @param workspaceId Optional workspace.
 * @returns Stored trace with ingestedAt.
 */
export function pushTrace(trace: OtelGenAiTrace, workspaceId?: string): StoredTrace {
  const stored: StoredTrace = {
    ...trace,
    ingestedAt: new Date().toISOString(),
    workspaceId,
  };
  buffer.push(stored);
  while (buffer.length > BUFFER_SIZE) {
    buffer.shift();
  }
  return stored;
}

/**
 * List recent traces, newest first.
 *
 * @param options Query options.
 * @returns Recent traces.
 */
export function listRecentTraces(options: {
  limit?: number;
  sessionId?: string;
  workspaceId?: string;
} = {}): StoredTrace[] {
  const filtered = buffer.filter((t) => {
    if (options.sessionId && t.sessionId !== options.sessionId) return false;
    if (options.workspaceId && t.workspaceId !== options.workspaceId) return false;
    return true;
  });
  const limit = options.limit ?? 50;
  return [...filtered].reverse().slice(0, limit);
}

/**
 * Read one trace by id.
 *
 * @param traceId Trace identifier.
 * @returns Stored trace or null.
 */
export function findTrace(traceId: string): StoredTrace | null {
  return buffer.find((t) => t.traceId === traceId) ?? null;
}
