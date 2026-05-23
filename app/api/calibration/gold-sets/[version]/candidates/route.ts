import { NextResponse } from "next/server";
import { appendGoldSetCandidate } from "@/calibration/goldSetFileStore";
import { buildGoldSetCandidateFromDatasetCase } from "@/calibration/goldSetCandidate";
import { getZeroreRequestContext } from "@/auth/context";
import { createDatasetStore } from "@/eval-datasets/storage";
import { goldSetPromoteCandidateSchema } from "@/schemas/calibration";

type RouteContext = {
  params: Promise<{ version: string }>;
};

/**
 * Promote one eval-dataset case into a gold-set annotation candidate.
 * @param request Incoming HTTP request.
 * @param context Dynamic route params.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { version } = await context.params;
    const parsedBody = goldSetPromoteCandidateSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const requestContext = getZeroreRequestContext(request);
    const store = createDatasetStore({ workspaceId: requestContext.workspaceId });
    const datasetCase = await store.getCaseById(parsedBody.data.caseId);
    if (!datasetCase) {
      return NextResponse.json({ error: `未找到 dataset case: ${parsedBody.data.caseId}` }, { status: 404 });
    }

    const candidate = buildGoldSetCandidateFromDatasetCase(datasetCase, {
      goldSetVersion: version,
      assignee: parsedBody.data.assignee,
      reviewer: parsedBody.data.reviewer,
    });
    const result = await appendGoldSetCandidate(version, candidate);

    return NextResponse.json({
      case: result.caseRecord,
      task: result.task,
      draft: result.draft,
      alreadyExists: result.alreadyExists,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "生成 gold set candidate 失败。", detail: message }, { status: 500 });
  }
}
