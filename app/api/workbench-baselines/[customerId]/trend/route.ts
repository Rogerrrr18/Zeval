import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { listRecentEvaluateRunTrends } from "@/persistence/evaluateRunStore";
import { createWorkbenchBaselineStore } from "@/workbench";

type RouteContext = {
  params: Promise<{ customerId: string }>;
};

/**
 * Return recent evaluate run trend points for one baseline customer.
 *
 * @param request Incoming request.
 * @param context Route params.
 * @returns Trend point response.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const requestContext = getZeroreRequestContext(request);
    const { customerId } = await context.params;
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 8);
    const decodedCustomerId = decodeURIComponent(customerId);
    const store = createWorkbenchBaselineStore({ workspaceId: requestContext.workspaceId });
    const points = await listRecentEvaluateRunTrends(store, decodedCustomerId, limit);
    return NextResponse.json({ customerId: decodedCustomerId, points, count: points.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取基线趋势失败。", detail: message }, { status: 500 });
  }
}

