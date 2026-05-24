import { NextResponse } from "next/server";
import { listOnlineEvalRuns } from "@/lib/onlineEvalRunStore";

/**
 * Return a summary list of all persisted online-eval replay runs, newest first.
 * The evaluate payload is excluded to keep the response lightweight.
 */
export async function GET() {
  const runs = await listOnlineEvalRuns();
  return NextResponse.json({ runs, count: runs.length });
}
