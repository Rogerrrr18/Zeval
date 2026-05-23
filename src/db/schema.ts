/**
 * @fileoverview Relational schema constants and TypeScript record contracts.
 *
 * P1 重构：
 *  - 移除 DbTopicSegment / DbBusinessKpiSignal / topic_segments / business_kpi_signals
 *  - 移除 zerore_records / workspaces / users / workspace_members 旧兼容层
 *  - 新增 DbIntentSequence / DbIntentRunLog / DbIntentEvalMetrics / DbSuggestion
 *  - 所有信号表不再使用 workspaceId 字段，改用 projectId（uuid string）
 */

// ── Table name registry ──────────────────────────────────────────────────────

export const DB_TABLES = [
  // Org & Project
  "organizations",
  "projects",
  "project_members",
  "api_keys",
  "audit_logs",
  // Data ingestion
  "datasets",
  "dataset_imports",
  "sessions",
  "message_turns",
  "turn_enrichments",
  // Evaluation pipeline
  "evaluation_runs",
  "judge_runs",
  "intent_sequences",
  "intent_run_logs",
  "intent_eval_metrics",
  // Signal layer
  "objective_signals",
  "subjective_signals",
  "risk_tags",
  "evidence_spans",
  "suggestions",
  // Baseline & online eval
  "baselines",
  "baseline_runs",
  "online_eval_runs",
  "replay_turns",
  "run_comparisons",
  // Eval dataset & regression
  "eval_cases",
  "eval_case_baselines",
  "eval_case_candidates",
  "dataset_admission_rules",
  "sample_batches",
  "sample_batch_cases",
  "capability_attributions",
  "experiment_routes",
  "validation_runs",
  "validation_results",
  "validation_generalization_reports",
  // Synthesis
  "synthesis_templates",
  "synthesis_runs",
  "synthesized_samples",
  // Remediation
  "remediation_packages",
  "remediation_artifacts",
  // Async (Post-MVP)
  "agent_runs",
  "jobs",
] as const;

export type DbTableName = (typeof DB_TABLES)[number];

// ── Shared types ─────────────────────────────────────────────────────────────

export type DbEvalSource = "raw" | "rule" | "llm" | "inferred" | "fallback" | "human" | "system" | "import";

export type JsonObject = Record<string, unknown>;

/**
 * Base entity fields shared by all typed DB records.
 * Uses uuid strings for all IDs (matching new UUID primary key schema).
 */
export type DbBaseRecord = {
  id: string;
  projectId: string;
  createdAt: string;
};

// ── Evaluation runs ──────────────────────────────────────────────────────────

export type DbEvaluationRun = DbBaseRecord & {
  table: "evaluation_runs";
  runKey: string;
  scenarioId?: string;
  status: string;
  useLlm: boolean;
  dynamicReplayEnabled: boolean;
  sessionCount: number;
  messageCount: number;
  hasTimestamp: boolean;
  warnings: string[];
  reportPayload?: JsonObject;
  artifactUri?: string;
  generatedAt: string;
};

// ── LLM Judge ────────────────────────────────────────────────────────────────

export type DbJudgeRunStatus = "succeeded" | "parse_failed" | "http_failed" | "skipped";

export type DbJudgeRun = DbBaseRecord & {
  table: "judge_runs";
  evaluationRunId: string;
  stage: string;
  model: string;
  promptVersion?: string;
  inputRef?: JsonObject;
  outputJson?: JsonObject;
  status: DbJudgeRunStatus;
  latencyMs?: number;
  errorMessage?: string;
};

// ── Intent Pointer ────────────────────────────────────────────────────────────

export type DbIntentSequence = DbBaseRecord & {
  table: "intent_sequences";
  evaluationRunId: string;
  sessionId: string;
  schemaVersion: string;
  schemaLockRevision: number;
  intentSequence: JsonObject[];
  refillables: JsonObject[];
  lockStatus: "draft" | "locked";
  intentCount: number;
  refillableCount: number;
  extractJudgeRunId?: string;
  updatedAt: string;
};

