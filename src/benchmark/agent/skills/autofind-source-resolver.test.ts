/**
 * @fileoverview AutoFind source resolver tests.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  rankHuggingFaceDataFiles,
  resolveCandidateDownloadUrls,
} from "./autofind-source-resolver.ts";
import type { DatasetCandidate } from "./autofind-types.ts";

describe("rankHuggingFaceDataFiles", () => {
  it("prefers dialogue-like csv/jsonl files over metadata", () => {
    const ranked = rankHuggingFaceDataFiles([
      { path: "README.md", size: 5000 },
      { path: "Next_Response_gpt.csv", size: 3_700_000 },
      { path: "E2E_Convo_gpt_gpt.csv", size: 595_433 },
      { path: "shopeasy_customer_service_train_v2.jsonl", size: 148_088 },
    ]);
    assert.ok(ranked[0]?.path.includes("Convo") || ranked[0]?.path.endsWith(".jsonl"));
    assert.ok(ranked.some((file) => file.path.endsWith(".jsonl")));
    assert.ok(
      ranked.findIndex((file) => file.path === "Next_Response_gpt.csv") >
        ranked.findIndex((file) => file.path === "E2E_Convo_gpt_gpt.csv"),
    );
    assert.equal(ranked.some((file) => /readme/i.test(file.path)), false);
  });
});

describe("resolveCandidateDownloadUrls", () => {
  it("resolves nested HuggingFace data files under data/", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tree/main/data")) {
        return new Response(
          JSON.stringify([
            {
              type: "file",
              path: "data/train-customer-support.jsonl",
              size: 120_000,
            },
          ]),
          { status: 200 },
        );
      }
      if (url.endsWith("/tree/main")) {
        return new Response(
          JSON.stringify([
            { type: "directory", path: "data" },
            { type: "file", path: "README.md", size: 900 },
          ]),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const candidate: DatasetCandidate = {
        id: "hf:mock/nested-support",
        source: "huggingface",
        title: "mock/nested-support",
        description: "nested ecommerce support dataset",
        url: "https://huggingface.co/datasets/mock/nested-support",
        score: 5,
      };
      const urls = await resolveCandidateDownloadUrls(candidate);
      assert.equal(
        urls[0],
        "https://huggingface.co/datasets/mock/nested-support/resolve/main/data/train-customer-support.jsonl",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
