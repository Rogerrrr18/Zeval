/**
 * @fileoverview Build optional schema-aware structured metrics from uploaded benchmark data.
 */

import { buildSgdStructuredTaskMetrics, parseSgdRichConversationCases } from "@/adapters/sgdAdapter";
import type { StructuredTaskMetrics } from "@/types/rich-conversation";
import type { UploadFormat } from "@/types/pipeline";

/**
 * Build structured task metrics from the original uploaded source when annotations exist.
 * @param text Uploaded source text.
 * @param format Upload format.
 * @returns Structured metrics or undefined when unsupported.
 */
export function buildStructuredTaskMetricsFromSource(
  text: string,
  format: UploadFormat,
): StructuredTaskMetrics | undefined {
  if (format !== "json" && format !== "jsonl") {
    return undefined;
  }
  try {
    const cases = parseSgdRichConversationCases(text);
    if (cases.length === 0) {
      return undefined;
    }
    return buildSgdStructuredTaskMetrics(cases);
  } catch {
    return undefined;
  }
}
