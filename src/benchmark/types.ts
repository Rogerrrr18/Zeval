/**
 * @fileoverview Benchmark Mode contracts.
 *
 * Benchmark Mode evaluates real business tasks across Agent frameworks and
 * model choices. It is intentionally separate from the legacy conversation
 * evaluation response so task-level benchmark scores can evolve without being
 * constrained by chatlog-only metrics.
 */

import type { DatasetCaseSource } from "@/eval-datasets/storage/types";

export type BenchmarkDomain =
  | "hr"
  | "finance"
  | "procurement"
  | "software"
  | "healthcare"
  | "research"
  | "custom";

export type BenchmarkCapabilityDimension =
  | "task_completion"
  | "instruction_following"
  | "factual_grounding"
  | "data_extraction"
  | "reasoning_quality"
  | "tool_use_correctness"
  | "format_compliance"
  | "latency_efficiency"
  | "safety_policy"
  | "business_judgment";

export type BenchmarkEvaluatorType =
  | "exact_match"
  | "regex_match"
  | "numeric_tolerance"
  | "f1_match"
  | "code_exec"
  | "unit_test"
  | "environment_state_test"
  | "llm_judge"
  | "human_label"
  | "hybrid";

export type BenchmarkRubricApprovalStatus = "candidate" | "approved" | "rejected";

export type BenchmarkScoringScale = {
  min: number;
  max: number;
  passThreshold: number;
};

export type BenchmarkEvaluatorConfig = {
  /**
   * Dot path into the normalized agent output. Example: "parsed.decision".
   */
  outputPath?: string;
  /**
   * Dot path into the benchmark case expected object. Example: "expected.decision".
   */
  expectedPath?: string;
  /**
   * Regex pattern for regex_match.
   */
  pattern?: string;
  /**
   * Numeric tolerance for numeric_tolerance. Defaults to 0.
   */
  tolerance?: number;
  /**
   * Output path for predicted set/list values in f1_match.
   */
  predictedItemsPath?: string;
  /**
   * Expected path for gold set/list values in f1_match.
   */
  expectedItemsPath?: string;
  /**
   * Rubric prompt or natural language criteria for llm_judge/human_label.
   */
  criteria?: string;
  /**
   * Child metric keys for hybrid metrics.
   */
  childMetricKeys?: string[];
};

export type BenchmarkRubricMetric = {
  metricKey: string;
  capability: BenchmarkCapabilityDimension;
  displayName: string;
  description: string;
  evaluatorType: BenchmarkEvaluatorType;
  weight: number;
  scale: BenchmarkScoringScale;
  approvalStatus: BenchmarkRubricApprovalStatus;
  evidenceRequired: boolean;
  humanApprovalRequired: boolean;
  failureTags: string[];
  config?: BenchmarkEvaluatorConfig;
};

export type BenchmarkRubricModule = {
  capability: BenchmarkCapabilityDimension;
  displayName: string;
  description: string;
  weight: number;
  metrics: BenchmarkRubricMetric[];
};

export type BenchmarkRubricSet = {
  rubricId: string;
  version: string;
  title: string;
  description: string;
  domain: BenchmarkDomain;
  modules: BenchmarkRubricModule[];
  generatedBy: "copilot" | "human" | "template" | "imported";
  approvalStatus: BenchmarkRubricApprovalStatus;
  createdAt: string;
  updatedAt: string;
};

export type BenchmarkTaskPackage = {
  benchmarkId: string;
  taskId: string;
  version: string;
  title: string;
  description: string;
  domain: BenchmarkDomain;
  requirementText: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  rubric: BenchmarkRubricSet;
  files?: Array<{
    fileId: string;
    relativePath: string;
    mediaType?: string;
    description?: string;
  }>;
  metadata?: Record<string, unknown>;
};

export type BenchmarkCase = {
  caseId: string;
  taskId: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
  /**
   * Full human labels are required in the first calibration phase.
   */
  humanLabels?: Record<string, BenchmarkHumanLabel>;
  source?: "imported" | "generated" | "manual" | "fixture";
  metadata?: Record<string, unknown>;
};

export type AgentFrameworkId = "claude_code" | "codex" | "hermes" | "openclaw";

export type BenchmarkModelId =
  | "deepseek-v4-flash"
  | "gpt-5.5"
  | "gpt-5.4-mini"
  | "mimo-v2-flash"
  | (string & {});

