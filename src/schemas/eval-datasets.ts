/**
 * @fileoverview Zod schemas for eval-datasets HTTP API.
 */

import { z } from "zod";

/**
 * Admission channel values mirroring {@link DatasetCaseSource}.
 */
export const datasetCaseSourceSchema = z.enum([
  "auto_tp",
  "manual_fp",
  "auto_fn",
  "auto_tn",
  "auto_uncertainty",
  "auto_disagreement",
  "synthesized",
  "imported",
]);

/**
 * Request body for creating one dataset case.
 */
export const evalDatasetCreateCaseBodySchema = z.object({
  caseId: z.string().min(1).optional(),
  caseSetType: z.enum(["goodcase", "badcase"]),
  /** Admission channel. Defaults to `auto_tp` when omitted. */
  source: datasetCaseSourceSchema.optional(),
  sessionId: z.string().min(1),
  topicSegmentId: z.string().min(1),
  topicLabel: z.string().min(1),
  topicSummary: z.string(),
  /** 用于计算 `normalizedTranscriptHash` 的原始片段文本。 */
  transcript: z.string().min(1),
  baselineVersion: z.string().min(1),
  baselineCaseScore: z.number(),
  tags: z.array(z.string()).optional().default([]),
  duplicateGroupKey: z.string().optional(),
  /** 为 true 时允许在仅命中近重复（非哈希完全一致）时仍入库。 */
  allowNearDuplicate: z.boolean().optional().default(false),
  baseline: z
    .object({
      baselineObjectiveScore: z.number(),
      baselineSubjectiveScore: z.number(),
      baselineRiskPenaltyScore: z.number(),
      baselineSignals: z.array(
        z.object({
          signalKey: z.string(),
          score: z.number(),
          severity: z.string(),
        }),
      ),
      baselineProductVersion: z.string().min(1),
    })
    .optional(),
});

/**
 * Query for listing dataset cases.
 */
export const evalDatasetListCasesQuerySchema = z.object({
  caseSetType: z.enum(["goodcase", "badcase"]).optional(),
  /** Filter by admission channel. */
  source: datasetCaseSourceSchema.optional(),
});

/**
 * Request body for lightweight human review of one dataset case.
 */
export const evalDatasetUpdateCaseBodySchema = z.object({
  humanVerdict: z.enum(["valid_bad_case", "false_positive", "unclear"]).optional(),
  failureType: z.string().max(120).optional(),
  expectedBehavior: z.string().max(4000).optional(),
  reviewNotes: z.string().max(4000).optional(),
  manualOverrides: z
    .array(z.object({ type: z.literal("false_positive"), note: z.string().max(4000).optional(), createdAt: z.string() }))
    .optional(),
  reviewer: z.string().max(120).optional(),
  reviewStatus: z
    .enum(["auto_captured", "human_reviewed", "gold_candidate", "gold", "regression_active"])
    .optional(),
});

/**
 * Request body for creating a stratified sample batch.
 */
export const evalDatasetCreateSampleBatchBodySchema = z.object({
  requestedGoodcaseCount: z.number().int().min(0).max(2000),
  requestedBadcaseCount: z.number().int().min(0).max(2000),
  seed: z.string().optional(),
  strategy: z.string().optional(),
  targetVersion: z.string().optional(),
  persist: z.boolean().optional().default(true),
});

/**
 * Request body for harvesting extracted bad cases into eval-datasets.
 */
export const evalDatasetHarvestBadcasesBodySchema = z.object({
  baselineVersion: z.string().optional(),
  allowNearDuplicate: z.boolean().optional().default(false),
  /** TN channel random-sampling rate. Defaults to 0.05 (5%). */
  tnSampleRate: z.number().min(0).max(1).optional(),
  /**
   * Fraction of TP/TN cases requiring human review before entering the
   * benchmark pool. 0 = bypass all review, 1 = review everything.
   * FN and uncertainty cases are always reviewed regardless of this value.
   * Defaults to 1.0 (full review) when omitted.
   */
  humanSamplingRate: z.number().min(0).max(1).optional(),
  /** Capability dimension tag applied to all admitted cases in this batch. */
  capabilityDimension: z.string().max(120).optional(),
  evaluate: z.object({
    runId: z.string().min(1),
    subjectiveMetrics: z.object({
      signals: z.array(
        z.object({
          signalKey: z.string().min(1),
          score: z.number(),
          severity: z.string().min(1),
          evidenceTurnRange: z.string().min(1),
        }),
      ),
    }),
    badCaseAssets: z.array(
      z.object({
        caseKey: z.string().min(1),
        sessionId: z.string().min(1),
        title: z.string().min(1),
        severityScore: z.number(),
        normalizedTranscriptHash: z.string().min(1),
        duplicateGroupKey: z.string().min(1),
        topicSegmentId: z.string().min(1),
        topicIndex: z.number().int().optional(),
        topicRange: z.object({ startTurn: z.number().int(), endTurn: z.number().int() }).optional(),
        topicLabel: z.string().min(1),
        topicSummary: z.string(),
        tags: z.array(z.string()).default([]),
        transcript: z.string().min(1),
        evidence: z.array(
          z.object({
            turnIndex: z.number().int(),
            role: z.enum(["user", "assistant", "system"]),
            content: z.string(),
          }),
        ),
        autoSignals: z.array(z.record(z.string(), z.unknown())).optional(),
        suggestedAction: z.string(),
        sourceRunId: z.string().min(1),
      }),
    ),
  }),
});
