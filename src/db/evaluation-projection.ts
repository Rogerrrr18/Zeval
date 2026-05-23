/**
 * @fileoverview Projection from EvaluateResponse into typed relational records.
 *
 * P1 重构：
 *  - 移除 DbTopicSegment / DbBusinessKpiSignal / workspaceId
 *  - 新增 intent_sequences / intent_run_logs / intent_eval_metrics 投影
 *  - 新增 suggestions 投影
 *  - 所有记录使用 projectId (uuid string)
 */

import type { DbRecord, ZeroreDatabase } from "@/db";
import type {
  DbEvaluationProjectionRecord,
  DbEvaluationRun,
  DbEvidenceSpan,
  DbIntentEvalMetrics,
  DbIntentRunLog,
  DbIntentSequence,
  DbObjectiveSignal,
  DbRiskTag,
  DbSubjectiveSignal,
  DbSuggestion,
} from "@/db/schema";
import type { EvaluateResponse, IntentRunLog, ObjectiveMetrics } from "@/types/pipeline";

export type EvaluationProjectionOptions = {
  projectId: string;
  runId?: string;
  useLlm?: boolean;
  enableDynamicReplay?: boolean;
};

export type EvaluationProjection = {
  records: DbEvaluationProjectionRecord[];
  dbRecords: DbRecord[];
  summary: {
    evaluationRuns: number;
    intentSequences: number;
    intentRunLogs: number;
    intentEvalMetrics: number;
    objectiveSignals: number;
    subjectiveSignals: number;
    evidenceSpans: number;
    riskTags: number;
    suggestions: number;
  };
};

type EvidenceInput = {
  kind: string;
  quote: string;
  sessionId?: string;
  intentIndex?: number;
  startTurn?: number;
  endTurn?: number;
  source?: DbEvidenceSpan["source"];
};

/**
 * Project a completed evaluation response into normalized database records.
 *
 * @param response Completed evaluation response.
 * @param options Projection options.
 * @returns Projection records plus local database records.
 */
