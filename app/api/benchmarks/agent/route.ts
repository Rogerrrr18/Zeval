import { NextResponse } from "next/server";
import { runBenchmarkRubricAgent } from "@/benchmark/rubric-agent";
import type { BenchmarkRubricSet } from "@/benchmark/types";

type RequestBody = {
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  requirementText?: string;
  rubric?: BenchmarkRubricSet | null;
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RequestBody;
    const messages = Array.isArray(body.messages)
      ? body.messages.filter((message) =>
          (message.role === "user" || message.role === "assistant") &&
          typeof message.content === "string" &&
          message.content.trim(),
        )
      : [];

    if (messages.length === 0) {
      return NextResponse.json({ error: "请提供用户消息。" }, { status: 400 });
    }

    const result = await runBenchmarkRubricAgent({
      messages,
      requirementText: typeof body.requirementText === "string" ? body.requirementText : "",
      rubric: body.rubric ?? null,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rubric Agent 未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
