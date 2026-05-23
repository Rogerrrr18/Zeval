/**
 * @fileoverview Lightweight bad case clustering for dataset browsing.
 */

import { cosineSimilarity, metricVectorDistance, tagVectorDistance } from "@/badcase/dedupe";
import type { BadCaseCluster, BadCaseClusterItem } from "@/badcase/types";
import type { DatasetCaseRecord } from "@/eval-datasets/storage/types";

/**
 * Build lightweight clusters over stored bad case records.
 *
 * Clustering strategy for the MVP:
 * - same `duplicateGroupKey` and moderately close features -> same cluster
 * - or strong semantic similarity -> same cluster
 * - or strong structural similarity -> same cluster
 *
 * @param cases Stored dataset cases.
 * @returns Cluster summaries ordered by impact.
 */
export function buildBadCaseClusters(cases: DatasetCaseRecord[]): BadCaseCluster[] {
  if (cases.length === 0) {
    return [];
  }

  const filtered = cases.filter((item) => item.caseSetType === "badcase");
  if (filtered.length === 0) {
    return [];
  }

  const parent = filtered.map((_, index) => index);

  for (let left = 0; left < filtered.length; left += 1) {
    for (let right = left + 1; right < filtered.length; right += 1) {
      if (shouldClusterTogether(filtered[left]!, filtered[right]!)) {
        union(parent, left, right);
      }
    }
  }

  const groups = new Map<number, DatasetCaseRecord[]>();
  filtered.forEach((item, index) => {
    const root = find(parent, index);
    if (!groups.has(root)) {
      groups.set(root, []);
    }
    groups.get(root)?.push(item);
  });

  return [...groups.values()]
    .map((items) => buildClusterSummary(items))
    .sort((left, right) => {
      if (right.size !== left.size) {
        return right.size - left.size;
      }
      return right.averageSeverityScore - left.averageSeverityScore;
    });
}

/**
 * Decide whether two cases should belong to the same lightweight cluster.
 *
 * @param left Left record.
 * @param right Right record.
 * @returns Whether the two cases should be linked.
 */
function shouldClusterTogether(left: DatasetCaseRecord, right: DatasetCaseRecord): boolean {
  if (left.normalizedTranscriptHash === right.normalizedTranscriptHash) {
    return true;
  }

  if (!left.featureSnapshot || !right.featureSnapshot) {
    return Boolean(left.duplicateGroupKey && left.duplicateGroupKey === right.duplicateGroupKey);
  }

  const semantic = cosineSimilarity(left.featureSnapshot.textEmbedding, right.featureSnapshot.textEmbedding);
  const structural = metricVectorDistance(left.featureSnapshot, right.featureSnapshot);
  const tagDistance = tagVectorDistance(left.featureSnapshot, right.featureSnapshot);
  const sameGroupKey = Boolean(left.duplicateGroupKey && left.duplicateGroupKey === right.duplicateGroupKey);

  if (semantic >= 0.93) {
    return true;
  }
  if (sameGroupKey && semantic >= 0.86 && structural <= 0.22) {
    return true;
  }
  if (sameGroupKey && structural <= 0.12 && tagDistance <= 0.2) {
    return true;
  }

  return false;
}

/**
 * Build one cluster summary from its member cases.
 *
 * @param items Cluster members.
 * @returns Cluster summary.
 */
function buildClusterSummary(items: DatasetCaseRecord[]): BadCaseCluster {
  const representative = pickRepresentative(items);
  const averageSeverityScore =
    items.length > 0
      ? Number(
          (
            items.reduce((sum, item) => sum + (item.failureSeverityScore ?? 0), 0) /
            items.length
          ).toFixed(4),
        )
      : 0;
  const dominantTags = pickDominantTags(items);
  const scenarioId = representative.scenarioId ?? items.find((item) => item.scenarioId)?.scenarioId;
  const clusterId = buildClusterId(items, representative.caseId);
  const label = buildClusterLabel(dominantTags, scenarioId, representative.title);

  return {
    clusterId,
    label,
    size: items.length,
    scenarioId,
    representativeCaseId: representative.caseId,
    representativeTitle: representative.title ?? representative.caseId,
    averageSeverityScore,
    dominantTags,
    items: items
      .slice()
      .sort(
        (left, right) =>
          (right.failureSeverityScore ?? 0) - (left.failureSeverityScore ?? 0) ||
          right.createdAt.localeCompare(left.createdAt),
      )
      .map(
        (item) =>
          ({
            caseId: item.caseId,
            title: item.title ?? item.caseId,
            sessionId: item.sessionId,
            scenarioId: item.scenarioId,
            tags: item.tags,
            failureSeverityScore: item.failureSeverityScore ?? 0,
            createdAt: item.createdAt,
            transcript: item.transcript,
            suggestedAction: item.suggestedAction,
          }) satisfies BadCaseClusterItem,
      ),
  };
}

