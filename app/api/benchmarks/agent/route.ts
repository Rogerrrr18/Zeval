import { NextResponse } from "next/server";
import { buildKnowledgeContextForQuery } from "@/benchmark/agent/knowledge-store";
import { runBenchmarkRubricAgent } from "@/benchmark/rubric-agent";
import type { BenchmarkRubricSet } from "@/benchmark/types";

type RequestBody = {
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
  requirementText?: string;
  rubric?: BenchmarkRubricSet | null;
  userId?: string;
  knowledgeFileIds?: string[];
  includeKnowledgeBase?: boolean;
  knowledgeQuery?: string;
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

    const knowledgeFileIds = Array.isArray(body.knowledgeFileIds)
      ? body.knowledgeFileIds.filter((fileId) => typeof fileId === "string" && fileId.trim()).map((fileId) => fileId.trim())
      : undefined;
    const knowledgeContext = await resolveKnowledgeContext({
      userId: typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : "default",
      includeKnowledgeBase: Boolean(body.includeKnowledgeBase) || Boolean(knowledgeFileIds?.length),
      knowledgeFileIds,
      query: buildKnowledgeQuery({
        requestQuery: typeof body.knowledgeQuery === "string" ? body.knowledgeQuery : "",
        requirementText: typeof body.requirementText === "string" ? body.requirementText : "",
        messages,
      }),
    });

    const result = await runBenchmarkRubricAgent({
      messages,
      requirementText: typeof body.requirementText === "string" ? body.requirementText : "",
      rubric: body.rubric ?? null,
      knowledgeContext,
      signal: request.signal,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rubric Agent 未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Build local knowledge-base context for the Rubric Agent.
 *
 * @param input User scope and optional file selection.
 * @returns Prompt-ready context, or an empty string when no knowledge should be attached.
 */
async function resolveKnowledgeContext(input: {
  userId: string;
  includeKnowledgeBase: boolean;
  knowledgeFileIds?: string[];
  query: string;
}): Promise<string> {
  if (!input.includeKnowledgeBase) return "";
  try {
    return await buildKnowledgeContextForQuery({
      userId: input.userId,
      fileIds: input.knowledgeFileIds,
      query: input.query,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return [
      "## 本地知识库检索状态",
      `检索失败：${message}`,
      "降级要求：不要声称已经参考本地知识库；如果继续生成 rubric，需明确基于任务描述和可用公开参考。",
    ].join("\n");
  }
}

/**
 * Build a retrieval query for local knowledge-base grounding.
 *
 * @param input Explicit query, current requirement, and recent chat messages.
 * @returns Compact retrieval query text.
 */
function buildKnowledgeQuery(input: {
  requestQuery: string;
  requirementText: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}): string {
  const latestUserText = [...input.messages].reverse().find((message) => message.role === "user")?.content ?? "";
  return [
    input.requestQuery.trim(),
    input.requirementText.trim(),
    latestUserText.trim(),
  ].filter(Boolean).join("\n\n").slice(0, 6000);
}
