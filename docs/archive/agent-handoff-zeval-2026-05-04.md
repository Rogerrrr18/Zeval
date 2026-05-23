# Zeval Agent Handoff

Last updated: 2026-05-04

This document is for future coding agents taking over the Zeval repo. It summarizes the current state, important constraints, validation commands, and known caveats.

## Repository

- Path: `/Users/rogeryang/Desktop/zerore-eval-system-main`
- Active branch: `Zeval`
- Stack: Next.js App Router + TypeScript
- Current MVP goal: upload/receive conversation data -> parse -> normalize -> objective metrics -> LLM Judge subjective metrics -> charts/suggestions -> optimization/reporting UI.

## Project Rules To Preserve

- Prioritize runnable MVP pipeline over large platform abstractions.
- Keep changes minimal and directly related to the requested task.
- Do not add login, multi-tenant permission systems, or complex orchestration unless explicitly requested.
- New functions should have JSDoc comments explaining input, output, and fallback behavior.
- Prefer pure functions for core metric and evaluation logic.
- Do not silently swallow errors. Return observable error messages.
- Do not remove legacy compatibility keys unless the user explicitly asks.

## Current Major Implementations

### Brand/UI

- Product name is now `Zeval`.
- Main navigation is a fixed left sidebar.
- `Copilot` was renamed to `Chat`.
- Chat supports multiple channels and localStorage-backed history.
- New CSS-based logo component is used in shell and landing UI.

Important files:

- `src/components/shell/AppShell.tsx`
- `src/components/brand/ZevalLogo.tsx`
- `src/components/brand/zevalLogo.module.css`
- `src/components/copilot/CopilotConsole.tsx`
- `src/components/home/LandingPage.tsx`

### LLM Judge Engineering

Judge calls now use a fixed versioned profile:

- Profile version: defined in `src/llm/judgeProfile.ts`
- Prompt versions: per judge stage
- Runtime params: fixed model, temperature, topP, maxTokens
- Logs include `judgeProfile` and `promptVersion`
- CI gate supports gold regression, agreement, and drift checks

Important files:

- `src/llm/judgeProfile.ts`
- `src/lib/siliconflow.ts`
- `src/calibration/judgeCalibration.ts`
- `src/calibration/judgeGate.ts`
- `src/calibration/types.ts`
- `calibration/judge-profile.json`
- `calibration/scripts/run-judge-on-gold.mts`
- `calibration/scripts/ci-gate.mts`

Preferred environment variables:

```bash
ZEVAL_JUDGE_API_KEY
ZEVAL_JUDGE_BASE_URL
ZEVAL_JUDGE_MODEL
ZEVAL_JUDGE_ENABLE_THINKING
```

Legacy fallback variables still work:

```bash
SILICONFLOW_API_KEY
SILICONFLOW_BASE_URL
SILICONFLOW_MODEL
SILICONFLOW_ENABLE_THINKING
```

### Queue / Job Runner

The queue is now a durable local filesystem-backed queue suitable for MVP long jobs.

Supported status values:

- `queued`
- `running`
- `succeeded`
- `failed`
- `canceled`

Supported operations:

- enqueue
- list
- read
- cancel
- retry
- recover stale running jobs
- run one batch
- worker loop

Important files:

- `src/queue/index.ts`
- `src/jobs/handlers.ts`
- `scripts/run-job-worker.mts`
- `app/api/jobs/route.ts`
- `app/api/jobs/[jobId]/route.ts`
- `app/api/jobs/run/route.ts`
- `app/api/evaluate/route.ts`
- `app/api/validation-runs/route.ts`

Worker commands:

```bash
npm run jobs:work
npm run jobs:work:once
```

Note: this is not yet a production distributed queue. Do not overstate it as Redis/SQS/Postgres-grade.

### Docs And Naming

Docs and visible product naming were migrated to `Zeval`.

Important docs:

- `README.md`
- `CURRENT_DEVELOPMENT_PROGRESS.md`
- `AGENT_HANDOFF_ZEVAL.md`
- `zeval-metrics-dag.html`
- `项目方案说明（PM版）.md`
- `执行规划.md`
- `eval-system-概述/Zeval · 业务介绍.md`

Some legacy terms are intentionally retained:

- `ZERORE_*` env fallbacks
- `x-zerore-*` header fallbacks
- `zerore_records` historical database bridge wording

These should not be blindly replaced unless compatibility is intentionally removed.

## Validation Commands

Run these before committing meaningful code changes:

```bash
npm run lint
npx tsc --noEmit
npm run calibration:ci
npm run jobs:work:once
npm run build
```

Known build caveat:

- `npm run build` may emit a Turbopack NFT warning related to existing workbench baseline file tracing. Build currently completes successfully.

## Current Known Gaps

1. Gold set coverage is still MVP-level. Expand calibration datasets before trusting judge stability long term.
2. Queue is durable local storage, not a true distributed production queue.
3. SDK/integration examples are not yet a published stable SDK.
4. Need real customer-data stress testing for large CSV/JSON/TXT/MD imports.
5. Need `.env.example` cleanup for Zeval-first naming and legacy fallback explanation.

## Safe Next Tasks

Recommended next implementation tasks:

1. Add `.env.example` with Zeval variables.
2. Add Playwright or API-level E2E tests for upload -> evaluation report.
3. Expand calibration gold labels by scenario.
4. Add Postgres-backed queue adapter or BullMQ adapter behind the existing queue interface.
5. Add CI workflow running lint, typecheck, build, and calibration gate.
6. Add UI status view for queued/running/failed jobs.

## Git Notes

- User asked to push to branch `Zeval`.
- Preserve unrelated user files and previous generated docs.
- `zeval-metrics-dag.html` is an intentional root artifact from a previous request.

