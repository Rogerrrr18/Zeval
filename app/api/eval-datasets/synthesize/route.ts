import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { computeNormalizedTranscriptHash } from "@/eval-datasets/case-transcript-hash";
import { createDatasetStore } from "@/eval-datasets/storage";
import type { DatasetCaseRecord } from "@/eval-datasets/storage/types";
import { synthesizeRequestSchema } from "@/schemas/synthesize";
import { synthesizeConversations, transcriptFromRows } from "@/synthesis/synthesizer";
import type { SyntheticConversation } from "@/synthesis/synthesizer";

/**
 * Synthesize evaluation conversations on demand (DeepEval Synthesizer 等价物).
 *
 * @param request Incoming HTTP request.
 */
export async function POST(request: Request) {
  try {
    const context = getZeroreRequestContext(request);
    const parsed = synthesizeRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求体不合法。", details: parsed.error.flatten() },
        { status: 400 },
      );
    }

    const result = await synthesizeConversations(parsed.data);
    const persistence = parsed.data.persistAsCases
      ? await persistSyntheticCases({
          conversations: result.conversations,
          workspaceId: context.workspaceId,
          baselineVersion: parsed.data.runId ?? `synthesize_${Date.now()}`,
        })
      : undefined;
    return NextResponse.json({
      conversations: result.conversations,
      count: result.conversations.length,
      plan: result.plan,
      qualityReport: result.qualityReport,
      persistence,
      warnings: result.warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "synthesize 失败。", detail: message }, { status: 500 });
  }
}

/**
 * Persist accepted synthetic conversations into eval-datasets.
 * Exact and near duplicates are skipped so generated long-tail cases do not pollute regression pools.
 *
 * @param params Synthetic conversations and workspace context.
 * @returns Saved and skipped case diagnostics.
 */
async function persistSyntheticCases(params: {
  conversations: SyntheticConversation[];
  workspaceId: string;
  baselineVersion: string;
}): Promise<{
  savedCaseIds: string[];
  skipped: Array<{
    caseId: string;
    reason: "exact_hash" | "near_duplicate";
    matchedCaseId?: string;
  }>;
}> {
  const store = createDatasetStore({ workspaceId: params.workspaceId });
  const savedCaseIds: string[] = [];
  const skipped: Array<{
    caseId: string;
    reason: "exact_hash" | "near_duplicate";
    matchedCaseId?: string;
  }> = [];

  for (const conversation of params.conversations) {
    const transcript = transcriptFromRows(conversation.rawRows);
    const normalizedTranscriptHash = computeNormalizedTranscriptHash(transcript);
    const baselineCaseScore = estimateBaselineCaseScore(conversation);
    const duplicate = await store.checkDuplicate({
      normalizedTranscriptHash,
      topicLabel: conversation.failureMode ?? conversation.scenarioTag,
      baselineCaseScore,
    });

    if (duplicate.isDuplicate) {
      skipped.push({
        caseId: conversation.caseId,
        reason: duplicate.reason === "exact_hash" ? "exact_hash" : "near_duplicate",
        matchedCaseId: duplicate.matchedCaseId,
      });
      continue;
    }

    const now = new Date().toISOString();
    const record: DatasetCaseRecord = {
      caseId: conversation.caseId,
      caseSetType: conversation.failureMode ? "badcase" : "goodcase",
      sessionId: conversation.rawRows[0]?.sessionId ?? conversation.caseId,
      topicSegmentId: `${conversation.caseId}_segment_0`,
      topicLabel: conversation.failureMode ?? conversation.scenarioTag,
      topicSummary: conversation.expectedBehavior,
      normalizedTranscriptHash,
      duplicateGroupKey: `synth:${conversation.failureMode ?? "positive"}:${conversation.difficultyHint}`,
      baselineVersion: params.baselineVersion,
      baselineCaseScore,
      tags: buildSyntheticTags(conversation),
      title: `${conversation.failureMode ?? "正向对照"} · ${conversation.difficultyHint}`,
      transcript,
      suggestedAction: conversation.expectedBehavior,
      failureType: conversation.failureMode ?? undefined,
      expectedBehavior: conversation.expectedBehavior,
      reviewStatus: conversation.failureMode ? "gold_candidate" : "auto_captured",
      failureSeverityScore: conversation.failureMode ? Number((1 - baselineCaseScore).toFixed(4)) : undefined,
      autoSignals: [
        {
          source: "synthesize",
          planCellId: conversation.planCellId,
          evolutionOperators: conversation.evolutionOperators,
          rarityScore: conversation.rarityScore,
          qualityScore: conversation.qualityScore,
          qualityNotes: conversation.qualityNotes,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    await store.createCase(record);
    savedCaseIds.push(record.caseId);
  }

  return { savedCaseIds, skipped };
}

/**
 * Estimate a synthetic baseline score without running the full evaluator.
 * Negative long-tail cases intentionally start lower so replay sampling can stratify them.
 *
 * @param conversation Synthetic conversation.
 * @returns Normalized baseline case score.
 */
function estimateBaselineCaseScore(conversation: SyntheticConversation): number {
  if (!conversation.failureMode) {
    return 0.86;
  }
  const difficultyPenalty = conversation.difficultyHint === "hard" ? 0.2 : conversation.difficultyHint === "medium" ? 0.12 : 0.06;
  const rarityPenalty = Math.min(0.16, (conversation.rarityScore ?? 0.5) * 0.14);
  const qualityBoost = Math.max(0, ((conversation.qualityScore ?? 0.7) - 0.7) * 0.08);
  return Number(Math.max(0.18, Math.min(0.82, 0.68 - difficultyPenalty - rarityPenalty + qualityBoost)).toFixed(4));
}

/**
 * Build dataset tags from synthesis metadata.
 * @param conversation Synthetic conversation.
 * @returns Tags for dataset filtering.
 */
function buildSyntheticTags(conversation: SyntheticConversation): string[] {
  return [
    "synthetic",
    `difficulty:${conversation.difficultyHint}`,
    conversation.failureMode ? "synthetic_badcase" : "synthetic_goodcase",
    ...(conversation.planCellId ? [`plan:${conversation.planCellId}`] : []),
    ...(conversation.evolutionOperators ?? []).map((operator) => `evolution:${operator}`),
  ];
}
