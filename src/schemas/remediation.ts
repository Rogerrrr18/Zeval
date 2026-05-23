/**
 * @fileoverview Zod schemas for remediation package APIs.
 */

import { z } from "zod";

const subjectiveDimensionSchema = z.object({
  dimension: z.string().min(1),
  score: z.number(),
  reason: z.string(),
  evidence: z.string(),
  confidence: z.number(),
});

const implicitSignalSchema = z.object({
  signalKey: z.string().min(1),
  score: z.number(),
  severity: z.string().min(1),
  reason: z.string(),
  evidence: z.string(),
  evidenceTurnRange: z.string().min(1),
  confidence: z.number(),
  triggeredRules: z.array(z.string()).default([]),
});

const goalCompletionSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(["achieved", "partial", "failed", "unclear"]),
  score: z.number(),
  userIntent: z.string(),
  achievementEvidence: z.array(z.string()).default([]),
  failureReasons: z.array(z.string()).default([]),
  triggeredRules: z.array(z.string()).default([]),
  confidence: z.number(),
});

const recoveryTraceSchema = z.object({
  sessionId: z.string().min(1),
  status: z.enum(["none", "completed", "failed"]),
  failureTurn: z.number().nullable(),
  recoveryTurn: z.number().nullable(),
  spanTurns: z.number().nullable(),
  failureType: z.string().min(1),
  repairStrategy: z.string().nullable(),
  qualityScore: z.number(),
  confidence: z.number(),
  triggeredRules: z.array(z.string()).default([]),
  evidence: z.array(
    z.object({
      turnIndex: z.number().int(),
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    }),
  ),
});

const badCaseAssetSchema = z.object({
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
});

const scenarioEvaluationSchema = z.object({
  scenarioId: z.string().min(1),
  displayName: z.string().min(1),
  averageScore: z.number(),
  generatedAt: z.string().min(1),
  kpis: z.array(
    z.object({
      id: z.string().min(1),
      displayName: z.string().min(1),
      description: z.string().min(1),
      score: z.number(),
      status: z.enum(["healthy", "degraded", "at_risk"]),
      successThreshold: z.number(),
      degradedThreshold: z.number(),
      topEvidence: z.array(z.string()).default([]),
      contributions: z.array(
        z.object({
          source: z.enum(["objective", "subjective", "signal"]),
          metricId: z.string().min(1),
          weight: z.number(),
          rawValue: z.number(),
          alignedScore: z.number(),
          evidence: z.string(),
        }),
      ),
    }),
  ),
});

/**
 * Request body for creating one remediation package from one evaluation result.
 */
export const remediationPackageCreateBodySchema = z.object({
  sourceFileName: z.string().optional(),
  baselineCustomerId: z.string().min(1).optional(),
  selectedCaseKeys: z.array(z.string().min(1)).optional().default([]),
  evaluate: z.object({
    runId: z.string().min(1),
    objectiveMetrics: z.object({
      avgResponseGapSec: z.number(),
      topicSwitchRate: z.number(),
      userQuestionRepeatRate: z.number(),
      agentResolutionSignalRate: z.number(),
      escalationKeywordHitRate: z.number(),
    }),
    subjectiveMetrics: z.object({
      dimensions: z.array(subjectiveDimensionSchema),
      signals: z.array(implicitSignalSchema),
      goalCompletions: z.array(goalCompletionSchema),
      recoveryTraces: z.array(recoveryTraceSchema),
    }),
    scenarioEvaluation: scenarioEvaluationSchema.nullable(),
    badCaseAssets: z.array(badCaseAssetSchema),
    suggestions: z.array(z.string()).default([]),
  }),
});

/**
 * Request body for updating one saved remediation package gate config.
 */
export const remediationPackageUpdateBodySchema = z
  .object({
    acceptanceGate: z
      .object({
        replay: z
          .object({
            baselineCustomerId: z.string().min(1).nullable().optional(),
          })
          .optional(),
        offlineEval: z
          .object({
            sampleBatchId: z.string().min(1).nullable().optional(),
          })
          .optional(),
      })
      .refine((value) => Boolean(value.replay) || Boolean(value.offlineEval), {
        message: "至少提供一个 acceptance gate 更新项。",
      }),
  });
