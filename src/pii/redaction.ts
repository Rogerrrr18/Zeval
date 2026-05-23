/**
 * @fileoverview Deterministic PII redaction for chatlog rows.
 */

import type { RawChatlogRow } from "@/types/pipeline";

export type PiiRedactionReport = {
  enabled: boolean;
  redactedRows: number;
  redactedFields: number;
  categories: string[];
};

type PiiPattern = {
  category: string;
  pattern: RegExp;
  replacement: string;
};

const PII_PATTERNS: PiiPattern[] = [
  {
    category: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    category: "phone",
    pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g,
    replacement: "[REDACTED_PHONE]",
  },
  {
    category: "id_card",
    pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g,
    replacement: "[REDACTED_ID]",
  },
  {
    category: "bank_card",
    pattern: /(?<!\d)(?:\d[ -]?){15,19}(?!\d)/g,
    replacement: "[REDACTED_CARD]",
  },
  {
    category: "order_id",
    pattern: /(?:订单号|order(?:\s*id)?|单号)[:：\s-]*[A-Z0-9_-]{5,}/gi,
    replacement: "[REDACTED_ORDER]",
  },
];

/**
 * Redact PII-like patterns from raw chat rows.
 *
 * @param rows Source rows.
 * @returns Redacted rows and report.
 */
export function redactRawRows(rows: RawChatlogRow[]): {
  rows: RawChatlogRow[];
  report: PiiRedactionReport;
} {
  const enabled = process.env.PII_REDACTION_ENABLED !== "false";
  if (!enabled) {
    return {
      rows,
      report: { enabled: false, redactedRows: 0, redactedFields: 0, categories: [] },
    };
  }

  let redactedRows = 0;
  let redactedFields = 0;
  const categories = new Set<string>();
  const nextRows = rows.map((row) => {
    const redacted = redactText(row.content);
    if (redacted.text !== row.content) {
      redactedRows += 1;
      redactedFields += redacted.count;
      redacted.categories.forEach((item) => categories.add(item));
    }
    return { ...row, content: redacted.text };
  });

  return {
    rows: nextRows,
    report: {
      enabled: true,
      redactedRows,
      redactedFields,
      categories: [...categories].sort(),
    },
  };
}

/**
 * Redact PII-like patterns from one string.
 *
 * @param value Source text.
 * @returns Redacted text and match metadata.
 */
export function redactText(value: string): { text: string; count: number; categories: string[] } {
  let text = value;
  let count = 0;
  const categories = new Set<string>();
  for (const item of PII_PATTERNS) {
    text = text.replace(item.pattern, () => {
      count += 1;
      categories.add(item.category);
      return item.replacement;
    });
  }
  return { text, count, categories: [...categories] };
}
