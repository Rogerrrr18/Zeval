/**
 * @fileoverview Extract session-level bad case assets from one evaluation run.
 *
 * P1 重构：已移除 topicSegmentId / topicLabel / topicSummary / emotionScore 等
 * topic/emotion 字段。groupBy 改为 session 粒度。
 */

import { computeNormalizedTranscriptHash } from "@/eval-datasets/case-transcript-hash";
import { harvestBadCases, type BadCaseSignal, type HarvestedBadCase } from "@/pipeline/badCaseHarvest";
import type {
  BadCaseAsset,
  BadCaseTag,
  EnrichedChatlogRow,
  ObjectiveMetrics,
  RecoveryTraceResult,
  SubjectiveMetrics,
} from "@/types/pipeline";

type BadCaseEvidenceRow = BadCaseAsset["evidence"][number];

/**
 * Build bad case assets from enriched rows and evaluated metrics.
 */
export function buildBadCaseAssets(
  rows: EnrichedChatlogRow[],
  objectiveMetrics: ObjectiveMetrics,
  subjectiveMetrics: SubjectiveMetrics,
  options: {
    runId: string;
    scenarioId?: string;
  },
): BadCaseAsset[] {
  const grouped = groupRowsBySession(rows);
  const harvested = new Map(
    harvestBadCases(rows, objectiveMetrics, subjectiveMetrics.signals).map((item) => [item.sessionId, item]),
  );
  const goalMap = new Map(subjectiveMetrics.goalCompletions.map((item) => [item.sessionId, item]));
  const recoveryMap = new Map(subjectiveMetrics.recoveryTraces.map((item) => [item.sessionId, item]));

  return [...grouped.entries()]
    .map(([sessionId, sessionRows]) =>
      buildSessionBadCase(
        sessionId,
        sessionRows,
        goalMap.get(sessionId),
        recoveryMap.get(sessionId),
        harvested.get(sessionId),
        options,
      ),
    )
    .filter((item): item is BadCaseAsset => item !== null)
    .sort((left, right) => right.severityScore - left.severityScore);
}

function buildSessionBadCase(
  sessionId: string,
  rows: EnrichedChatlogRow[],
  goalCompletion: SubjectiveMetrics["goalCompletions"][number] | undefined,
  recoveryTrace: RecoveryTraceResult | undefined,
  harvested: HarvestedBadCase | undefined,
  options: { runId: string; scenarioId?: string },
): BadCaseAsset | null {
  const tags = new Set<BadCaseTag>();
  const evidenceRows: BadCaseEvidenceRow[] = [];
  let severityScore = harvested?.severity ?? 0;
  const autoSignals: BadCaseSignal[] = harvested?.signals ?? [];

  if (autoSignals.some((s) => s.kind === "negative_keyword")) tags.add("understanding_barrier");
  if (autoSignals.some((s) => s.kind === "metric" && s.metric === "responseGap")) tags.add("long_response_gap");
  evidenceRows.push(...materializeAutoSignalEvidence(autoSignals, rows));

  if (goalCompletion?.status === "failed") {
    tags.add("goal_failed"); severityScore += 0.34;
    evidenceRows.push(...materializeGoalEvidence(goalCompletion, rows));
  } else if (goalCompletion?.status === "partial") {
    tags.add("goal_partial"); severityScore += 0.2;
    evidenceRows.push(...materializeGoalEvidence(goalCompletion, rows));
  } else if (goalCompletion?.status === "unclear") {
    tags.add("goal_unclear"); severityScore += 0.12;
    evidenceRows.push(...materializeGoalEvidence(goalCompletion, rows));
  }

  if (recoveryTrace?.status === "failed") {
    tags.add("recovery_failed"); severityScore += 0.24;
    evidenceRows.push(...recoveryTrace.evidence);
  }

  const repeatedQuestionRows = findRepeatedQuestionRows(rows);
  if (repeatedQuestionRows.length > 0) {
    tags.add("question_repeat"); severityScore += 0.18;
    evidenceRows.push(...repeatedQuestionRows);
  }

  const understandingRow = rows.find(
    (row) => row.role === "user" && /(什么意思|不懂|你是说|再说一遍|没明白|怎么理解)/.test(row.content),
  );
  if (understandingRow) {
    tags.add("understanding_barrier"); severityScore += 0.16;
    evidenceRows.push(understandingRow);
  }

  const escalationRow = rows.find((row) => /(转人工|投诉|主管|经理|升级专员)/.test(row.content));
  if (escalationRow) {
    tags.add("escalation_keyword"); severityScore += 0.22;
    evidenceRows.push(escalationRow);
  }

  const longGapRow = rows.find((row) => typeof row.responseGapSec === "number" && row.responseGapSec >= 60);
  if (longGapRow) {
    tags.add("long_response_gap"); severityScore += 0.1;
    evidenceRows.push(longGapRow);
  }

  if (tags.size === 0) return null;

  const orderedEvidence = uniqEvidenceRows(evidenceRows).slice(0, 4);
  const primaryEvidence = orderedEvidence[0];
  const primaryRow = (primaryEvidence ? rows.find((r) => r.turnIndex === primaryEvidence.turnIndex) : null) ?? rows[0];
  const transcript = rows.map((r) => `[turn ${r.turnIndex}] [${r.role}] ${r.content}`).join("\n");
  const normalizedTranscriptHash = computeNormalizedTranscriptHash(transcript);
  const orderedTags = [...tags].sort() as BadCaseTag[];
  const severity = clamp01(severityScore);

  return {
    caseKey: `${sessionId}_${normalizedTranscriptHash.slice(0, 10)}`,
    sessionId: primaryRow?.sessionId ?? sessionId,
    title: buildTitle(orderedTags, primaryRow?.turnIndex ?? 1, primaryRow?.content ?? ""),
    severityScore: severity,
    normalizedTranscriptHash,
    duplicateGroupKey: [options.scenarioId ?? "generic", orderedTags.join("+")].join(":"),
    tags: orderedTags,
    transcript,
    evidence: orderedEvidence,
    autoSignals,
    suggestedAction: buildSuggestedAction(orderedTags),
    sourceRunId: options.runId,
  };
}

