import { NextResponse } from "next/server";
import { applyAgentReview, buildDataMappingPlan, markAgentReviewDegraded } from "@/data-onboarding/detector";
import { reviewDataMappingPlanWithLlm } from "@/data-onboarding/llm";
import { dataOnboardingRequestSchema } from "@/schemas/api";

/**
 * Inspect an uploaded file and generate a mapping plan before evaluation.
 * @param request Next.js request object.
 * @returns Data mapping plan and capability report.
 */
export async function POST(request: Request) {
  try {
    const parsedBody = dataOnboardingRequestSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "请求体不合法，请检查上传内容。" }, { status: 400 });
    }
    const body = parsedBody.data;
    let plan = buildDataMappingPlan({
      text: body.text,
      format: body.format,
      fileName: body.fileName,
    });

    if (body.useLlm) {
      try {
        const review = await reviewDataMappingPlanWithLlm(plan, body.text);
        plan = applyAgentReview(plan, review);
      } catch (error) {
        const message = error instanceof Error ? error.message : "LLM 复核未知错误";
        plan = markAgentReviewDegraded(plan, message);
      }
    }

    return NextResponse.json({ plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "data onboarding 未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