export type BenchmarkMatrixCell = {
  agentFramework: AgentFrameworkId;
  model: BenchmarkModelId;
  maxTurns?: number;
  timeoutMs?: number;
  concurrency?: number;
  enabled: boolean;
  metadata?: Record<string, unknown>;
};

export type BenchmarkAgentSubmissionStatus =
  | "completed"
  | "failed"
  | "timeout"
  | "no_output"
  | "skipped";

export type BenchmarkAgentSubmission = {
  submissionId: string;
  runId: string;
  benchmarkId: string;
  taskId: string;
  caseId: string;
  agentFramework: AgentFrameworkId;
  model: BenchmarkModelId;
  status: BenchmarkAgentSubmissionStatus;
  rawOutput: string;
  parsedOutput?: Record<string, unknown>;
  artifacts?: Record<string, unknown>;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  metadata?: Record<string, unknown>;
};

export type BenchmarkHumanLabel = {
  score: number;
  passed: boolean;
  reason: string;
  evidence?: string;
  reviewer?: string;
  labeledAt?: string;
};

export type BenchmarkMetricEvaluationStatus =
  | "scored"
  | "needs_human_review"
  | "unsupported"
  | "skipped"
  | "error";

export type BenchmarkMetricEvaluationResult = {
  runId: string;
  benchmarkId: string;
  taskId: string;
  caseId: string;
  submissionId: string;
  agentFramework: AgentFrameworkId;
  model: BenchmarkModelId;
  metricKey: string;
  metricWeight: number;
  capability: BenchmarkCapabilityDimension;
  evaluatorType: BenchmarkEvaluatorType;
  score: number;
  normalizedScore: number;
  passed: boolean;
  status: BenchmarkMetricEvaluationStatus;
  reason: string;
  evidence: string[];
  confidence: number;
  expected?: unknown;
  actual?: unknown;
  humanLabel?: BenchmarkHumanLabel;
  needsHumanReview: boolean;
  failureTags: string[];
};

export type BenchmarkCapabilityScore = {
  capability: BenchmarkCapabilityDimension;
  score: number;
  weight: number;
  metricCount: number;
  passedMetricCount: number;
  evidence: string[];
};

export type BenchmarkCaseScore = {
  runId: string;
  benchmarkId: string;
  taskId: string;
  caseId: string;
  submissionId: string;
  agentFramework: AgentFrameworkId;
  model: BenchmarkModelId;
  taskScore: number;
  passed: boolean;
  capabilityScores: BenchmarkCapabilityScore[];
  metricResults: BenchmarkMetricEvaluationResult[];
};

export type BenchmarkLeaderboardRow = {
  agentFramework: AgentFrameworkId;
  model: BenchmarkModelId;
  averageScore: number;
  taskCount: number;
  caseCount: number;
  passRate: number;
  capabilityScores: BenchmarkCapabilityScore[];
};

export type BenchmarkRunResult = {
  runId: string;
  benchmarkId: string;
  taskId: string;
  rubricId: string;
  matrix: BenchmarkMatrixCell[];
  cases: BenchmarkCase[];
  submissions: BenchmarkAgentSubmission[];
  metricResults: BenchmarkMetricEvaluationResult[];
  caseScores: BenchmarkCaseScore[];
  leaderboard: BenchmarkLeaderboardRow[];
  summary: {
    averageScore: number;
    caseCount: number;
    submissionCount: number;
    metricResultCount: number;
    badcaseCandidateCount: number;
    goldencaseCandidateCount: number;
    needsHumanReviewCount: number;
  };
  generatedAt: string;
};

export type BenchmarkDatasetCaseCandidate = {
  caseSetType: "badcase" | "goodcase";
  source: DatasetCaseSource;
  benchmarkId: string;
  taskId: string;
  caseId: string;
  submissionId: string;
  agentFramework: AgentFrameworkId;
  model: BenchmarkModelId;
  metricKey: string;
  capability: BenchmarkCapabilityDimension;
  score: number;
  evidence: string[];
  reason: string;
  transcript: string;
  tags: string[];
  metadata: Record<string, unknown>;
};

export type BenchmarkLlmJudgeResult = {
  score: number;
  reason: string;
  evidence: string[];
  confidence: number;
};

export type BenchmarkLlmJudge = (input: {
  metric: BenchmarkRubricMetric;
  taskCase: BenchmarkCase;
  submission: BenchmarkAgentSubmission;
}) => Promise<BenchmarkLlmJudgeResult>;
