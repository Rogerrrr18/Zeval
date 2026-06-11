/**
 * @fileoverview AutoFind URL and CSV validation tests (TDD).
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  countCsvSessions,
  filterValidCandidates,
  isFictionalDatasetRef,
  isTrustedDatasetUrl,
  looksLikeDialoguePayload,
  looksLikeHtmlPayload,
  validateCandidate,
  validateDownloadedPayload,
  validateNormalizedCsv,
} from "./autofind-validation.ts";
import { normalizeDatasetToCsv } from "./autofind-normalizers.ts";
import type { DatasetCandidate } from "./autofind-discovery.ts";

const fixtureDir = dirname(fileURLToPath(import.meta.url));

function buildDialogueFixture(sessionCount: number): string {
  const sessions = Array.from({ length: sessionCount }, (_, index) => ({
    session_id: `shopify_${index + 1}`,
    messages: [
      { role: "user", content: `Where is my Shopify order ${index + 1}?` },
      { role: "assistant", content: `I can help check order ${index + 1}.` },
      { role: "user", content: `Need shipping update for order ${index + 1}.` },
      { role: "assistant", content: `Checking logistics for order ${index + 1}.` },
    ],
  }));
  return JSON.stringify(sessions);
}

describe("isFictionalDatasetRef", () => {
  it("rejects mock and example placeholders", () => {
    assert.equal(isFictionalDatasetRef("hf:mock/customer-support-dialogues"), true);
    assert.equal(isFictionalDatasetRef("https://example.test/data.json"), true);
    assert.equal(isFictionalDatasetRef("https://example.com/datasets/fake"), true);
    assert.equal(isFictionalDatasetRef("hf:placeholder/dataset"), true);
  });

  it("accepts real public dataset references", () => {
    assert.equal(isFictionalDatasetRef("hf:CAS-SIAT-XinHai/CPsyCoun"), false);
    assert.equal(isFictionalDatasetRef("CAS-SIAT-XinHai/CPsyCoun"), false);
    assert.equal(isFictionalDatasetRef("bitext/Bitext-customer-support-llm-chatbot-training-dataset"), false);
    assert.equal(
      isFictionalDatasetRef("https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset"),
      false,
    );
  });
});

describe("isTrustedDatasetUrl", () => {
  it("accepts HuggingFace and GitHub raw URLs", () => {
    assert.equal(
      isTrustedDatasetUrl("https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun/resolve/main/CPsyCounD.json"),
      true,
    );
    assert.equal(
      isTrustedDatasetUrl("https://raw.githubusercontent.com/thu-coai/Emotional-Support-Conversation/main/FailedESConv.json"),
      true,
    );
    assert.equal(isTrustedDatasetUrl("https://duckduckgo.com/l/?uddg=x"), false);
  });
});

describe("validateCandidate companion HF list", () => {
  it("keeps CAS-SIAT-XinHai/CPsyCoun and drops github mirror pages", () => {
    const hf = validateCandidate({
      id: "hf:CAS-SIAT-XinHai/CPsyCoun",
      source: "huggingface",
      title: "CAS-SIAT-XinHai/CPsyCoun",
      description: "",
      url: "https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun",
      score: 10,
    });
    const githubMirror = validateCandidate({
      id: "github:https://github.com/CAS-SIAT-XinHai/CPsyCoun",
      source: "github",
      title: "CAS-SIAT-XinHai/CPsyCoun - GitHub",
      description: "",
      url: "https://github.com/CAS-SIAT-XinHai/CPsyCoun",
      score: 7,
    });
    assert.equal(hf.ok, true);
    assert.equal(githubMirror.ok, true);
    const filtered = filterValidCandidates([
      {
        id: "hf:CAS-SIAT-XinHai/CPsyCoun",
        source: "huggingface",
        title: "CAS-SIAT-XinHai/CPsyCoun",
        description: "",
        url: "https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun",
        score: 10,
      },
      {
        id: "github:https://github.com/CAS-SIAT-XinHai/CPsyCoun",
        source: "github",
        title: "CAS-SIAT-XinHai/CPsyCoun - GitHub",
        description: "",
        url: "https://github.com/CAS-SIAT-XinHai/CPsyCoun",
        score: 7,
      },
    ]);
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.source, "huggingface");
  });
});

describe("validateCandidate", () => {
  it("rejects fictional HuggingFace candidates", () => {
    const candidate: DatasetCandidate = {
      id: "hf:mock/customer-support-dialogues",
      source: "huggingface",
      title: "mock/customer-support-dialogues",
      description: "fake",
      url: "https://huggingface.co/datasets/mock/customer-support-dialogues",
      downloadUrl: "https://example.test/customer-support.json",
      score: 10,
    };
    const result = validateCandidate(candidate);
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /虚构|mock|example/i);
  });

  it("accepts real HuggingFace candidates", () => {
    const candidate: DatasetCandidate = {
      id: "hf:CAS-SIAT-XinHai/CPsyCoun",
      source: "huggingface",
      title: "CAS-SIAT-XinHai/CPsyCoun",
      description: "counseling dialogue",
      url: "https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun",
      downloadUrl: "https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun/resolve/main/CPsyCounD.json",
      score: 8,
    };
    const result = validateCandidate(candidate);
    assert.equal(result.ok, true);
  });
});

describe("validateDownloadedPayload", () => {
  it("rejects HTML search result pages", () => {
    const result = validateDownloadedPayload("<!DOCTYPE html><html><body>GitHub</body></html>", "text/html");
    assert.equal(result.ok, false);
    assert.match(result.reason ?? "", /HTML/i);
  });

  it("accepts dialogue JSON arrays", () => {
    const raw = readFileSync(join(fixtureDir, "__fixtures__", "autofind-customer-service.json"), "utf8");
    const result = validateDownloadedPayload(raw, "application/json");
    assert.equal(result.ok, true);
    assert.equal(looksLikeDialoguePayload(raw), true);
    assert.equal(looksLikeHtmlPayload(raw), false);
  });
});

describe("validateNormalizedCsv", () => {
  it("requires 10 positive and 10 negative sessions", () => {
    const small = normalizeDatasetToCsv({
      rawText: readFileSync(join(fixtureDir, "__fixtures__", "autofind-customer-service.json"), "utf8"),
      searchProfile: "shopify 客服 外贸",
      positiveCount: 10,
      negativeCount: 10,
      sessionPrefix: "cs_",
    });
    const smallResult = validateNormalizedCsv(small ?? "", { positiveCount: 10, negativeCount: 10 });
    assert.equal(smallResult.ok, false);

    const large = normalizeDatasetToCsv({
      rawText: buildDialogueFixture(24),
      searchProfile: "shopify 客服 外贸 转人工",
      positiveCount: 10,
      negativeCount: 10,
      sessionPrefix: "cs_",
    });
    assert.ok(large);
    const largeResult = validateNormalizedCsv(large!, { positiveCount: 10, negativeCount: 10 });
    assert.equal(largeResult.ok, true);
    assert.equal(countCsvSessions(large!).positiveSessions, 10);
    assert.equal(countCsvSessions(large!).negativeSessions, 10);
  });
});