function buildTitle(tags: BadCaseTag[], turnIndex: number, content: string): string {
  if (tags.includes("goal_failed")) return `第 ${turnIndex} 轮后目标未达成：${content.slice(0, 24)}`;
  if (tags.includes("recovery_failed")) return `第 ${turnIndex} 轮后恢复失败：${content.slice(0, 24)}`;
  if (tags.includes("escalation_keyword")) return `第 ${turnIndex} 轮出现升级风险：${content.slice(0, 24)}`;
  return `第 ${turnIndex} 轮出现失败信号：${content.slice(0, 24)}`;
}

function buildSuggestedAction(tags: BadCaseTag[]): string {
  if (tags.includes("goal_failed")) return "优先把失败 session 编译为 remediation spec，并补一键回放验证。";
  if (tags.includes("recovery_failed")) return "补充 apology + clarify + action 的恢复序列，并把失败片段加入 regression。";
  if (tags.includes("question_repeat") || tags.includes("understanding_barrier")) return "把策略改为先直接回答问题，再扩展背景，避免用户重复追问。";
  if (tags.includes("escalation_keyword")) return "增加投诉/转人工前的兜底动作和 SLA 承诺句，减少升级触发。";
  return "将该片段沉淀到 bad case 池，并纳入下一轮 sample batch 与回放对比。";
}

function materializeGoalEvidence(
  goalCompletion: SubjectiveMetrics["goalCompletions"][number],
  rows: EnrichedChatlogRow[],
): BadCaseEvidenceRow[] {
  return [...goalCompletion.failureReasons, ...goalCompletion.achievementEvidence]
    .map((ev) => rows.find((r) => ev.includes(r.content.slice(0, 20)) || r.content.includes(ev)))
    .filter((r): r is EnrichedChatlogRow => Boolean(r));
}

function findRepeatedQuestionRows(rows: EnrichedChatlogRow[]): BadCaseEvidenceRow[] {
  const questionRows = rows.filter((r) => r.role === "user" && r.isQuestion);
  const counts = new Map<string, EnrichedChatlogRow[]>();
  questionRows.forEach((r) => {
    const key = r.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 18);
    if (!key) return;
    const arr = counts.get(key) ?? [];
    arr.push(r);
    counts.set(key, arr);
  });
  return [...counts.values()].filter((items) => items.length >= 2).flatMap((items) => items.slice(0, 2));
}

function materializeAutoSignalEvidence(signals: BadCaseSignal[], rows: EnrichedChatlogRow[]): BadCaseEvidenceRow[] {
  return signals
    .map((s) => {
      if (s.kind === "negative_keyword") return rows.find((r) => r.turnIndex === s.turnIndex);
      if (s.kind === "metric" && s.metric === "responseGap") return rows.find((r) => r.responseGapSec === s.value);
      return rows.find((r) => r.role === "user");
    })
    .filter((r): r is EnrichedChatlogRow => Boolean(r))
    .map((r) => ({ turnIndex: r.turnIndex, role: r.role, content: r.content }));
}

function uniqEvidenceRows(rows: BadCaseEvidenceRow[]): BadCaseEvidenceRow[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = `${r.turnIndex}:${r.role}:${r.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((r) => ({ turnIndex: r.turnIndex, role: r.role, content: r.content }));
}

function groupRowsBySession(rows: EnrichedChatlogRow[]): Map<string, EnrichedChatlogRow[]> {
  const grouped = new Map<string, EnrichedChatlogRow[]>();
  rows.forEach((r) => {
    if (!grouped.has(r.sessionId)) grouped.set(r.sessionId, []);
    grouped.get(r.sessionId)!.push(r);
  });
  return grouped;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
