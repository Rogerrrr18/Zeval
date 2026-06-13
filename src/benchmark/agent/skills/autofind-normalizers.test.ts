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

  it("normalizes instruction/response CSV into grouped multi-turn sessions (>=3 turns)", () => {
    // Six single-turn rows merge into two 3-turn sessions (group size = 3).
    const csv = [
      "flags,instruction,category,intent,response",
      'A,"question about order {{Order Number}}",ORDER,track,"Visit {{Website URL}} for order {{Order Number}}."',
      'A,"follow up on order 1",ORDER,track,"Checking logistics for order 1."',
      'A,"still waiting on order 1",ORDER,track,"Order 1 is on the way."',
      'A,"question about order 2",ORDER,track,"I can help with order 2."',
      'A,"follow up on order 2",ORDER,track,"Checking logistics for order 2."',
      'A,"still waiting on order 2",ORDER,track,"Order 2 is on the way."',
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
    // Each session must carry at least 3 user turns (3 轮).
    const posUserTurns = normalized!
      .split(/\r?\n/)
      .filter((line) => /^cs_pos_01,/.test(line) && /,user,/.test(line)).length;
    assert.ok(posUserTurns >= 3, `expected >=3 user turns, got ${posUserTurns}`);
    assert.doesNotMatch(normalized!, /\{\{[^}]+\}\}/, "Bitext slots should be filled before export");
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
