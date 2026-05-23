/**
 * @fileoverview Zod schemas for OTel GenAI trace ingest.
 */

import { z } from "zod";

const otelGenAiSpanSchema = z.object({
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  name: z.string().min(1),
  kind: z.enum(["chat", "embeddings", "tool", "agent", "retrieval", "custom"]),
  attributes: z.record(z.string(), z.unknown()).optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  startTime: z.string().min(1),
  endTime: z.string().optional(),
  status: z.enum(["ok", "error"]).optional(),
  error: z.string().optional(),
});

export const otelGenAiTraceSchema = z.object({
  traceId: z.string().min(1),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  turnIndex: z.number().int().optional(),
  name: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  spans: z.array(otelGenAiSpanSchema).default([]),
});

export const otelTraceIngestRequestSchema = z.object({
  traces: z.array(otelGenAiTraceSchema).min(1),
  /** 是否在 ingest 同时立即跑 evaluate（每条 trace 单独评估） */
  evaluateInline: z.boolean().optional().default(false),
  /** evaluate 时是否启用 LLM judge */
  useLlm: z.boolean().optional().default(false),
  /** 关联场景模板 */
  scenarioId: z.string().optional(),
});
