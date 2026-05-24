import { NextResponse } from "next/server";
import { getOnlineEvalRun } from "@/lib/onlineEvalRunStore";

/**
 * Return a full persisted online-eval replay run including the evaluate payload.
 * @param _request Unused request object.
 * @param context Route context with the runId param.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  const record = await getOnlineEvalRun(runId);
  if (!record) {
    return NextResponse.json({ error: "未找到该回放记录。" }, { status: 404 });
  }
  return NextResponse.json(record);
}
