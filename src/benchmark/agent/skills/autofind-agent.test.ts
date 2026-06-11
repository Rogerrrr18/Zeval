/**
 * @fileoverview AutoFind Agent tests with mock LLM and discovery dependencies.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  runAutoFindAgent,
  type AutoFindAgentLlmDeps,
} from "./autofind-agent.ts";
import type { AutoFindDiscoveryDeps } from "./autofind-discovery.ts";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const customerFixture = readFileSync(
  join(fixtureDir, "__fixtures__", "autofind-customer-service-large.json"),
  "utf8",
);

const BITEXT_ID = "hf:bitext/Bitext-customer-support-llm-chatbot-training-dataset";

function mockDiscoveryDeps(): AutoFindDiscoveryDeps {
  return {
    searchHuggingFace: async () => [
      {
        id: BITEXT_ID,
        source: "huggingface",
        title: "bitext/Bitext-customer-support-llm-chatbot-training-dataset",
        description: "Shopify customer service multi-turn dialogues",
        url: "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset",
        downloadUrl:
          "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset/resolve/main/README.md",
        score: 8,
      },
    ],
    searchGitHub: async () => [],
    webSearch: async () => [],
    downloadText: async () => ({ text: customerFixture, contentType: "application/json" }),
  };
}

function mockLlmDeps(): AutoFindAgentLlmDeps {
  return {
    complete: async (_messages, stage) => {
      if (stage === "autofind_query_plan") {
        return JSON.stringify({
          queries: ["shopify customer service dialogue dataset", "bitext support chatbot"],
          reasoning: "客服任务优先电商支持对话集",
        });
      }
      if (stage === "autofind_candidate_select") {
        return JSON.stringify({
          candidateId: BITEXT_ID,
          reasoning: "与 Shopify 客服场景最匹配",
        });
      }
      if (stage === "autofind_session_curate") {
        const positivePoolIds = Array.from({ length: 10 }, (_, index) =>
          `pool_${String(index + 1).padStart(3, "0")}`,
        );
        const negativePoolIds = Array.from({ length: 10 }, (_, index) =>
          `pool_${String(index + 11).padStart(3, "0")}`,
        );
        return JSON.stringify({
          positivePoolIds,
          negativePoolIds,
          reasoning: "前 10 条高相关为正，后 10 条为负",
        });
      }
      throw new Error(`unexpected stage: ${stage}`);
    },
  };
}

describe("runAutoFindAgent", () => {
  it("uses LLM to plan queries, select dataset and curate 10+10 sessions", async () => {
    const result = await runAutoFindAgent(
      {
        searchProfile: "外贸 Shopify AI 客服自动回复，关注转人工率",
        datasetProfile: "customer_service",
        rubricContext: {
          requirementText: "外贸 Shopify AI 客服自动回复，关注转人工率",
          rubricDialogue: [],
          rubricTitle: "外贸客服自动化回复评测标准",
          rubricMetrics: ["转人工规避能力", "事实一致性"],
        },
        positiveCount: 10,
        negativeCount: 10,
        sessionPrefix: "cs_",
      },
      mockDiscoveryDeps(),
      mockLlmDeps(),
    );

    assert.equal(result.llmAssisted, true);
    assert.match(result.csvText, /cs_pos_10/);
    assert.match(result.csvText, /cs_neg_10/);
    assert.equal(result.selectedCandidate.id, BITEXT_ID);
    assert.ok(result.agentTrace.some((line) => /检索词（模型）/.test(line)));
    assert.ok(result.agentTrace.some((line) => /选中数据集（模型）/.test(line)));
    assert.ok(result.sources.some((source) => /AutoFind Agent/.test(source)));
  });

  it("falls back to rules when LLM is unavailable", async () => {
    const failingLlm: AutoFindAgentLlmDeps = {
      complete: async () => {
        throw new Error("LLM unavailable");
      },
    };

    const result = await runAutoFindAgent(
      {
        searchProfile: "外贸 Shopify 客服",
        datasetProfile: "customer_service",
        positiveCount: 10,
        negativeCount: 10,
        sessionPrefix: "cs_",
      },
      mockDiscoveryDeps(),
      failingLlm,
    );

    assert.equal(result.llmAssisted, false);
    assert.match(result.csvText, /cs_pos_/);
    assert.match(result.csvText, /cs_neg_/);
    assert.ok(result.warnings.some((warning) => /模型不可用/.test(warning)));
    assert.ok(result.agentTrace.some((line) => /规则/.test(line)));
  });
});
