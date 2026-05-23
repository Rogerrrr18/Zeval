/**
 * @fileoverview Zod schemas for calibration and gold-set annotation APIs.
 */

import { z } from "zod";

export const goldSetReviewStatusSchema = z.enum([
  "draft",
  "ready_for_review",
  "changes_requested",
  "approved",
  "imported",
]);

const goldSetDimensionDraftSchema = z.object({
  dimension: z.string().min(1),
  score: z.number().min(1).max(5).nullable(),
  evidence: z.string().optional(),
  notes: z.string().optional(),
});

export const goldSetLabelDraftSchema = z.object({
  taskId: z.string().min(1),
  goldSetVersion: z.string().min(1),
  caseId: z.string().min(1),
  reviewStatus: goldSetReviewStatusSchema,
  dimensions: z.array(goldSetDimensionDraftSchema).min(1),
  goalCompletion: z.object({
    status: z.enum(["achieved", "partial", "failed", "unclear"]).nullable(),
    score: z.number().min(0).max(5).nullable(),
    evidence: z.array(z.string()),
  }),
  recoveryTrace: z.object({
    status: z.enum(["none", "completed", "failed"]).nullable(),
    qualityScore: z.number().min(0).max(5).nullable(),
    notes: z.string().optional(),
  }),
  labeler: z.string().optional(),
  reviewer: z.string().optional(),
  reviewedAt: z.string().optional(),
  reviewNotes: z.string().optional(),
  autoPrefill: z
    .object({
      source: z.string().min(1),
      generatedAt: z.string().min(1),
      reasons: z.array(z.string()),
    })
    .optional(),
});

/**
 * Request body for promoting one dataset case into a gold-set candidate.
 */
export const goldSetPromoteCandidateSchema = z.object({
  caseId: z.string().min(1),
  assignee: z.string().optional(),
  reviewer: z.string().optional(),
});
