/**
 * @fileoverview URL helper tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractHuggingFaceDatasetId, isFetchableUrl, unwrapRedirectUrl } from "./url-utils.ts";

describe("unwrapRedirectUrl", () => {
  it("unwraps DuckDuckGo redirect URLs with protocol-relative href", () => {
    const wrapped =
      "//duckduckgo.com/l/?uddg=https%3A%2F%2Fgithub.com%2Fmock%2Fdatasets&rut=abc";
    assert.equal(unwrapRedirectUrl(wrapped), "https://github.com/mock/datasets");
  });

  it("unwraps DuckDuckGo redirect URLs with absolute href", () => {
    const wrapped =
      "https://duckduckgo.com/l/?uddg=https%3A%2F%2Fhuggingface.co%2Fdatasets%2Fmock%2Fdata";
    assert.equal(unwrapRedirectUrl(wrapped), "https://huggingface.co/datasets/mock/data");
  });

  it("normalizes protocol-relative direct URLs", () => {
    assert.equal(unwrapRedirectUrl("//example.com/data.json"), "https://example.com/data.json");
  });
});

describe("extractHuggingFaceDatasetId", () => {
  it("extracts owner/name dataset ids from HuggingFace URLs", () => {
    assert.equal(
      extractHuggingFaceDatasetId(
        "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset",
      ),
      "bitext/Bitext-customer-support-llm-chatbot-training-dataset",
    );
    assert.equal(
      extractHuggingFaceDatasetId(
        "https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun/resolve/main/CPsyCounD.json",
      ),
      "CAS-SIAT-XinHai/CPsyCoun",
    );
    assert.equal(
      extractHuggingFaceDatasetId(
        "https://huggingface.co/datasets/krisfu/awesome-llm-datasets-only-Chinese/blob/main/data.jsonl",
      ),
      "krisfu/awesome-llm-datasets-only-Chinese",
    );
  });
});

describe("isFetchableUrl", () => {
  it("accepts https URLs", () => {
    assert.equal(isFetchableUrl("https://github.com/mock/repo"), true);
  });

  it("rejects protocol-relative URLs", () => {
    assert.equal(isFetchableUrl("//duckduckgo.com/l/?uddg=x"), false);
  });
});
