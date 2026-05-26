/**
 * @fileoverview Duplicate detection for harvested bad cases.
 */

import { jaccardTranscriptSimilarity } from "@/eval-datasets/case-transcript-hash";
import type { BadCaseDuplicateDecision, BadCaseFeatureSnapshot } from "@/badcase/types";
import type { DatasetCaseRecord } from "@/eval-datasets/storage/types";

/**
 * Jaccard similarity threshold above which two transcripts are considered
 * near-duplicates.  Tuned to catch same-scenario paraphrases while allowing
 * genuinely distinct sessions through.
 */
const JACCARD_NEAR_DUP_THRESHOLD = 0.85;

/**
 * Find whether one candidate bad case duplicates an existing stored case.
 *
 * Layer order:
 *   L1 – exact SHA-256 transcript hash  (always checked)
 *   L2 – semantic similarity:
 *        • embedding cosine (≥ 0.95) when `featureSnapshot.textEmbedding` is populated
 *        • Jaccard token similarity (≥ {@link JACCARD_NEAR_DUP_THRESHOLD}) as fallback
 *          when embeddings are absent and `candidate.transcript` is supplied.
 *          This enables cross-session near-dedup without an embedding model.
 *   L3 – structural metric + tag vector distance
 *
 * @param candidate Candidate transcript hash, feature snapshot, and optional raw transcript.
 * @param existingCases Existing stored dataset cases.
 * @returns Duplicate decision.
 */
export function findBadCaseDuplicate(
  candidate: {
    normalizedTranscriptHash: string;
    featureSnapshot: BadCaseFeatureSnapshot;
    /**
     * Raw transcript text used for Jaccard L2 fallback.
     * Required for inter-session near-dedup when `textEmbedding` is empty.
     */
    transcript?: string;
  },
  existingCases: DatasetCaseRecord[],
): BadCaseDuplicateDecision {
  // ── L1: exact hash ────────────────────────────────────────────────────────────
  const exact = existingCases.find((item) => item.normalizedTranscriptHash === candidate.normalizedTranscriptHash);
  if (exact) {
    return {
      isDuplicate: true,
      layer: "l1_exact_hash",
      matchedCaseId: exact.caseId,
      similarityScore: 1,
    };
  }

  // ── L2: semantic (embedding cosine or Jaccard fallback) ───────────────────────
  if (candidate.featureSnapshot.textEmbedding.length > 0) {
    // Embedding cosine similarity — use when an embedding model is available.
    const semantic = findBestSemanticMatch(candidate.featureSnapshot, existingCases);
    if (semantic && semantic.similarityScore >= 0.95) {
      return {
        isDuplicate: true,
        layer: "l2_semantic",
        matchedCaseId: semantic.caseId,
        similarityScore: semantic.similarityScore,
      };
    }
  } else if (candidate.transcript) {
    // Jaccard token similarity fallback — no embedding model required.
    // Catches cross-session near-duplicates (same issue, slightly different wording).
    const jaccard = findBestJaccardMatch(candidate.transcript, existingCases);
    if (jaccard) {
      return {
        isDuplicate: true,
        layer: "l2_semantic",
        matchedCaseId: jaccard.caseId,
        similarityScore: jaccard.similarityScore,
      };
    }
  }

  // ── L3: structural ────────────────────────────────────────────────────────────
  const structural = findBestStructuralMatch(candidate.featureSnapshot, existingCases);
  if (structural && structural.metricDistance <= 0.1 && structural.tagDistance === 0) {
    return {
      isDuplicate: true,
      layer: "l3_structural",
      matchedCaseId: structural.caseId,
      metricDistance: structural.metricDistance,
      tagDistance: structural.tagDistance,
    };
  }

  return {
    isDuplicate: false,
    layer: "none",
  };
}

/**
 * Compute cosine similarity between two vectors.
 *
 * @param left Left vector.
 * @param right Right vector.
 * @returns Cosine similarity in [-1, 1].
 */
