import { NextResponse } from "next/server";
import { buildAgentRunSnapshot, createAgentRunStore } from "@/agent-runs";
import { createRemediationPackageStore } from "@/remediation";
import { agentRunCreateBodySchema } from "@/schemas/agent-runs";

/**
 * List saved agent runs with optional package filter.
 *
 * @param request Incoming HTTP request.
 * @returns Agent run index list.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const packageId = url.searchParams.get("packageId")?.trim() || undefined;
    const store = createAgentRunStore();
    const agentRuns = await store.list(packageId);
    return NextResponse.json({ agentRuns, count: agentRuns.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取 agent runs 失败。", detail: message }, { status: 500 });
  }
}

/**
 * Create and persist one tracked agent run.
 *
 * @param request Incoming HTTP request.
 * @returns Saved agent run snapshot.
 */
export async function POST(request: Request) {
  try {
    const parsedBody = agentRunCreateBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const remediationStore = createRemediationPackageStore();
    const packageSnapshot = await remediationStore.read(parsedBody.data.packageId);
    if (!packageSnapshot) {
      return NextResponse.json({ error: `未找到 remediation package: ${parsedBody.data.packageId}` }, { status: 404 });
    }

    const store = createAgentRunStore();
    const agentRun = buildAgentRunSnapshot(parsedBody.data);
    await store.save(agentRun);
    return NextResponse.json({ agentRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "创建 agent run 失败。", detail: message }, { status: 500 });
  }
}
