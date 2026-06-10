import { NextResponse } from "next/server";
import {
  runAutoFindDataSkill,
  type AutoFindRubricContext,
  type AutoFindWorkflowState,
  type RunAutoFindInput,
} from "@/benchmark/agent/skills/autofind-data-skill";

type RequestBody = {
  action?: RunAutoFindInput["action"];
  requirementText?: string;
  rubricContext?: AutoFindRubricContext;
  message?: string;
  state?: AutoFindWorkflowState | null;
};

/**
 * AutoFind 轻量数据工作流 API。
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const action = body.action ?? "chat";
    const result = await runAutoFindDataSkill({
      action,
      requirementText: body.requirementText,
      rubricContext: body.rubricContext,
      message: body.message,
      state: body.state ?? null,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "AutoFind 未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
