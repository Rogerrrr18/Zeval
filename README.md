# Zeval MVP

Zeval is a Next.js + TypeScript workbench for evaluating AI conversations and turning bad cases into remediation tasks.

Current product loop:

```text
upload chatlog -> parse / normalize -> objective + subjective evaluation
-> charts / evidence / suggestions -> baseline -> remediation skill bundle
-> replay / validation -> Chat-assisted follow-up
```

## Quick Start

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

Useful checks:

```bash
npx tsc --noEmit
npm run lint
npm run build
npm run calibration:ci
```

Smoke commands:

```bash
npm run smoke:e2e:clean
npm run smoke:e2e:bad
npm run jobs:work:once
```

## Main Surfaces

- `/chat`：Chat agent, multi-channel history, evaluation and baseline skills.
- `/workbench`：upload / ingest / streamed evaluation / charts / baseline trends / remediation package entry.
- `/datasets`：read-only bad case pool with automatic signals and manual false-positive overrides.
- `/online-eval`：baseline replay and current-vs-baseline comparison.
- `/remediation-packages`：Skill-bundle remediation package browser and validation workflow.
- `/synthesize`：LLM-assisted sample generation for evaluation datasets.

## Integration Methods

Start with the smallest path that proves the loop, then automate the same contract in CI or release checks.

### 1. File Upload

Use `/workbench` for demos and first customer datasets.

- Supported files: `CSV / JSON / TXT / MD`.
- Output: objective metrics, LLM Judge metrics, charts, suggestions, bad cases and baseline artifacts.
- Best for: sample validation, PM review, bad-case triage.

### 2. REST API

Call the evaluation endpoint with canonical `rawRows`.

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "useLlm": true,
    "judgeRequired": true,
    "rawRows": [
      {
        "sessionId": "s1",
        "timestamp": "2026-05-06T00:00:00.000Z",
        "role": "user",
        "content": "我想查一下订单退款进度"
      },
      {
        "sessionId": "s1",
        "timestamp": "2026-05-06T00:00:10.000Z",
        "role": "assistant",
        "content": "我来帮你核对订单状态。"
      }
    ]
  }'
```

The response follows the product contract:

```text
meta + objectiveMetrics + subjectiveMetrics + charts + suggestions
```

### 3. Agent Workflow

Use `/chat` or `/remediation-packages` after an evaluation run.

- Chat can explain results and trigger evaluation/baseline skills.
- Remediation packages compile bad cases into `issue-brief.md`, `remediation-spec.yaml`, `badcases.jsonl` and `acceptance-gate.yaml`.
- Replay checks compare current behavior against saved baselines before shipping.

## Current Scope

Supported input formats:

- `CSV`
- `JSON`
- `TXT`
- `MD`

Core evaluation layers:

- parser / normalizer
- topic segmentation
- objective metrics
- subjective LLM judge as a required product dependency
- bad case harvesting
- report and suggestion builder
- baseline storage
- replay / offline validation

MVP boundaries:

- No production login system.
- No full multi-tenant permission UI.
- No heavyweight workflow orchestration.
- Keep changes scoped to the evaluation and remediation loop.

## Documentation

Root documentation is intentionally minimal. Use [docs/README.md](docs/README.md) as the document index.

Important entries:

- [Engineering status](docs/engineering-status.md)
- [Quality-loop roadmap](docs/roadmap-quality-loop.md)
- [PM product brief](docs/product-brief-pm.md)
- [Data architecture](docs/data-architecture.md)
- [Design guidelines](docs/design-guidelines.md)
- [Changelog](docs/changelog.md)

Agent rules remain in [AGENTS.md](AGENTS.md).

## Environment

Zeval-first variables are preferred:

```bash
ZEVAL_JUDGE_API_KEY=...
ZEVAL_JUDGE_BASE_URL=...
ZEVAL_JUDGE_MODEL=...
ZEVAL_DATABASE_ADAPTER=local-json
```

Legacy `SILICONFLOW_*`, `ZERORE_*`, and `x-zerore-*` compatibility paths still exist for older fixtures and local data.

## Project Structure

```text
app/                    Next.js app routes and API handlers
src/pipeline/           evaluation pipeline and metrics
src/copilot/            Chat skill registry and orchestrator
src/components/         workbench, datasets, remediation and shell UI
src/remediation/        remediation Skill bundle builder and store
src/validation/         replay / offline validation runner
src/workbench/          baseline store abstraction
src/eval-datasets/      case pool and sample batch storage
docs/                   project documentation index and long-form docs
eval-system-概述/        product research, PRDs and historical planning notes
```
