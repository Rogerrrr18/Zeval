import { NextResponse } from "next/server";
import { createAgentRunStore } from "@/agent-runs";
import { agentRunUpdateBodySchema } from "@/schemas/agent-runs";

type RouteContext = {
  params: Promise<{ agentRunId: string }>;
};

/**
 * Read one saved agent run by id.
 *
 * @param _request Incoming HTTP request.
 * @param context Dynamic route params.
 * @returns Agent run snapshot.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { agentRunId } = await context.params;
    const store = createAgentRunStore();
    const agentRun = await store.read(agentRunId);
    if (!agentRun) {
      return NextResponse.json({ error: `未找到 agent run: ${agentRunId}` }, { status: 404 });
    }
    return NextResponse.json({ agentRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取 agent run 失败。", detail: message }, { status: 500 });
  }
}

/**
 * Update one tracked agent run.
 *
 * @param request Incoming HTTP request.
 * @param context Dynamic route params.
 * @returns Updated agent run snapshot.
 */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { agentRunId } = await context.params;
    const parsedBody = agentRunUpdateBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const store = createAgentRunStore();
    const agentRun = await store.update(agentRunId, parsedBody.data);
    if (!agentRun) {
      return NextResponse.json({ error: `未找到 agent run: ${agentRunId}` }, { status: 404 });
    }
    return NextResponse.json({ agentRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "更新 agent run 失败。", detail: message }, { status: 500 });
  }
}
