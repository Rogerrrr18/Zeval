/**
 * @fileoverview Data onboarding contracts for upload-time structure alignment.
 */

import type { UploadFormat } from "@/types/pipeline";

/**
 * Source format inferred by the onboarding agent.
 */
export type DataSourceFormat =
  | "sgd"
  | "assetops"
  | "plain-chatlog"
  | "custom-json"
  | "custom-jsonl"
  | "custom-csv"
  | "plain-text"
  | "unknown";

/**
 * Detected source-file structure summary.
 */
export type DetectedDataStructure = {
  rootType: "array" | "object" | "jsonl" | "csv" | "text" | "unknown";
  recordCount: number;
  conversationCount?: number;
  messageCount?: number;
  detectedFields: string[];
  samplePaths: string[];
};

/**
 * One field mapping candidate into the internal evaluation contract.
 */
export type DataFieldMapping = {
  path: string;
  target: string;
  sourceField?: string;
  confidence: number;
  required: boolean;
  transform?: string;
  note?: string;
};

/**
 * One deterministic transform that should be applied while normalizing.
 */
export type DataTransformPlan = {
  field: string;
  transform:
    | "role-normalize"
    | "timestamp-parse"
    | "flatten-array"
    | "join-text"
    | "rename"
    | "drop-empty"
    | "copy";
  detail: string;
};

/**
 * Capability flags that decide which metric groups can be enabled.
 */
export type DataCapabilityReport = {
  basicChat: boolean;
  schemaAware: boolean;
  slotEval: boolean;
  stateTracking: boolean;
  serviceCallEval: boolean;
  serviceResultGrounding: boolean;
  actualToolTraceEval: boolean;
  benchmarkGoldEval: boolean;
  enabledMetricGroups: string[];
  disabledMetricGroups: Array<{
    group: string;
    reason: string;
  }>;
};

/**
 * LLM review metadata for the generated mapping plan.
 */
export type DataOnboardingAgentReview = {
  status: "not_requested" | "completed" | "degraded";
  summary: string;
  confidence: number;
};

/**
 * Upload-time mapping plan generated before evaluation.
 */
export type DataMappingPlan = {
  planId: string;
  sourceFormat: DataSourceFormat;
  uploadFormat: UploadFormat;
  fileName: string;
  confidence: number;
  detectedStructure: DetectedDataStructure;
  fieldMappings: DataFieldMapping[];
  transforms: DataTransformPlan[];
  capabilityReport: DataCapabilityReport;
  warnings: string[];
  questionsForUser: string[];
  agentReview: DataOnboardingAgentReview;
};
