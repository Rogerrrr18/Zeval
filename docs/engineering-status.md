# Zeval Engineering Status

Updated: 2026-05-25

This is the canonical handoff document for developers and future coding agents. It replaces the older root-level `CURRENT_DEVELOPMENT_PROGRESS.md` and `AGENT_HANDOFF_ZEVAL.md`.

## Repository Context

- Repo: `zerore-eval-system-main`
- Active branch: `zeval-2.1`
- Stack: Next.js App Router + TypeScript + zod + Recharts
- Database: `ZEVAL_DATABASE_ADAPTER=local-json` (filesystem, no Supabase migration yet)
- Current goal: keep the MVP quality loop runnable end-to-end with observable LLM judging.

Core loop:

```text
chatlog upload → ingest → evaluate → bad cases / evidence
→ five-channel admission → dataset pool (pending queue / pool)
→ baseline → remediation Skill bundle → online replay
→ compare baseline vs current
```

## Implemented Product Surfaces

### Workbench (`/`)
- CSV / JSON / TXT / MD upload with drag-and-drop.
- Data onboarding mapping plan (field detection + confirmation UI).
- Streamed evaluation progress via `/api/evaluate?stream=1`.
- Grouped summary metrics with tooltips.
- Baseline trend panel.
- Remediation Skill bundle generation entry.
- Result tabs: Summary · Metrics · Bad Case · Goal · Recovery · KPI · Suggestions.
- **LLM status badge** on Goal / Recovery tabs — shows "LLM 评审" (green) or "规则降级" (amber).

### Datasets (`/datasets`)
- Five-channel admission pipeline: `auto_tp / auto_fn / auto_tn / auto_uncertainty / manual_fp`.
- Two-tab UI: **案例池** (pool — human-gate active only) · **待确认** (FN + uncertainty + humanReviewRequired TP/TN).
- Capability dimension filter (`capabilityDimension`) for dimension-sliced pool browsing.
- Near-duplicate dedup via SHA-256 transcript hash.
- `humanSamplingRate` — fraction of TP/TN cases gated for human review before entering pool.
- Human review status badge: auto_captured → human_reviewed → gold_candidate → gold.
- `auto_disagreement` channel is intentionally empty in MVP (requires dual-track parallel evaluation).

### Online Eval (`/online-eval`)
- 3-step flow: select baseline / sample batch → configure replay → compare.
- **历史回放记录**: previous runs persisted to `.zeval-db/online-eval-runs/`, loadable one click.
- **OnlineCompareCharts**: win-rate summary bar + per-metric delta table (↑ ↓ →) + 3 bar charts.
  - Covers all 4 objective metrics (was missing 3 in earlier version).
  - `lowerIsBetter` flag handles directional metrics correctly.

### Chat
- Multi-channel localStorage history.
- Producer / Engineer transcript modes.
- Skill registry: `run_evaluate`, `summarize_findings`, `build_remediation`, `save_baseline`, `run_validation`, `compare_baselines`.

### Remediation packages
```text
remediation-skill-<packageId>/
  SKILL.md
  README.md
  reference/
    issue-brief.md
    badcases.jsonl
    remediation-spec.yaml
    acceptance-gate.yaml
```

## Key Engineering Modules

### Pipeline
- `src/pipeline/evaluateRun.ts` — shared evaluation pipeline entry point.
- `src/pipeline/subjectiveMetrics.ts` — LLM judge for dimensions + goal completion + recovery traces.
- `src/pipeline/extendedMetrics/index.ts` — 10 DeepEval-aligned metrics, bounded concurrency via `mapWithConcurrency`.
- `src/pipeline/objectiveMetrics.ts` — rule-based objective metrics.
- `src/pipeline/signals.ts` — implicit risk signals.
- `src/pipeline/badCaseHarvest.ts` — rule-only topic-level bad case harvest (legacy path, still active).

### Admission & Datasets
- `src/eval-datasets/harvest-badcases.ts` — five-channel admission entry: evaluate → admit → persist.
- `src/eval-datasets/admission/pipeline.ts` — core admission logic (TP / FN / TN / uncertainty / near-dedup gate).
- `src/eval-datasets/admission/rules.ts` — TP, FN, TN, uncertainty rule evaluators; all thresholds env-configurable.
- `src/eval-datasets/storage/` — dataset store abstraction (filesystem adapter by default).

### LLM Observability & Reliability
- `src/lib/siliconflow.ts` — LLM judge client with retry loop, exponential backoff, model fallback.
- `src/lib/judgeLog.ts` — append-only JSONL log at `.zeval-db/judge-logs.jsonl`; one entry per judge call (success + failure).
- `src/lib/concurrency.ts` — `mapWithConcurrency` / `resolveJudgeConcurrency`; prevents rate-limit storms.

### Near-duplicate deduplication
- `src/eval-datasets/case-transcript-hash.ts` — `normalizeTranscriptForHash` + `computeNormalizedTranscriptHash` (L1 exact) + **`jaccardTranscriptSimilarity`** (L2 token-set Jaccard for cross-session near-dedup).
- `src/badcase/dedupe.ts` — Three-layer dedup: L1 exact SHA-256 / L2 Jaccard token similarity (≥ 0.85, fallback when embedding empty) / L3 structural metric+tag distance.
- `src/eval-datasets/admission/pipeline.ts` — Jaccard near-dedup wired for all non-TP channels directly; TP channels use feature-snapshot path (embedding cosine or Jaccard fallback).

