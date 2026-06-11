/**
 * @fileoverview AutoFind discovery pipeline tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  buildDiscoveryQueries,
  discoverDatasetCandidates,
  rankDatasetCandidates,
  runAutoFindDiscovery,
  type AutoFindDiscoveryDeps,
  type DatasetCandidate,
} from "./autofind-discovery.ts";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const customerFixture = readFileSync(
  join(fixtureDir, "__fixtures__", "autofind-customer-service-large.json"),
  "utf8",
);

function mockCustomerServiceDeps(): AutoFindDiscoveryDeps {
  const candidate: DatasetCandidate = {
    id: "hf:bitext/Bitext-customer-support-llm-chatbot-training-dataset",
    source: "huggingface",
    title: "bitext/Bitext-customer-support-llm-chatbot-training-dataset",
    description: "Shopify customer service multi-turn dialogues",
    url: "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset",
    downloadUrl:
      "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset/resolve/main/README.md",
    score: 8,
  };

  return {
    searchHuggingFace: async () => [candidate],
    searchGitHub: async () => [
      {
        id: "gh:mock/support-bot",
        source: "github",
        title: "mock/support-bot",
        description: "ecommerce support dataset",
        url: "https://github.com/mock/support-bot",
        score: 3,
      },
    ],
    webSearch: async () => [
      {
        id: "web:hf",
        source: "web",
        title: "Customer support dataset",
        description: "huggingface dialogue dataset",
        url: "https://huggingface.co/datasets/mock/customer-support-dialogues",
        score: 2,
      },
    ],
    downloadText: async () => ({ text: customerFixture, contentType: "application/json" }),
  };
}

describe("buildDiscoveryQueries", () => {
  it("biases customer-service tasks toward support datasets", () => {
    const queries = buildDiscoveryQueries("外贸 Shopify 客服 转人工", "customer_service");
    assert.ok(queries.some((query) => /customer service|shopify|support/i.test(query)));
  });
});

describe("rankDatasetCandidates", () => {
  it("prefers candidates whose text overlaps task keywords", () => {
    const ranked = rankDatasetCandidates(
      [
        {
          id: "a",
          source: "huggingface",
          title: "random-image-dataset",
          description: "cats and dogs",
          url: "https://huggingface.co/datasets/random",
          score: 0,
        },
        {
          id: "b",
          source: "huggingface",
          title: "customer-support-dialogues",
          description: "shopify ecommerce support chat",
          url: "https://huggingface.co/datasets/customer-support-dialogues",
          score: 0,
        },
      ],
      "shopify 客服 外贸 转人工",
    );
    assert.equal(ranked[0]?.id, "b");
  });
});

describe("discoverDatasetCandidates", () => {
  it("aggregates HuggingFace, GitHub and web_search candidates", async () => {
    const candidates = await discoverDatasetCandidates(
      ["shopify customer service dataset"],
      {
        searchProfile: "shopify 客服",
        datasetProfile: "customer_service",
        positiveCount: 2,
        negativeCount: 2,
      },
      mockCustomerServiceDeps(),
    );
    assert.ok(candidates.length >= 2);
    assert.ok(candidates.some((item) => item.source === "huggingface"));
    assert.ok(candidates.some((item) => item.source === "github"));
  });
});

describe("runAutoFindDiscovery", () => {
  it("downloads and normalizes the selected dataset for customer-service tasks", async () => {
    const result = await runAutoFindDiscovery(
      {
        searchProfile: "外贸 Shopify AI 客服自动回复，关注转人工率",
        datasetProfile: "customer_service",
        positiveCount: 10,
        negativeCount: 10,
        sessionPrefix: "cs_",
      },
      mockCustomerServiceDeps(),
    );

    assert.match(result.csvText, /cs_pos_/);
    assert.match(result.csvText, /cs_neg_/);
    assert.doesNotMatch(result.csvText, /companion_pos_/);
    assert.equal(result.selectedCandidate.source, "huggingface");
    assert.match(result.verifiedDownloadUrl, /^https:\/\/huggingface\.co\//);
    assert.match(result.csvText, /cs_pos_10/);
    assert.match(result.csvText, /cs_neg_10/);
    assert.ok(result.sources.some((source) => /HuggingFace|GitHub|web_search/.test(source)));
  });
});
