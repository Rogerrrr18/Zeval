-- ============================================================
-- Zeval 2.0 — 替换式 migration（P1 重构）
-- 策略：完全替换旧 schema，不保留任何旧表或 JSONB 桥接表
-- 目标：supabase-target-schema.sql 所定义的 43 张类型化表
-- ============================================================

-- ── Step 1：Drop all old tables (reverse dependency order) ──

drop table if exists zerore_records           cascade;
drop table if exists bad_case_clusters        cascade;
drop table if exists bad_case_tags            cascade;
drop table if exists bad_cases               cascade;
drop table if exists gold_label_drafts        cascade;
drop table if exists gold_labels             cascade;
drop table if exists gold_annotation_tasks   cascade;
drop table if exists gold_cases              cascade;
drop table if exists gold_sets               cascade;
drop table if exists judge_drift_reports     cascade;
drop table if exists judge_agreement_reports cascade;
drop table if exists judge_predictions       cascade;
drop table if exists judge_runs              cascade;
drop table if exists topic_segments          cascade;
drop table if exists business_kpi_signals    cascade;
drop table if exists subjective_signals      cascade;
drop table if exists objective_signals       cascade;
drop table if exists risk_tags               cascade;
drop table if exists evidence_spans          cascade;
drop table if exists evaluation_runs         cascade;
drop table if exists scenario_contexts       cascade;
drop table if exists message_turns           cascade;
drop table if exists sessions                cascade;
drop table if exists dataset_imports         cascade;
drop table if exists datasets                cascade;
drop table if exists remediation_artifacts   cascade;
drop table if exists remediation_packages    cascade;
drop table if exists validation_results      cascade;
drop table if exists validation_runs         cascade;
drop table if exists agent_runs              cascade;
drop table if exists jobs                    cascade;
drop table if exists audit_logs              cascade;
drop table if exists api_keys                cascade;
drop table if exists workspace_members       cascade;
drop table if exists project_members         cascade;
drop table if exists workspaces              cascade;
drop table if exists users                   cascade;
drop table if exists projects                cascade;
drop table if exists organizations           cascade;
-- additional legacy tables that may exist
drop table if exists sample_batch_cases      cascade;
drop table if exists sample_batches          cascade;
drop table if exists eval_cases              cascade;

-- ── Step 2：Drop old custom enum types ──

drop type if exists workspace_role          cascade;
drop type if exists job_status              cascade;
drop type if exists eval_source             cascade;
drop type if exists review_status           cascade;
drop type if exists scenario_goal_status    cascade;
drop type if exists recovery_status         cascade;
drop type if exists agent_run_status        cascade;
drop type if exists validation_run_status   cascade;

-- ── Step 3：Enable required extensions ──

create extension if not exists pgcrypto;

-- ── Step 4：Create new target schema (43 tables) ────────────

-- Organization & Project

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan_key text not null default 'dev',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  environment text not null default 'production',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Data Ingestion

create table if not exists datasets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  source_kind text not null default 'upload',
  scenario_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists dataset_imports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  dataset_id uuid references datasets(id) on delete set null,
  file_name text,
  format text not null,
  row_count integer not null default 0,
  mapping_plan jsonb,
  pii_redaction jsonb not null default '{}'::jsonb,
  artifact_uri text,
  warnings text[] not null default array[]::text[],
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  dataset_id uuid references datasets(id) on delete set null,
  external_session_id text not null,
  normalized_transcript_hash text,
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, dataset_id, external_session_id)
);

create table if not exists message_turns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  turn_index integer not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  timestamp timestamptz,
  timestamp_raw text,
  token_count_estimate integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, turn_index)
);

-- Evaluation Runs

create table if not exists evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  dataset_id uuid references datasets(id) on delete set null,
  run_key text not null,
  scenario_id text,
  status text not null default 'succeeded',
  use_llm boolean not null default true,
  dynamic_replay_enabled boolean not null default false,
  session_count integer not null default 0,
  message_count integer not null default 0,
  has_timestamp boolean not null default false,
  warnings text[] not null default array[]::text[],
  report_payload jsonb,
  artifact_uri text,
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (project_id, run_key)
);

-- LLM Judge (defined before intent tables that reference it)

create table if not exists judge_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid references evaluation_runs(id) on delete cascade,
  stage text not null,
  model text not null,
  prompt_version text,
  input_ref jsonb,
  output_json jsonb,
  status text not null,
  latency_ms integer,
  error_message text,
  created_at timestamptz not null default now()
);

-- Intent Pointer Dynamic Evaluation

