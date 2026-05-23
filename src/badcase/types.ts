/**
 * @fileoverview Shared types for bad case features and duplicate decisions.
 */

/**
 * Persisted feature snapshot attached to one harvested bad case.
 */
export type BadCaseFeatureSnapshot = {
  version: "badcase_feature_v1";
  metricKeys: string[];
  metricVector: number[];
  tagKeys: string[];
  tagVector: number[];
  textEmbedding: number[];
  embeddingModel: "lexical_hash_v1";
};

/**
 * Duplicate decision for one candidate bad case against the existing pool.
 */
export type BadCaseDuplicateDecision = {
  isDuplicate: boolean;
  layer: "l1_exact_hash" | "l2_semantic" | "l3_structural" | "none";
  matchedCaseId?: string;
  similarityScore?: number;
  metricDistance?: number;
  tagDistance?: number;
};

/**
 * One clustered bad case item exposed to browsing surfaces.
 */
export type BadCaseClusterItem = {
  caseId: string;
  title: string;
  sessionId: string;
  scenarioId?: string;
  tags: string[];
  failureSeverityScore: number;
  createdAt: string;
  transcript?: string;
  suggestedAction?: string;
};

/**
 * One bad case cluster summary for dataset browsing.
 */
export type BadCaseCluster = {
  clusterId: string;
  label: string;
  size: number;
  scenarioId?: string;
  representativeCaseId: string;
  representativeTitle: string;
  averageSeverityScore: number;
  dominantTags: string[];
  items: BadCaseClusterItem[];
};
