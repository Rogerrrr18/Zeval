/**
 * @fileoverview Deterministic objective metric aggregation.
 *
 * P1 重构：已移除 topicSwitchRate（依赖 topicSegmentId）。
 */

import type { EnrichedChatlogRow, ObjectiveMetrics } from "@/types/pipeline";

/**
 * Build objective metrics from enriched rows.
 * @param rows Enriched rows.
 * @returns Objective metric summary.
 */
export function buildObjectiveMetrics(rows: EnrichedChatlogRow[]): ObjectiveMetrics {
  const sessionGroups = [...groupRowsBySession(rows).values()];
  const sessionDepthDistribution = sessionGroups.reduce<Record<string, number>>(
    (acc, sessionRows) => {
      const maxTurn = Math.max(...sessionRows.map((row) => row.turnIndex));
      const bucket = maxTurn <= 3 ? "1-3" : maxTurn <= 8 ? "4-8" : "9+";
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    },
    {},
  );

  const dropoffTurnDistribution = rows
    .filter((row) => row.isDropoffTurn)
    .reduce<Record<string, number>>((acc, row) => {
      const key = String(row.turnIndex);
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});

  const gapRows = rows
    .map((row) => row.responseGapSec)
    .filter((gap): gap is number => typeof gap === "number");
  const avgResponseGapSec = gapRows.length
    ? Number((gapRows.reduce((sum, gap) => sum + gap, 0) / gapRows.length).toFixed(2))
    : 0;

  const activeHourDistribution = rows.reduce<Record<string, number>>((acc, row) => {
    const key = row.activeHour === null ? "unknown" : String(row.activeHour);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const userRows = rows.filter((row) => row.role === "user");
  const assistantRows = rows.filter((row) => row.role === "assistant");

  return {
    sessionDepthDistribution,
    dropoffTurnDistribution,
    avgResponseGapSec,
    userQuestionRepeatRate: buildUserQuestionRepeatRate(sessionGroups),
    agentResolutionSignalRate: buildAgentResolutionSignalRate(sessionGroups),
    escalationKeywordHitRate: buildEscalationKeywordHitRate(sessionGroups),
    activeHourDistribution,
    userQuestionRate: userRows.length
      ? Number((userRows.filter((row) => row.isQuestion).length / userRows.length).toFixed(4))
      : 0,
    avgUserMessageLength: averageLength(userRows),
    userMessageLengthTrend: buildLengthTrend(userRows),
    avgAssistantMessageLength: averageLength(assistantRows),
  };
}

/**
 * Compute average message length for a role slice.
 */
function averageLength(rows: EnrichedChatlogRow[]): number {
  if (rows.length === 0) return 0;
  return Number((rows.reduce((sum, row) => sum + row.content.length, 0) / rows.length).toFixed(2));
}

/**
 * Build a simple user message length trend slope.
 */
function buildLengthTrend(rows: EnrichedChatlogRow[]): number {
  if (rows.length <= 1) return 0;
  const n = rows.length;
  const xMean = (n - 1) / 2;
  const yMean = rows.reduce((sum, row) => sum + row.content.length, 0) / n;
  let numerator = 0;
  let denominator = 0;
  rows.forEach((row, index) => {
    numerator += (index - xMean) * (row.content.length - yMean);
    denominator += (index - xMean) ** 2;
  });
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

/**
 * Group rows by session identifier.
 */
export function groupRowsBySession(rows: EnrichedChatlogRow[]): Map<string, EnrichedChatlogRow[]> {
  const grouped = new Map<string, EnrichedChatlogRow[]>();
  rows.forEach((row) => {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId)?.push(row);
  });
  return grouped;
}

function buildUserQuestionRepeatRate(sessionGroups: EnrichedChatlogRow[][]): number {
  const fingerprints = sessionGroups.flatMap((sessionRows) =>
    sessionRows
      .filter((row) => row.role === "user" && row.isQuestion)
      .map((row) => row.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 18))
      .filter((value) => value.length > 0),
  );
  if (fingerprints.length === 0) return 0;
  const counts = new Map<string, number>();
  fingerprints.forEach((f) => counts.set(f, (counts.get(f) ?? 0) + 1));
  const repeatedCount = [...counts.values()].reduce((sum, c) => sum + (c >= 2 ? c - 1 : 0), 0);
  return Number((repeatedCount / fingerprints.length).toFixed(4));
}

function buildAgentResolutionSignalRate(sessionGroups: EnrichedChatlogRow[][]): number {
  if (sessionGroups.length === 0) return 0;
  const hitCount = sessionGroups.filter((sessionRows) =>
    sessionRows.some(
      (row) =>
        row.role === "assistant" &&
        /(已(经)?(为您|帮您)?(处理|提交|安排|登记|解决)|预计.*(回复|发出)|工单号|补发|退款)/.test(row.content),
    ),
  ).length;
  return Number((hitCount / sessionGroups.length).toFixed(4));
}

function buildEscalationKeywordHitRate(sessionGroups: EnrichedChatlogRow[][]): number {
  if (sessionGroups.length === 0) return 0;
  const hitCount = sessionGroups.filter((sessionRows) =>
    sessionRows.some((row) => /(转人工|投诉|主管|经理|升级专员|人工复核|工单)/.test(row.content)),
  ).length;
  return Number((hitCount / sessionGroups.length).toFixed(4));
}
