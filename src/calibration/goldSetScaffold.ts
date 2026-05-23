/**
 * @fileoverview Gold-set v2 annotation scaffolding and import validation.
 */

import type {
  GoldSetAnnotationTaskRecord,
  GoldSetCaseRecord,
  GoldSetLabelDraftRecord,
  GoldSetLabelRecord,
  GoldSetReviewStatus,
} from "./types";
import type { GoalCompletionStatus, RecoveryTraceResult } from "../types/pipeline";

export const REQUIRED_GOLD_DIMENSIONS = ["共情程度", "答非所问/无视风险", "说教感/压迫感", "情绪恢复能力"] as const;

const GOAL_COMPLETION_STATUSES: GoalCompletionStatus[] = ["achieved", "partial", "failed", "unclear"];
const RECOVERY_TRACE_STATUSES: Array<RecoveryTraceResult["status"]> = ["none", "completed", "failed"];

export type BuildGoldSetScaffoldOptions = {
  goldSetVersion: string;
  sourceCasesPath: string;
  createdAt?: string;
  assignees?: string[];
  reviewers?: string[];
  defaultPriority?: GoldSetAnnotationTaskRecord["priority"];
};

export type GoldSetDraftValidationResult = {
  caseId: string;
  taskId?: string;
  reviewStatus?: GoldSetReviewStatus;
  importable: boolean;
  errors: string[];
  warnings: string[];
};

export type GoldSetImportResult = {
  labels: GoldSetLabelRecord[];
  validations: GoldSetDraftValidationResult[];
  importedCount: number;
  skippedCount: number;
  failedCount: number;
  generatedAt: string;
};

/**
 * Build assignable annotation tasks from gold-set cases.
 *
 * @param cases Gold-set case records.
 * @param options Scaffold options.
 * @returns Task records ready for `annotation-tasks.jsonl`.
 */
export function buildGoldSetAnnotationTasks(
  cases: GoldSetCaseRecord[],
  options: BuildGoldSetScaffoldOptions,
): GoldSetAnnotationTaskRecord[] {
  const createdAt = options.createdAt ?? new Date().toISOString();
  return cases.map((item, index) => {
    const taskId = `${options.goldSetVersion}_${sanitizeTaskPart(item.caseId)}_label`;
    return {
      taskId,
      goldSetVersion: options.goldSetVersion,
      caseId: item.caseId,
      sceneId: item.sceneId,
      sessionId: item.sessionId,
      tags: item.tags,
      priority: options.defaultPriority ?? "P1",
      status: "draft",
      assignee: pickRoundRobin(options.assignees, index),
      reviewer: pickRoundRobin(options.reviewers, index),
      sourceCasesPath: options.sourceCasesPath,
      labelDraftPath: `calibration/gold-sets/${options.goldSetVersion}/label-drafts/${taskId}.json`,
      transcriptPreview: item.rawRows.map((row, rowIndex) => `${rowIndex + 1}. ${row.role}: ${row.content}`),
      checklist: {
        hasRawRows: item.rawRows.length > 0,
        hasNotes: Boolean(item.notes?.trim()),
        messageCount: item.rawRows.length,
        userMessageCount: item.rawRows.filter((row) => row.role === "user").length,
        assistantMessageCount: item.rawRows.filter((row) => row.role === "assistant").length,
      },
      createdAt,
      updatedAt: createdAt,
    };
  });
}

/**
 * Build one editable label draft template from a task.
 *
 * @param task Annotation task.
 * @returns Draft record with null placeholders.
 */
export function buildGoldSetLabelDraftTemplate(task: GoldSetAnnotationTaskRecord): GoldSetLabelDraftRecord {
  return {
    taskId: task.taskId,
    goldSetVersion: task.goldSetVersion,
    caseId: task.caseId,
    reviewStatus: "draft",
    dimensions: REQUIRED_GOLD_DIMENSIONS.map((dimension) => ({
      dimension,
      score: null,
      evidence: "",
      notes: "",
    })),
    goalCompletion: {
      status: null,
      score: null,
      evidence: [],
    },
    recoveryTrace: {
      status: null,
      qualityScore: null,
      notes: "",
    },
    labeler: task.assignee,
    reviewer: task.reviewer,
    reviewedAt: "",
    reviewNotes: "",
  };
}

