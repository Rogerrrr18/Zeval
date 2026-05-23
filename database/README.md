# Zeval Database Architecture

This directory defines the target relational storage model for Zeval.

The current app can still run with local files and the local JSON adapter. The database schema is the next production storage target and follows the SEAR-inspired principle documented in `eval-system-概述/5-SEAR数据哲学与下一阶段架构.md`:

> An evaluation is not a single score. It is a set of joinable, traceable and explainable quality signals.

## Storage Roles

- PostgreSQL/Supabase is the intended production system of record.
- Local JSON remains the development fallback and smoke artifact path.
- Evaluate/baseline JSON files remain export and audit snapshots, not the long-term query model.
- Data is isolated by `organization_id -> project_id`. The current application
  still exposes `workspaceId` in several store interfaces; in the Zeval data
  model that value is treated as a deprecated compatibility alias for
  `projectId`.
- `zerore_records` is the temporary JSONB bridge table used by the current
  `ZeroreDatabase` interface. It now carries `organization_id` and `project_id`
  columns so bridge writes can respect the same tenancy boundary.

## Schema Groups

`schema.sql` is organized around the product workflow:

1. `organizations`, `projects`, `users`, `project_members`, compatibility `workspaces`, `workspace_members`, `api_keys`, `audit_logs`
2. `datasets`, `dataset_imports`, `sessions`, `message_turns`, `scenario_contexts`
3. `evaluation_runs`, `topic_segments`, `objective_signals`, `subjective_signals`, `business_kpi_signals`, `evidence_spans`, `risk_tags`
4. `gold_sets`, `gold_cases`, `gold_annotation_tasks`, `gold_label_drafts`, `gold_labels`, `judge_runs`, `judge_predictions`, `judge_agreement_reports`, `judge_drift_reports`
5. `bad_cases`, `bad_case_tags`, `bad_case_clusters`, `remediation_packages`, `remediation_artifacts`, `agent_runs`, `validation_runs`, `validation_results`, `jobs`

## Migration Strategy

The migration should be incremental:

1. Keep the existing pipeline and artifact outputs unchanged.
2. Add an evaluate projection layer that converts `EvaluateResponse` into normalized database records. This is now implemented in `src/db/evaluation-projection.ts`.
3. Write projections through the current `ZeroreDatabase` interface first. Synchronous `/api/evaluate` runs now write these records through the local JSON adapter.
4. Add a Postgres adapter behind the same interface. This is available with `ZEVAL_DATABASE_ADAPTER=postgres`.
5. Migrate gold set, bad case, agent run and validation stores one domain at a time.
6. Replace `zerore_records` reads with typed `projects`, `evaluation_runs`,
   `subjective_signals`, `objective_signals`, `jobs` and annotation tables.

## Adapter Configuration

Default local mode:

```bash
ZEVAL_DATABASE_ADAPTER=local-json
```

Postgres/Supabase bridge mode:

```bash
ZEVAL_DATABASE_ADAPTER=postgres
DATABASE_URL=postgresql://postgres:YOUR_DB_PASSWORD@db.rukjxsykowetriaxifon.supabase.co:5432/postgres
ZEVAL_POSTGRES_SSL=auto
ZEVAL_POSTGRES_POOL_MAX=5
ZEVAL_DEFAULT_ORGANIZATION_ID=default-org
DATASET_STORE_PROVIDER=database
WORKBENCH_BASELINE_STORE_PROVIDER=database
```

Legacy `ZERORE_*` variables still work as deprecated fallbacks.

`ZEVAL_POSTGRES_SSL` accepts:

- `auto`: enable relaxed SSL for common managed Postgres hosts such as Supabase/Neon.
- `require`: always enable relaxed SSL.
- `disable`: do not enable SSL, useful for local Docker Postgres.

For Supabase, use the database connection string from Supabase Dashboard -> Project Settings -> Database. The publishable key belongs to browser/client usage and does not replace `DATABASE_URL`.

## Supabase Migration

Supabase project configuration lives in `supabase/config.toml`, and the initial schema migration is copied from `database/schema.sql` into `supabase/migrations`.

```bash
supabase login
npm run db:supabase:link
npm run db:supabase:push
```

After setting `ZEVAL_DATABASE_ADAPTER=postgres` and `DATABASE_URL`, run:

```bash
npm run db:smoke
npm run db:smoke:evaluate-projection
npm run db:smoke:stores
```

## Traceability Rule

Every primary quality signal should be traceable to:

- `organization_id`
- `project_id`
- compatibility `workspace_id`
- `run_id`
- `session_id`
- a metric key or signal key
- a source (`rule`, `llm`, `inferred`, `human`, `system`, `import`)
- optional `turn_id`, `segment_id`, `judge_run_id`, `evidence_span_id`

This is the data contract that keeps the product explainable and auditable.
