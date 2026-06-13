/**
 * @fileoverview AutoFind workflow tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import type { AutoFindDiscoveryDeps } from "./autofind-discovery.ts";
import {
  computeContextKey,
  detectDatasetProfile,
  runAutoFindDataSkill,
} from "./autofind-data-skill.ts";

const fixtureDir = dirname(fileURLToPath(import.meta.url));
const customerFixture = readFileSync(
  join(fixtureDir, "__fixtures__", "autofind-customer-service-large.json"),
  "utf8",
);

const REAL_HF_DATASET_URL =
  "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset";
const REAL_HF_DOWNLOAD_URL =
  "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset/resolve/main/README.md";

function mockDiscoveryDeps(): AutoFindDiscoveryDeps {
  return {
    searchHuggingFace: async () => [
      {
        id: "hf:bitext/Bitext-customer-support-llm-chatbot-training-dataset",
        source: "huggingface",
        title: "bitext/Bitext-customer-support-llm-chatbot-training-dataset",
        description: "shopify customer service dialogue dataset",
        url: REAL_HF_DATASET_URL,
        downloadUrl: REAL_HF_DOWNLOAD_URL,
        score: 10,
      },
    ],
    searchGitHub: async () => [],
    webSearch: async () => [],
    downloadText: async () => ({ text: customerFixture, contentType: "application/json" }),
  };
}

describe("detectDatasetProfile", () => {
  it("routes companion hardware tasks to companion datasets", () => {
    const profile = detectDatasetProfile("情绪陪伴硬件，关注共情与追问质量", {
      requirementText: "",
      rubricDialogue: [],
      rubricTitle: "情绪陪伴硬件评测标准",
    });
    assert.equal(profile, "companion");
  });

  it("routes customer-service tasks to customer_service discovery", () => {
    const profile = detectDatasetProfile("外贸 Shopify AI 客服自动回复，关注转人工率", {
      requirementText: "",
      rubricDialogue: [],
      rubricTitle: "外贸客服自动化回复评测标准",
    });
    assert.equal(profile, "customer_service");
  });
});

describe("computeContextKey", () => {
  it("changes when task requirement or rubric changes", () => {
    const left = computeContextKey("需求 A", {
      requirementText: "需求 A",
      rubricDialogue: [],
      rubricTitle: "任务 A",
    });
    const right = computeContextKey("需求 B", {
      requirementText: "需求 B",
      rubricDialogue: [],
      rubricTitle: "任务 B",
    });
    assert.notEqual(left, right);
  });
});

describe("runAutoFindDataSkill search", () => {
  it("runs discovery pipeline for customer-service tasks instead of companion cache", async () => {
    const started = await runAutoFindDataSkill({
      action: "start",
      requirementText: "外贸 Shopify AI 客服自动回复，关注转人工率",
      rubricContext: {
        requirementText: "外贸 Shopify AI 客服自动回复，关注转人工率",
        rubricDialogue: [],
        rubricTitle: "外贸客服自动化回复评测标准",
        rubricMetrics: ["转人工规避能力", "事实一致性"],
      },
    });

    const searched = await runAutoFindDataSkill({
      action: "search",
      requirementText: "外贸 Shopify AI 客服自动回复，关注转人工率",
      rubricContext: started.state.rubricContext,
      // Keep the small deterministic fixture (24 sessions) decoupled from the
      // production 25+25 default; this test only verifies discovery routing.
      state: { ...started.state, positiveCount: 10, negativeCount: 10 },
      discoveryDeps: mockDiscoveryDeps(),
    });

    assert.equal(searched.state.phase, "searched");
    assert.ok(searched.state.csvText);
    assert.match(searched.state.csvText!, /cs_pos_/);
    assert.doesNotMatch(searched.state.csvText!, /companion_pos_/);
    assert.equal(
      searched.state.selectedDatasetId,
      "hf:bitext/Bitext-customer-support-llm-chatbot-training-dataset",
    );
    assert.match(searched.state.verifiedDownloadUrl ?? "", /^https:\/\/huggingface\.co\//);
    assert.match(searched.reply, /检索与整理完成/);
    assert.ok(searched.state.agentTrace?.length);
    assert.match(searched.reply, /数据文件：/);
    assert.equal(searched.state.summary?.positiveSessions, 10);
    assert.equal(searched.state.summary?.negativeSessions, 10);
  });

  it("resets searched artifacts when context changes", async () => {
    const first = await runAutoFindDataSkill({
      action: "start",
      requirementText: "情绪陪伴硬件",
      rubricContext: {
        requirementText: "情绪陪伴硬件",
        rubricDialogue: [],
        rubricTitle: "情绪陪伴硬件评测标准",
      },
    });

    const merged = await runAutoFindDataSkill({
      action: "chat",
      message: "开始搜索",
      requirementText: "外贸 Shopify 客服",
      rubricContext: {
        requirementText: "外贸 Shopify 客服",
        rubricDialogue: [],
        rubricTitle: "外贸客服自动化回复评测标准",
      },
      state: {
        ...first.state,
        phase: "searched",
        positiveCount: 10,
        negativeCount: 10,
        csvText: "sessionId,timestamp,role,content\ncompanion_pos_01,2026-01-01T00:00:00.000Z,user,\"old\"",
        selectedDatasetId: "builtin:companion-pack",
      },
      discoveryDeps: mockDiscoveryDeps(),
    });

    assert.equal(merged.state.phase, "searched");
    assert.match(merged.state.csvText ?? "", /cs_pos_/);
    assert.notEqual(merged.state.selectedDatasetId, "builtin:companion-pack");
  });
});
