/**
 * @fileoverview Shared contracts for raw, enriched and presentation layers.
 *
 * P1 重构：已移除 TopicSegment / EmotionPolarity / EmotionIntensity 等
 * topic 切分与情绪链路类型。会话结构化单元统一由 IntentSequenceDoc 承担。
 */

import type { ScenarioEvaluation } from "@/types/scenario";
import type { StructuredTaskMetrics } from "@/types/rich-conversation";
import type { EvalMetricRegistrySnapshot } from "@/types/eval-metric";
import type { EvalTrace } from "@/types/eval-trace";
import type { EvalCaseBundle } from "@/types/eval-case";
import type { ExtendedMetricsBundle } from "@/types/extended-metrics";

/**
 * Supported upload formats for raw chatlog ingestion.
 */
export type UploadFormat = "csv" | "json" | "jsonl" | "txt" | "md";

/**
 * Supported message roles.
 */
export type ChatRole = "user" | "assistant" | "system";

/**
 * Raw chat row ingested from user-provided logs.
 */
export type RawChatlogRow = {
  sessionId: string;
  timestamp: string;
  role: ChatRole;
  content: string;
};

/**
 * Normalized row after sorting and time parsing.
 */
export type NormalizedChatlogRow = RawChatlogRow & {
  turnIndex: number;
  timestampMs: number | null;
  activeHour: number | null;
};

/**
 * Tracks how a field is produced to keep enrichment transparent.
 */
export type FieldSource = "raw" | "rule" | "llm" | "inferred" | "fallback";

/**
 * Enriched row — minimal row-level signals after topic/emotion removal.
 * Only deterministic, LLM-free fields remain here.
 */
export type EnrichedChatlogRow = NormalizedChatlogRow & {
  /** Seconds since the previous message in this session (null if no prior message). */
  responseGapSec: number | null;
  /** True if this is the last assistant turn (possible dropoff signal). */
  isDropoffTurn: boolean;
  /** True if the message ends with a question mark. */
  isQuestion: boolean;
  /** Estimated token count (content.length / 1.6, clamped to ≥ 1). */
  tokenCountEstimate: number;
};

/**
 * Supported chart keys for the MVP release (topic/emotion charts removed).
 */
export type ChartKey =
  | "dropoffDistribution"
  | "activeHourDistribution";

/**
 * Supported frontend chart render types.
 */
export type ChartType = "line" | "bar" | "area";

/**
 * Generic chart payload consumed by frontend chart components.
 */
export type ChartPayload = {
  chartKey: ChartKey;
  title: string;
  description: string;
  chartType: ChartType;
  xField: string;
  yField: string;
  seriesField?: string;
  data: Array<Record<string, string | number | boolean | null>>;
};

/**
 * Summary card item shown in the frontend metric overview.
 */
export type SummaryCard = {
  key: string;
  label: string;
  value: string;
  hint: string;
};

/**
 * Scenario-specific context collected before evaluation.
 */
export type ScenarioEvaluateContext = {
  scenarioId?: string;
  onboardingAnswers: Record<string, string>;
};

/**
 * Aggregated objective metrics (topic/emotion fields removed).
 */
export type ObjectiveMetrics = {
  sessionDepthDistribution: Record<string, number>;
  dropoffTurnDistribution: Record<string, number>;
  avgResponseGapSec: number;
  userQuestionRepeatRate: number;
  agentResolutionSignalRate: number;
  escalationKeywordHitRate: number;
  activeHourDistribution: Record<string, number>;
  userQuestionRate: number;
  avgUserMessageLength: number;
  userMessageLengthTrend: number;
  avgAssistantMessageLength: number;
};

/**
 * Supported implicit signal identifiers.
 */
export type ImplicitSignalKey =
  | "interestDeclineRisk"
  | "understandingBarrierRisk";

/**
 * Structured implicit signal extracted from enriched behavior patterns.
 */
export type ImplicitSignal = {
  signalKey: ImplicitSignalKey;
  score: number;
  severity: "low" | "medium" | "high";
  triggeredRules: string[];
  reason: string;
  evidence: string;
  evidenceTurnRange: string;
  confidence: number;
};

/**
 * Structured subjective scoring result.
 */
