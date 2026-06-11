/**
 * @fileoverview AutoFind candidate URL and normalized CSV validation.
 */

import { isFetchableUrl, unwrapRedirectUrl } from "@/benchmark/agent/url-utils";
import type { DatasetCandidate } from "./autofind-types";
import { isZevalCsv } from "./autofind-normalizers";

export type CsvSessionCounts = {
  positiveSessions: number;
  negativeSessions: number;
  totalSessions: number;
  rows: number;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

const FICTIONAL_REF_PATTERN =
  /(?:^|[/:])(mock|fake|placeholder)(?:[/.]|$)|(?:^|[/:])mock\/|\/mock\/|example\.(?:test|com)|localhost|127\.0\.0\.1/i;

const TRUSTED_HOST_PATTERN =
  /^(https?:\/\/)?(huggingface\.co|raw\.githubusercontent\.com|github\.com|api\.github\.com|kaggle\.com)/i;

/**
 * Detect placeholder or fictional dataset identifiers.
 *
 * @param value Candidate id, title, or URL.
 * @returns True when the reference looks fabricated.
 */
export function isFictionalDatasetRef(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;
  return FICTIONAL_REF_PATTERN.test(normalized);
}

/**
 * Check whether a URL points to a trusted public dataset host.
 *
 * @param url Candidate or download URL.
 * @returns True for HuggingFace / GitHub / Kaggle hosts.
 */
export function isTrustedDatasetUrl(url: string): boolean {
  const resolved = unwrapRedirectUrl(url);
  if (!isFetchableUrl(resolved)) return false;
  return TRUSTED_HOST_PATTERN.test(resolved);
}

/**
 * Validate a discovered dataset candidate before download.
 *
 * @param candidate Ranked dataset candidate.
 * @returns Validation result with reason when rejected.
 */
export function validateCandidate(candidate: DatasetCandidate): ValidationResult {
  const identityFields = [candidate.id, candidate.title, candidate.url, candidate.downloadUrl].filter(
    (field): field is string => Boolean(field?.trim()),
  );
  if (identityFields.some((field) => isFictionalDatasetRef(field))) {
    return { ok: false, reason: "候选数据集疑似虚构或占位引用（mock/example）" };
  }
  if (!isTrustedDatasetUrl(candidate.url)) {
    return { ok: false, reason: `候选 URL 不在可信公开源：${candidate.url}` };
  }
  if (candidate.downloadUrl && !isTrustedDatasetUrl(candidate.downloadUrl)) {
    return { ok: false, reason: `下载 URL 不在可信公开源：${candidate.downloadUrl}` };
  }
  return { ok: true };
}

/**
 * Detect HTML payloads that are usually search/landing pages, not datasets.
 *
 * @param text Downloaded body text.
 * @returns True when payload looks like HTML.
 */
export function looksLikeHtmlPayload(text: string): boolean {
  const head = text.trim().slice(0, 256).toLowerCase();
  return head.startsWith("<!doctype html") || head.startsWith("<html") || /<head[\s>]/i.test(head);
}

/**
 * Detect dialogue-shaped JSON or Zeval CSV payloads.
 *
 * @param text Downloaded body text.
 * @returns True when payload may contain multi-turn dialogue data.
 */
export function looksLikeDialoguePayload(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (isZevalCsv(trimmed)) return true;

  const header = trimmed.split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  if (
    (header.includes("instruction") || header.includes("question") || header.includes("user") || header.includes("input")) &&
    (header.includes("response") || header.includes("answer") || header.includes("assistant") || header.includes("output"))
  ) {
    return true;
  }
  if (header.includes("dia") || header.includes("conversation") || header.includes("dialogue")) {
    return true;
  }

  const lines = trimmed.split(/\r?\n/).filter(Boolean);
  if (lines.length >= 2) {
    const jsonlSample = lines.slice(0, Math.min(3, lines.length));
    if (
      jsonlSample.every((line) => {
        try {
          return typeof JSON.parse(line) === "object";
        } catch {
          return false;
        }
      })
    ) {
      return true;
    }
  }

  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return false;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const first = items[0];
    if (!first || typeof first !== "object") return false;
    const record = first as Record<string, unknown>;
    return (
      Array.isArray(record.history) ||
      Array.isArray(record.dialog) ||
      Array.isArray(record.messages) ||
      Array.isArray(record.conversations) ||
      typeof record.conversation === "string" ||
      typeof record.dialogue === "string" ||
      typeof record.dia === "string" ||
      ((typeof record.input === "string" || typeof record.instruction === "string") &&
        (typeof record.output === "string" || typeof record.response === "string"))
    );
  } catch {
    return false;
  }
}

