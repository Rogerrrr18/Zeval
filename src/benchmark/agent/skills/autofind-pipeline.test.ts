/**
 * @fileoverview End-to-end AutoFind pipeline tests: discovered URL -> download -> normalize CSV.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { runAutoFindAgent, type AutoFindAgentLlmDeps } from "./autofind-agent.ts";
import type { AutoFindDiscoveryDeps } from "./autofind-discovery.ts";
import {
  extractDialogueSessionPool,
  normalizeDatasetToCsv,
  parseConversationText,
} from "./autofind-normalizers.ts";
import { downloadResolvedUrl } from "./autofind-source-resolver.ts";
import {
  validateDownloadedPayload,
  validateNormalizedCsv,
} from "./autofind-validation.ts";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const spadeFixture = readFileSync(join(fixtureDir, "__fixtures__", "autofind-spade-dia-sample.csv"), "utf8");
const shopeasyFixture = readFileSync(join(fixtureDir, "__fixtures__", "autofind-shopeasy.jsonl"), "utf8");
const ecommerceFixture = readFileSync(
  join(fixtureDir, "__fixtures__", "autofind-ecommerce-conversation.json"),
  "utf8",
);

const failingLlm: AutoFindAgentLlmDeps = {
  complete: async () => {
    throw new Error("LLM unavailable");
  },
};

function normalizeFixture(
  rawText: string,
  searchProfile: string,
  options: { positiveCount: number; negativeCount: number; contentType?: string },
): string {
  assert.equal(validateDownloadedPayload(rawText, options.contentType).ok, true);
  const csv = normalizeDatasetToCsv({
    rawText,
    contentType: options.contentType,
    searchProfile,
    positiveCount: options.positiveCount,
    negativeCount: options.negativeCount,
    sessionPrefix: "cs_",
  });
  assert.ok(csv, "normalizeDatasetToCsv returned null");
  const validation = validateNormalizedCsv(csv!, {
    positiveCount: options.positiveCount,
    negativeCount: options.negativeCount,
  });
  assert.equal(validation.ok, true, validation.ok ? "" : validation.reason);
  return csv!;
}

describe("parseConversationText", () => {
  it("parses Agent/Customer and user/system prefixed dialogue", () => {
    const messages = parseConversationText(
      "Agent: Hello\n\nCustomer: I need help with my order\n\nAgent: Sure, share the order id",
    );
    assert.equal(messages.length, 3);
    assert.equal(messages[0]?.role, "assistant");
    assert.equal(messages[1]?.role, "user");
  });
});

describe("discovered payload normalization", () => {
  it("normalizes SPADE dia-column CSV into multi-turn sessions", () => {
    const csv = normalizeFixture(spadeFixture, "shopify customer service hotel booking", {
      positiveCount: 2,
      negativeCount: 2,
    });
    assert.match(csv, /cs_pos_02/);
    assert.match(csv, /cs_neg_02/);
    const pool = extractDialogueSessionPool({
      rawText: spadeFixture,
      searchProfile: "shopify customer service",
    });
    assert.ok(pool.length >= 4);
  });

  it("normalizes shopeasy JSONL via grouped input/output rows", () => {
    const csv = normalizeFixture(shopeasyFixture, "shopify ecommerce customer support refund", {
      positiveCount: 5,
      negativeCount: 5,
    });
    assert.match(csv, /cs_pos_05/);
    assert.match(csv, /cs_neg_05/);
  });

  it("normalizes ecommerce conversation JSON from datasets-server shape", () => {
    const csv = normalizeFixture(ecommerceFixture, "shopify customer service support agent", {
      positiveCount: 6,
      negativeCount: 6,
    });
    assert.match(csv, /cs_pos_06/);
    assert.match(csv, /cs_neg_06/);
  });
});

describe("downloadResolvedUrl virtual hf-rows", () => {
  it("downloads parquet-only datasets through datasets-server rows API", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/info?")) {
        return new Response(
          JSON.stringify({
            dataset_info: {
              default: { splits: { train: { num_examples: 12 } } },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/rows?")) {
        return new Response(
          JSON.stringify({
            rows: ecommerceFixture
              .trim()
              .startsWith("[")
              ? JSON.parse(ecommerceFixture).map((row: Record<string, unknown>) => ({ row }))
              : [],
          }),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const downloaded = await downloadResolvedUrl("hf-rows://NebulaByte/E-Commerce_Customer_Support_Conversations", async () => ({
        text: "",
      }));
      const csv = normalizeFixture(downloaded.text, "ecommerce customer support conversation", {
        positiveCount: 6,
        negativeCount: 6,
      });
      assert.match(csv, /cs_pos_06/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("runAutoFindAgent pipeline", () => {
  it("normalizes discovered candidate through multi-file download retries", async () => {
    const candidate = {
      id: "hf:AngieYYF/SPADE-customer-service-dialogue",
      source: "huggingface" as const,
      title: "AngieYYF/SPADE-customer-service-dialogue",
      description: "customer service dialogue csv",
      url: "https://huggingface.co/datasets/AngieYYF/SPADE-customer-service-dialogue",
      score: 9,
    };

    const deps: AutoFindDiscoveryDeps = {
      searchHuggingFace: async () => [candidate],
      searchGitHub: async () => [],
      webSearch: async () => [],
      downloadText: async (url) => {
        if (url.includes("Next_Response")) {
          return { text: "not,a,dialogue\n1,0,empty", contentType: "text/csv" };
        }
        if (url.includes("E2E_Convo") || url.includes("hf-rows://")) {
          return { text: spadeFixture, contentType: "text/csv" };
        }
        throw new Error(`unexpected download: ${url}`);
      },
    };

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/tree/main")) {
        return new Response(
          JSON.stringify([
            { type: "file", path: "Next_Response_gpt.csv", size: 3_700_000 },
            { type: "file", path: "E2E_Convo_gpt_gpt.csv", size: 595_433 },
          ]),
          { status: 200 },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;

    try {
      const result = await runAutoFindAgent(
        {
          searchProfile: "外贸 Shopify 客服 转人工",
          datasetProfile: "customer_service",
          positiveCount: 2,
          negativeCount: 2,
          sessionPrefix: "cs_",
          queries: ["shopify customer service dialogue"],
        },
        deps,
        failingLlm,
      );

      assert.match(result.csvText, /cs_pos_02/);
      assert.match(result.csvText, /cs_neg_02/);
      assert.match(result.verifiedDownloadUrl, /E2E_Convo_gpt_gpt\.csv/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
