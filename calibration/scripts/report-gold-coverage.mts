import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as calibrationJsonl from "../../src/calibration/jsonl.ts";
import * as calibrationPaths from "../../src/calibration/paths.ts";
import * as goldSetFileStore from "../../src/calibration/goldSetFileStore.ts";
import type {
  GoldSetAnnotationTaskRecord,
  GoldSetCaseRecord,
  GoldSetLabelDraftRecord,
  GoldSetLabelRecord,
} from "../../src/calibration/types.ts";

const calibrationJsonlApi = resolveInteropModule(calibrationJsonl);
const calibrationPathsApi = resolveInteropModule(calibrationPaths);
const goldSetFileStoreApi = resolveInteropModule(goldSetFileStore);

const DEFAULT_TARGET_CASES = 80;
const MIN_APPROVED_RATIO = 0.8;

void main().catch((error) => {
  console.error("[gold:coverage] failed", error);
  process.exitCode = 1;
});

/**
 * Generate a coverage and readiness report for one gold-set version.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const version = getFlagValue(args, "--version") ?? "v2";
  const targetCases = Number(getFlagValue(args, "--target-cases") ?? String(DEFAULT_TARGET_CASES));
  const outputPath = path.resolve(
    getFlagValue(args, "--out") ??
      calibrationPathsApi.resolveCalibrationPath("gold-sets", version, "coverage-report.md"),
  );

  const [cases, tasks, drafts, labels] = await Promise.all([
    goldSetFileStoreApi.readGoldSetCases(version),
    goldSetFileStoreApi.readGoldSetAnnotationTasks(version),
    goldSetFileStoreApi.readGoldSetLabelDrafts(version),
    readOptionalLabels(version),
  ]);
  const report = renderCoverageReport({
    version,
    targetCases,
    generatedAt: new Date().toISOString(),
    cases,
    tasks,
    drafts,
    labels,
  });

  await writeFile(outputPath, report, "utf8");
  console.info(`[gold:coverage] version=${version} cases=${cases.length} labels=${labels.length} output=${outputPath}`);
}

type CoverageReportInput = {
  version: string;
  targetCases: number;
  generatedAt: string;
  cases: GoldSetCaseRecord[];
  tasks: GoldSetAnnotationTaskRecord[];
  drafts: GoldSetLabelDraftRecord[];
  labels: GoldSetLabelRecord[];
};

/**
 * Render one markdown coverage report.
 *
 * @param input Report input.
 * @returns Markdown report.
 */
function renderCoverageReport(input: CoverageReportInput): string {
  const approvedDrafts = input.drafts.filter((item) => item.reviewStatus === "approved");
  const importedLabelIds = new Set(input.labels.map((item) => item.caseId));
  const importedDrafts = input.drafts.filter((item) => importedLabelIds.has(item.caseId));
  const targetApproved = Math.ceil(input.targetCases * MIN_APPROVED_RATIO);
  const caseGap = Math.max(0, input.targetCases - input.cases.length);
  const approvedGap = Math.max(0, targetApproved - approvedDrafts.length);
  const scenes = countBy(input.cases, (item) => item.sceneId);
  const tags = countBy(
    input.cases.flatMap((item) => item.tags),
    (tag) => tag,
  );
  const statuses = countBy(input.tasks, (item) => item.status);
  const draftStatuses = countBy(input.drafts, (item) => item.reviewStatus);
  const labelerLoad = countBy(input.drafts, (item) => item.labeler?.trim() || "unassigned");
  const reviewerLoad = countBy(input.drafts, (item) => item.reviewer?.trim() || "unassigned");
  const emptyEvidenceCount = input.drafts.filter((draft) => hasEmptyEvidence(draft)).length;

  const lines = [
    `# Gold Set ${input.version.toUpperCase()} Coverage Report`,
    "",
    `- Generated At: ${input.generatedAt}`,
    `- Target Cases: ${input.targetCases}`,
    `- Candidate Cases: ${input.cases.length}`,
    `- Annotation Tasks: ${input.tasks.length}`,
    `- Label Drafts: ${input.drafts.length}`,
    `- Approved Drafts: ${approvedDrafts.length}`,
    `- Imported Labels: ${input.labels.length}`,
    `- Candidate Gap: ${caseGap}`,
    `- Approved Label Gap: ${approvedGap}`,
    "",
    "## Readiness",
    "",
    readinessLine("Candidate pool", input.cases.length >= input.targetCases, `${input.cases.length}/${input.targetCases}`),
    readinessLine("Approved labels", approvedDrafts.length >= targetApproved, `${approvedDrafts.length}/${targetApproved}`),
    readinessLine("Imported labels", input.labels.length === approvedDrafts.length, `${input.labels.length}/${approvedDrafts.length}`),
    readinessLine("Draft evidence", emptyEvidenceCount === 0, `${emptyEvidenceCount} drafts with missing evidence`),
    "",
    "## Scene Coverage",
    "",
    renderCountTable("Scene", scenes),
    "",
    "## Tag Coverage",
    "",
    renderCountTable("Tag", tags.slice(0, 30)),
    "",
    "## Workflow Status",
    "",
    renderStatusTable(statuses, draftStatuses),
    "",
    "## Assignment Load",
    "",
    "### Labelers",
    "",
    renderCountTable("Labeler", labelerLoad),
    "",
    "### Reviewers",
    "",
    renderCountTable("Reviewer", reviewerLoad),
    "",
    "## Recommended Next Sampling",
    "",
    ...buildRecommendations({
      caseGap,
      approvedGap,
      scenes,
      importedDraftCount: importedDrafts.length,
      emptyEvidenceCount,
    }).map((item) => `- ${item}`),
    "",
  ];

  return `${lines.join("\n").trim()}\n`;
}

