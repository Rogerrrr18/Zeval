/**
 * @fileoverview Live Bitext customer-support normalization smoke test.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDatasetToCsv } from "./autofind-normalizers.ts";
import {
  validateDownloadedPayload,
  validateNormalizedCsv,
} from "./autofind-validation.ts";

const liveEnabled = process.env.AUTOFIND_LIVE_TEST !== "0";

describe("Bitext live normalization", { skip: !liveEnabled }, () => {
  it("downloads and normalizes customer-support CSV into 10+10 sessions", { timeout: 180_000 }, async () => {
    const url =
      "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset/resolve/main/Bitext_Sample_Customer_Support_Training_Dataset_27K_responses-v11.csv";
    const response = await fetch(url, { signal: AbortSignal.timeout(180000) });
    assert.equal(response.ok, true);
    const text = await response.text();
    assert.equal(validateDownloadedPayload(text).ok, true);

    const csv = normalizeDatasetToCsv({
      rawText: text,
      searchProfile: "shopify 客服 外贸 转人工 customer service",
      positiveCount: 10,
      negativeCount: 10,
      sessionPrefix: "cs_",
    });
    assert.ok(csv, "Bitext normalization returned null");
    const validation = validateNormalizedCsv(csv!, { positiveCount: 10, negativeCount: 10 });
    assert.equal(validation.ok, true, validation.ok ? "" : validation.reason);
    assert.match(csv!, /cs_pos_10/);
    assert.match(csv!, /cs_neg_10/);
  });
});