export function buildEvaluationProjection(
  response: EvaluateResponse,
  options: EvaluationProjectionOptions,
): EvaluationProjection {
  const { projectId } = options;
  const now = response.meta.generatedAt || new Date().toISOString();
  const runId = options.runId ?? response.runId;
  const evaluationRunId = stableId("eval-run", projectId, runId);
  const evidenceSpans: DbEvidenceSpan[] = [];

  // ── Evidence span builder ────────────────────────────────────────────────────

  const createEvidence = (input: EvidenceInput): string | undefined => {
    const quote = input.quote.trim();
    if (!quote) return undefined;
    const id = stableId(
      "evidence",
      projectId,
      runId,
      input.kind,
      input.sessionId ?? "run",
      input.startTurn ?? "na",
      quote,
    );
    if (!evidenceSpans.some((item) => item.id === id)) {
      evidenceSpans.push({
        table: "evidence_spans",
        id,
        projectId,
        evaluationRunId,
        sessionId: input.sessionId,
        intentIndex: input.intentIndex,
        evidenceKind: input.kind,
        quote,
        startTurn: input.startTurn,
        endTurn: input.endTurn,
        source: input.source ?? "rule",
        createdAt: now,
      });
    }
    return id;
  };

  // ── evaluation_runs ──────────────────────────────────────────────────────────

  const evaluationRun: DbEvaluationRun = {
    table: "evaluation_runs",
    id: evaluationRunId,
    projectId,
    runKey: runId,
    scenarioId: response.meta.scenarioContext?.scenarioId,
    status: "succeeded",
    useLlm: Boolean(options.useLlm),
    dynamicReplayEnabled: Boolean(options.enableDynamicReplay),
    sessionCount: response.meta.sessions,
    messageCount: response.meta.messages,
    hasTimestamp: response.meta.hasTimestamp,
    warnings: response.meta.warnings,
    artifactUri: response.artifactPath,
    generatedAt: response.meta.generatedAt,
    reportPayload: {
      summaryCards: response.summaryCards,
      piiRedaction: response.meta.piiRedaction,
      scenarioContext: response.meta.scenarioContext,
      dynamicReplayStatus: response.dynamicReplayStatus,
    },
    createdAt: now,
  };

  // ── objective_signals ─────────────────────────────────────────────────────────

  const objectiveSignals = buildObjectiveSignals(response.objectiveMetrics, {
    projectId,
    evaluationRunId,
    now,
  });

  // ── subjective_signals ────────────────────────────────────────────────────────

  const subjectiveSignals: DbSubjectiveSignal[] = response.subjectiveMetrics.dimensions.map(
    (dimension) => {
      const evidenceSpanId = createEvidence({
        kind: "subjective_dimension",
        quote: dimension.evidence,
        source: "llm",
      });
      return {
        table: "subjective_signals",
        id: stableId("subjective-signal", projectId, runId, dimension.dimension),
        projectId,
        evaluationRunId,
        dimensionKey: slugify(dimension.dimension),
        dimensionLabel: dimension.dimension,
        score: dimension.score,
        reason: dimension.reason,
        source: "llm",
        confidence: dimension.confidence,
        evidenceSpanId,
        createdAt: now,
      };
    },
  );

  // ── risk_tags ─────────────────────────────────────────────────────────────────

  const riskTags: DbRiskTag[] = [];

  for (const signal of response.subjectiveMetrics.signals) {
    const evidenceSpanId = createEvidence({
      kind: "implicit_signal",
      quote: signal.evidence,
      sessionId: parseEvidenceSessionId(signal.evidenceTurnRange),
      startTurn: parseEvidenceTurnRange(signal.evidenceTurnRange).startTurn,
      endTurn: parseEvidenceTurnRange(signal.evidenceTurnRange).endTurn,
      source: "inferred",
    });
    riskTags.push({
      table: "risk_tags",
      id: stableId("risk-tag", projectId, runId, signal.signalKey),
      projectId,
      evaluationRunId,
      sessionId: parseEvidenceSessionId(signal.evidenceTurnRange),
      tagKey: signal.signalKey,
      score: signal.score,
      severity: signal.severity,
      reason: signal.reason,
      evidenceSpanId,
      source: "inferred",
      createdAt: now,
    });
  }

  for (const badCase of response.badCaseAssets) {
    for (const tag of badCase.tags) {
      const quote = badCase.evidence
        .map((item) => `[turn ${item.turnIndex}] ${item.content}`)
        .join("\n");
      const evidenceSpanId = quote
        ? createEvidence({
            kind: "bad_case",
            quote,
            sessionId: badCase.sessionId,
            startTurn: badCase.evidence[0]?.turnIndex,
            endTurn: badCase.evidence[badCase.evidence.length - 1]?.turnIndex,
            source: "rule",
          })
        : undefined;
      riskTags.push({
        table: "risk_tags",
        id: stableId("risk-tag", projectId, runId, badCase.caseKey, tag),
        projectId,
        evaluationRunId,
        sessionId: badCase.sessionId,
        tagKey: tag,
        score: badCase.severityScore,
        reason: badCase.title,
        evidenceSpanId,
        source: "rule",
        createdAt: now,
      });
    }
  }

  // ── suggestions ───────────────────────────────────────────────────────────────

  const suggestions: DbSuggestion[] = response.suggestions.map((text, index) => ({
    table: "suggestions",
    id: stableId("suggestion", projectId, runId, String(index)),
    projectId,
    evaluationRunId,
    title: extractSuggestionTitle(text),
    problem: text,
    impact: "",
    action: text,
    triggerMetricKeys: [],
    priority: index + 1,
    createdAt: now,
  }));

  // ── intent_sequences / intent_run_logs / intent_eval_metrics ─────────────────

  const intentSequences: DbIntentSequence[] = [];
  const intentRunLogs: DbIntentRunLog[] = [];
  const intentEvalMetrics: DbIntentEvalMetrics[] = [];

  if (
    response.dynamicReplayStatus !== "skipped" &&
    response.intentSequences &&
    response.intentRunLogs
  ) {
    for (const seqDoc of response.intentSequences) {
      const intentSequenceId = stableId(
        "intent-seq",
        projectId,
        runId,
        seqDoc.sessionId,
      );
      intentSequences.push({
        table: "intent_sequences",
        id: intentSequenceId,
        projectId,
        evaluationRunId,
        sessionId: seqDoc.sessionId,
        schemaVersion: seqDoc.schemaVersion,
        schemaLockRevision: seqDoc.schemaLockRevision,
        intentSequence: seqDoc.intentSequence as unknown as Record<string, unknown>[],
        refillables: seqDoc.refillables as unknown as Record<string, unknown>[],
        lockStatus: seqDoc.lockStatus,
        intentCount: seqDoc.intentSequence.length,
        refillableCount: seqDoc.refillables.length,
        updatedAt: now,
        createdAt: now,
      });
    }

    const seqIdBySession = new Map<string, string>(
      response.intentSequences.map((seq) => [
        seq.sessionId,
        stableId("intent-seq", projectId, runId, seq.sessionId),
      ]),
    );

    for (const sessionLogs of response.intentRunLogs) {
      for (const log of sessionLogs) {
        const intentSequenceId = seqIdBySession.get(log.sessionId) ?? stableId("intent-seq", projectId, runId, log.sessionId);
        intentRunLogs.push({
          table: "intent_run_logs",
          id: stableId("intent-log", projectId, runId, log.sessionId, String(log.intentIndex), String(log.turnCount)),
          projectId,
          evaluationRunId,
          sessionId: log.sessionId,
          intentSequenceId,
          intentIndex: log.intentIndex,
          turnCount: log.turnCount,
          budget: log.budget,
          userText: log.userText,
          assistantText: log.assistantText,
          judgeLabel: log.judgeLabel,
          rationale: log.rationale,
          evidenceQuote: log.evidenceQuote,
          events: log.events,
          createdAt: now,
        });
      }
    }

    // Compute per-session intent eval metrics from run logs
    if (response.intentMetrics) {
      for (const sessionMetrics of response.intentMetrics.perSession) {
        const intentSequenceId = seqIdBySession.get(sessionMetrics.sessionId) ?? stableId("intent-seq", projectId, runId, sessionMetrics.sessionId);
        intentEvalMetrics.push({
          table: "intent_eval_metrics",
          id: stableId("intent-metrics", projectId, runId, sessionMetrics.sessionId),
          projectId,
          evaluationRunId,
          sessionId: sessionMetrics.sessionId,
          intentSequenceId,
          intentCompletionRate: sessionMetrics.intentCompletionRate,
          clarificationEfficiency: sessionMetrics.clarificationEfficiency,
          deviationRate: sessionMetrics.deviationRate,
          turnEfficiency: sessionMetrics.turnEfficiency,
          intentCount: sessionMetrics.intentCount,
          satisfiedCount: sessionMetrics.satisfiedCount,
          budgetFailedCount: sessionMetrics.budgetFailedCount,
          totalReplayTurns: sessionMetrics.totalReplayTurns,
          skippedReason: sessionMetrics.skippedReason,
          createdAt: now,
        });
      }
    }
  }

  // ── Assemble ──────────────────────────────────────────────────────────────────

  const records: DbEvaluationProjectionRecord[] = [
    evaluationRun,
    ...intentSequences,
    ...intentRunLogs,
    ...intentEvalMetrics,
    ...objectiveSignals,
    ...subjectiveSignals,
    ...evidenceSpans,
    ...riskTags,
    ...suggestions,
  ];

  return {
    records,
    dbRecords: records.map(toDbRecord),
    summary: {
      evaluationRuns: 1,
      intentSequences: intentSequences.length,
      intentRunLogs: intentRunLogs.length,
      intentEvalMetrics: intentEvalMetrics.length,
      objectiveSignals: objectiveSignals.length,
      subjectiveSignals: subjectiveSignals.length,
      evidenceSpans: evidenceSpans.length,
      riskTags: riskTags.length,
      suggestions: suggestions.length,
    },
  };
}

