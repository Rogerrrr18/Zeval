/**
 * @fileoverview Zod schemas for workbench baseline HTTP API.
 */

import { z } from "zod";
import { rawChatlogRowSchema } from "@/schemas/api";

/**
 * Body for saving a baseline snapshot from the home console (after evaluate).
 */
export const workbenchBaselineSaveSchema = z.object({
  customerId: z.string().min(1).max(64),
  label: z.string().max(200).optional(),
  sourceFileName: z.string().max(500).optional(),
  /** 完整评估结果（服务端做弱校验）。 */
  evaluate: z.record(z.string(), z.unknown()),
  rawRows: z.array(rawChatlogRowSchema).min(1),
});
