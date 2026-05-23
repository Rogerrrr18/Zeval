import { NextResponse } from "next/server";
import { validateGoldSetLabelDraft } from "@/calibration/goldSetScaffold";
import { readGoldSetCases, saveGoldSetLabelDraft } from "@/calibration/goldSetFileStore";
import { goldSetLabelDraftSchema } from "@/schemas/calibration";

type RouteContext = {
  params: Promise<{ version: string; taskId: string }>;
};

/**
 * Save one editable label draft.
 * @param request Incoming HTTP request.
 * @param context Dynamic route params.
 */
export async function PUT(request: Request, context: RouteContext) {
  try {
    const { version, taskId } = await context.params;
    const parsedBody = goldSetLabelDraftSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsedBody.error.flatten() }, { status: 400 });
    }
    if (parsedBody.data.goldSetVersion !== version || parsedBody.data.taskId !== taskId) {
      return NextResponse.json({ error: "draft 与 URL 中的 version/taskId 不一致。" }, { status: 400 });
    }

    const draft = await saveGoldSetLabelDraft(version, parsedBody.data);
    const cases = await readGoldSetCases(version);
    const validation = validateGoldSetLabelDraft(draft, new Set(cases.map((item) => item.caseId)));
    return NextResponse.json({ draft, validation });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "保存 gold set label draft 失败。", detail: message }, { status: 500 });
  }
}
