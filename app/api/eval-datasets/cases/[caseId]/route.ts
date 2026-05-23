/**
 * GET  /api/eval-datasets/cases/[caseId]  — read one case + baseline
 * PATCH /api/eval-datasets/cases/[caseId] — update review fields
 *
 * FP automation (PRD §13.3.5):
 *   When `humanVerdict = "false_positive"` is received the handler:
 *     1. Flips `caseSetType` to "goodcase".
 *     2. Sets `source` to "manual_fp".
 *     3. Writes `metadata.false_positive = true` so the admission pipeline
 *        will never re-admit the same session via TP rules.
 *     4. Appends an entry to `manualOverrides`.
 */

import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { createDatasetStore } from "@/eval-datasets/storage";
import { evalDatasetUpdateCaseBodySchema } from "@/schemas/eval-datasets";

type RouteContext = {
  params: Promise<{ caseId: string }>;
};

/**
 * Read one dataset case and its optional baseline snapshot.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const requestContext = getZeroreRequestContext(request);
    const { caseId } = await context.params;
    const store = createDatasetStore({ workspaceId: requestContext.workspaceId });
    const datasetCase = await store.getCaseById(caseId);
    if (!datasetCase) {
      return NextResponse.json({ error: `未找到案例: ${caseId}` }, { status: 404 });
    }
    const baseline = await store.getBaseline(caseId);
    return NextResponse.json({ case: datasetCase, baseline });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取评测案例失败。", detail: message }, { status: 500 });
  }
}

/**
 * Update lightweight human review fields for one dataset case.
 *
 * When `humanVerdict = "false_positive"` the case is automatically converted
 * to a goodcase with `source = "manual_fp"` and `metadata.false_positive = true`.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const parsedBody = evalDatasetUpdateCaseBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "请求体不合法。", details: parsedBody.error.flatten() },
        { status: 400 },
      );
    }

    const requestContext = getZeroreRequestContext(request);
    const { caseId } = await context.params;
    const store = createDatasetStore({ workspaceId: requestContext.workspaceId });
    const datasetCase = await store.getCaseById(caseId);
    if (!datasetCase) {
      return NextResponse.json({ error: `未找到案例: ${caseId}` }, { status: 404 });
    }

    const now = new Date().toISOString();
    const isFalsePositive = parsedBody.data.humanVerdict === "false_positive";

    // Build the updated manualOverrides list when flagging as false positive.
    const existingOverrides = datasetCase.manualOverrides ?? [];
    const nextOverrides = isFalsePositive
      ? [
          ...existingOverrides,
          { type: "false_positive" as const, note: parsedBody.data.reviewNotes, createdAt: now },
        ]
      : existingOverrides;

    const nextCase = {
      ...datasetCase,
      ...parsedBody.data,
      // FP automation: flip set type, source and metadata.
      caseSetType: isFalsePositive ? ("goodcase" as const) : datasetCase.caseSetType,
      source: isFalsePositive ? ("manual_fp" as const) : datasetCase.source,
      metadata: isFalsePositive
        ? { ...(datasetCase.metadata ?? {}), false_positive: true }
        : datasetCase.metadata,
      manualOverrides: nextOverrides,
      reviewStatus:
        parsedBody.data.reviewStatus ??
        inferReviewStatus(parsedBody.data.humanVerdict, datasetCase.reviewStatus),
      reviewedAt: parsedBody.data.humanVerdict ? now : datasetCase.reviewedAt,
      updatedAt: now,
    };

    await store.updateCase(nextCase);
    return NextResponse.json({ case: nextCase });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "更新评测案例失败。", detail: message }, { status: 500 });
  }
}

/**
 * Infer review lifecycle status from a human verdict patch.
 */
function inferReviewStatus(
  verdict?: string,
  currentStatus?: "auto_captured" | "human_reviewed" | "gold_candidate" | "gold" | "regression_active",
): "auto_captured" | "human_reviewed" | "gold_candidate" | "gold" | "regression_active" {
  return verdict ? "human_reviewed" : (currentStatus ?? "auto_captured");
}
