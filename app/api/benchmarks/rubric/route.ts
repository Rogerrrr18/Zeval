import { NextResponse } from "next/server";
import { draftBenchmarkRubric } from "@/benchmark/copilot";
import { benchmarkRubricDraftRequestSchema } from "@/schemas/benchmark";

/**
 * Draft a capability-based benchmark rubric from business requirements.
 */
export async function POST(request: Request) {
  try {
    const parsed = benchmarkRubricDraftRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求体不合法，请提供 title / description / requirementText。" },
        { status: 400 },
      );
    }

    const result = await draftBenchmarkRubric(parsed.data);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "benchmark rubric draft 未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
