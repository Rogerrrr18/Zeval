/**
 * @fileoverview Zod schemas for agent run APIs.
 */

import { z } from "zod";

/**
 * Request body for creating one tracked agent run.
 */
export const agentRunCreateBodySchema = z.object({
  packageId: z.string().min(1),
  channel: z.enum(["prompt", "issue", "pr"]),
  title: z.string().min(1).max(240),
  summary: z.string().min(1).max(2000),
  content: z.string().min(1),
  notes: z.string().max(4000).optional(),
  replayValidationRunId: z.string().min(1).nullable().optional(),
  offlineValidationRunId: z.string().min(1).nullable().optional(),
});

/**
 * Request body for updating one tracked agent run.
 */
export const agentRunUpdateBodySchema = z.object({
  status: z.enum(["draft", "queued", "running", "blocked", "completed"]).optional(),
  notes: z.string().max(4000).optional(),
  replayValidationRunId: z.string().min(1).nullable().optional(),
  offlineValidationRunId: z.string().min(1).nullable().optional(),
});
