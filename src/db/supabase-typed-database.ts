/**
 * @fileoverview Typed Supabase/Postgres writer for the P1 evaluation pipeline.
 *
 * This module writes directly to the 43 typed tables defined in
 * supabase/migrations/20260516000100_target_schema_v2.sql.
 *
 * Each table writer uses INSERT … ON CONFLICT DO UPDATE (upsert) keyed by
 * the record's `id` field (UUID string).
 *
 * Usage:
 *   const db = createSupabaseTypedDatabase();
 *   await db.writeEvaluationProjection(projection);
 */

import { Pool } from "pg";
import type { PoolConfig } from "pg";
import type { EvaluationProjection } from "@/db/evaluation-projection";
import type {
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

export class SupabaseTypedDatabase {
  private readonly pool: Pool;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
  }

  /**
   * Write a full evaluation projection to typed tables.
   * Idempotent — all writes use ON CONFLICT DO UPDATE.
   */
  async writeEvaluationProjection(projection: EvaluationProjection): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");

      for (const record of projection.records) {
        switch (record.table) {
          case "evaluation_runs":
            await this.upsertEvaluationRun(client, record as DbEvaluationRun);
            break;
          case "intent_sequences":
            await this.upsertIntentSequence(client, record as DbIntentSequence);
            break;
          case "intent_run_logs":
            await this.upsertIntentRunLog(client, record as DbIntentRunLog);
            break;
          case "intent_eval_metrics":
            await this.upsertIntentEvalMetrics(client, record as DbIntentEvalMetrics);
            break;
          case "objective_signals":
            await this.upsertObjectiveSignal(client, record as DbObjectiveSignal);
            break;
          case "subjective_signals":
            await this.upsertSubjectiveSignal(client, record as DbSubjectiveSignal);
            break;
          case "evidence_spans":
            await this.upsertEvidenceSpan(client, record as DbEvidenceSpan);
            break;
          case "risk_tags":
            await this.upsertRiskTag(client, record as DbRiskTag);
            break;
          case "suggestions":
            await this.upsertSuggestion(client, record as DbSuggestion);
            break;
          default:
            // Skip tables not in the projection set
            break;
        }
      }

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  private async upsertEvaluationRun(client: import("pg").PoolClient, record: DbEvaluationRun): Promise<void> {
    await client.query(
      `
        insert into evaluation_runs (
          id, project_id, run_key, scenario_id, status, use_llm,
          dynamic_replay_enabled, session_count, message_count, has_timestamp,
          warnings, report_payload, artifact_uri, generated_at, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,$15)
        on conflict (id) do update set
          status = excluded.status,
          report_payload = excluded.report_payload,
          artifact_uri = excluded.artifact_uri,
          generated_at = excluded.generated_at
      `,
      [
        record.id,
        record.projectId,
        record.runKey,
        record.scenarioId ?? null,
        record.status,
        record.useLlm,
        record.dynamicReplayEnabled,
        record.sessionCount,
        record.messageCount,
        record.hasTimestamp,
        record.warnings,
        record.reportPayload ? JSON.stringify(record.reportPayload) : null,
        record.artifactUri ?? null,
        record.generatedAt,
        record.createdAt,
      ],
    );
  }

  private async upsertIntentSequence(client: import("pg").PoolClient, record: DbIntentSequence): Promise<void> {
    await client.query(
      `
        insert into intent_sequences (
          id, project_id, evaluation_run_id, session_id, schema_version,
          schema_lock_revision, intent_sequence, refillables, lock_status,
          intent_count, refillable_count, extract_judge_run_id, updated_at, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11,$12,$13,$14)
        on conflict (id) do update set
          schema_lock_revision = excluded.schema_lock_revision,
          intent_sequence = excluded.intent_sequence,
          refillables = excluded.refillables,
          lock_status = excluded.lock_status,
          intent_count = excluded.intent_count,
          refillable_count = excluded.refillable_count,
          updated_at = excluded.updated_at
      `,
      [
        record.id,
        record.projectId,
        record.evaluationRunId,
        record.sessionId,
        record.schemaVersion,
        record.schemaLockRevision,
        JSON.stringify(record.intentSequence),
        JSON.stringify(record.refillables),
        record.lockStatus,
        record.intentCount,
        record.refillableCount,
        record.extractJudgeRunId ?? null,
        record.updatedAt,
        record.createdAt,
      ],
    );
  }

  private async upsertIntentRunLog(client: import("pg").PoolClient, record: DbIntentRunLog): Promise<void> {
    await client.query(
      `
        insert into intent_run_logs (
          id, project_id, evaluation_run_id, session_id, intent_sequence_id,
          intent_index, turn_count, budget, user_text, assistant_text,
          judge_label, rationale, evidence_quote, events,
          simuser_judge_run_id, intent_judge_run_id, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        on conflict (id) do update set
          judge_label = excluded.judge_label,
          rationale = excluded.rationale,
          evidence_quote = excluded.evidence_quote
      `,
      [
        record.id,
        record.projectId,
        record.evaluationRunId,
        record.sessionId,
        record.intentSequenceId,
        record.intentIndex,
        record.turnCount,
        record.budget,
        record.userText,
        record.assistantText,
        record.judgeLabel,
        record.rationale ?? null,
        record.evidenceQuote ?? null,
        record.events,
        record.simuserJudgeRunId ?? null,
        record.intentJudgeRunId ?? null,
        record.createdAt,
      ],
    );
  }

  private async upsertIntentEvalMetrics(client: import("pg").PoolClient, record: DbIntentEvalMetrics): Promise<void> {
    await client.query(
      `
        insert into intent_eval_metrics (
          id, project_id, evaluation_run_id, session_id, intent_sequence_id,
          intent_completion_rate, clarification_efficiency, deviation_rate, turn_efficiency,
          intent_count, satisfied_count, budget_failed_count, total_replay_turns,
          skipped_reason, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        on conflict (id) do update set
          intent_completion_rate = excluded.intent_completion_rate,
          clarification_efficiency = excluded.clarification_efficiency,
          deviation_rate = excluded.deviation_rate,
          turn_efficiency = excluded.turn_efficiency,
          satisfied_count = excluded.satisfied_count,
          budget_failed_count = excluded.budget_failed_count,
          total_replay_turns = excluded.total_replay_turns
      `,
      [
        record.id,
        record.projectId,
        record.evaluationRunId,
        record.sessionId,
        record.intentSequenceId,
        record.intentCompletionRate,
        record.clarificationEfficiency,
        record.deviationRate,
        record.turnEfficiency,
        record.intentCount,
        record.satisfiedCount,
        record.budgetFailedCount,
        record.totalReplayTurns,
        record.skippedReason ?? null,
        record.createdAt,
      ],
    );
  }

  private async upsertObjectiveSignal(client: import("pg").PoolClient, record: DbObjectiveSignal): Promise<void> {
    await client.query(
      `
        insert into objective_signals (
          id, project_id, evaluation_run_id, session_id, metric_key,
          numeric_value, string_value, json_value, source, confidence,
          evidence_span_id, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
        on conflict (id) do update set
          numeric_value = excluded.numeric_value,
          string_value = excluded.string_value,
          json_value = excluded.json_value
      `,
      [
        record.id,
        record.projectId,
        record.evaluationRunId,
        record.sessionId ?? null,
        record.metricKey,
        record.numericValue ?? null,
        record.stringValue ?? null,
        record.jsonValue !== undefined ? JSON.stringify(record.jsonValue) : null,
        record.source,
        record.confidence ?? null,
        record.evidenceSpanId ?? null,
        record.createdAt,
      ],
    );
  }

  private async upsertSubjectiveSignal(client: import("pg").PoolClient, record: DbSubjectiveSignal): Promise<void> {
    await client.query(
      `
        insert into subjective_signals (
          id, project_id, evaluation_run_id, session_id, intent_index,
          dimension_key, dimension_label, score, reason, source,
          confidence, evidence_span_id, judge_run_id, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        on conflict (id) do update set
          score = excluded.score,
          reason = excluded.reason,
          confidence = excluded.confidence
      `,
      [
        record.id,
        record.projectId,
        record.evaluationRunId,
        record.sessionId ?? null,
        record.intentIndex ?? null,
        record.dimensionKey,
        record.dimensionLabel ?? null,
        record.score,
        record.reason,
        record.source,
        record.confidence ?? null,
        record.evidenceSpanId ?? null,
        record.judgeRunId ?? null,
        record.createdAt,
      ],
    );
  }

  private async upsertEvidenceSpan(client: import("pg").PoolClient, record: DbEvidenceSpan): Promise<void> {
    await client.query(
      `
        insert into evidence_spans (
          id, project_id, evaluation_run_id, session_id, intent_index,
          evidence_kind, quote, start_turn, end_turn, source, metadata, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12)
        on conflict (id) do nothing
      `,
      [
        record.id,
        record.projectId,
        record.evaluationRunId ?? null,
        record.sessionId ?? null,
        record.intentIndex ?? null,
        record.evidenceKind,
        record.quote,
        record.startTurn ?? null,
        record.endTurn ?? null,
        record.source,
        record.metadata ? JSON.stringify(record.metadata) : null,
        record.createdAt,
      ],
    );
  }

  private async upsertRiskTag(client: import("pg").PoolClient, record: DbRiskTag): Promise<void> {
    await client.query(
      `
        insert into risk_tags (
          id, project_id, evaluation_run_id, session_id, intent_index,
          tag_key, score, severity, reason, triggered_rules,
          source, confidence, evidence_span_id, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14)
        on conflict (id) do update set
          score = excluded.score,
          severity = excluded.severity,
          reason = excluded.reason
      `,
      [
        record.id,
        record.projectId,
        record.evaluationRunId,
        record.sessionId ?? null,
        record.intentIndex ?? null,
        record.tagKey,
        record.score ?? null,
        record.severity ?? null,
        record.reason ?? null,
        record.triggeredRules ? JSON.stringify(record.triggeredRules) : null,
        record.source,
        record.confidence ?? null,
        record.evidenceSpanId ?? null,
        record.createdAt,
      ],
    );
  }

  private async upsertSuggestion(client: import("pg").PoolClient, record: DbSuggestion): Promise<void> {
    await client.query(
      `
        insert into suggestions (
          id, project_id, evaluation_run_id, title, problem, impact, action,
          trigger_metric_keys, evidence_span_id, priority, created_at
        ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        on conflict (id) do update set
          title = excluded.title,
          problem = excluded.problem,
          action = excluded.action,
          priority = excluded.priority
      `,
      [
        record.id,
        record.projectId,
        record.evaluationRunId,
        record.title,
        record.problem,
        record.impact,
        record.action,
        record.triggerMetricKeys,
        record.evidenceSpanId ?? null,
        record.priority,
        record.createdAt,
      ],
    );
  }
}

/**
 * Create a SupabaseTypedDatabase instance from environment variables.
 *
 * Requires DATABASE_URL to be set.
 *
 * @returns Typed database instance.
 */
export function createSupabaseTypedDatabase(): SupabaseTypedDatabase {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required for SupabaseTypedDatabase.");
  }
  return new SupabaseTypedDatabase({
    connectionString,
    ssl: resolveSslConfig(connectionString),
    max: Number(process.env.ZEVAL_POSTGRES_POOL_MAX ?? 5),
  });
}

function resolveSslConfig(connectionString: string): PoolConfig["ssl"] {
  const sslMode = process.env.ZEVAL_POSTGRES_SSL ?? "auto";
  if (sslMode === "disable") return false;
  if (sslMode === "require" || /supabase|neon|render|railway/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}
