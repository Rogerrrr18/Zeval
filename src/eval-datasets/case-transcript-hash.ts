/**
 * @fileoverview Topic transcript normalization and stable dedupe hashing.
 */

import { createHash } from "node:crypto";

/**
 * Normalize raw topic transcript text for dedupe hashing.
 * Collapses whitespace, applies NFKC, lowercases ASCII, strips common punctuation.
 * Does not attempt full semantic normalization; LLM 不可用时仍保持确定性。
 * @param raw Raw transcript string from one topic segment.
 * @returns Normalized string suitable for hashing.
 */
export function normalizeTranscriptForHash(raw: string): string {
  const collapsed = raw
    .normalize("NFKC")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0009\u000A\u000B\u000C\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g, " ")
    .trim()
    .toLowerCase();

  return collapsed.replace(/[，。！？、；：“”‘’（）【】《》.,!?;:'"()[\]<>_-]/g, "");
}

/**
 * Compute SHA-256 hex digest for a normalized transcript.
 * @param rawTranscript Raw topic transcript.
 * @returns 64-char lowercase hex SHA-256 of {@link normalizeTranscriptForHash} output.
 */
export function computeNormalizedTranscriptHash(rawTranscript: string): string {
  const normalized = normalizeTranscriptForHash(rawTranscript);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}
