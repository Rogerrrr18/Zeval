/**
 * @fileoverview Promote dataset cases into gold-set annotation candidates.
 */

import { buildGoldSetAnnotationTasks, buildGoldSetLabelDraftTemplate } from "@/calibration/goldSetScaffold";
import type {
  GoldSetAnnotationTaskRecord,
  GoldSetCaseRecord,
  GoldSetLabelDraftRecord,
} from "@/calibration/types";
import type { DatasetCaseRecord } from "@/eval-datasets/storage/types";
import type { ChatRole, RawChatlogRow } from "@/types/pipeline";

/**
 * Convert one dataset case into a gold-set case, task and draft.
 *
 * @param datasetCase Stored eval dataset case.
 * @param options Target gold-set metadata.
 * @returns Candidate records ready to append.
 */
export function buildGoldSetCandidateFromDatasetCase(
  datasetCase: DatasetCaseRecord,
  options: {
    goldSetVersion: string;
    assignee?: string;
    reviewer?: string;
    createdAt?: string;
  },
): {
  caseRecord: GoldSetCaseRecord;
  task: GoldSetAnnotationTaskRecord;
  draft: GoldSetLabelDraftRecord;
} {
  const createdAt = options.createdAt ?? new Date().toISOString();
  const caseRecord: GoldSetCaseRecord = {
    caseId: buildGoldCaseId(datasetCase.caseId),
    sceneId: datasetCase.scenarioId ?? datasetCase.caseSetType,
    sessionId: datasetCase.sessionId,
    tags: [
      `source:${datasetCase.caseSetType}`,
      `dataset:${datasetCase.caseId}`,
      ...datasetCase.tags,
    ],
    rawRows: parseDatasetTranscript(datasetCase),
    notes: buildGoldCaseNotes(datasetCase),
  };
  const [task] = buildGoldSetAnnotationTasks([caseRecord], {
    goldSetVersion: options.goldSetVersion,
    sourceCasesPath: `eval-datasets:${datasetCase.caseId}`,
    createdAt,
    assignees: options.assignee ? [options.assignee] : undefined,
    reviewers: options.reviewer ? [options.reviewer] : undefined,
    defaultPriority: "P1",
  });
  const draft = prefillGoldSetLabelDraft(buildGoldSetLabelDraftTemplate(task!), datasetCase);

  return {
    caseRecord,
    task: task!,
    draft,
  };
}

/**
 * Prefill a label draft from deterministic dataset/badcase signals.
 * Human reviewers still need to approve the draft before import.
 *
 * @param draft Blank draft template.
 * @param datasetCase Source dataset case.
 * @returns Prefilled draft with source metadata.
 */
export function prefillGoldSetLabelDraft(
  draft: GoldSetLabelDraftRecord,
  datasetCase: DatasetCaseRecord,
): GoldSetLabelDraftRecord {
  const rows = parseDatasetTranscript(datasetCase);
  const primaryEvidence = pickPrimaryEvidence(datasetCase, rows);
  const reasons = buildPrefillReasons(datasetCase);
  const tags = new Set(datasetCase.tags);
  const hasGoalFailure = tags.has("goal_failed");
  const hasGoalPartial = tags.has("goal_partial");
  const hasRecoveryFailure = tags.has("recovery_failed");
  const hasUnderstandingBarrier = tags.has("understanding_barrier");
  const hasOffTopic = tags.has("off_topic_shift");
  const hasEscalation = tags.has("escalation_keyword");

  return {
    ...draft,
    dimensions: draft.dimensions.map((dimension) => {
      if (dimension.dimension === "共情程度") {
        return {
          ...dimension,
          score: hasEscalation || hasGoalFailure ? 3 : 4,
          evidence: primaryEvidence,
          notes: "auto-prefill：基于 badcase tags 与 transcript 初筛，请人工复核。",
        };
      }
      if (dimension.dimension === "答非所问/无视风险") {
        return {
          ...dimension,
          score: hasGoalFailure || hasUnderstandingBarrier || hasOffTopic ? 2 : hasGoalPartial ? 3 : 4,
          evidence: primaryEvidence,
          notes: "auto-prefill：目标失败/理解障碍/话题偏移会降低该维度。",
        };
      }
      if (dimension.dimension === "说教感/压迫感") {
        return {
          ...dimension,
          score: hasEscalation ? 4 : 5,
          evidence: primaryEvidence,
          notes: "auto-prefill：当前仅基于升级风险保守降分。",
        };
      }
      if (dimension.dimension === "情绪恢复能力") {
        return {
          ...dimension,
          score: hasRecoveryFailure || hasGoalFailure ? 2 : hasGoalPartial ? 3 : 4,
          evidence: primaryEvidence,
          notes: "auto-prefill：恢复失败或目标失败会降低该维度。",
        };
      }
      return dimension;
    }),
    goalCompletion: {
      status: hasGoalFailure ? "failed" : hasGoalPartial ? "partial" : "unclear",
      score: hasGoalFailure ? 1 : hasGoalPartial ? 3 : 2,
      evidence: [primaryEvidence],
    },
    recoveryTrace: {
      status: hasRecoveryFailure ? "failed" : "none",
      qualityScore: hasRecoveryFailure ? 1 : 0,
      notes: hasRecoveryFailure
        ? "auto-prefill：badcase tag 命中 recovery_failed。"
        : "auto-prefill：未命中 recovery_failed，默认无恢复轨迹；如 transcript 中存在情绪下探再恢复，请人工改为 completed。",
    },
    reviewNotes: [
      draft.reviewNotes,
      "Auto-prefill generated from deterministic badcase signals. Review required before approval.",
    ]
      .filter(Boolean)
      .join("\n"),
    autoPrefill: {
      source: `eval-datasets:${datasetCase.caseId}`,
      generatedAt: new Date().toISOString(),
      reasons,
    },
  };
}

