/**
 * @fileoverview Zod schemas for validation run APIs.
 */

import { z } from "zod";

/**
 * Request body for creating one validation run.
 */
export const validationRunCreateBodySchema = z.object({
  packageId: z.string().min(1),
  mode: z.enum(["replay", "offline_eval"]),
  baselineCustomerId: z.string().min(1).optional(),
  replyApiBaseUrl: z.string().min(1).max(2000).optional(),
  sampleBatchId: z.string().min(1).optional(),
  useLlm: z.boolean().optional().default(true),
  replyTimeoutMs: z.number().int().min(3000).max(120000).optional(),
  asyncMode: z.boolean().optional(),
});
