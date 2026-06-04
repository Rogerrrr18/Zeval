import { NextResponse } from "next/server";
import { readBenchmarkRunStatus } from "@/benchmark/progress-recovery";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");

  if (!runId) {
    return NextResponse.json({ error: "Missing runId query param" }, { status: 400 });
  }

  const status = await readBenchmarkRunStatus(runId);
  return NextResponse.json(status);
}
