import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { cancelLocalJob, readLocalJob, retryLocalJob } from "@/queue";

/**
 * Read one queued job for the current workspace.
 *
 * @param request Incoming request.
 * @param context Route params.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const requestContext = getZeroreRequestContext(request);
    const { jobId } = await context.params;
    const job = await readLocalJob(requestContext.workspaceId, jobId);
    if (!job) {
      return NextResponse.json({ error: `未找到 job: ${jobId}` }, { status: 404 });
    }
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取异步任务失败。", detail: message }, { status: 500 });
  }
}

/**
 * Mutate a queued job. Supported actions: cancel, retry.
 *
 * @param request Incoming request.
 * @param context Route params.
 */
export async function PATCH(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const requestContext = getZeroreRequestContext(request);
    const { jobId } = await context.params;
    const body = (await request.json()) as { action?: string };
    const job =
      body.action === "cancel"
        ? await cancelLocalJob(requestContext.workspaceId, jobId)
        : body.action === "retry"
          ? await retryLocalJob(requestContext.workspaceId, jobId)
          : null;
    if (!job) {
      return NextResponse.json({ error: body.action ? `未找到 job: ${jobId}` : "不支持的 job action。" }, { status: body.action ? 404 : 400 });
    }
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "更新异步任务失败。", detail: message }, { status: 500 });
  }
}
