import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { ZEVAL_QUEUE_HANDLERS } from "@/jobs/handlers";
import { runLocalJobBatch } from "@/queue";

/**
 * Run queued jobs for the current workspace. This endpoint is intended for
 * local/dev workers; production can call the same queue adapter from a worker
 * process instead of from an HTTP route.
 *
 * @param request Incoming request.
 */
export async function POST(request: Request) {
  try {
    const context = getZeroreRequestContext(request);
    const body = (await request.json().catch(() => ({}))) as { concurrency?: number };
    const results = await runLocalJobBatch(
      context.workspaceId,
      ZEVAL_QUEUE_HANDLERS,
      body.concurrency ?? Number(process.env.ZEVAL_QUEUE_CONCURRENCY ?? process.env.ZERORE_QUEUE_CONCURRENCY ?? 1),
    );
    return NextResponse.json({ results, count: results.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "执行异步任务失败。", detail: message }, { status: 500 });
  }
}
