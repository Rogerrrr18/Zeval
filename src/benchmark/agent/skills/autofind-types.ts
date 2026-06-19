/**
 * @fileoverview Shared AutoFind discovery types.
 */

export type AutoFindDatasetProfile = "companion" | "customer_service" | "general";

export type AutoFindRubricContext = {
  requirementText: string;
  rubricDialogue: Array<{ role: "user" | "assistant"; text: string }>;
  rubricTitle?: string;
  rubricDescription?: string;
  rubricMetrics?: string[];
};

export type DatasetCandidateSource = "benchhub" | "huggingface" | "github" | "web";

export type DatasetCandidate = {
  id: string;
  source: DatasetCandidateSource;
  title: string;
  description: string;
  url: string;
  downloadUrl?: string;
  score: number;
};
