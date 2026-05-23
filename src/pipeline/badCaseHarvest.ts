/**
 * @fileoverview Rule-only session-level bad case harvesting.
 *
 * P1 重构：已移除 topicSwitch 信号（依赖 isTopicSwitch），改为纯 session 粒度。
 */

import { findNegativeKeyword } from "@/pipeline/keywords/negative-zh";
import type { EnrichedChatlogRow, ObjectiveMetrics, SubjectiveMetrics } from "@/types/pipeline";

export type BadCaseSignal =
  | { kind: "negative_keyword"; keyword: string; turnIndex: number }
  | { kind: "metric"; metric: "responseGap" | "shortTurns"; value: number }
  | { kind: "implicit_signal"; signalId: string };

export type HarvestedBadCase = {
  sessionId: string;
  severity: number;
  signals: BadCaseSignal[];
};

/**
 * Harvest session-level bad cases using local rules only.
 */
export function harvestBadCases(
  rows: EnrichedChatlogRow[],
  _metrics: ObjectiveMetrics,
  signals: SubjectiveMetrics["signals"],
): HarvestedBadCase[] {
  const grouped = groupRowsBySession(rows);
  return [...grouped.entries()]
    .map(([sessionId, sessionRows]) => harvestSession(sessionId, sessionRows, signals))
    .filter((item): item is HarvestedBadCase => item !== null)
    .sort((left, right) => right.severity - left.severity);
}

function harvestSession(
  sessionId: string,
  rows: EnrichedChatlogRow[],
  signals: SubjectiveMetrics["signals"],
): HarvestedBadCase | null {
  const badCaseSignals: BadCaseSignal[] = [];
  let severity = 0;

  for (const row of rows) {
    if (row.role !== "user") continue;
    const match = findNegativeKeyword(row.content);
    if (match) {
      badCaseSignals.push({ kind: "negative_keyword", keyword: match.keyword, turnIndex: row.turnIndex });
      severity += match.weight;
    }
  }

  const maxGap = Math.max(...rows.map((row) => row.responseGapSec ?? 0), 0);
  if (maxGap >= 60) {
    badCaseSignals.push({ kind: "metric", metric: "responseGap", value: maxGap });
    severity += 0.18;
  }

  if (rows.length <= 2 && badCaseSignals.some((s) => s.kind === "negative_keyword")) {
    badCaseSignals.push({ kind: "metric", metric: "shortTurns", value: rows.length });
    severity += 0.12;
  }

  for (const signal of signals) {
    if (signal.severity === "high" && signal.evidenceTurnRange.startsWith(`${sessionId}:`)) {
      badCaseSignals.push({ kind: "implicit_signal", signalId: signal.signalKey });
      severity += 0.14;
    }
  }

  if (badCaseSignals.length === 0) return null;

  return {
    sessionId,
    severity: Math.min(1, Number(severity.toFixed(4))),
    signals: badCaseSignals,
  };
}

function groupRowsBySession(rows: EnrichedChatlogRow[]): Map<string, EnrichedChatlogRow[]> {
  const grouped = new Map<string, EnrichedChatlogRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId)!.push(row);
  }
  return grouped;
}
