/**
 * @fileoverview Unified metric contracts inspired by DeepEval-style test metrics.
 */

/**
 * Metric execution strategy.
 */
export type EvalMetricKind =
  | "rule"
  | "objective"
  | "llm_geval"
  | "llm_dag"
  | "structured"
  | "trace"
  | "gate"
  | "synthetic";

/**
 * Metric aggregation scope.
 */
export type EvalMetricScope = "turn" | "session" | "dataset" | "trace";

/**
 * Metric result status.
 */
export type EvalMetricStatus = "ready" | "degraded" | "skipped" | "error";

/**
 * Canonical fields that metric definitions may require.
 */
export type EvalRequiredField =
  | "turns"
  | "expected_output"
  | "retrieval_context"
  | "tools_called"
  | "expected_tools"
  | "trace"
  | "frames"
  | "slots"
  | "state"
  | "service_call"
  | "service_results"
  | "schema";

/**
 * Human and machine readable metric definition.
 */
export type EvalMetricDefinition = {
  id: string;
  displayName: string;
  description: string;
  category: "objective" | "subjective" | "structured" | "trace" | "business" | "synthetic";
  kind: EvalMetricKind;
  scope: EvalMetricScope;
  threshold: number;
  direction: "higher-is-better" | "lower-is-better";
  requiredFields: EvalRequiredField[];
  evaluator: "rule" | "llm" | "hybrid";
  proxyMetricId?: string;
};

/**
 * One normalized metric result emitted by the registry.
 */
export type EvalMetricResult = EvalMetricDefinition & {
  score: number | null;
  rawValue?: number | string;
  status: EvalMetricStatus;
  success: boolean | null;
  reason: string;
  evidence: string[];
  missingFields: EvalRequiredField[];
  confidence: number;
  latencyMs?: number;
  judgeModel?: string;
  cacheHit?: boolean;
};

/**
 * Aggregate metric health for a pipeline run.
 */
export type EvalMetricRegistrySnapshot = {
  generatedAt: string;
  definitions: EvalMetricDefinition[];
  results: EvalMetricResult[];
  passRate: number;
  readyCount: number;
  degradedCount: number;
  skippedCount: number;
  errorCount: number;
  gateStatus: "passed" | "warning" | "failed";
  gateReasons: string[];
};