/**
 * Persist an evaluation projection through the active database adapter.
 *
 * @param database Database adapter.
 * @param projection Projection payload.
 */
export async function persistEvaluationProjection(
  database: ZeroreDatabase,
  projection: EvaluationProjection,
): Promise<void> {
  for (const record of projection.dbRecords) {
    await database.upsert(record);
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function buildObjectiveSignals(
  metrics: ObjectiveMetrics,
  context: {
    projectId: string;
    evaluationRunId: string;
    now: string;
  },
): DbObjectiveSignal[] {
  return Object.entries(metrics).map(([metricKey, value]) => ({
    table: "objective_signals",
    id: stableId("objective-signal", context.projectId, context.evaluationRunId, metricKey),
    projectId: context.projectId,
    evaluationRunId: context.evaluationRunId,
    metricKey,
    numericValue: typeof value === "number" ? value : undefined,
    jsonValue: typeof value === "number" ? undefined : value,
    source: "rule",
    confidence: 1,
    createdAt: context.now,
  }));
}

function toDbRecord(record: DbEvaluationProjectionRecord): DbRecord {
  const base = record as DbEvaluationProjectionRecord & { createdAt?: string };
  return {
    id: record.id,
    projectId: record.projectId,
    type: record.table,
    payload: record,
    createdAt: base.createdAt ?? new Date().toISOString(),
    updatedAt: base.createdAt ?? new Date().toISOString(),
  };
}

function extractSuggestionTitle(text: string): string {
  // Extract priority label (P0/P1/P2) and first clause as title
  const match = /^(P\d)[:：](.{0,40})/.exec(text);
  if (match) return `${match[1]} ${match[2].trim()}`.slice(0, 60);
  return text.slice(0, 60);
}

function parseEvidenceSessionId(value: string): string | undefined {
  const match = /^([^:]+):/.exec(value);
  return match?.[1];
}

function parseEvidenceTurnRange(value: string): { startTurn?: number; endTurn?: number } {
  const match = /:(\d+)-(\d+)/.exec(value);
  if (!match) return {};
  return { startTurn: Number(match[1]), endTurn: Number(match[2]) };
}

function stableId(...parts: Array<string | number>): string {
  return parts.map((part) => slugify(String(part))).filter(Boolean).join("_");
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9一-龥]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 120) || "unknown"
  );
}
