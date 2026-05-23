/**
 * @fileoverview Enrich normalized rows with deterministic row-level signals.
 *
 * P1 重构：已移除 buildTopicSegments / scoreTopicSegmentEmotions 调用链。
 * enrichRows 现在只依赖 normalizeRawRows（无 LLM），输出行级派生字段：
 *   - responseGapSec（回复间隔）
 *   - isDropoffTurn（流失信号）
 *   - isQuestion（提问标记）
 *   - tokenCountEstimate（token 估算）
 */

import { normalizeRawRows } from "@/pipeline/normalize";
import type { EnrichedChatlogRow, RawChatlogRow } from "@/types/pipeline";

/**
 * Enrich raw rows with deterministic row-level signals (no LLM required).
 * @param rows Raw chat rows.
 * @returns Enriched rows.
 */
export function enrichRows(rows: RawChatlogRow[]): { enrichedRows: EnrichedChatlogRow[] } {
  const normalizedRows = normalizeRawRows(rows);
  const previousTimestampBySession = new Map<string, number | null>();
  const lastTurnBySession = new Map<string, number>();

  normalizedRows.forEach((row) => {
    lastTurnBySession.set(row.sessionId, row.turnIndex);
  });

  const enrichedRows: EnrichedChatlogRow[] = normalizedRows.map((row) => {
    const previousTimestamp = previousTimestampBySession.get(row.sessionId) ?? null;
    const responseGapSec =
      row.timestampMs !== null && previousTimestamp !== null
        ? Math.max(0, Math.round((row.timestampMs - previousTimestamp) / 1000))
        : null;

    previousTimestampBySession.set(row.sessionId, row.timestampMs);

    return {
      ...row,
      responseGapSec,
      isDropoffTurn:
        row.turnIndex === (lastTurnBySession.get(row.sessionId) ?? row.turnIndex) &&
        row.role === "assistant",
      isQuestion: /[?？]/.test(row.content),
      tokenCountEstimate: Math.max(1, Math.ceil(row.content.length / 1.6)),
    };
  });

  return { enrichedRows };
}

/**
 * Build canonical CSV string from raw rows.
 * @param rows Raw chat rows.
 * @returns Canonical CSV text.
 */
export function toCanonicalCsv(rows: RawChatlogRow[]): string {
  const normalizedRows = normalizeRawRows(rows);
  const header = "sessionId,timestamp,role,content";
  const body = normalizedRows.map((row) =>
    [row.sessionId, row.timestamp, row.role, row.content].map(escapeCell).join(","),
  );
  return [header, ...body].join("\n");
}

/**
 * Export enriched rows as CSV text.
 * @param rows Enriched rows.
 * @returns Stable enriched CSV text.
 */
export function toEnrichedCsv(rows: EnrichedChatlogRow[]): string {
  const header = [
    "sessionId",
    "timestamp",
    "role",
    "content",
    "turnIndex",
    "responseGapSec",
    "isDropoffTurn",
    "isQuestion",
    "activeHour",
    "tokenCountEstimate",
  ].join(",");
  const body = rows.map((row) =>
    [
      row.sessionId,
      row.timestamp,
      row.role,
      row.content,
      row.turnIndex,
      row.responseGapSec,
      row.isDropoffTurn,
      row.isQuestion,
      row.activeHour,
      row.tokenCountEstimate,
    ]
      .map(escapeCell)
      .join(","),
  );
  return [header, ...body].join("\n");
}

/**
 * Escape CSV cell values.
 * @param value Cell value.
 * @returns Escaped CSV cell.
 */
function escapeCell(value: string | number | boolean | null): string {
  const text = value === null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}
