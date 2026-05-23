import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { enqueueLocalJob, listLocalJobs } from "@/queue";

/**
 * List queued jobs for the current workspace.
 *
 * @param request Incoming request.
 */
export async function GET(request: Request) {
  try {
    const context = getZeroreRequestContext(request);
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    const type = url.searchParams.get("type") ?? undefined;
    const jobs = await listLocalJobs(context.workspaceId, {
      status:
        status === "queued" ||
        status === "running" ||
        status === "succeeded" ||
        status === "failed" ||
        status === "canceled"
          ? status
          : undefined,
      type,
    });
    return NextResponse.json({ jobs, count: jobs.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取异步任务失败。", detail: message }, { status: 500 });
  }
}

/**
 * Create one queued job. This is the first async-job contract; workers can
 * later consume the same queue from a separate process.
 * @param request Incoming request.
 */
export async function POST(request: Request) {
  try {
    const context = getZeroreRequestContext(request);
    const body = (await request.json()) as { type?: string; payload?: unknown; maxAttempts?: number };
    if (!body.type?.trim()) {
      return NextResponse.json({ error: "job type 缺失。" }, { status: 400 });
    }
    const job = await enqueueLocalJob({
      workspaceId: context.workspaceId,
      organizationId: context.organizationId,
      projectId: context.projectId,
      type: body.type,
      payload: body.payload ?? {},
      maxAttempts: body.maxAttempts,
    });
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "创建异步任务失败。", detail: message }, { status: 500 });
  }
}