/**
 * Validate label drafts and import approved rows into calibration labels.
 *
 * @param cases Source case records.
 * @param drafts Human label drafts.
 * @param generatedAt Import timestamp.
 * @returns Import result with labels and per-draft validation details.
 */
export function importApprovedGoldSetLabels(
  cases: GoldSetCaseRecord[],
  drafts: GoldSetLabelDraftRecord[],
  generatedAt: string = new Date().toISOString(),
): GoldSetImportResult {
  const caseIds = new Set(cases.map((item) => item.caseId));
  const validations = drafts.map((draft) => validateGoldSetLabelDraft(draft, caseIds));
  const labels = drafts
    .map((draft, index) => ({ draft, validation: validations[index] }))
    .filter((item): item is { draft: ImportableGoldSetLabelDraftRecord; validation: GoldSetDraftValidationResult } =>
      item.validation.importable,
    )
    .map(({ draft }) => toGoldSetLabelRecord(draft, generatedAt));

  return {
    labels,
    validations,
    importedCount: labels.length,
    skippedCount: validations.filter((item) => item.reviewStatus !== "approved").length,
    failedCount: validations.filter((item) => item.reviewStatus === "approved" && item.errors.length > 0).length,
    generatedAt,
  };
}

/**
 * Validate one draft against the import gate.
 *
 * @param draft Label draft.
 * @param caseIds Known case IDs.
 * @returns Validation result.
 */
