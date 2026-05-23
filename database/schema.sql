-- Zeval relational schema
-- Target: PostgreSQL 15+ / Supabase-compatible PostgreSQL
-- Principle: eval output is a warehouse of traceable quality signals, not just a report JSON.

create extension if not exists pgcrypto;

create type workspace_role as enum ('owner', 'admin', 'member', 'viewer');
create type job_status as enum ('queued', 'running', 'succeeded', 'failed', 'canceled');
create type eval_source as enum ('raw', 'rule', 'llm', 'inferred', 'fallback', 'human', 'system', 'import');
create type review_status as enum ('draft', 'in_review', 'approved', 'rejected', 'needs_changes');
create type scenario_goal_status as enum ('achieved', 'partial', 'failed', 'unclear');
create type recovery_status as enum ('none', 'completed', 'failed');
create type agent_run_status as enum ('queued', 'running', 'succeeded', 'failed', 'canceled');
create type validation_run_status as enum ('queued', 'running', 'passed', 'failed', 'errored', 'canceled');

create table organizations (
  id text primary key,
  name text not null,
  plan_key text not null default 'dev',
  data_region text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table projects (
  id text primary key,
  organization_id text not null references organizations(id) on delete cascade,
  name text not null,
  data_region text,
  environment text not null default 'production',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

-- Deprecated compatibility table. Existing application stores still call this
-- identifier workspace_id, but it now maps 1:1 to projects.id.
create table workspaces (
  id text primary key references projects(id) on delete cascade,
  organization_id text not null references organizations(id) on delete cascade,
  project_id text not null unique,
  name text not null,
  plan_key text not null default 'dev',
  data_region text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, project_id) references projects(organization_id, id) on delete cascade,
  unique (organization_id, project_id)
);

create table users (
  id text primary key,
  email text unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table workspace_members (
  workspace_id text not null references workspaces(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  role workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table project_members (
  organization_id text not null references organizations(id) on delete cascade,
  project_id text not null,
  user_id text not null references users(id) on delete cascade,
  role workspace_role not null default 'member',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, project_id) references projects(organization_id, id) on delete cascade,
  primary key (organization_id, project_id, user_id)
);

create table api_keys (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  key_hash text not null,
  scopes text[] not null default array[]::text[],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  actor_user_id text references users(id),
  action text not null,
  entity_type text not null,
  entity_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Bridge table used by the current ZeroreDatabase adapter.
-- It lets the projection layer write JSONB records to Postgres before every
-- domain store has been migrated to typed relational tables.
create table zerore_records (
  organization_id text not null default 'default-org',
  project_id text not null,
  workspace_id text not null,
  type text not null,
  id text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, type, id)
);

create table datasets (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  name text not null,
  description text,
  source_kind text not null default 'upload',
  scenario_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table dataset_imports (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  dataset_id text references datasets(id) on delete set null,
  file_name text,
  format text not null,
  row_count integer not null default 0,
  pii_redaction jsonb not null default '{}'::jsonb,
  warnings text[] not null default array[]::text[],
  artifact_uri text,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create table sessions (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  dataset_id text references datasets(id) on delete set null,
  external_session_id text not null,
  normalized_transcript_hash text,
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, dataset_id, external_session_id)
);

create table message_turns (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  session_id text not null references sessions(id) on delete cascade,
  turn_index integer not null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  content_redacted boolean not null default true,
  timestamp timestamptz,
  timestamp_raw text,
  token_count_estimate integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, turn_index)
);

create table scenario_contexts (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references workspaces(id) on delete cascade,
  run_id text,
  dataset_id text references datasets(id) on delete set null,
  scenario_id text not null,
  onboarding_answers jsonb not null default '{}'::jsonb,
  created_by text references users(id),
  created_at timestamptz not null default now()
);

create table evaluation_runs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  dataset_id text references datasets(id) on delete set null,
  scenario_context_id uuid references scenario_contexts(id) on delete set null,
  run_id text not null,
  scenario_id text,
  status text not null default 'succeeded',
  use_llm boolean not null default false,
  session_count integer not null default 0,
  message_count integer not null default 0,
  has_timestamp boolean not null default false,
  warnings text[] not null default array[]::text[],
  artifact_uri text,
  raw_response jsonb,
  created_by text references users(id),
  generated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, run_id)
);

create table topic_segments (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  evaluation_run_id text not null references evaluation_runs(id) on delete cascade,
  session_id text not null references sessions(id) on delete cascade,
  topic_segment_id text not null,
  topic_segment_index integer not null,
  label text not null,
  summary text not null,
  source eval_source not null,
  confidence numeric(5,4) not null,
  start_turn integer not null,
  end_turn integer not null,
  message_count integer not null,
  emotion_polarity text,
  emotion_intensity text,
  emotion_score numeric(6,2),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (evaluation_run_id, topic_segment_id)
);

create table evidence_spans (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  evaluation_run_id text references evaluation_runs(id) on delete cascade,
  session_id text references sessions(id) on delete cascade,
  turn_id text references message_turns(id) on delete set null,
  topic_segment_id text references topic_segments(id) on delete set null,
  evidence_kind text not null,
  quote text not null,
  start_turn integer,
  end_turn integer,
  source eval_source not null default 'rule',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table objective_signals (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  evaluation_run_id text not null references evaluation_runs(id) on delete cascade,
  session_id text references sessions(id) on delete cascade,
  topic_segment_id text references topic_segments(id) on delete set null,
  metric_key text not null,
  metric_label text,
  numeric_value numeric,
  string_value text,
  json_value jsonb,
  reason text,
  source eval_source not null default 'rule',
  confidence numeric(5,4),
  evidence_span_id text references evidence_spans(id) on delete set null,
  created_at timestamptz not null default now()
);

create table subjective_signals (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  evaluation_run_id text not null references evaluation_runs(id) on delete cascade,
  session_id text references sessions(id) on delete cascade,
  topic_segment_id text references topic_segments(id) on delete set null,
  dimension_key text not null,
  dimension_label text,
  score numeric(6,2) not null,
  reason text not null,
  source eval_source not null default 'llm',
  confidence numeric(5,4) not null,
  evidence_span_id text references evidence_spans(id) on delete set null,
  judge_run_id text,
  prompt_version text,
  created_at timestamptz not null default now()
);

create table business_kpi_signals (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  evaluation_run_id text not null references evaluation_runs(id) on delete cascade,
  session_id text references sessions(id) on delete cascade,
  kpi_key text not null,
  status text,
  score numeric(6,2),
  value jsonb not null default '{}'::jsonb,
  reason text,
  source eval_source not null default 'rule',
  confidence numeric(5,4),
  evidence_span_id text references evidence_spans(id) on delete set null,
  created_at timestamptz not null default now()
);

create table risk_tags (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  evaluation_run_id text not null references evaluation_runs(id) on delete cascade,
  session_id text references sessions(id) on delete cascade,
  topic_segment_id text references topic_segments(id) on delete set null,
  tag_key text not null,
  severity_score numeric(6,2),
  reason text,
  evidence_span_id text references evidence_spans(id) on delete set null,
  source eval_source not null default 'rule',
  created_at timestamptz not null default now()
);

create table gold_sets (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  version text not null,
  name text not null,
  scenario_id text,
  status text not null default 'draft',
  metadata jsonb not null default '{}'::jsonb,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, version)
);

create table gold_cases (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  gold_set_id text not null references gold_sets(id) on delete cascade,
  source_session_id text references sessions(id) on delete set null,
  source_bad_case_id text,
  case_id text not null,
  title text not null,
  transcript jsonb not null,
  tags text[] not null default array[]::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (gold_set_id, case_id)
);

create table gold_annotation_tasks (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  gold_set_id text not null references gold_sets(id) on delete cascade,
  gold_case_id text not null references gold_cases(id) on delete cascade,
  assignee_user_id text references users(id),
  review_status review_status not null default 'draft',
  reviewer_user_id text references users(id),
  reviewed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table gold_label_drafts (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  task_id text not null references gold_annotation_tasks(id) on delete cascade,
  label_payload jsonb not null,
  auto_prefill jsonb,
  review_notes text,
  updated_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (task_id)
);

create table gold_labels (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  gold_set_id text not null references gold_sets(id) on delete cascade,
  gold_case_id text not null references gold_cases(id) on delete cascade,
  label_payload jsonb not null,
  approved_by text references users(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (gold_set_id, gold_case_id)
);

create table judge_runs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  gold_set_id text references gold_sets(id) on delete set null,
  judge_key text not null,
  judge_version text,
  prompt_version text,
  model_name text,
  status job_status not null default 'queued',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table judge_predictions (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  judge_run_id text not null references judge_runs(id) on delete cascade,
  gold_case_id text references gold_cases(id) on delete set null,
  prediction_payload jsonb not null,
  score numeric(6,2),
  reason text,
  evidence_span_id text references evidence_spans(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (judge_run_id, gold_case_id)
);

create table judge_agreement_reports (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  judge_run_id text not null references judge_runs(id) on delete cascade,
  report_payload jsonb not null,
  artifact_uri text,
  created_at timestamptz not null default now()
);

create table judge_drift_reports (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  baseline_judge_run_id text not null references judge_runs(id) on delete cascade,
  candidate_judge_run_id text not null references judge_runs(id) on delete cascade,
  report_payload jsonb not null,
  artifact_uri text,
  created_at timestamptz not null default now()
);

create table bad_cases (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  evaluation_run_id text references evaluation_runs(id) on delete set null,
  session_id text references sessions(id) on delete set null,
  topic_segment_id text references topic_segments(id) on delete set null,
  title text not null,
  severity_score numeric(6,2) not null,
  normalized_transcript_hash text,
  duplicate_group_key text,
  transcript text not null,
  suggested_action text,
  source_run_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table bad_case_tags (
  bad_case_id text not null references bad_cases(id) on delete cascade,
  tag_key text not null,
  primary key (bad_case_id, tag_key)
);

create table bad_case_clusters (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  cluster_key text not null,
  title text not null,
  summary text,
  case_count integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, cluster_key)
);

create table remediation_packages (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  source_evaluation_run_id text references evaluation_runs(id) on delete set null,
  title text not null,
  priority text not null default 'P1',
  package_payload jsonb not null,
  status text not null default 'draft',
  created_by text references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table remediation_artifacts (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  remediation_package_id text not null references remediation_packages(id) on delete cascade,
  artifact_kind text not null,
  artifact_uri text,
  content text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table agent_runs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  remediation_package_id text references remediation_packages(id) on delete set null,
  agent_key text not null,
  status agent_run_status not null default 'queued',
  input_payload jsonb not null default '{}'::jsonb,
  output_payload jsonb not null default '{}'::jsonb,
  validation_run_id text,
  error text,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table validation_runs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  remediation_package_id text references remediation_packages(id) on delete set null,
  baseline_run_id text references evaluation_runs(id) on delete set null,
  candidate_run_id text references evaluation_runs(id) on delete set null,
  status validation_run_status not null default 'queued',
  gate_payload jsonb not null default '{}'::jsonb,
  report_payload jsonb not null default '{}'::jsonb,
  artifact_uri text,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table validation_results (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  validation_run_id text not null references validation_runs(id) on delete cascade,
  check_key text not null,
  status text not null,
  baseline_value numeric,
  candidate_value numeric,
  delta numeric,
  reason text,
  evidence_span_id text references evidence_spans(id) on delete set null,
  created_at timestamptz not null default now()
);

create table jobs (
  id text primary key,
  workspace_id text not null references workspaces(id) on delete cascade,
  job_type text not null,
  status job_status not null default 'queued',
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  created_by text references users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create index idx_dataset_imports_workspace_created on dataset_imports(workspace_id, created_at desc);
create index idx_zerore_records_workspace_type_updated on zerore_records(workspace_id, type, updated_at desc);
create index idx_zerore_records_org_project_type_updated on zerore_records(organization_id, project_id, type, updated_at desc);
create index idx_projects_organization_created on projects(organization_id, created_at desc);
create index idx_project_members_user on project_members(user_id);
create index idx_sessions_workspace_dataset on sessions(workspace_id, dataset_id);
create index idx_message_turns_session_turn on message_turns(session_id, turn_index);
create index idx_evaluation_runs_workspace_generated on evaluation_runs(workspace_id, generated_at desc);
create index idx_topic_segments_run_session on topic_segments(evaluation_run_id, session_id);
create index idx_objective_signals_run_metric on objective_signals(evaluation_run_id, metric_key);
create index idx_subjective_signals_run_dimension on subjective_signals(evaluation_run_id, dimension_key);
create index idx_business_kpi_signals_run_kpi on business_kpi_signals(evaluation_run_id, kpi_key);
create index idx_evidence_spans_run_session on evidence_spans(evaluation_run_id, session_id);
create index idx_risk_tags_run_tag on risk_tags(evaluation_run_id, tag_key);
create index idx_gold_cases_set_case on gold_cases(gold_set_id, case_id);
create index idx_gold_tasks_set_status on gold_annotation_tasks(gold_set_id, review_status);
create index idx_judge_predictions_run_case on judge_predictions(judge_run_id, gold_case_id);
create index idx_bad_cases_workspace_severity on bad_cases(workspace_id, severity_score desc);
create index idx_jobs_workspace_status on jobs(workspace_id, status, created_at desc);
