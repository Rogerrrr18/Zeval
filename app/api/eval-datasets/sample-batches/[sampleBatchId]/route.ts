import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { createDatasetStore } from "@/eval-datasets/storage";

type RouteContext = {
  params: Promise<{ sampleBatchId: string }>;
};

/**
 * Read one persisted sample batch JSON.
 * @param _request Incoming HTTP request.
 * @param context Dynamic route params.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const requestContext = getZeroreRequestContext(request);
    const { sampleBatchId } = await context.params;
    const store = createDatasetStore({ workspaceId: requestContext.workspaceId });
    const sampleBatch = await store.getSampleBatch(sampleBatchId);
    if (!sampleBatch) {
      return NextResponse.json({ error: `未找到 sample batch: ${sampleBatchId}` }, { status: 404 });
    }
    return NextResponse.json({ sampleBatch });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取 sample batch 失败。", detail: message }, { status: 500 });
  }
}
