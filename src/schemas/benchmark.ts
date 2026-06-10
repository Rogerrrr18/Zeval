/**
 * @fileoverview Zod schemas for Benchmark Mode APIs.
 */

import { z } from "zod";

export const benchmarkDomainSchema = z.enum([
  "hr",
  "finance",
  "procurement",
  "software",
  "healthcare",
  "research",
  "custom",
]);

export const benchmarkCapabilitySchema = z.enum([
  "task_completion",
  "instruction_following",
  "factual_grounding",
  "data_extraction",
  "reasoning_quality",
  "tool_use_correctness",
  "format_compliance",
  "latency_efficiency",
  "safety_policy",
  "business_judgment",
]);

export const benchmarkAgentFrameworkSchema = z.enum([
  "claude_code",
  "codex",
  "hermes",
  "openclaw",
]);

export const benchmarkRubricDraftRequestSchema = z.object({
  title: z.string().min(1).max(160),
  description: z.string().min(1).max(2000),
  domain: benchmarkDomainSchema.default("custom"),
  requirementText: z.string().min(1).max(20000),
  preferredCapabilities: z.array(benchmarkCapabilitySchema).optional(),
  useLlm: z.boolean().optional().default(false),
});

export const benchmarkHrDemoRunRequestSchema = z.object({
  approvedMetricKeys: z.array(z.string().min(1)).min(1),
  matrix: z.array(
    z.object({
      agentFramework: benchmarkAgentFrameworkSchema,
      model: z.string().min(1),
      enabled: z.boolean().default(true),
      maxTurns: z.number().int().positive().optional(),
      timeoutMs: z.number().int().positive().optional(),
      concurrency: z.number().int().positive().optional(),
    }),
  ).optional(),
  persistCases: z.boolean().optional().default(false),
  /** Override API key for agent calls (defaults to AGENT_API_KEY env). */
  apiKey: z.string().optional(),
  /** Override base URL for agent calls (defaults to AGENT_BASE_URL env). */
  baseUrl: z.string().optional(),
});
