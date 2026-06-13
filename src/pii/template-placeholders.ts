/**
 * @fileoverview Resolve Bitext-style `{{Entity}}` template slots into readable
 * synthetic values for Zeval evaluation.
 *
 * Bitext customer-support datasets ship unfilled slots for LLM fine-tuning.
 * They are **not** produced by upload-time PII redaction (`redactRawRows`).
 * Leaving them in benchmark CSVs causes judges to score placeholder noise
 * instead of dialogue quality.
 */

import type { RawChatlogRow } from "@/types/pipeline";

/** Context for session-stable placeholder fills. */
export type TemplatePlaceholderContext = {
  /** Zeval session id — drives per-session order / account ids. */
  sessionId?: string;
};

/** Report from batch placeholder resolution. */
export type TemplatePlaceholderReport = {
  /** Rows whose content changed. */
  resolvedRows: number;
  /** Total `{{...}}` slot replacements. */
  resolvedSlots: number;
};

/** Bitext slot → Shopify-style synthetic value (session-independent). */
const STATIC_SLOT_VALUES: Readonly<Record<string, string>> = {
  "{{Online Company Portal Info}}": "Shopify merchant dashboard",
  "{{Online Order Interaction}}": "Orders page",
  "{{Cancel Purchase}}": "Cancel order",
  "{{My Purchases}}": "My orders",
  "{{Customer Support Hours}}": "Mon–Fri 9:00 AM–6:00 PM EST",
  "{{Customer Support Phone Number}}": "+1-800-555-0199",
  "{{Website URL}}": "https://support.example-shop.com",
  "{{Company}}": "Example Shop",
  "{{Company Name}}": "Example Shop Inc.",
  "{{Company Account}}": "merchant account",
  "{{Invoice Number}}": "#INV-10001",
  "{{Account Category}}": "standard",
  "{{Account Type}}": "standard",
  "{{Salutation}}": "Ms.",
  "{{Client Last Name}}": "Johnson",
  "{{Person Name}}": "Sarah Johnson",
  "{{Date Range}}": "last 30 days",
  "{{Customer Support Email}}": "support@example-shop.com",
};

const TEMPLATE_SLOT_PATTERN = /\{\{[^}]+\}\}/g;

/**
 * Derive a stable numeric suffix from a session id for synthetic ids.
 *
 * @param sessionId Session identifier.
 * @returns Positive integer in [100000, 999999].
 */
function sessionNumericSuffix(sessionId: string): number {
  let hash = 0;
  for (const char of sessionId) {
    hash = (hash * 31 + char.charCodeAt(0)) | 0;
  }
  return (Math.abs(hash) % 900_000) + 100_000;
}

/**
 * Resolve session-specific Bitext slots.
 *
 * Order ids use `#NNNNNN` form so they stay readable but avoid the ingest
 * order-id PII regex (`order … ORD-xxx`).
 *
 * @param slot Raw `{{…}}` token.
 * @param sessionId Session id for stable per-conversation values.
 * @returns Filled value or undefined when unknown.
 */
function resolveSessionSlot(slot: string, sessionId: string): string | undefined {
  const suffix = sessionNumericSuffix(sessionId);
  const normalized = slot.trim();
  if (normalized === "{{Order Number}}") return `#${suffix}`;
  if (normalized === "{{Invoice Number}}") return `#INV-${suffix}`;
  if (normalized === "{{Account Category}}" || normalized === "{{Account Type}}") {
    return "standard";
  }
  return undefined;
}

/**
 * Replace Bitext-style `{{Entity}}` slots with readable synthetic values.
 *
 * Unknown slots fall back to a lower-cased, de-braced label so content stays
 * evaluable instead of showing raw template syntax.
 *
 * @param text Source message text.
 * @param context Optional session context for stable ids.
 * @returns Resolved text and replacement count.
 */
export function resolveTemplatePlaceholders(
  text: string,
  context: TemplatePlaceholderContext = {},
): { text: string; count: number } {
  if (!text.includes("{{")) {
    return { text, count: 0 };
  }

  let count = 0;
  const sessionId = context.sessionId ?? "default_session";
  const resolved = text.replace(TEMPLATE_SLOT_PATTERN, (slot) => {
    count += 1;
    const sessionValue = resolveSessionSlot(slot, sessionId);
    if (sessionValue) return sessionValue;
    const staticValue = STATIC_SLOT_VALUES[slot];
    if (staticValue) return staticValue;
    const label = slot.replace(/^\{\{|\}\}$/g, "").trim().toLowerCase();
    return label || slot;
  });

  return { text: resolved, count };
}

/**
 * Resolve template slots on raw chatlog rows (ingest / upload path).
 *
 * @param rows Parsed chat rows.
 * @returns Rows with filled slots and a summary report.
 */
export function resolveTemplatePlaceholdersInRows(rows: RawChatlogRow[]): {
  rows: RawChatlogRow[];
  report: TemplatePlaceholderReport;
} {
  let resolvedRows = 0;
  let resolvedSlots = 0;
  const nextRows = rows.map((row) => {
    const result = resolveTemplatePlaceholders(row.content, { sessionId: row.sessionId });
    if (result.count > 0) {
      resolvedRows += 1;
      resolvedSlots += result.count;
    }
    return { ...row, content: result.text };
  });

  return {
    rows: nextRows,
    report: { resolvedRows, resolvedSlots },
  };
}

/**
 * Whether a string still contains unfilled `{{…}}` template slots.
 *
 * @param text Candidate text.
 * @returns True when template slots remain.
 */
export function hasTemplatePlaceholders(text: string): boolean {
  return /\{\{[^}]+\}\}/.test(text);
}
