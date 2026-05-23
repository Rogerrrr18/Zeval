import { NextResponse } from "next/server";
import { readPersistedEvaluateResult } from "@/persistence/evaluateResultStore";

type RouteContext = {
  params: Promise<{ runId: string }>;
};

/**
 * Read one saved evaluate result by run id.
 *
 * @param _request Incoming HTTP request.
 * @param context Dynamic route params.
 * @returns Full evaluate response payload.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { runId } = await context.params;
    const evaluate = await readPersistedEvaluateResult(decodeURIComponent(runId));
    if (!evaluate) {
      return NextResponse.json({ error: `未找到评估记录: ${runId}` }, { status: 404 });
    }
    return NextResponse.json({ evaluate });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取评估结果失败。", detail: message }, { status: 500 });
  }
}
