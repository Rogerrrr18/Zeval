/**
 * @fileoverview Regenerate the two benchmark sample CSVs from their real
 * open-source source datasets, expanded from 20 (10+10) to 50 (25+25) sessions.
 *
 * Sources (real, public HuggingFace datasets):
 *  - 情绪陪伴 / companion → CAS-SIAT-XinHai/CPsyCoun (CPsyCounD.json)
 *  - 外贸 AI 客服 / cs     → bitext/Bitext-customer-support-llm-chatbot-training-dataset
 *
 * Normalization reuses the exact AutoFind pipeline (`normalizeDatasetToCsv`),
 * so the output stays consistent with what the in-app AutoFind feature would
 * produce — only the positive/negative counts change.
 *
 * Usage: node --import tsx scripts/regen-sample-data-50sessions.ts
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeDatasetToCsv } from "../src/benchmark/agent/skills/autofind-normalizers.ts";
import {
  validateDownloadedPayload,
  validateNormalizedCsv,
} from "../src/benchmark/agent/skills/autofind-validation.ts";

const root = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(root, "..", "public", "sample-data");

const POSITIVE_COUNT = 25;
const NEGATIVE_COUNT = 25;

type RegenTarget = {
  label: string;
  url: string;
  searchProfile: string;
  sessionPrefix: string;
  outFile: string;
};

const targets: RegenTarget[] = [
  {
    label: "情绪陪伴 / companion (CPsyCounD)",
    url: "https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun/resolve/main/CPsyCounD.json",
    searchProfile: "情绪陪伴 CPsyCoun 心理咨询",
    sessionPrefix: "companion_",
    outFile: "companion-autofind-50sessions.csv",
  },
  {
    label: "外贸 AI 客服 / cs (Bitext)",
    url: "https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset/resolve/main/Bitext_Sample_Customer_Support_Training_Dataset_27K_responses-v11.csv",
    searchProfile: "shopify 客服 外贸 转人工 customer service",
    sessionPrefix: "cs_",
    outFile: "business-autofind-50sessions.csv",
  },
];

/**
 * Download, normalize, validate, and persist one sample CSV.
 *
 * @param target Regeneration target descriptor.
 */
async function regenOne(target: RegenTarget): Promise<void> {
  process.stdout.write(`\n▶ ${target.label}\n  GET ${target.url}\n`);
  const response = await fetch(target.url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) {
    throw new Error(`下载失败 HTTP ${response.status} ${target.url}`);
  }
  const rawText = await response.text();
  const payloadCheck = validateDownloadedPayload(rawText, response.headers.get("content-type") ?? undefined);
  if (!payloadCheck.ok) {
    throw new Error(`下载内容校验失败：${payloadCheck.reason}`);
  }

  const csv = normalizeDatasetToCsv({
    rawText,
    contentType: response.headers.get("content-type") ?? undefined,
    searchProfile: target.searchProfile,
    positiveCount: POSITIVE_COUNT,
    negativeCount: NEGATIVE_COUNT,
    sessionPrefix: target.sessionPrefix,
  });
  if (!csv) {
    throw new Error("归一化返回 null（源数据中可用会话不足）。");
  }

  const validation = validateNormalizedCsv(csv, {
    positiveCount: POSITIVE_COUNT,
    negativeCount: NEGATIVE_COUNT,
  });
  if (!validation.ok) {
    throw new Error(`归一化结果校验失败：${validation.reason}`);
  }

  const outPath = path.join(outDir, target.outFile);
  await writeFile(outPath, csv, "utf8");
  const sessionCount = (validation.counts?.positiveSessions ?? 0) + (validation.counts?.negativeSessions ?? 0);
  process.stdout.write(
    `  ✓ ${sessionCount} sessions（pos ${validation.counts?.positiveSessions} / neg ${validation.counts?.negativeSessions}）→ ${target.outFile}\n`,
  );
}

async function main(): Promise<void> {
  for (const target of targets) {
    await regenOne(target);
  }
  process.stdout.write("\n全部完成。\n");
}

main().catch((error) => {
  process.stderr.write(`\n✗ 失败：${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