export function cosineSimilarity(left: number[], right: number[]): number {
  const dimension = Math.max(left.length, right.length);
  if (dimension === 0) {
    return 0;
  }

  let numerator = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < dimension; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    numerator += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return numerator / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/**
 * Compute normalized Euclidean distance between two metric vectors.
 *
 * @param left Left feature snapshot.
 * @param right Right feature snapshot.
 * @returns Distance in [0, 1+] where lower means closer.
 */
export function metricVectorDistance(
  left: BadCaseFeatureSnapshot,
  right: BadCaseFeatureSnapshot,
): number {
  const keys = [...new Set([...left.metricKeys, ...right.metricKeys])];
  const leftMap = new Map(left.metricKeys.map((key, index) => [key, left.metricVector[index] ?? 0]));
  const rightMap = new Map(right.metricKeys.map((key, index) => [key, right.metricVector[index] ?? 0]));
  const distance = Math.sqrt(
    keys.reduce((sum, key) => {
      const delta = (leftMap.get(key) ?? 0) - (rightMap.get(key) ?? 0);
      return sum + delta * delta;
    }, 0),
  );
  return Number((distance / Math.max(1, Math.sqrt(keys.length))).toFixed(4));
}

/**
 * Compute Hamming-style distance between two tag vectors over the union keyspace.
 *
 * @param left Left feature snapshot.
 * @param right Right feature snapshot.
 * @returns Distance in [0, 1].
 */
export function tagVectorDistance(
  left: BadCaseFeatureSnapshot,
  right: BadCaseFeatureSnapshot,
): number {
  const keys = [...new Set([...left.tagKeys, ...right.tagKeys])];
  if (keys.length === 0) {
    return 0;
  }

  const leftSet = new Set(left.tagKeys.filter((_, index) => left.tagVector[index] === 1));
  const rightSet = new Set(right.tagKeys.filter((_, index) => right.tagVector[index] === 1));
  const mismatches = keys.filter((key) => leftSet.has(key) !== rightSet.has(key)).length;
  return Number((mismatches / keys.length).toFixed(4));
}

type ScoredCase = {
  caseId: string;
  similarityScore: number;
  metricDistance: number;
  tagDistance: number;
};

/**
 * Find the best Jaccard match against existing cases above the near-dup threshold.
 *
 * Iterates all existing cases that have a stored `transcript`.  Returns the
 * highest-scoring match at or above {@link JACCARD_NEAR_DUP_THRESHOLD}, or
 * `null` when no match crosses the threshold.
 *
 * @param transcript Raw candidate transcript text.
 * @param existingCases Existing dataset cases (must have `transcript` populated for comparison).
 * @returns Best match or `null`.
 */
function findBestJaccardMatch(
  transcript: string,
  existingCases: DatasetCaseRecord[],
): Pick<ScoredCase, "caseId" | "similarityScore"> | null {
  let best: Pick<ScoredCase, "caseId" | "similarityScore"> | null = null;

  for (const item of existingCases) {
    if (!item.transcript) continue;
    const score = Number(jaccardTranscriptSimilarity(transcript, item.transcript).toFixed(4));
    if (score >= JACCARD_NEAR_DUP_THRESHOLD && (!best || score > best.similarityScore)) {
      best = { caseId: item.caseId, similarityScore: score };
    }
  }

  return best;
}

/**
 * Find the strongest semantic match in the existing pool.
 *
 * @param candidate Candidate feature snapshot.
 * @param existingCases Existing dataset cases.
 * @returns Best semantic match or `null`.
 */
function findBestSemanticMatch(
  candidate: BadCaseFeatureSnapshot,
  existingCases: DatasetCaseRecord[],
): Pick<ScoredCase, "caseId" | "similarityScore"> | null {
  let best: Pick<ScoredCase, "caseId" | "similarityScore"> | null = null;

  existingCases.forEach((item) => {
    if (!item.featureSnapshot) {
      return;
    }
    const similarityScore = Number(
      cosineSimilarity(candidate.textEmbedding, item.featureSnapshot.textEmbedding).toFixed(4),
    );
    if (!best || similarityScore > best.similarityScore) {
      best = { caseId: item.caseId, similarityScore };
    }
  });

  return best;
}

/**
 * Find the strongest structural match in the existing pool.
 *
 * @param candidate Candidate feature snapshot.
 * @param existingCases Existing dataset cases.
 * @returns Best structural match or `null`.
 */
function findBestStructuralMatch(
  candidate: BadCaseFeatureSnapshot,
  existingCases: DatasetCaseRecord[],
): Pick<ScoredCase, "caseId" | "metricDistance" | "tagDistance"> | null {
  let best: Pick<ScoredCase, "caseId" | "metricDistance" | "tagDistance"> | null = null;

  existingCases.forEach((item) => {
    if (!item.featureSnapshot) {
      return;
    }
    const metricDistance = metricVectorDistance(candidate, item.featureSnapshot);
    const tagDistance = tagVectorDistance(candidate, item.featureSnapshot);
    if (!best || metricDistance + tagDistance < best.metricDistance + best.tagDistance) {
      best = { caseId: item.caseId, metricDistance, tagDistance };
    }
  });

  return best;
}