/**
 * Pick the representative case for one cluster.
 *
 * Preference:
 * - if feature snapshots exist, choose the medoid by average metric distance
 * - otherwise choose the highest-severity case
 *
 * @param items Cluster members.
 * @returns Representative case.
 */
function pickRepresentative(items: DatasetCaseRecord[]): DatasetCaseRecord {
  const withFeatures = items.filter((item) => item.featureSnapshot);
  if (withFeatures.length <= 1) {
    return pickHighestSeverity(items);
  }

  let best = withFeatures[0]!;
  let bestScore = Number.POSITIVE_INFINITY;

  withFeatures.forEach((candidate) => {
    const distance = withFeatures.reduce((sum, other) => {
      if (candidate.caseId === other.caseId) {
        return sum;
      }
      return sum + metricVectorDistance(candidate.featureSnapshot!, other.featureSnapshot!);
    }, 0);

    if (distance < bestScore) {
      best = candidate;
      bestScore = distance;
    }
  });

  return best;
}

/**
 * Pick the highest-severity case in one cluster.
 *
 * @param items Cluster members.
 * @returns Highest-severity record.
 */
function pickHighestSeverity(items: DatasetCaseRecord[]): DatasetCaseRecord {
  return items
    .slice()
    .sort(
      (left, right) =>
        (right.failureSeverityScore ?? 0) - (left.failureSeverityScore ?? 0) ||
        right.createdAt.localeCompare(left.createdAt),
    )[0]!;
}

/**
 * Pick up to three dominant tags from a cluster.
 *
 * @param items Cluster members.
 * @returns Dominant tag list.
 */
function pickDominantTags(items: DatasetCaseRecord[]): string[] {
  const counts = new Map<string, number>();
  items.forEach((item) => {
    item.tags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 3)
    .map(([tag]) => tag);
}

/**
 * Build a stable cluster id from representative and group context.
 *
 * @param items Cluster members.
 * @param representativeCaseId Representative case id.
 * @returns Cluster identifier.
 */
function buildClusterId(items: DatasetCaseRecord[], representativeCaseId: string): string {
  const base =
    items.find((item) => item.duplicateGroupKey)?.duplicateGroupKey?.replace(/[^a-z0-9:_-]+/gi, "-") ??
    representativeCaseId;
  return `cluster_${base}_${items.length}`;
}

/**
 * Build a short human-readable cluster label.
 *
 * @param dominantTags Dominant tags.
 * @param scenarioId Optional scenario id.
 * @param fallbackTitle Fallback title when tags are sparse.
 * @returns Cluster label.
 */
function buildClusterLabel(
  dominantTags: string[],
  scenarioId: string | undefined,
  fallbackTitle: string | undefined,
): string {
  if (dominantTags.length > 0) {
    return `${scenarioId ?? "generic"} · ${dominantTags.join(" + ")}`;
  }
  return fallbackTitle ?? "Unlabeled Cluster";
}

/**
 * Disjoint-set find with path compression.
 *
 * @param parent Parent array.
 * @param index Node index.
 * @returns Root index.
 */
function find(parent: number[], index: number): number {
  if (parent[index] !== index) {
    parent[index] = find(parent, parent[index]!);
  }
  return parent[index]!;
}

/**
 * Disjoint-set union.
 *
 * @param parent Parent array.
 * @param left Left node index.
 * @param right Right node index.
 */
function union(parent: number[], left: number, right: number): void {
  const leftRoot = find(parent, left);
  const rightRoot = find(parent, right);
  if (leftRoot !== rightRoot) {
    parent[rightRoot] = leftRoot;
  }
}
