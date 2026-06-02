import { NextResponse } from "next/server";
import { runHrDemoBenchmark } from "@/benchmark/hr-demo";
import { benchmarkHrDemoRunRequestSchema } from "@/schemas/benchmark";

/**
 * Run the local HR resume-screening benchmark smoke test.
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

    const result = await runHrDemoBenchmark(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "HR demo benchmark 未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
