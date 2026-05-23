import { NextResponse } from "next/server";
import { listPersistedEvaluateRuns } from "@/persistence/evaluateResultStore";

/**
 * List recently saved evaluate run records.
 *
 * @param request Incoming HTTP request with optional limit query.
 * @returns Lightweight evaluate run index rows.
 */
export async function GET(request: Request) {
  try {
    const limitParam = new URL(request.url).searchParams.get("limit");
    const parsedLimit = Number.parseInt(limitParam ?? "8", 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 8;
    const runs = await listPersistedEvaluateRuns(limit);
    return NextResponse.json({ runs });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取评估记录失败。", detail: message }, { status: 500 });
  }
}