export type SubjectiveDimensionResult = {
  dimension: string;
  score: number;
  reason: string;
  evidence: string;
  confidence: number;
};

/**
 * Aggregated subjective metrics (emotionCurve / emotionTurningPoints removed).
 */
export type SubjectiveMetrics = {
  status: "ready" | "degraded" | "pending_llm_integration";
  dimensions: SubjectiveDimensionResult[];
  signals: ImplicitSignal[];
  goalCompletions: GoalCompletionResult[];
  recoveryTraces: RecoveryTraceResult[];
};

/**
 * Goal completion evaluation status per session.
 */
export type GoalCompletionStatus = "achieved" | "partial" | "failed" | "unclear";

/**
 * Session-level goal completion result.
 */
export type GoalCompletionResult = {
  sessionId: string;
  status: GoalCompletionStatus;
  score: number;
  userIntent: string;
  intentSource: FieldSource;
  achievementEvidence: string[];
  failureReasons: string[];
  triggeredRules: string[];
  confidence: number;
  source: FieldSource;
};

/**
 * Classified failure pattern that seeds a recovery trace.
 */
export type RecoveryFailureType =
  | "ignore"
  | "understanding-barrier"
  | "unknown";

/**
 * Session-level recovery trace result.
 */
export type RecoveryTraceResult = {
  sessionId: string;
  status: "none" | "completed" | "failed";
  failureTurn: number | null;
  recoveryTurn: number | null;
  spanTurns: number | null;
  failureType: RecoveryFailureType;
  repairStrategy: string | null;
  repairStrategySource: FieldSource;
  qualityScore: number;
  evidence: Array<{
    turnIndex: number;
    role: ChatRole;
    content: string;
  }>;
  triggeredRules: string[];
  confidence: number;
};

/**
 * Supported failure tags for harvested bad cases.
 */
export type BadCaseTag =
  | "goal_failed"
  | "goal_partial"
  | "goal_unclear"
  | "recovery_failed"
  | "understanding_barrier"
  | "question_repeat"
  | "escalation_keyword"
  | "long_response_gap";

/**
 * Session-level bad case asset extracted from one evaluation run.
 */
export type BadCaseAsset = {
  caseKey: string;
  sessionId: string;
  title: string;
  severityScore: number;
  normalizedTranscriptHash: string;
  duplicateGroupKey: string;
  tags: BadCaseTag[];
  transcript: string;
  evidence: Array<{
    turnIndex: number;
    role: ChatRole;
    content: string;
  }>;
  autoSignals?: Array<
    | { kind: "negative_keyword"; keyword: string; turnIndex: number }
    | { kind: "metric"; metric: "responseGap" | "shortTurns"; value: number }
    | { kind: "implicit_signal"; signalId: string }
  >;
  suggestedAction: string;
  sourceRunId: string;
};

/**
 * Metadata returned for a completed evaluation run.
 */
export type EvaluateMeta = {
  sessions: number;
  messages: number;
  hasTimestamp: boolean;
  generatedAt: string;
  warnings: string[];
  savedEvaluatePath?: string;
  scenarioContext?: ScenarioEvaluateContext;
  piiRedaction?: {
    enabled: boolean;
    redactedRows: number;
    redactedFields: number;
    categories: string[];
  };
  organizationId?: string;
  projectId?: string;
  workspaceId?: string;
};

/**
 * Ingest response contract returned to frontend.
 */
export type IngestResponse = {
  format: UploadFormat;
  fileName: string;
  rawRows: RawChatlogRow[];
  canonicalCsv: string;
  previewTop20: string[];
  structuredTaskMetrics?: StructuredTaskMetrics;
  ingestMeta: {
    sessions: number;
    rows: number;
    hasTimestamp: boolean;
    organizationId?: string;
    projectId?: string;
    workspaceId?: string;
    piiRedaction?: {
      enabled: boolean;
      redactedRows: number;
      redactedFields: number;
      categories: string[];
    };
  };
  warnings: string[];
};

// ── Intent Pointer Dynamic Evaluation types ──────────────────────────────────

/**
 * One intent item within an IntentSequenceDoc.
 */
