/**
 * @fileoverview Tests for Bitext template placeholder resolution.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasTemplatePlaceholders,
  resolveTemplatePlaceholders,
  resolveTemplatePlaceholdersInRows,
} from "./template-placeholders.ts";
import { redactRawRows } from "./redaction.ts";

describe("template placeholders", () => {
  it("TP-01: fills known Bitext slots with session-stable order ids", () => {
    const input = "cancel order {{Order Number}} via {{Online Company Portal Info}}";
    const left = resolveTemplatePlaceholders(input, { sessionId: "cs_pos_01" });
    const right = resolveTemplatePlaceholders(input, { sessionId: "cs_pos_01" });
    assert.equal(left.count, 2);
    assert.equal(left.text, right.text);
    assert.match(left.text, /cancel order #\d{6} via Shopify merchant dashboard/);
    assert.equal(hasTemplatePlaceholders(left.text), false);
  });

  it("TP-02: resolves rows for ingest upload path", () => {
    const { rows, report } = resolveTemplatePlaceholdersInRows([
      {
        sessionId: "cs_neg_03",
        timestamp: "2026-01-01T00:00:00.000Z",
        role: "assistant",
        content: "Call us at {{Customer Support Phone Number}} or visit {{Website URL}}.",
      },
    ]);
    assert.equal(report.resolvedRows, 1);
    assert.equal(report.resolvedSlots, 2);
    assert.match(rows[0].content, /\+1-800-555-0199/);
    assert.match(rows[0].content, /support\.example-shop\.com/);
  });

  it("TP-03: placeholder fill runs before PII redaction without over-redacting order refs", () => {
    const filled = resolveTemplatePlaceholdersInRows([
      {
        sessionId: "cs_pos_05",
        timestamp: "2026-01-01T00:00:00.000Z",
        role: "user",
        content: "please cancel order {{Order Number}}",
      },
    ]).rows;
    const redacted = redactRawRows(filled).rows;
    assert.match(redacted[0].content, /cancel order #\d{6}/);
    assert.doesNotMatch(redacted[0].content, /\[REDACTED_ORDER\]/);
    assert.doesNotMatch(redacted[0].content, /\{\{/);
  });
});