/**
 * Read labels when they exist; return empty list before first import.
 *
 * @param version Gold-set version.
 * @returns Imported labels.
 */
async function readOptionalLabels(version: string): Promise<GoldSetLabelRecord[]> {
  try {
    return await calibrationJsonlApi.readJsonlFile<GoldSetLabelRecord>(
      calibrationPathsApi.resolveCalibrationPath("gold-sets", version, "labels.jsonl"),
    );
  } catch {
    return [];
  }
}

/**
 * Count rows by one key.
 *
 * @param rows Source rows.
 * @param getKey Key selector.
 * @returns Sorted counts.
 */
function countBy<T>(rows: T[], getKey: (item: T) => string): Array<{ key: string; count: number }> {
  const counts = new Map<string, number>();
  rows.forEach((item) => {
    const key = getKey(item);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((left, right) => right.count - left.count || left.key.localeCompare(right.key));
}

/**
 * Render a compact readiness row.
 *
 * @param label Check label.
 * @param passed Whether the check passed.
 * @param detail Detail text.
 * @returns Markdown bullet.
 */
function readinessLine(label: string, passed: boolean, detail: string): string {
  return `- ${label}: ${passed ? "pass" : "needs work"} (${detail})`;
}

/**
 * Render a count table.
 *
 * @param label First-column label.
 * @param rows Count rows.
 * @returns Markdown table.
 */
function renderCountTable(label: string, rows: Array<{ key: string; count: number }>): string {
  if (rows.length === 0) {
    return "_No rows._";
  }
  return [
    `| ${label} | Count |`,
    "|---|---:|",
    ...rows.map((item) => `| ${item.key} | ${item.count} |`),
  ].join("\n");
}

/**
 * Render task/draft status counts side by side.
 *
 * @param taskStatuses Task status counts.
 * @param draftStatuses Draft status counts.
 * @returns Markdown table.
 */
function renderStatusTable(
  taskStatuses: Array<{ key: string; count: number }>,
  draftStatuses: Array<{ key: string; count: number }>,
): string {
  const keys = [...new Set([...taskStatuses.map((item) => item.key), ...draftStatuses.map((item) => item.key)])].sort();
  return [
    "| Status | Tasks | Drafts |",
    "|---|---:|---:|",
    ...keys.map((key) => {
      const taskCount = taskStatuses.find((item) => item.key === key)?.count ?? 0;
      const draftCount = draftStatuses.find((item) => item.key === key)?.count ?? 0;
      return `| ${key} | ${taskCount} | ${draftCount} |`;
    }),
  ].join("\n");
}

/**
 * Detect drafts that cannot be imported because evidence is missing.
 *
 * @param draft Label draft.
 * @returns Whether evidence is incomplete.
 */
function hasEmptyEvidence(draft: GoldSetLabelDraftRecord): boolean {
  return (
    draft.dimensions.some((item) => !item.evidence?.trim()) ||
    draft.goalCompletion.evidence.length === 0 ||
    draft.goalCompletion.evidence.some((item) => !item.trim())
  );
}

/**
 * Build actionable sampling recommendations.
 *
 * @param input Coverage summary.
 * @returns Recommendation lines.
 */
function buildRecommendations(input: {
  caseGap: number;
  approvedGap: number;
  scenes: Array<{ key: string; count: number }>;
  importedDraftCount: number;
  emptyEvidenceCount: number;
}): string[] {
  const recommendations: string[] = [];
  if (input.caseGap > 0) {
    recommendations.push(`Add ${input.caseGap} more candidate cases before claiming an 80-case calibration baseline.`);
  }
  if (input.approvedGap > 0) {
    recommendations.push(`Approve ${input.approvedGap} more reviewed label drafts before agreement metrics are decision-grade.`);
  }
  if (input.importedDraftCount === 0) {
    recommendations.push("Run the import step after approvals so agreement scripts read canonical labels.jsonl instead of drafts.");
  }
  if (input.emptyEvidenceCount > 0) {
    recommendations.push(`Fill evidence in ${input.emptyEvidenceCount} drafts; evidence is the import gate that prevents weak labels.`);
  }
  const lowestScenes = input.scenes.slice().sort((left, right) => left.count - right.count).slice(0, 3);
  if (lowestScenes.length > 0) {
    recommendations.push(`Prioritize under-covered scenes: ${lowestScenes.map((item) => `${item.key} (${item.count})`).join(", ")}.`);
  }
  return recommendations.length > 0 ? recommendations : ["Coverage is sufficient for the configured target."];
}

/**
 * Read one optional CLI flag value.
 *
 * @param args Raw CLI args.
 * @param flag Flag name.
 * @returns Flag value when present.
 */
function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

/**
 * Normalize tsx loader interop.
 *
 * @param module Imported module namespace.
 * @returns Stable module surface.
 */
function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}
