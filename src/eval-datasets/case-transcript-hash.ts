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

/**
 * Tokenize a normalized transcript string into a whitespace-delimited token set.
 * Internal helper for {@link jaccardTranscriptSimilarity}.
 */
function tokenizeNormalized(normalized: string): Set<string> {
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return new Set(tokens);
}

/**
 * Compute token-level Jaccard similarity between two raw transcripts.
 *
 * Both transcripts are passed through {@link normalizeTranscriptForHash} before
 * tokenization, so comparisons are insensitive to whitespace, casing, and
 * common punctuation.  No LLM or embedding model is required.
 *
 * Use this as an L2 near-duplicate signal when embedding vectors are unavailable.
 *
 * @param a First raw transcript.
 * @param b Second raw transcript.
 * @returns Jaccard similarity in [0, 1] where 1 = identical token sets.
 */
export function jaccardTranscriptSimilarity(a: string, b: string): number {
  const setA = tokenizeNormalized(normalizeTranscriptForHash(a));
  const setB = tokenizeNormalized(normalizeTranscriptForHash(b));

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return intersection / union;
}
