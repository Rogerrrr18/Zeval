/**
 * @fileoverview CSV parser for raw chatlog rows.
 */

import { splitCsvLine } from "@/lib/csv";
import type { RawChatlogRow } from "@/types/pipeline";

const ALLOWED_ROLES = new Set<RawChatlogRow["role"]>(["user", "assistant", "system"]);

/**
 * Parse CSV text into raw rows.
 * @param text Raw CSV text.
 * @returns Parsed raw chat rows.
 */
export function parseCsvRows(text: string): RawChatlogRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return [];
  }

  const header = splitCsvLine(lines[0]).map((cell) => cell.trim());
  const sessionIdIndex = header.indexOf("sessionId");
  const timestampIndex = header.indexOf("timestamp");
  const roleIndex = header.indexOf("role");
  const contentIndex = header.indexOf("content");

  if ([sessionIdIndex, timestampIndex, roleIndex, contentIndex].some((index) => index < 0)) {
    return [];
  }

  return lines.slice(1).flatMap((line) => {
    const cells = splitCsvLine(line);
    const role = String(cells[roleIndex] ?? "").toLowerCase() as RawChatlogRow["role"];
    if (!ALLOWED_ROLES.has(role)) {
      return [];
    }
    return [
      {
        sessionId: String(cells[sessionIdIndex] ?? "unknown"),
        timestamp: String(cells[timestampIndex] ?? ""),
        role,
        content: String(cells[contentIndex] ?? ""),
      },
    ];
  });
}
