import { NextResponse } from "next/server";
import { benchmarkProgress } from "@/benchmark/progress";
import { persistBenchmarkRunSnapshot, readBenchmarkRunArtifact } from "@/benchmark/progress-artifacts";
import { requestBenchmarkRunCancel } from "@/benchmark/run-cancellation";

/**
 * Request cooperative cancellation of an in-flight benchmark run.
 *
 * The active worker checks the cancel flag between submissions/metrics and
 * persists the latest checkpoint as `interrupted`.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { runId?: string };
    const runId = body.runId?.trim();
    if (!runId) {
      return NextResponse.json({ error: "Missing runId" }, { status: 400 });
    }

    requestBenchmarkRunCancel(runId);

    const liveSnapshot = benchmarkProgress.getSnapshot(runId);
    if (!liveSnapshot) {
      const artifact = await readBenchmarkRunArtifact(runId);
      if (artifact && artifact.snapshot.phase !== "completed") {
        const interruptedSnapshot = {
          ...artifact.snapshot,
          phase: "interrupted" as const,
          error: "评测已由用户手动停止。",
          updatedAt: new Date().toISOString(),
        };
        await persistBenchmarkRunSnapshot(interruptedSnapshot);
        return NextResponse.json({ ok: true, phase: "interrupted" });
      }
    }

    return NextResponse.json({ ok: true, phase: liveSnapshot?.phase ?? "pending" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "取消评测失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