export function validateGoldSetLabelDraft(
  draft: GoldSetLabelDraftRecord,
  caseIds: Set<string>,
): GoldSetDraftValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const reviewStatus = draft.reviewStatus;

  if (!caseIds.has(draft.caseId)) {
    errors.push(`caseId 不存在于 cases.jsonl: ${draft.caseId}`);
  }
  if (reviewStatus !== "approved") {
    warnings.push(`reviewStatus=${reviewStatus}，跳过导入。`);
  }
  if (!draft.labeler?.trim()) {
    errors.push("labeler 缺失。");
  }
  if (!draft.reviewer?.trim()) {
    errors.push("reviewer 缺失。");
  }
  if (!draft.reviewedAt?.trim()) {
    errors.push("reviewedAt 缺失。");
  }
  validateDimensions(draft, errors);
  validateGoalCompletion(draft, errors);
  validateRecoveryTrace(draft, errors);

  return {
    caseId: draft.caseId,
    taskId: draft.taskId,
    reviewStatus,
    importable: reviewStatus === "approved" && errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Render a human-readable import report.
 *
 * @param result Import result.
 * @returns Markdown report.
 */
export function renderGoldSetImportReport(result: GoldSetImportResult): string {
  const lines = [
    "# Gold Set Label Import Report",
    "",
    `- Generated At: ${result.generatedAt}`,
    `- Imported: ${result.importedCount}`,
    `- Skipped: ${result.skippedCount}`,
    `- Failed: ${result.failedCount}`,
    "",
    "## Draft Checks",
    "",
  ];

  for (const item of result.validations) {
    const status = item.importable ? "imported" : item.reviewStatus === "approved" ? "blocked" : "skipped";
    lines.push(`### ${item.caseId}`);
    lines.push(`- Task: ${item.taskId ?? "--"}`);
    lines.push(`- Review Status: ${item.reviewStatus ?? "--"}`);
    lines.push(`- Import Status: ${status}`);
    if (item.errors.length > 0) {
      lines.push(`- Errors: ${item.errors.join(" | ")}`);
    }
    if (item.warnings.length > 0) {
      lines.push(`- Warnings: ${item.warnings.join(" | ")}`);
    }
    lines.push("");
  }

  return `${lines.join("\n").trim()}\n`;
}

type ImportableGoldSetLabelDraftRecord = GoldSetLabelDraftRecord & {
  dimensions: Array<{
    dimension: string;
    score: number;
    evidence: string;
    notes?: string;
  }>;
  goalCompletion: {
    status: GoalCompletionStatus;
    score: number;
    evidence: string[];
  };
  recoveryTrace: {
    status: RecoveryTraceResult["status"];
    qualityScore: number;
    notes?: string;
  };
  labeler: string;
  reviewedAt: string;
};

/**
 * Convert an importable draft into the stable labels.jsonl contract.
 *
 * @param draft Validated approved draft.
 * @param generatedAt Fallback review timestamp.
 * @returns Gold-set label record.
 */
function toGoldSetLabelRecord(draft: ImportableGoldSetLabelDraftRecord, generatedAt: string): GoldSetLabelRecord {
  return {
    caseId: draft.caseId,
    dimensions: draft.dimensions.map((item) => ({
      dimension: item.dimension,
      score: item.score as number,
      evidence: item.evidence ?? "",
      notes: item.notes,
    })),
    goalCompletion: draft.goalCompletion,
    recoveryTrace: draft.recoveryTrace,
    labeler: draft.labeler,
    reviewedAt: draft.reviewedAt || generatedAt,
  };
}

/**
 * Validate all required subjective dimensions.
 *
 * @param draft Label draft.
 * @param errors Mutable error accumulator.
 */
function validateDimensions(draft: GoldSetLabelDraftRecord, errors: string[]): void {
  for (const dimension of REQUIRED_GOLD_DIMENSIONS) {
    const label = draft.dimensions.find((item) => item.dimension === dimension);
    if (!label) {
      errors.push(`dimension 缺失: ${dimension}`);
      continue;
    }
    if (!isScore(label.score, 1, 5)) {
      errors.push(`dimension=${dimension} score 需为 1-5。`);
    }
    if (!label.evidence?.trim()) {
      errors.push(`dimension=${dimension} evidence 缺失。`);
    }
  }
}

/**
 * Validate goal-completion labels.
 *
 * @param draft Label draft.
 * @param errors Mutable error accumulator.
 */
function validateGoalCompletion(draft: GoldSetLabelDraftRecord, errors: string[]): void {
  if (!draft.goalCompletion.status || !GOAL_COMPLETION_STATUSES.includes(draft.goalCompletion.status)) {
    errors.push("goalCompletion.status 需为 achieved / partial / failed / unclear。");
  }
  if (!isScore(draft.goalCompletion.score, 0, 5)) {
    errors.push("goalCompletion.score 需为 0-5。");
  }
  if (draft.goalCompletion.evidence.length === 0 || draft.goalCompletion.evidence.some((item) => !item.trim())) {
    errors.push("goalCompletion.evidence 至少需要 1 条非空证据。");
  }
}

/**
 * Validate recovery-trace labels.
 *
 * @param draft Label draft.
 * @param errors Mutable error accumulator.
 */
function validateRecoveryTrace(draft: GoldSetLabelDraftRecord, errors: string[]): void {
  if (!draft.recoveryTrace.status || !RECOVERY_TRACE_STATUSES.includes(draft.recoveryTrace.status)) {
    errors.push("recoveryTrace.status 需为 none / completed / failed。");
  }
  if (!isScore(draft.recoveryTrace.qualityScore, 0, 5)) {
    errors.push("recoveryTrace.qualityScore 需为 0-5。");
  }
  if (draft.recoveryTrace.status === "none" && draft.recoveryTrace.qualityScore !== 0) {
    errors.push("recoveryTrace.status=none 时 qualityScore 需为 0。");
  }
}

/**
 * Pick a round-robin owner from an optional roster.
 *
 * @param values Roster values.
 * @param index Case index.
 * @returns Owner or undefined.
 */
function pickRoundRobin(values: string[] | undefined, index: number): string | undefined {
  const cleaned = values?.map((item) => item.trim()).filter(Boolean) ?? [];
  if (cleaned.length === 0) {
    return undefined;
  }
  return cleaned[index % cleaned.length];
}

/**
 * Check whether a value is a finite score in range.
 *
 * @param value Candidate score.
 * @param min Minimum score.
 * @param max Maximum score.
 * @returns True when valid.
 */
function isScore(value: number | null | undefined, min: number, max: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
}

/**
 * Sanitize one task ID component.
 *
 * @param value Raw ID segment.
 * @returns File-safe segment.
 */
function sanitizeTaskPart(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "case";
}
