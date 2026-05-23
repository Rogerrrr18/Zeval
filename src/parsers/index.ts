/**
 * @fileoverview Parser entrypoints for multi-format chatlog ingestion.
 */

import { parseCsvRows } from "@/parsers/csvParser";
import { parseJsonRows } from "@/parsers/jsonParser";
import { parseTextRows } from "@/parsers/textParser";
import type { RawChatlogRow, UploadFormat } from "@/types/pipeline";

/**
 * Detect upload format from file extension.
 * @param fileName Uploaded file name.
 * @returns Inferred upload format.
 */
export function inferFormatFromFileName(fileName: string): UploadFormat {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv" || extension === "json" || extension === "jsonl" || extension === "txt" || extension === "md") {
    return extension;
  }
  return "txt";
}

/**
 * Parse text by provided upload format.
 * @param text Source text.
 * @param format Upload format.
 * @param fileName Original file name.
 * @returns Parsed raw chat rows.
 */
export function parseByFormat(
  text: string,
  format: UploadFormat,
  fileName: string,
): RawChatlogRow[] {
  if (format === "csv") {
    return parseCsvRows(text);
  }
  if (format === "json" || format === "jsonl") {
    return parseJsonRows(text);
  }
  return parseTextRows(text, format, fileName);
}
