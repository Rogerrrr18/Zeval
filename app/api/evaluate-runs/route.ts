import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { listPersistedEvaluateRuns } from "@/persistence/evaluateResultStore";

/**
 * List recently saved evaluate run records, scoped to the active project.
 *
 * @param request Incoming HTTP request with optional limit query.
 * @returns Lightweight evaluate run index rows.
 */
export async function GET(request: Request) {
  try {
    const context = getZeroreRequestContext(request);
    const limitParam = new URL(request.url).searchParams.get("limit");
    const parsedLimit = Number.parseInt(limitParam ?? "8", 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 8;
    const runs = await listPersistedEvaluateRuns(limit, context.projectId);
    return NextResponse.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取评估记录失败。", detail: message }, { status: 500 });
  }
}
