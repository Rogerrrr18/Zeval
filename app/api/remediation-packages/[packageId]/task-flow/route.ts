import { NextResponse } from "next/server";
import { createAgentRunStore } from "@/agent-runs";
import { createRemediationPackageStore, emitRemediationTaskFlowDraft } from "@/remediation";
import { createValidationRunStore } from "@/validation";

type RouteContext = {
  params: Promise<{ packageId: string }>;
};

/**
 * Emit issue/PR/task-flow drafts from a saved remediation package.
 *
 * @param _request Incoming HTTP request.
 * @param context Dynamic route params.
 * @returns Task-flow draft bundle.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { packageId } = await context.params;
    const remediationStore = createRemediationPackageStore();
    const packageSnapshot = await remediationStore.read(packageId);
    if (!packageSnapshot) {
      return NextResponse.json({ error: `未找到 remediation package: ${packageId}` }, { status: 404 });
    }

    const agentRunStore = createAgentRunStore();
    const validationStore = createValidationRunStore();
    const [agentRuns, validationRuns] = await Promise.all([agentRunStore.list(packageId), validationStore.list(packageId)]);
    const latestReplayIndex = validationRuns.find((item) => item.mode === "replay");
    const latestOfflineIndex = validationRuns.find((item) => item.mode === "offline_eval");
    const [latestReplayValidation, latestOfflineValidation] = await Promise.all([
      latestReplayIndex ? validationStore.read(latestReplayIndex.validationRunId) : Promise.resolve(null),
      latestOfflineIndex ? validationStore.read(latestOfflineIndex.validationRunId) : Promise.resolve(null),
    ]);

    const draft = emitRemediationTaskFlowDraft({
      packageSnapshot,
      agentRuns,
      validationRuns,
      latestReplayValidation,
      latestOfflineValidation,
    });
    return NextResponse.json({ draft });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "生成 task-flow draft 失败。", detail: message }, { status: 500 });
  }
}
