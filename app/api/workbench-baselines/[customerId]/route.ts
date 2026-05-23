import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { createWorkbenchBaselineStore } from "@/workbench";

type RouteContext = {
  params: Promise<{ customerId: string }>;
};

/**
 * List baseline snapshots for one customer id.
 * @param _request Request.
 * @param context Route params.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const requestContext = getZeroreRequestContext(request);
    const { customerId } = await context.params;
    const store = createWorkbenchBaselineStore({ workspaceId: requestContext.workspaceId });
    const baselines = await store.list(decodeURIComponent(customerId));
    return NextResponse.json({ customerId: decodeURIComponent(customerId), baselines });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "列出基线失败。", detail: message }, { status: 500 });
  }
}