### Online Eval
- `src/lib/onlineEvalRunStore.ts` — save/load/list replay runs at `.zeval-db/online-eval-runs/{runId}.json`.
- `src/online-eval/replayAssistant.ts` — HTTP replay logic.

### Infrastructure
- `src/workbench/` — baseline store abstraction.
- `src/auth/context.ts` — Organization / Project / User / Role request context.
- `src/db/` — local JSON / Postgres bridge database adapter.
- `src/copilot/skills.ts` — Chat skill registry.
- `src/copilot/orchestrator.ts` — plan → tool call → final loop.
- `src/remediation/builder.ts` — Skill-bundle remediation package builder.

## Environment Variables

### Zeval-first names (prefer these)

```bash
# LLM judge (any OpenAI-compatible gateway)
ZEVAL_JUDGE_API_KEY=
ZEVAL_JUDGE_BASE_URL=https://api.siliconflow.cn/v1
ZEVAL_JUDGE_MODEL=Qwen/Qwen3.5-27B
ZEVAL_JUDGE_ENABLE_THINKING=false

# Judge concurrency (default 4; raise carefully — avoids rate-limit storms)
ZEVAL_JUDGE_CONCURRENCY=4

# Admission pipeline tuning
ZEVAL_ADMISSION_TN_SAMPLE_RATE=0.05       # fraction of clean sessions sampled as TN (0–1)
ZEVAL_ADMISSION_HUMAN_SAMPLING_RATE=1.0   # fraction of TP/TN requiring human review (0–1)
ZEVAL_UNCERTAINTY_CONF_LO=0.4             # uncertainty band lower bound
ZEVAL_UNCERTAINTY_CONF_HI=0.6             # uncertainty band upper bound

# Database
ZEVAL_DATABASE_ADAPTER=local-json         # or "postgres"
DATASET_STORE_PROVIDER=filesystem
WORKBENCH_BASELINE_STORE_PROVIDER=filesystem

# Online eval customer reply API base URL
ZEVAL_CUSTOMER_API_URL=http://127.0.0.1:4200
```

### Legacy compatibility (keep; do not remove)

```bash
SILICONFLOW_API_KEY        # falls back from ZEVAL_JUDGE_API_KEY
SILICONFLOW_BASE_URL       # falls back from ZEVAL_JUDGE_BASE_URL
SILICONFLOW_MODEL          # falls back from ZEVAL_JUDGE_MODEL
SILICONFLOW_ENABLE_THINKING
SILICONFLOW_CUSTOMER_API_URL  # falls back from ZEVAL_CUSTOMER_API_URL
ZERORE_*
x-zerore-* (headers)
```

## Validation Commands

Always run before meaningful code changes:

```bash
npx tsc --noEmit        # zero-error requirement
npm run lint
npm run build
```

Smoke / gate commands:

```bash
npm run smoke:e2e:clean                          # clean session end-to-end
npm run smoke:e2e:bad                            # angry escalation session
node --import tsx scripts/smoke-admission-pipeline.mts   # five-channel admission unit smoke
npm run calibration:ci
npm run jobs:work:once
```

## Current Known Gaps

| Area | Gap | Priority |
|---|---|---|
| `auto_disagreement` channel | Requires dual-track parallel evaluation (rules ‖ LLM). Fused pipeline makes this non-trivial. Empty in MVP. | Low |
| P1 evaluation projection | ✅ **Done** — `sessions` + `message_turns` now projected. `smoke-evaluate-projection.mts` outputs `sessions:1, messageTurns:8`. | — |
| Near-duplicate dedup | ✅ **Done** — Jaccard token-similarity L2 (threshold 0.85) active for cross-session near-dedup. Exact hash still L1. Jaccard is most effective for 10+ turn sessions or English/mixed-language content; short Chinese-only sessions require near-identical wording due to lack of word boundaries. | — |
| Large-scale fixtures | `mock-chatlog/raw-data` contains only small fixtures (< 50 rows). No large-scale smoke. | Medium |
| Gold set coverage | MVP-level labels. Should expand by scenario and add CI workflow. | Medium |
| Queue | Local durable storage; not a production distributed queue (no BullMQ / Redis). | Low |
| Postgres migration | Schema and adapter exist; `ZEVAL_DATABASE_ADAPTER=local-json` intentionally active until migration is explicitly requested. | Deferred |

## Safe Next Tasks

1. ~~Activate P1 evaluation projection for local-json adapter.~~ ✅ Done.
2. ~~Implement inter-session dedup clustering (Jaccard / MinHash on top of hash).~~ ✅ Done (Jaccard L2).
3. Add large fixture + `scripts/smoke-end-to-end.mjs --scale large`.
4. Expand gold labels by scenario and add CI workflow.
5. Build `auto_disagreement` channel once dual-track evaluation is feasible.
6. SDK contract stabilization (versioned SDK release).

## Agent Rules

Preserve the root [AGENTS.md](../AGENTS.md) constraints:

- Keep changes scoped.
- Prefer runnable MVP pipeline over broad platform rewrites.
- Add JSDoc for new functions.
- Keep errors observable.
- Do **not** remove legacy compatibility unless explicitly requested.
- Do **not** migrate to Supabase/Postgres without explicit instruction (`数据库暂时先不用迁移`).
