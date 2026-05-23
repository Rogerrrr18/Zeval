import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { buildStratifiedSampleBatch } from "@/eval-datasets/sample-batch";
import { createDatasetStore } from "@/eval-datasets/storage";
import { evalDatasetCreateSampleBatchBodySchema } from "@/schemas/eval-datasets";

/**
 * List saved sample batches.
 *
 * @returns Sample batch list.
 */
export async function GET(request: Request) {
  try {
    const context = getZeroreRequestContext(request);
    const store = createDatasetStore({ workspaceId: context.workspaceId });
    const sampleBatches = await store.listSampleBatches();
    return NextResponse.json({ sampleBatches, count: sampleBatches.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取 sample batch 列表失败。", detail: message }, { status: 500 });
  }
}

/**
 * Create one stratified sample batch and persist by default.
 * @param request Incoming HTTP request.
 */
export async function POST(request: Request) {
  try {
    const parsedBody = evalDatasetCreateSampleBatchBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const body = parsedBody.data;
    const context = getZeroreRequestContext(request);
    const store = createDatasetStore({ workspaceId: context.workspaceId });
    const { record, warnings } = await buildStratifiedSampleBatch(
      {
        store,
        requestedGoodcaseCount: body.requestedGoodcaseCount,
        requestedBadcaseCount: body.requestedBadcaseCount,
        seed: body.seed,
        strategy: body.strategy,
        targetVersion: body.targetVersion,
      },
      { persist: body.persist },
    );

    return NextResponse.json({ sampleBatch: record, warnings });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "创建 sample batch 失败。", detail: message }, { status: 500 });
  }
}
