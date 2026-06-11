/**
 * @fileoverview Live CPsyCoun normalization smoke test.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizeDatasetToCsv } from "./autofind-normalizers.ts";
import {
  validateDownloadedPayload,
  validateNormalizedCsv,
} from "./autofind-validation.ts";

const liveEnabled = process.env.AUTOFIND_LIVE_TEST !== "0";

describe("CPsyCoun live normalization", { skip: !liveEnabled }, () => {
  it("downloads and normalizes CAS-SIAT-XinHai/CPsyCoun into 10+10 CSV", { timeout: 120_000 }, async () => {
    const url = "https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun/resolve/main/CPsyCounD.json";
    const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
    assert.equal(response.ok, true);
    const text = await response.text();
    assert.equal(validateDownloadedPayload(text).ok, true);

    const csv = normalizeDatasetToCsv({
      rawText: text,
      searchProfile: "情绪陪伴 CPsyCoun 心理咨询",
      positiveCount: 10,
      negativeCount: 10,
      sessionPrefix: "companion_",
    });
    assert.ok(csv, "CPsyCoun normalization returned null");
    const validation = validateNormalizedCsv(csv!, { positiveCount: 10, negativeCount: 10 });
    assert.equal(validation.ok, true, validation.ok ? "" : validation.reason);
    assert.match(csv!, /companion_pos_10/);
    assert.match(csv!, /companion_neg_10/);
  });
});
