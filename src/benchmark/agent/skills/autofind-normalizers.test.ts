/**
 * @fileoverview AutoFind dataset normalizer tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { isZevalCsv, normalizeDatasetToCsv } from "./autofind-normalizers.ts";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

describe("normalizeDatasetToCsv", () => {
  it("passes through Zeval CSV", () => {
    const csv = "sessionId,timestamp,role,content\ns1,2026-01-01T00:00:00.000Z,user,\"hi\"\n";
    const normalized = normalizeDatasetToCsv({
      rawText: csv,
      searchProfile: "客服",
      positiveCount: 1,
      negativeCount: 1,
      sessionPrefix: "cs_",
    });
    assert.equal(normalized, csv);
    assert.equal(isZevalCsv(csv), true);
  });

  it("normalizes instruction/response CSV into grouped multi-turn sessions", () => {
    const csv = [
      "flags,instruction,category,intent,response",
      'A,"question about order 1",ORDER,track,"I can help with order 1."',
      'A,"follow up on order 1",ORDER,track,"Checking logistics for order 1."',
      'A,"question about order 2",ORDER,track,"I can help with order 2."',
      'A,"follow up on order 2",ORDER,track,"Checking logistics for order 2."',
    ].join("\n");
    const normalized = normalizeDatasetToCsv({
      rawText: csv,
      searchProfile: "shopify customer service order",
      positiveCount: 1,
      negativeCount: 1,
      sessionPrefix: "cs_",
    });
    assert.ok(normalized);
    assert.match(normalized!, /cs_pos_/);
    assert.match(normalized!, /cs_neg_/);
  });

  it("normalizes generic customer-service dialogue JSON", () => {
    const raw = readFileSync(join(fixtureDir, "__fixtures__", "autofind-customer-service.json"), "utf8");
    const normalized = normalizeDatasetToCsv({
      rawText: raw,
      searchProfile: "shopify 客服 外贸 转人工",
      positiveCount: 2,
      negativeCount: 2,
      sessionPrefix: "cs_",
    });
    assert.ok(normalized);
    assert.match(normalized!, /cs_pos_/);
    assert.match(normalized!, /cs_neg_/);
    assert.doesNotMatch(normalized!, /companion_pos_/);
  });
});
