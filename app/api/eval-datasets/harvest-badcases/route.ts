/**
 * POST /api/eval-datasets/harvest-badcases
 *
 * Runs the five-channel auto-admission pipeline for one evaluate response
 * and persists accepted cases into eval-datasets storage.
 *
 * Response includes per-source counts (acceptedBySource), dedup skips, and
 * an audit summary — matching PRD §13.7.
 */

import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { harvestBadCasesToDataset } from "@/eval-datasets/harvest-badcases";
import { createDatasetStore } from "@/eval-datasets/storage";
import { evalDatasetHarvestBadcasesBodySchema } from "@/schemas/eval-datasets";
import type { EvaluateResponse } from "@/types/pipeline";

export async function POST(request: Request) {
  try {
    const parsedBody = evalDatasetHarvestBadcasesBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "请求体不合法。", details: parsedBody.error.flatten() },
        { status: 400 },
      );
    }

    const context = getZeroreRequestContext(request);
    const store = createDatasetStore({ workspaceId: context.workspaceId });

    const result = await harvestBadCasesToDataset({
      store,
      evaluate: parsedBody.data.evaluate as unknown as EvaluateResponse,
      baselineVersion: parsedBody.data.baselineVersion,
      allowNearDuplicate: parsedBody.data.allowNearDuplicate,
      tnSampleRate: parsedBody.data.tnSampleRate,
      humanSamplingRate: parsedBody.data.humanSamplingRate,
      capabilityDimension: parsedBody.data.capabilityDimension,
    });

    return NextResponse.json({
      // Legacy-compatible fields
      savedCount: result.savedCaseIds.length,
      savedCaseIds: result.savedCaseIds,
      skippedCount: result.skippedDuplicates + result.skippedFalsePositive,

      // New rich fields (PRD §13.7)
      acceptedBySource: result.acceptedBySource,
      pendingReviewCount: result.pendingReviewCount,
      /** Cases queued for mandatory human review (FN/uncertainty always + sampled TP/TN). */
      humanReviewQueueCount: result.auditSummary.humanReviewQueued,
      skippedDuplicates: result.skippedDuplicates,
      skippedFalsePositive: result.skippedFalsePositive,
      skips: result.skips,
      auditSummary: result.auditSummary,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "自动入池流水线执行失败。", detail: message },
      { status: 500 },
    );
  }
}