export type IntentItem = {
  intentIndex: number;
  intentText: string;
  /** Which user-turn span in the original session this intent covers. */
  turnSpanUserTurns: [number, number];
  exampleUserQueries: string[];
  successCriteria: string;
  dependsOn: number[];
  /** Historical excerpt (from original session) for context injection. */
  historicalSpan?: string;
};

/**
 * One refillable fact item that can be injected into SimUser queries.
 */
export type RefillableItem = {
  refillIndex: number;
  triggerCondition: string;
  refillReference: string;
  key: string;
  injectionText: string;
  confidence: number;
};

/**
 * Full intent sequence document for one session (draft or locked).
 */
export type IntentSequenceDoc = {
  schemaVersion: string;
  sessionId: string;
  schemaLockRevision: number;
  lockStatus: "draft" | "locked";
  intentSequence: IntentItem[];
  refillables: RefillableItem[];
};

/**
 * Judge label emitted by SimUser-as-Judge at each replay turn.
 */
export type IntentJudgeLabel =
  | "SATISFIED"
  | "NOT_SATISFIED"
  | "DEVIATION"
  | "FALLBACK_NOT_SATISFIED"
  | "SKIPPED_GEN_FAILURE";

/**
 * One log entry from the SimUser dynamic replay loop.
 */
export type IntentRunLog = {
  sessionId: string;
  intentIndex: number;
  turnCount: number;
  budget: number;
  userText: string;
  assistantText: string;
  judgeLabel: IntentJudgeLabel;
  rationale?: string;
  evidenceQuote?: string;
  events: string[];
};

/**
 * Per-session intent eval metrics computed from RunLog.
 */
export type SessionIntentMetrics = {
  sessionId: string;
  intentCount: number;
  satisfiedCount: number;
  budgetFailedCount: number;
  totalReplayTurns: number;
  historicalTurns: number;
  /** Ratio of intents satisfied. */
  intentCompletionRate: number;
  /** Total clarification turns across all intents / k. */
  clarificationEfficiency: number;
  /** DEVIATION turns / total replay turns. */
  deviationRate: number;
  /** T_eval / T_hist. */
  turnEfficiency: number;
  skippedReason?: string;
};

/**
 * Aggregated intent eval metrics across all sessions in one run.
 */
export type IntentEvalMetrics = {
  aggregate: {
    intentCompletionRate: number;
    clarificationEfficiency: number;
    deviationRate: number;
    turnEfficiency: number;
  };
  perSession: SessionIntentMetrics[];
};

/**
 * Status of the dynamic replay pipeline for one evaluation run.
 */
export type DynamicReplayStatus =
  | "skipped"      // enableDynamicReplay=false
  | "completed"    // all sessions processed
  | "partial"      // some sessions failed but at least one succeeded
  | "failed";      // all sessions failed or lock file missing

/**
 * Evaluate response contract returned to frontend.
 */
export type EvaluateResponse = {
  runId: string;
  meta: EvaluateMeta;
  summaryCards: SummaryCard[];
  enrichedRows: EnrichedChatlogRow[];
  enrichedCsv: string;
  artifactPath?: string;
  objectiveMetrics: ObjectiveMetrics;
  subjectiveMetrics: SubjectiveMetrics;
  structuredTaskMetrics?: StructuredTaskMetrics;
  trace?: EvalTrace;
  evalCaseBundle?: EvalCaseBundle;
  metricRegistry?: EvalMetricRegistrySnapshot;
  scenarioEvaluation: ScenarioEvaluation | null;
  badCaseAssets: BadCaseAsset[];
  /** DeepEval-aligned extended metrics. Null fields mean corresponding input was not provided. */
  extendedMetrics?: ExtendedMetricsBundle;
  charts: ChartPayload[];
  suggestions: string[];
  /** Dynamic replay status. "skipped" when enableDynamicReplay=false. */
  dynamicReplayStatus: DynamicReplayStatus;
  /** Null when dynamicReplayStatus="skipped". */
  intentMetrics: IntentEvalMetrics | null;
  /** Per-session intent sequence documents. Null when dynamicReplayStatus="skipped". */
  intentSequences: IntentSequenceDoc[] | null;
  /** Per-session run logs. Null when dynamicReplayStatus="skipped". */
  intentRunLogs: IntentRunLog[][] | null;
};