/**
 * Validate downloaded dataset payload before normalization.
 *
 * @param text Downloaded body text.
 * @param contentType Optional response content type.
 * @returns Validation result.
 */
export function validateDownloadedPayload(text: string, contentType?: string): ValidationResult {
  if (!text.trim()) {
    return { ok: false, reason: "下载内容为空" };
  }
  if (looksLikeHtmlPayload(text) || /text\/html/i.test(contentType ?? "")) {
    return { ok: false, reason: "下载内容是 HTML 页面而非数据集文件" };
  }
  if (!looksLikeDialoguePayload(text)) {
    return { ok: false, reason: "下载内容不是可识别的多轮对话 JSON/CSV" };
  }
  return { ok: true };
}

/**
 * Count positive/negative sessions in a Zeval CSV export.
 *
 * @param csvText Normalized CSV text.
 * @returns Session counts.
 */
export function countCsvSessions(csvText: string): CsvSessionCounts {
  const lines = csvText.trim().split(/\r?\n/).slice(1);
  const seen = new Set<string>();
  let positiveSessions = 0;
  let negativeSessions = 0;

  for (const line of lines) {
    const sessionId = line.split(",")[0]?.replace(/^"/, "").replace(/"$/, "") ?? "";
    if (!sessionId || seen.has(sessionId)) continue;
    seen.add(sessionId);
    if (sessionId.includes("_pos_")) positiveSessions += 1;
    if (sessionId.includes("_neg_")) negativeSessions += 1;
  }

  return {
    positiveSessions,
    negativeSessions,
    totalSessions: seen.size,
    rows: lines.length,
  };
}

/**
 * Validate normalized CSV meets AutoFind 10+10 session requirements.
 *
 * @param csvText Normalized CSV text.
 * @param options Expected positive/negative session counts.
 * @returns Validation result with counts when successful.
 */
export function validateNormalizedCsv(
  csvText: string,
  options: { positiveCount: number; negativeCount: number },
): ValidationResult & { counts?: CsvSessionCounts } {
  if (!isZevalCsv(csvText)) {
    return { ok: false, reason: "归一化结果不是 Zeval CSV 格式" };
  }

  const counts = countCsvSessions(csvText);
  if (counts.positiveSessions < options.positiveCount) {
    return {
      ok: false,
      reason: `正样本 session 不足：${counts.positiveSessions}/${options.positiveCount}`,
      counts,
    };
  }
  if (counts.negativeSessions < options.negativeCount) {
    return {
      ok: false,
      reason: `负样本 session 不足：${counts.negativeSessions}/${options.negativeCount}`,
      counts,
    };
  }
  const minRows = (options.positiveCount + options.negativeCount) * 2;
  if (counts.rows < minRows) {
    return { ok: false, reason: `CSV 消息行数不足：${counts.rows}/${minRows}`, counts };
  }
  return { ok: true, counts };
}

/**
 * Filter and validate dataset candidates, dropping fictional or untrusted entries.
 *
 * @param candidates Raw candidate list.
 * @returns Valid candidates only.
 */
export function filterValidCandidates(candidates: DatasetCandidate[]): DatasetCandidate[] {
  return candidates.filter((candidate) => {
    const validation = validateCandidate(candidate);
    if (!validation.ok) return false;
    if (candidate.source === "github" && /hugging\s*face|README\.md at main| - GitHub$/i.test(candidate.title)) {
      return false;
    }
    return true;
  });
}
