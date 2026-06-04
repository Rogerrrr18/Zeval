import { NextResponse } from "next/server";
import { runHrDemoStreaming } from "@/benchmark/hr-demo-streaming";
import { benchmarkHrDemoRunRequestSchema } from "@/schemas/benchmark";

/**
 * Run the HR resume-screening benchmark with real-time progress.
 *
 * Returns immediately with a runId. The frontend should then open an
 * SSE stream to /api/benchmarks/hr-demo-stream?runId={runId} to
 * receive live progress updates.
 */
export async function POST(request: Request) {
  try {
    const parsed = benchmarkHrDemoRunRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求体不合法，请至少提供 approvedMetricKeys。" },
        { status: 400 },
      );
    }

    const runId = `benchmark_hr_demo_${Date.now()}`;

    // Start benchmark in background; it will emit progress events
    void runHrDemoStreaming({
      runId,
      approvedMetricKeys: parsed.data.approvedMetricKeys,
      matrix: parsed.data.matrix,
      persistCases: parsed.data.persistCases,
      apiKey: parsed.data.apiKey,
      baseUrl: parsed.data.baseUrl,
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const { benchmarkProgress } = require("@/benchmark/progress");
      benchmarkProgress.setPhase(runId, "failed", message);
    });

    return NextResponse.json({ runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "HR demo benchmark 未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
