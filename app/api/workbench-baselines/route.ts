import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { createWorkbenchBaselineStore } from "@/workbench";
import type { WorkbenchBaselineSnapshot } from "@/workbench/types";
import { workbenchBaselineSaveSchema } from "@/schemas/workbench";
import type { EvaluateResponse } from "@/types/pipeline";

/**
 * Save one workbench baseline snapshot (post-evaluate, from browser).
 * @param request Incoming JSON body.
 */
export async function POST(request: Request) {
  try {
    const parsed = workbenchBaselineSaveSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;
    const evaluate = body.evaluate as EvaluateResponse;
    if (!evaluate?.runId || typeof evaluate.runId !== "string") {
      return NextResponse.json({ error: "evaluate.runId 缺失。" }, { status: 400 });
    }
    if (!Array.isArray(evaluate.charts) || !evaluate.objectiveMetrics || !evaluate.subjectiveMetrics) {
      return NextResponse.json({ error: "evaluate 载荷不完整（需含 charts / objectiveMetrics / subjectiveMetrics）。" }, { status: 400 });
    }

    const snapshot: WorkbenchBaselineSnapshot = {
      schemaVersion: 1,
      customerId: body.customerId.trim(),
      runId: evaluate.runId,
      createdAt: new Date().toISOString(),
      label: body.label,
      sourceFileName: body.sourceFileName,
      evaluate,
      rawRows: body.rawRows,
    };

    const context = getZeroreRequestContext(request);
    const store = createWorkbenchBaselineStore({ workspaceId: context.workspaceId });
    await store.save(snapshot);
    return NextResponse.json({
      ok: true,
      customerId: snapshot.customerId,
      runId: snapshot.runId,
      createdAt: snapshot.createdAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "保存基线失败。", detail: message }, { status: 500 });
  }
}
