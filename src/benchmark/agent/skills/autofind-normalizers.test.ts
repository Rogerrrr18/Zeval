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

  it("normalizes benchmark QA CSV with answer and option columns", () => {
    const rows = ["id,question,A,B,C,D,answer,explanation"];
    for (let index = 1; index <= 6; index += 1) {
      rows.push(
        [
          String(index),
          `"金融指标 ${index} 应如何计算？"`,
          '"资产/负债"',
          '"收入-成本"',
          '"现金/利润"',
          '"以上都不是"',
          '"B"',
          `"第 ${index} 题考察金融指标计算。"`,
        ].join(","),
      );
    }

    const normalized = normalizeDatasetToCsv({
      rawText: rows.join("\n"),
      searchProfile: "金融 数值计算 指标抽取",
      positiveCount: 1,
      negativeCount: 1,
      sessionPrefix: "finance_",
    });

    assert.ok(normalized);
    assert.match(normalized!, /finance_pos_01/);
    assert.match(normalized!, /finance_neg_01/);
    assert.match(normalized!, /A\. 资产\/负债/);
    assert.match(normalized!, /解析：第 1 题考察金融指标计算。/);
  });

  it("normalizes nested financial QA JSON with document context", () => {
    const rows = Array.from({ length: 6 }, (_, index) => ({
      id: `convfinqa_${index + 1}`,
      pre_text: [
        `company revenue increased ${index + 1}% year over year.`,
        "operating cash flow was reported in the annual statement.",
      ],
      post_text: ["management attributed the change to lower receivables."],
      table: [
        ["year", "2008", "2009"],
        ["cash provided by operations", "181001", "206588"],
      ],
      qa: {
        question: `What is the increase in cash provided by operations for row ${index + 1}?`,
        answer: "25587",
        program: "subtract(206588,181001)",
        exe_ans: "25587",
      },
    }));

    const normalized = normalizeDatasetToCsv({
      rawText: JSON.stringify(rows),
      searchProfile: "finance numerical calculation table reasoning",
      positiveCount: 1,
      negativeCount: 1,
      sessionPrefix: "finance_",
    });

    assert.ok(normalized);
    assert.match(normalized!, /finance_pos_01/);
    assert.match(normalized!, /finance_neg_01/);
    assert.match(normalized!, /上下文：company revenue increased 1%/);
    assert.match(normalized!, /表格：year \\| 2008 \\| 2009/);
    assert.match(normalized!, /计算程序：subtract\(206588,181001\)/);
  });
});
