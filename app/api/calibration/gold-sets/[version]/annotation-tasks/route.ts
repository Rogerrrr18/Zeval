import { NextResponse } from "next/server";
import {
  importApprovedGoldSetLabels,
  renderGoldSetImportReport,
  validateGoldSetLabelDraft,
} from "@/calibration/goldSetScaffold";
import {
  readGoldSetAnnotationTasks,
  readGoldSetCases,
  readGoldSetLabelDrafts,
  writeGoldSetImportArtifacts,
} from "@/calibration/goldSetFileStore";

type RouteContext = {
  params: Promise<{ version: string }>;
};

/**
 * List annotation tasks with their current drafts and validation state.
 * @param _request Incoming HTTP request.
 * @param context Dynamic route params.
 */
export async function GET(_request: Request, context: RouteContext) {
  try {
    const { version } = await context.params;
    const [cases, tasks, drafts] = await Promise.all([
      readGoldSetCases(version),
      readGoldSetAnnotationTasks(version),
      readGoldSetLabelDrafts(version),
    ]);
    const caseIds = new Set(cases.map((item) => item.caseId));
    const validations = drafts.map((draft) => validateGoldSetLabelDraft(draft, caseIds));
    return NextResponse.json({
      version,
      cases,
      tasks,
      drafts,
      validations,
      stats: buildAnnotationStats(tasks, validations),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取 gold set 标注任务失败。", detail: message }, { status: 500 });
  }
}

/**
 * Import approved drafts into canonical labels.jsonl.
 * @param _request Incoming HTTP request.
 * @param context Dynamic route params.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const { version } = await context.params;
    const [cases, drafts] = await Promise.all([readGoldSetCases(version), readGoldSetLabelDrafts(version)]);
    const result = importApprovedGoldSetLabels(cases, drafts);
    await writeGoldSetImportArtifacts(version, result.labels, renderGoldSetImportReport(result));

    if (result.importedCount === 0) {
      return NextResponse.json({ error: "没有可导入的 approved label draft。", result }, { status: 409 });
    }

    return NextResponse.json({ result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "导入 gold set 标签失败。", detail: message }, { status: 500 });
  }
}

/**
 * Summarize task progress for the annotation console.
 * @param tasks Annotation tasks.
 * @param validations Per-draft validation results.
 * @returns Counts by status.
 */
function buildAnnotationStats(
  tasks: Array<{ status: string }>,
  validations: Array<{ importable: boolean; errors: string[] }>,
) {
  const statusCounts = tasks.reduce<Record<string, number>>((acc, task) => {
    acc[task.status] = (acc[task.status] ?? 0) + 1;
    return acc;
  }, {});
  return {
    totalTasks: tasks.length,
    approvedImportable: validations.filter((item) => item.importable).length,
    blockedApproved: validations.filter((item) => !item.importable && item.errors.length > 0).length,
    statusCounts,
  };
}
