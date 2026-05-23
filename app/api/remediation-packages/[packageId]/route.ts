import { NextResponse } from "next/server";
import { createRemediationPackageStore } from "@/remediation";
import { remediationPackageUpdateBodySchema } from "@/schemas/remediation";

/**
 * Read one saved remediation package by id.
 *
 * @param request Incoming HTTP request.
 * @param context Route params.
 */
export async function GET(request: Request, context: { params: Promise<{ packageId: string }> }) {
  try {
    void request;
    const { packageId } = await context.params;
    const store = createRemediationPackageStore();
    const snapshot = await store.read(packageId);
    if (!snapshot) {
      return NextResponse.json({ error: "未找到对应调优包。" }, { status: 404 });
    }
    return NextResponse.json({ package: snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取调优包失败。", detail: message }, { status: 500 });
  }
}

/**
 * Update one saved remediation package gate config.
 *
 * @param request Incoming HTTP request.
 * @param context Route params.
 */
export async function PATCH(request: Request, context: { params: Promise<{ packageId: string }> }) {
  try {
    const { packageId } = await context.params;
    const parsedBody = remediationPackageUpdateBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const store = createRemediationPackageStore();
    const snapshot = await store.read(packageId);
    if (!snapshot) {
      return NextResponse.json({ error: "未找到对应调优包。" }, { status: 404 });
    }

    const nextSnapshot = {
      ...snapshot,
      acceptanceGate: {
        ...snapshot.acceptanceGate,
        replay: {
          ...snapshot.acceptanceGate.replay,
          baselineCustomerId:
            parsedBody.data.acceptanceGate.replay?.baselineCustomerId ?? snapshot.acceptanceGate.replay.baselineCustomerId ?? null,
        },
        offlineEval: {
          ...snapshot.acceptanceGate.offlineEval,
          sampleBatchId:
            parsedBody.data.acceptanceGate.offlineEval?.sampleBatchId ?? snapshot.acceptanceGate.offlineEval.sampleBatchId,
        },
      },
    };
    await store.save(nextSnapshot);
    return NextResponse.json({ package: nextSnapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "更新调优包失败。", detail: message }, { status: 500 });
  }
}
