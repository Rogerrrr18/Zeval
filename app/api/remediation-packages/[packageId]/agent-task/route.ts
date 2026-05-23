import { NextResponse } from "next/server";
import { createRemediationPackageStore, emitRemediationAgentTask } from "@/remediation";

type RouteContext = {
  params: Promise<{ packageId: string }>;
};

/**
 * Emit one coding-agent task payload from a saved remediation package.
 *
 * @param _request Incoming HTTP request.
 * @param context Dynamic route params.
 * @returns Agent task payload.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { packageId } = await context.params;
    const store = createRemediationPackageStore();
    const packageSnapshot = await store.read(packageId);
    if (!packageSnapshot) {
      return NextResponse.json({ error: `未找到 remediation package: ${packageId}` }, { status: 404 });
    }
    const task = emitRemediationAgentTask(packageSnapshot);
    return NextResponse.json({ task });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "生成 agent task 失败。", detail: message }, { status: 500 });
  }
}
