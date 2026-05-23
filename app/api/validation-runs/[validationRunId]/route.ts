import { NextResponse } from "next/server";
import { createValidationRunStore } from "@/validation";

type RouteContext = {
  params: Promise<{ validationRunId: string }>;
};

/**
 * Read one saved validation run by id.
 *
 * @param _request Incoming HTTP request.
 * @param context Dynamic route params.
 * @returns Validation run snapshot.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { validationRunId } = await context.params;
    const store = createValidationRunStore();
    const validationRun = await store.read(validationRunId);
    if (!validationRun) {
      return NextResponse.json({ error: `未找到 validation run: ${validationRunId}` }, { status: 404 });
    }
    return NextResponse.json({ validationRun });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取 validation run 失败。", detail: message }, { status: 500 });
  }
}
