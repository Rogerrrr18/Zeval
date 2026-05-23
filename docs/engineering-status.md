# Zeval Engineering Status

Updated: 2026-05-05

This is the canonical handoff document for developers and future coding agents. It replaces the older root-level `CURRENT_DEVELOPMENT_PROGRESS.md` and `AGENT_HANDOFF_ZEVAL.md`.

## Repository Context

- Repo: `/Users/rogeryang/Desktop/zerore-eval-system-main`
- Branch: `Zeval`
- Stack: Next.js App Router + TypeScript + zod
- Current goal: keep the MVP quality loop runnable end to end.

Core loop:

```text
chatlog upload -> ingest -> evaluate -> evidence / bad cases
-> baseline -> remediation Skill bundle -> replay / offline validation
-> Chat-guided follow-up
```

## Implemented Product Surfaces

- `Chat`
  - Multi-channel localStorage history.
  - Producer / Engineer transcript modes.
  - Skill registry includes `run_evaluate`, `summarize_findings`, `build_remediation`, `save_baseline`, `run_validation`, `compare_baselines`.
- `Workbench`
  - CSV / JSON / TXT / MD upload.
  - Data onboarding mapping plan.
  - Streamed evaluation progress through `/api/evaluate?stream=1`.
  - Grouped summary metrics with tooltips.
  - Baseline trend panel.
  - Remediation Skill bundle generation entry.
- `Datasets`
  - Topic-level bad case pool.
  - Read-only case cards with auto signals.
  - Manual false-positive overrides through `manualOverrides`.
- `Remediation packages`
  - Skill-bundle output shape:

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

- `Online eval`
  - Baseline replay via customer reply API.
  - Current-vs-baseline comparison payload.
- `Integrations`
  - SDK / CLI / REST snippets.
  - Trace ingest API remains available as internal capability.

## Key Engineering Modules

- `src/pipeline/evaluateRun.ts`：shared evaluation pipeline.
- `src/pipeline/segmenter.ts`：rule-first topic segmentation with optional LLM continuity review.
- `src/pipeline/badCaseHarvest.ts`：rule-only topic-level bad case harvest.
- `src/copilot/skills.ts`：Chat skill registry.
- `src/copilot/orchestrator.ts`：plan -> tool call -> final loop.
- `src/remediation/builder.ts`：Skill-bundle remediation package builder.
- `src/validation/runner.ts`：replay and offline validation runners.
- `src/workbench/*`：baseline store abstraction.
- `src/eval-datasets/storage/*`：dataset store abstraction.
- `src/auth/context.ts`：Organization / Project / User / Role request context.
- `src/db/*`：local JSON / Postgres bridge database adapter.
- `src/queue/index.ts`：local durable queue.

## Environment

Prefer Zeval-first names:

```bash
ZEVAL_JUDGE_API_KEY
ZEVAL_JUDGE_BASE_URL
ZEVAL_JUDGE_MODEL
ZEVAL_JUDGE_ENABLE_THINKING
ZEVAL_DATABASE_ADAPTER
```

Legacy compatibility still exists and should not be removed casually:

```bash
SILICONFLOW_API_KEY
SILICONFLOW_BASE_URL
SILICONFLOW_MODEL
SILICONFLOW_ENABLE_THINKING
ZERORE_*
x-zerore-*
zerore_records
```

## Validation Commands

Run before meaningful code changes:

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Useful smoke / gate commands:

```bash
npm run smoke:e2e:clean
npm run smoke:e2e:bad
npm run calibration:ci
npm run jobs:work:once
```

Known caveat: build may emit a Turbopack NFT warning related to local baseline file tracing. The warning is not currently treated as a failed build.

## Current Known Gaps

- P1 field mapping is still only partially generic. Rule variants exist, but user-confirmed mapping edits and cached LLM mapping decisions are not complete.
- Large dataset testing is not done. `mock-chatlog/raw-data` still contains small fixtures.
- Synthesis is still visible as a standard product surface; product decision says it should be downgraded to project-based cooperation.
- Queue is local durable storage, not a production distributed queue.
- Gold set coverage is still MVP-level and should be expanded by scenario.
- SDK / CLI examples are useful but not yet a published stable SDK contract.
- `.env.example` should be cleaned up around Zeval-first naming and legacy fallback explanation.

## Safe Next Tasks

1. Finish P1 field mapping: editable mapping confirmation UI, cached `dataMappingPlan`, stronger generic JSON/CSV conversion.
2. Add a large fixture and `scripts/smoke-end-to-end.mjs --scale large`.
3. Move `/synthesize` into an integrations/project-based cooperation hook.
4. Add API-level tests for upload -> evaluation -> baseline -> remediation -> validation.
5. Add Postgres-backed queue or BullMQ behind the existing queue interface.
6. Expand calibration gold labels by scenario and add CI workflow.

## Agent Rules

Preserve the root [AGENTS.md](../AGENTS.md) constraints:

- Keep changes scoped.
- Prefer runnable MVP pipeline over broad platform rewrites.
- Add JSDoc for new functions.
- Keep errors observable.
- Do not remove legacy compatibility unless explicitly requested.