create table if not exists intent_sequences (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid not null references evaluation_runs(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  schema_version text not null,
  schema_lock_revision integer not null default 1,
  intent_sequence jsonb not null default '[]'::jsonb,
  refillables jsonb not null default '[]'::jsonb,
  lock_status text not null default 'draft' check (lock_status in ('draft', 'locked')),
  intent_count integer not null default 0,
  refillable_count integer not null default 0,
  extract_judge_run_id uuid references judge_runs(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (evaluation_run_id, session_id)
);

create table if not exists intent_run_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid not null references evaluation_runs(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  intent_sequence_id uuid not null references intent_sequences(id) on delete cascade,
  intent_index integer not null,
  turn_count integer not null,
  budget integer not null,
  user_text text not null,
  assistant_text text not null,
  judge_label text not null check (judge_label in (
    'SATISFIED', 'NOT_SATISFIED', 'DEVIATION',
    'FALLBACK_NOT_SATISFIED', 'SKIPPED_GEN_FAILURE'
  )),
  rationale text,
  evidence_quote text,
  events jsonb not null default '[]'::jsonb,
  simuser_judge_run_id uuid references judge_runs(id) on delete set null,
  intent_judge_run_id uuid references judge_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists intent_eval_metrics (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid not null references evaluation_runs(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  intent_sequence_id uuid not null references intent_sequences(id) on delete cascade,
  intent_completion_rate numeric(5,4) not null,
  clarification_efficiency numeric(8,4) not null,
  deviation_rate numeric(5,4) not null,
  turn_efficiency numeric(8,4) not null,
  intent_count integer not null,
  satisfied_count integer not null,
  budget_failed_count integer not null,
  total_replay_turns integer not null,
  skipped_reason text,
  created_at timestamptz not null default now(),
  unique (evaluation_run_id, session_id)
);

-- Signal Layer

create table if not exists evidence_spans (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid references evaluation_runs(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  intent_index integer,
  turn_id uuid references message_turns(id) on delete set null,
  evidence_kind text not null,
  quote text not null,
  start_turn integer,
  end_turn integer,
  source text not null default 'rule',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists objective_signals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid not null references evaluation_runs(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  metric_key text not null,
  numeric_value numeric,
  string_value text,
  json_value jsonb,
  source text not null default 'rule',
  confidence numeric(5,4),
  evidence_span_id uuid references evidence_spans(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists subjective_signals (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid not null references evaluation_runs(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  intent_index integer,
  dimension_key text not null,
  dimension_label text,
  score numeric not null,
  reason text not null,
  source text not null,
  confidence numeric(5,4),
  evidence_span_id uuid references evidence_spans(id) on delete set null,
  judge_run_id uuid references judge_runs(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists risk_tags (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid references evaluation_runs(id) on delete cascade,
  session_id uuid references sessions(id) on delete cascade,
  intent_index integer,
  tag_key text not null,
  score numeric,
  severity text,
  reason text,
  triggered_rules jsonb,
  source text not null default 'inferred',
  confidence numeric(5,4),
  evidence_span_id uuid references evidence_spans(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists suggestions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid not null references evaluation_runs(id) on delete cascade,
  title text not null,
  problem text not null,
  impact text not null,
  action text not null,
  trigger_metric_keys text[] not null default array[]::text[],
  evidence_span_id uuid references evidence_spans(id) on delete set null,
  priority integer not null default 0,
  created_at timestamptz not null default now()
);

-- Baseline & Online Eval

create table if not exists baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  customer_id text not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists baseline_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  baseline_id uuid not null references baselines(id) on delete cascade,
  source_evaluation_run_id uuid references evaluation_runs(id) on delete set null,
  raw_rows_artifact_uri text,
  snapshot_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists online_eval_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  baseline_run_id uuid references baseline_runs(id) on delete set null,
  current_evaluation_run_id uuid references evaluation_runs(id) on delete set null,
  reply_api_url text not null,
  status text not null default 'queued',
  created_at timestamptz not null default now()
);

-- Eval Dataset & Regression

create table if not exists eval_cases (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  case_set_type text not null check (case_set_type in ('goodcase', 'badcase')),
  title text not null,
  normalized_transcript_hash text not null,
  transcript_payload jsonb not null,
  labels jsonb not null default '{}'::jsonb,
  source text not null default 'imported' check (source in (
    'auto_tp', 'manual_fp', 'auto_fn', 'auto_tn',
    'auto_uncertainty', 'auto_disagreement',
    'synthesized', 'imported'
  )),
  capability_dimension text check (capability_dimension in (
    'instruction_following', 'multi_turn_coherence', 'long_context_reasoning',
    'task_decomposition', 'tool_calling_correctness', 'workflow_execution',
    'knowledge_grounding', 'safety_refusal', 'style_format',
    'latency_efficiency', 'self_correction', 'human_handoff'
  )),
  failure_layer text check (failure_layer in (
    'L0_model', 'L1_input', 'L2_planning', 'L3_memory', 'L4_retrieval',
    'L5_tool_selection', 'L6_tool_execution', 'L7_state', 'L8_generation'
  )),
  attribution_confidence numeric(4,3),
  attribution_method text check (attribution_method in ('rule', 'llm_classifier', 'experiment', 'manual')),
  source_evaluation_run_id uuid references evaluation_runs(id) on delete set null,
  holdout boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (project_id, normalized_transcript_hash)
);

create table if not exists sample_batches (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  seed text,
  target_goodcase_count integer not null default 0,
  target_badcase_count integer not null default 0,
  actual_goodcase_count integer not null default 0,
  actual_badcase_count integer not null default 0,
  warnings text[] not null default array[]::text[],
  created_at timestamptz not null default now()
);

create table if not exists sample_batch_cases (
  sample_batch_id uuid not null references sample_batches(id) on delete cascade,
  eval_case_id uuid not null references eval_cases(id) on delete cascade,
  strata text not null,
  position integer not null,
  primary key (sample_batch_id, eval_case_id)
);

create table if not exists dataset_admission_rules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  rule_key text not null,
  case_set_type text not null check (case_set_type in ('goodcase', 'badcase')),
  expression jsonb not null,
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, rule_key)
);

create table if not exists eval_case_candidates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  evaluation_run_id uuid references evaluation_runs(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  case_set_type text not null check (case_set_type in ('goodcase', 'badcase')),
  source text check (source in (
    'auto_tp', 'manual_fp', 'auto_fn', 'auto_tn',
    'auto_uncertainty', 'auto_disagreement',
    'synthesized', 'imported'
  )),
  capability_dimension text not null,
  failure_layer text,
  attribution_confidence numeric(4,3),
  triggered_rules jsonb not null default '[]'::jsonb,
  severity text not null default 'medium',
  snapshot_payload jsonb not null,
  normalized_transcript_hash text not null,
  decision text not null default 'pending_review' check (decision in ('accepted', 'rejected', 'pending_review')),
  decision_reason text,
  near_duplicate_of_case_id uuid references eval_cases(id) on delete set null,
  promoted_eval_case_id uuid references eval_cases(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists capability_attributions (
  id uuid primary key default gen_random_uuid(),
  eval_case_id uuid not null references eval_cases(id) on delete cascade,
  capability_dimension text not null,
  failure_layer text not null,
  confidence numeric(4,3) not null,
  method text not null check (method in ('rule', 'llm_classifier', 'experiment', 'manual')),
  experiment_run_id uuid,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists experiment_routes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  target_capability text not null,
  target_layer text not null,
  axis text not null,
  candidates jsonb not null default '[]'::jsonb,
  eval_dataset_id uuid,
  status text not null default 'draft' check (status in ('draft', 'running', 'completed', 'archived')),
  result_summary jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists validation_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  sample_batch_id uuid references sample_batches(id) on delete set null,
  compare_baseline_run_id uuid references baseline_runs(id) on delete set null,
  evaluation_strategy text not null default 'full',
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'partial', 'failed')),
  warnings text[] not null default array[]::text[],
  created_at timestamptz not null default now()
);

create table if not exists validation_results (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  validation_run_id uuid not null references validation_runs(id) on delete cascade,
  eval_case_id uuid not null references eval_cases(id) on delete cascade,
  passed boolean not null,
  score numeric,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists validation_generalization_reports (
  id uuid primary key default gen_random_uuid(),
  validation_run_id uuid not null references validation_runs(id) on delete cascade,
  gen_coeff_per_capability jsonb not null default '{}'::jsonb,
  bootstrap_ci_per_capability jsonb not null default '{}'::jsonb,
  cross_capability_guard jsonb not null default '{}'::jsonb,
  insufficient_evidence_capabilities text[] not null default array[]::text[],
  overall_verdict text not null default 'insufficient_evidence' check (overall_verdict in (
    'passed', 'failed', 'insufficient_evidence', 'generalization_warning'
  )),
  warnings text[] not null default array[]::text[],
  created_at timestamptz not null default now(),
  unique (validation_run_id)
);

-- Sample Synthesis

create table if not exists synthesis_templates (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  default_hints jsonb not null default '[]'::jsonb,
  default_personas jsonb not null default '[]'::jsonb,
  default_expected_failures jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, name)
);

create table if not exists synthesis_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  template_id uuid references synthesis_templates(id) on delete set null,
  request_payload jsonb not null,
  model text not null,
  prompt_version text,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'partial', 'failed')),
  requested_count integer not null default 0,
  accepted_count integer not null default 0,
  rejected_count integer not null default 0,
  warnings text[] not null default array[]::text[],
  created_at timestamptz not null default now()
);

create table if not exists synthesized_samples (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  synthesis_run_id uuid not null references synthesis_runs(id) on delete cascade,
  eval_case_id uuid references eval_cases(id) on delete set null,
  transcript_payload jsonb not null,
  alignment_score numeric(5,4),
  redundancy_score numeric(5,4),
  judge_run_id uuid references judge_runs(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Remediation Packages (Skill 化)

create table if not exists remediation_packages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  status text not null default 'draft',
  scope_bad_case_ids uuid[] not null default array[]::uuid[],
  evaluation_run_ids uuid[] not null default array[]::uuid[],
  trigger_metric_keys text[] not null default array[]::text[],
  skill_version text,
  skill_artifact_uri text,
  skill_metadata jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists remediation_artifacts (
  id uuid primary key default gen_random_uuid(),
  remediation_package_id uuid not null references remediation_packages(id) on delete cascade,
  artifact_kind text not null check (artifact_kind in (
    'issue_brief', 'remediation_spec', 'badcases_jsonl', 'acceptance_gate',
    'skill_md', 'metadata_json', 'prompt_md', 'script_md', 'other'
  )),
  filename text not null,
  content_uri text,
  content_inline text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Row-level Turn Enrichments (P1)

create table if not exists turn_enrichments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  session_id uuid not null references sessions(id) on delete cascade,
  message_turn_id uuid not null references message_turns(id) on delete cascade,
  response_gap_sec numeric,
  is_question boolean,
  is_dropoff_turn boolean,
  token_count_estimate integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (message_turn_id)
);

-- Online Eval Replay Turns (P2)

create table if not exists replay_turns (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  online_eval_run_id uuid not null references online_eval_runs(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  turn_index integer not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  latency_ms integer,
  status text not null default 'ok' check (status in ('ok', 'timeout', 'error')),
  error_message text,
  created_at timestamptz not null default now()
);

-- Baseline vs Current Comparison (P2)

create table if not exists run_comparisons (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  online_eval_run_id uuid not null references online_eval_runs(id) on delete cascade,
  baseline_run_id uuid not null references baseline_runs(id) on delete cascade,
  current_evaluation_run_id uuid references evaluation_runs(id) on delete set null,
  metric_key text not null,
  baseline_value numeric,
  current_value numeric,
  delta numeric,
  direction text check (direction in ('better', 'worse', 'neutral', 'unknown')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Expected Baselines for Eval Cases (P3)

create table if not exists eval_case_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  eval_case_id uuid not null references eval_cases(id) on delete cascade,
  expected_dimensions jsonb not null default '{}'::jsonb,
  expected_labels jsonb not null default '{}'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  unique (eval_case_id)
);

-- Org Membership (MVP no UI)

create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_email text not null,
  role text not null default 'viewer' check (role in ('owner', 'editor', 'viewer', 'gate_reviewer')),
  created_at timestamptz not null default now(),
  unique (project_id, user_email)
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  key_hash text not null unique,
  label text not null,
  scopes text[] not null default array[]::text[],
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists audit_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  actor_email text,
  action text not null,
  resource_type text,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Async Agent Runs & Job Queue (P4 Post-MVP)

create table if not exists agent_runs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  remediation_package_id uuid references remediation_packages(id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  trigger_payload jsonb,
  result_payload jsonb,
  error_message text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  job_type text not null,
  status text not null default 'queued' check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error_message text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  scheduled_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

-- ── Step 5：Indexes for common query patterns ────────────────

create index if not exists idx_evaluation_runs_project_created
  on evaluation_runs(project_id, created_at desc);

create index if not exists idx_objective_signals_run
  on objective_signals(evaluation_run_id);

create index if not exists idx_subjective_signals_run
  on subjective_signals(evaluation_run_id);

create index if not exists idx_risk_tags_run
  on risk_tags(evaluation_run_id);

create index if not exists idx_evidence_spans_run
  on evidence_spans(evaluation_run_id);

create index if not exists idx_suggestions_run
  on suggestions(evaluation_run_id);

create index if not exists idx_intent_sequences_run
  on intent_sequences(evaluation_run_id);

create index if not exists idx_intent_run_logs_sequence
  on intent_run_logs(intent_sequence_id);

create index if not exists idx_judge_runs_run
  on judge_runs(evaluation_run_id);

create index if not exists idx_sessions_project
  on sessions(project_id, external_session_id);

create index if not exists idx_message_turns_session
  on message_turns(session_id, turn_index);

create index if not exists idx_eval_cases_project_hash
  on eval_cases(project_id, normalized_transcript_hash);
