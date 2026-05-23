/**
 * @fileoverview TXT/MD parser for raw chatlog rows.
 */

import type { UploadFormat, RawChatlogRow } from "@/types/pipeline";

/**
 * Parse TXT/MD text into raw rows using lightweight heuristics.
 * @param text Source text.
 * @param format Source format.
 * @param fileName Source file name.
 * @returns Parsed raw chat rows.
 */
export function parseTextRows(
  text: string,
  format: Extract<UploadFormat, "txt" | "md">,
  fileName: string,
): RawChatlogRow[] {
  let sessionId = `${fileName.replace(/\.[^.]+$/, "")}_session`;
  const rows: RawChatlogRow[] = [];

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    if (line.startsWith("## session:") || line.startsWith("[session:")) {
      sessionId = line
        .replace("## session:", "")
        .replace("[session:", "")
        .replace("]", "")
        .trim();
      return;
    }

    const withTimestamp =
      line.match(
        /^\[?(\d{4}-\d{2}-\d{2}T[\d:.+-]+)\]?\s*(user|assistant|system)[:：]\s*(.+)$/i,
      ) ?? null;
    if (withTimestamp) {
      rows.push({
        sessionId,
        timestamp: withTimestamp[1],
        role: withTimestamp[2].toLowerCase() as RawChatlogRow["role"],
        content: withTimestamp[3],
      });
      return;
    }

    const withoutTimestamp = line.match(/^(user|assistant|system)[:：]\s*(.+)$/i);
    if (withoutTimestamp) {
      rows.push({
        sessionId,
        timestamp: new Date(Date.now() + index * 1000).toISOString(),
        role: withoutTimestamp[1].toLowerCase() as RawChatlogRow["role"],
        content: withoutTimestamp[2],
      });
    }
  });

  if (rows.length > 0) {
    return rows;
  }

  if (format === "md") {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((content, index) => ({
      sessionId,
      timestamp: new Date(Date.now() + index * 1000).toISOString(),
      role: index % 2 === 0 ? "user" : "assistant",
      content,
    }));
}
