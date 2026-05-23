/**
 * @fileoverview Zod schemas for ingest and evaluate contracts.
 */

import { z } from "zod";

/**
 * Shared raw row schema.
 */
export const rawChatlogRowSchema = z.object({
  sessionId: z.string().min(1),
  timestamp: z.string().min(1),
  role: z.enum(["user", "assistant", "system"]),
  content: z.string(),
});

/**
 * Ingest request schema.
 */
export const ingestRequestSchema = z.object({
  text: z.string().min(1),
  format: z.enum(["csv", "json", "jsonl", "txt", "md"]).optional(),
  fileName: z.string().optional(),
});

/**
 * Data onboarding request schema.
 */
export const dataOnboardingRequestSchema = z.object({
  text: z.string().min(1),
  format: z.enum(["csv", "json", "jsonl", "txt", "md"]).optional(),
  fileName: z.string().optional(),
  useLlm: z.boolean().optional(),
});

const scenarioContextSchema = z.object({
  onboardingAnswers: z.record(z.string(), z.string().max(2000)).optional().default({}),
});

const structuredTaskMetricsSchema = z.object({
  status: z.enum(["ready", "unavailable", "degraded"]),
  sourceFormat: z.enum(["sgd", "assetops", "custom"]),
  caseCount: z.number(),
  serviceCount: z.number(),
  schemaServiceCount: z.number().optional(),
  schemaIntentCount: z.number().optional(),
  schemaSlotCount: z.number().optional(),
  frameCount: z.number(),
  actionCount: z.number(),
  slotMentionCount: z.number(),
  dialogueStateCount: z.number(),
  serviceCallCount: z.number(),
  serviceResultCount: z.number(),
  intentCoverageRate: z.number(),
  stateSlotCoverageRate: z.number(),
  schemaServiceCoverageRate: z.number().optional(),
  schemaIntentCoverageRate: z.number().optional(),
  schemaSlotCoverageRate: z.number().optional(),
  unknownIntentReferenceCount: z.number().optional(),
  unknownSlotReferenceCount: z.number().optional(),
  serviceCallGroundingRate: z.number(),
  serviceResultAvailabilityRate: z.number(),
  transactionalConfirmationRate: z.number(),
  warnings: z.array(z.string()),
});

const traceSpanSchema = z.object({
  spanId: z.string().min(1),
  parentSpanId: z.string().optional(),
  type: z.enum(["agent", "llm", "retriever", "tool", "base"]),
  name: z.string().min(1),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  durationMs: z.number().optional(),
  status: z.enum(["success", "error", "in_progress", "warning"]),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const traceSchema = z.object({
  traceId: z.string().min(1),
  name: z.string().optional(),
  sessionId: z.string().optional(),
  userId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  spans: z.array(traceSpanSchema).default([]),
});

/**
 * Retrieval context for RAG-style extended metrics (faithfulness/relevancy/...).
 */
export const retrievalContextSchema = z.object({
  contexts: z.array(z.string()).default([]),
  query: z.string(),
  response: z.string(),
  turnIndex: z.number().int().optional(),
  sessionId: z.string().optional(),
});

/**
 * Tool call record for ToolCorrectnessMetric.
 */
export const toolCallRecordSchema = z.object({
  sessionId: z.string(),
  turnIndex: z.number().int(),
  toolName: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
  expectedToolName: z.string().optional(),
  expectedArguments: z.record(z.string(), z.unknown()).optional(),
  succeeded: z.boolean().optional(),
});

/**
 * Knowledge retention fact for multi-turn metric.
 */
export const knowledgeRetentionFactSchema = z.object({
  factId: z.string(),
  introducedAtTurn: z.number().int(),
  factText: z.string(),
});

/**
 * Role profile for RoleAdherenceMetric.
 */
export const roleProfileSchema = z.object({
  roleName: z.string(),
  characterDescription: z.string(),
  prohibitedBehaviors: z.array(z.string()).optional(),
});

/**
 * Extended metrics inputs (DeepEval-aligned).
 */
export const extendedInputsSchema = z.object({
  retrievalContexts: z.array(retrievalContextSchema).optional(),
  toolCalls: z.array(toolCallRecordSchema).optional(),
  retentionFacts: z.array(knowledgeRetentionFactSchema).optional(),
  roleProfile: roleProfileSchema.optional(),
});

/**
 * Evaluate request schema.
 */
export const evaluateRequestSchema = z.object({
  rawRows: z.array(rawChatlogRowSchema).min(1),
  runId: z.string().optional(),
  scenarioId: z.string().min(1).optional(),
  scenarioContext: scenarioContextSchema.optional(),
  useLlm: z.boolean().optional(),
  judgeRequired: z.boolean().optional(),
  artifactBaseName: z.string().min(1).optional(),
  persistArtifact: z.boolean().optional(),
  asyncMode: z.boolean().optional(),
  structuredTaskMetrics: structuredTaskMetricsSchema.optional(),
  trace: traceSchema.optional(),
  extendedInputs: extendedInputsSchema.optional(),
  /**
   * Enable SimUser intent pointer dynamic replay.
   * When false (default), intent extraction and replay are skipped.
   * dynamicReplayStatus will be "skipped" and intentMetrics/intentSequences/intentRunLogs will be null.
   */
  enableDynamicReplay: z.boolean().optional().default(false),
  /**
   * Agent HTTP endpoint for SimUser to call during dynamic replay.
   * Required when enableDynamicReplay=true. POST { messages: [...] } → { content: string }.
   */
  agentApiEndpoint: z.string().url().optional(),
});