/**
 * Build the deterministic gold-set case ID for a dataset case.
 *
 * @param datasetCaseId Dataset case ID.
 * @returns Gold-set case ID.
 */
export function buildGoldCaseId(datasetCaseId: string): string {
  return `dataset_${datasetCaseId.replace(/[^a-z0-9_-]+/gi, "_")}`;
}

/**
 * Parse the persisted dataset transcript into raw chat rows.
 *
 * @param datasetCase Dataset case.
 * @returns Raw chatlog rows.
 */
function parseDatasetTranscript(datasetCase: DatasetCaseRecord): RawChatlogRow[] {
  const transcript = datasetCase.transcript?.trim();
  if (!transcript) {
    return [
      {
        sessionId: datasetCase.sessionId,
        timestamp: datasetCase.createdAt,
        role: "user",
        content: datasetCase.topicSummary || datasetCase.title || datasetCase.caseId,
      },
    ];
  }

  const baseTimeMs = Date.parse(datasetCase.createdAt);
  const timestampBase = Number.isFinite(baseTimeMs) ? baseTimeMs : Date.now();
  return transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const parsed = parseTranscriptLine(line);
      return {
        sessionId: datasetCase.sessionId,
        timestamp: new Date(timestampBase + index * 1000).toISOString(),
        role: parsed.role,
        content: parsed.content,
      };
    });
}

/**
 * Pick the best available evidence sentence for prefilled labels.
 *
 * @param datasetCase Source dataset case.
 * @param rows Parsed transcript rows.
 * @returns Evidence text.
 */
function pickPrimaryEvidence(datasetCase: DatasetCaseRecord, rows: RawChatlogRow[]): string {
  const escalationRow = rows.find((row) => /(投诉|转人工|主管|经理|升级专员|别套话)/.test(row.content));
  if (escalationRow) {
    return escalationRow.content;
  }
  const userRiskRow = rows.find((row) => row.role === "user");
  return userRiskRow?.content ?? datasetCase.title ?? datasetCase.topicSummary ?? datasetCase.caseId;
}

/**
 * Explain why prefill values were chosen.
 *
 * @param datasetCase Source dataset case.
 * @returns Reviewer-facing reasons.
 */
function buildPrefillReasons(datasetCase: DatasetCaseRecord): string[] {
  const reasons = [
    `baselineCaseScore=${datasetCase.baselineCaseScore}`,
    typeof datasetCase.failureSeverityScore === "number" ? `failureSeverityScore=${datasetCase.failureSeverityScore}` : "",
    datasetCase.tags.length > 0 ? `tags=${datasetCase.tags.join(",")}` : "",
  ].filter(Boolean);
  if (datasetCase.suggestedAction) {
    reasons.push(`suggestedAction=${datasetCase.suggestedAction}`);
  }
  return reasons;
}

/**
 * Parse one `[turn n] [role] content` line, with a fallback for legacy text.
 *
 * @param line Transcript line.
 * @returns Role and content.
 */
function parseTranscriptLine(line: string): { role: ChatRole; content: string } {
  const matched = line.match(/^\[turn\s+\d+\]\s+\[(user|assistant|system)\]\s*(.*)$/i);
  if (!matched) {
    return { role: "user", content: line };
  }
  return {
    role: matched[1]!.toLowerCase() as ChatRole,
    content: matched[2]?.trim() || line,
  };
}

/**
 * Build reviewer-facing case notes from dataset metadata.
 *
 * @param datasetCase Dataset case.
 * @returns Notes string.
 */
function buildGoldCaseNotes(datasetCase: DatasetCaseRecord): string {
  return [
    `Promoted from eval dataset case ${datasetCase.caseId}.`,
    datasetCase.title ? `Title: ${datasetCase.title}` : "",
    datasetCase.suggestedAction ? `Suggested action: ${datasetCase.suggestedAction}` : "",
    `Baseline score: ${datasetCase.baselineCaseScore}.`,
    typeof datasetCase.failureSeverityScore === "number"
      ? `Failure severity: ${datasetCase.failureSeverityScore}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
