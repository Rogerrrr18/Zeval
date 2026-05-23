import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { createWorkbenchBaselineStore } from "@/workbench";

type RouteContext = {
  params: Promise<{ customerId: string; runId: string }>;
};

/**
 * Read one baseline snapshot JSON.
 * @param _request Request.
 * @param context Route params.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const requestContext = getZeroreRequestContext(request);
    const { customerId, runId } = await context.params;
    const decodedCustomer = decodeURIComponent(customerId);
    const decodedRun = decodeURIComponent(runId);
    const store = createWorkbenchBaselineStore({ workspaceId: requestContext.workspaceId });
    const snapshot = await store.read(decodedCustomer, decodedRun);
    if (!snapshot) {
      return NextResponse.json({ error: "未找到基线快照。" }, { status: 404 });
    }
    return NextResponse.json({ snapshot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取基线失败。", detail: message }, { status: 500 });
  }
}