export type DbIntentJudgeLabel =
  | "SATISFIED"
  | "NOT_SATISFIED"
  | "DEVIATION"
  | "FALLBACK_NOT_SATISFIED"
  | "SKIPPED_GEN_FAILURE";

export type DbIntentRunLog = DbBaseRecord & {
  table: "intent_run_logs";
  evaluationRunId: string;
  sessionId: string;
  intentSequenceId: string;
  intentIndex: number;
  turnCount: number;
  budget: number;
  userText: string;
  assistantText: string;
  judgeLabel: DbIntentJudgeLabel;
  rationale?: string;
  evidenceQuote?: string;
  events: string[];
  simuserJudgeRunId?: string;
  intentJudgeRunId?: string;
};

export type DbIntentEvalMetrics = DbBaseRecord & {
  table: "intent_eval_metrics";
  evaluationRunId: string;
  sessionId: string;
  intentSequenceId: string;
  intentCompletionRate: number;
  clarificationEfficiency: number;
  deviationRate: number;
  turnEfficiency: number;
  intentCount: number;
  satisfiedCount: number;
  budgetFailedCount: number;
  totalReplayTurns: number;
  skippedReason?: string;
};

// ── Signal layer ─────────────────────────────────────────────────────────────

export type DbEvidenceSpan = DbBaseRecord & {
  table: "evidence_spans";
  evaluationRunId?: string;
  sessionId?: string;
  intentIndex?: number;
  evidenceKind: string;
  quote: string;
  startTurn?: number;
  endTurn?: number;
  source: DbEvalSource;
  metadata?: JsonObject;
};

export type DbObjectiveSignal = DbBaseRecord & {
  table: "objective_signals";
  evaluationRunId: string;
  sessionId?: string;
  metricKey: string;
  numericValue?: number;
  stringValue?: string;
  jsonValue?: unknown;
  source: DbEvalSource;
  confidence?: number;
  evidenceSpanId?: string;
};

export type DbSubjectiveSignal = DbBaseRecord & {
  table: "subjective_signals";
  evaluationRunId: string;
  sessionId?: string;
  intentIndex?: number;
  dimensionKey: string;
  dimensionLabel?: string;
  score: number;
  reason: string;
  source: DbEvalSource;
  confidence?: number;
  evidenceSpanId?: string;
  judgeRunId?: string;
};

export type DbRiskTag = DbBaseRecord & {
  table: "risk_tags";
  evaluationRunId: string;
  sessionId?: string;
  intentIndex?: number;
  tagKey: string;
  score?: number;
  severity?: string;
  reason?: string;
  triggeredRules?: JsonObject;
  source: DbEvalSource;
  confidence?: number;
  evidenceSpanId?: string;
};

export type DbSuggestion = DbBaseRecord & {
  table: "suggestions";
  evaluationRunId: string;
  title: string;
  problem: string;
  impact: string;
  action: string;
  triggerMetricKeys: string[];
  evidenceSpanId?: string;
  priority: number;
};

// ── Unions ────────────────────────────────────────────────────────────────────

export type DbQualitySignal =
  | DbObjectiveSignal
  | DbSubjectiveSignal
  | DbRiskTag;

export type DbEvaluationProjectionRecord =
  | DbEvaluationRun
  | DbJudgeRun
  | DbIntentSequence
  | DbIntentRunLog
  | DbIntentEvalMetrics
  | DbEvidenceSpan
  | DbQualitySignal
  | DbSuggestion;

export const EVALUATION_PROJECTION_TABLES = [
  "evaluation_runs",
  "judge_runs",
  "intent_sequences",
  "intent_run_logs",
  "intent_eval_metrics",
  "objective_signals",
  "subjective_signals",
  "risk_tags",
  "evidence_spans",
  "suggestions",
] as const satisfies readonly DbTableName[];

export type EvaluationProjectionTableName = (typeof EVALUATION_PROJECTION_TABLES)[number];
