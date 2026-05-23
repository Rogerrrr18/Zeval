/**
 * @fileoverview Normalize raw rows into stable, sorted rows.
 */

import type { NormalizedChatlogRow, RawChatlogRow } from "@/types/pipeline";

/**
 * Normalize raw rows by session and timestamp order.
 * @param rows Raw chat rows.
 * @returns Normalized rows with turn indexes and parsed time metadata.
 */
export function normalizeRawRows(rows: RawChatlogRow[]): NormalizedChatlogRow[] {
  const grouped = new Map<string, RawChatlogRow[]>();
  rows.forEach((row) => {
    if (!grouped.has(row.sessionId)) {
      grouped.set(row.sessionId, []);
    }
    grouped.get(row.sessionId)?.push(row);
  });

  const normalized: NormalizedChatlogRow[] = [];
  for (const sessionRows of grouped.values()) {
    const sortedRows = [...sessionRows]
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const leftTime = safeParseTimestamp(left.row.timestamp);
        const rightTime = safeParseTimestamp(right.row.timestamp);
        if (leftTime === null && rightTime === null) {
          return left.index - right.index;
        }
        if (leftTime === null) {
          return 1;
        }
        if (rightTime === null) {
          return -1;
        }
        return leftTime - rightTime;
      })
      .map((item) => item.row);

    sortedRows.forEach((row, index) => {
      const timestampMs = safeParseTimestamp(row.timestamp);
      normalized.push({
        ...row,
        turnIndex: index + 1,
        timestampMs,
        activeHour: timestampMs === null ? null : new Date(timestampMs).getHours(),
      });
    });
  }

  return normalized;
}

/**
 * Safely parse an ISO timestamp.
 * @param timestamp Timestamp string.
 * @returns Millisecond timestamp or null when invalid.
 */
export function safeParseTimestamp(timestamp: string): number | null {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}
