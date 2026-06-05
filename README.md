# Zeval 2.1

**Zeval** is an AI conversation quality evaluation workbench.  
Upload chatlog files, run objective + LLM-judge subjective metrics, harvest bad cases into a dataset pool, and generate remediation skill bundles — all from a browser UI **or a terminal CLI**.

```
chatlog file
    │
    ▼
zeval evaluate           ← parse → enrich → objective + subjective metrics
    │
    ├──▶ zeval runs show  ← inspect results, view bad cases
    │
    ├──▶ zeval harvest    ← 5-channel admission pipeline → dataset pool
    │
    └──▶ zeval package    ← build remediation skill bundle (YAML + Markdown)
```

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Quick Start — CLI](#quick-start--cli)
4. [Quick Start — Web UI](#quick-start--web-ui)
5. [CLI Command Reference](#cli-command-reference)
6. [Step-by-Step Workflow](#step-by-step-workflow)
7. [Input File Format](#input-file-format)
8. [Environment Variables](#environment-variables)
9. [REST API](#rest-api)
10. [Project Structure](#project-structure)
11. [Documentation](#documentation)

---

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | ≥ 18 | `node -v` |
| npm | ≥ 9 | `npm -v` |
| An LLM API key | any OpenAI-compatible gateway | — |

> **No database required for local use.**  
> The default storage adapter (`local-json`) writes everything to the local filesystem.

---

## Installation

### Option A — Build a Global CLI From Source

Build the CLI bundle, then install this project as a global command:

```bash
git clone https://github.com/Rogerrrr18/Zeval_2.0.git -b zeval-2.1
cd Zeval_2.0
npm install
npm run build:cli
npm install -g .
```

Verify it works:

```bash
zeval --version   # → 2.1.0
zeval --help
```

Then create a `.env` file anywhere you'll run commands from:

```bash
# .env — minimum required
ZEVAL_JUDGE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
ZEVAL_JUDGE_BASE_URL=https://api.siliconflow.cn/v1
ZEVAL_JUDGE_MODEL=Qwen/Qwen3-7B
```

> **Tip:** `zeval` reads `.env` from the current working directory automatically.

---

### Option B — Full Project Install (CLI + Web UI)

```bash
# 1. Clone and install dependencies
git clone https://github.com/Rogerrrr18/Zeval_2.0.git -b zeval-2.1
cd Zeval_2.0
npm install

# 2. Create your environment file
cp .env.example .env
```

Open `.env` and fill in your LLM API key (the only required field):

```bash
# .env — minimum required configuration
ZEVAL_JUDGE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
ZEVAL_JUDGE_BASE_URL=https://api.siliconflow.cn/v1   # or any OpenAI-compatible endpoint
ZEVAL_JUDGE_MODEL=Qwen/Qwen3-7B                      # any capable chat model
```

That's it. You're ready to go.

---

## Quick Start — CLI

The fastest way to evaluate a chatlog file.

**If installed globally** (Option A):

```bash
# Run evaluation on a chatlog file (no LLM, objective metrics only — fast)
zeval evaluate your-chatlog.csv --no-llm

# Run with full LLM judge (requires ZEVAL_JUDGE_API_KEY in .env)
zeval evaluate your-chatlog.csv

# See all saved runs
zeval runs list

# Inspect a specific run
zeval runs show <run-id>
```

**If using the full project** (Option B), prefix commands with `npm run zeval --`:

```bash
npm run zeval -- evaluate your-chatlog.csv --no-llm
npm run zeval -- runs list
```

You should see output like:

```
✓ Evaluation complete

Results
  sessions                       12
  messages                       242
  bad cases detected             4

  ─── Objective ───────────────
  avg response gap (s)           1.20
  user repeat rate               10.8%
  agent resolution rate          42.0%
  escalation hit rate            8.3%

  ─── Subjective ──────────────
  dimensions evaluated           5
  implicit signals               3
  goal completions               12
```

---

## Quick Start — Web UI

```bash
npm run dev
```

Open **http://localhost:3000** and use the browser interface:

| Page | Path | Purpose |
|---|---|---|
| Command Center 项目指挥台 | `/` | Review project status and quality-loop next steps |
| Dataset Pool 案例校准 | `/datasets` | Browse harvested bad cases, human review |
| Remediation 修复验证 | `/remediation-packages` | View & validate skill bundles |
| Benchmark | `/benchmark` | Offline regression testing |
| Copilot | `/chat` | AI assistant for result interpretation |

---

## CLI Command Reference

> All commands follow the pattern:  
> `npm run zeval -- <command> [options]`

---

### `evaluate` — Run evaluation pipeline

```bash
npm run zeval -- evaluate <file> [options]
```

| Option | Description | Default |
|---|---|---|
| `--run-id <id>` | Custom run identifier | auto-generated |
| `--format <fmt>` | `csv` / `json` / `jsonl` / `txt` / `md` | auto-detected |
| `--no-llm` | Skip LLM judge, objective metrics only (fast) | LLM on |
| `--no-persist` | Don't save result to `eval-runs/` | saves by default |
| `--harvest` | Auto-harvest bad cases after evaluation | off |
| `--baseline-version <ver>` | Version tag for harvested cases | `"cli"` |

**Examples:**

```bash
# Fastest run — no LLM, results in ~1 second
npm run zeval -- evaluate ./chatlog.csv --no-llm

# Full run with custom run ID
npm run zeval -- evaluate ./chatlog.csv --run-id sprint-42-eval

# Full run + auto-harvest bad cases in one command
npm run zeval -- evaluate ./chatlog.csv --harvest --baseline-version v1.3

# JSON format file, skip saving artifact
npm run zeval -- evaluate ./sessions.json --format json --no-persist
```

---

### `harvest` — Admit bad cases to dataset pool

Runs the 5-channel admission pipeline on a saved evaluate result and persists accepted cases.

```bash
npm run zeval -- harvest --run-id <id> [options]
```

| Option | Description | Default |
|---|---|---|
| `--run-id <id>` | **Required.** Run ID from a previous `evaluate` | — |
| `--baseline-version <ver>` | Version tag stamped on admitted cases | `"cli"` |
| `--near-duplicate` | Allow near-duplicate cases | reject |
| `--tn-sample-rate <0-1>` | Sampling rate for TN (golden positive) cases | `0.05` |
| `--human-sampling-rate <0-1>` | Fraction of TP/TN requiring human review | `1.0` |
| `--capability-dimension <tag>` | Capability label for all cases in this batch | — |

**Examples:**

```bash
# Harvest bad cases from run "sprint-42-eval"
npm run zeval -- harvest --run-id sprint-42-eval

# Harvest with version tag and no human review gate
npm run zeval -- harvest --run-id sprint-42-eval \
  --baseline-version v1.3 \
  --human-sampling-rate 0

# Tag all cases with a capability dimension
npm run zeval -- harvest --run-id sprint-42-eval \
  --capability-dimension intent_understanding
```

**5 admission channels explained:**

| Channel | What it captures |
|---|---|
| `auto_tp` | True positives — confirmed bad cases |
| `auto_fn` | False negatives — bad cases the judge missed |
| `auto_tn` | True negatives — golden positive sessions |
| `auto_uncertainty` | Borderline cases where judge confidence is low |
| `auto_disagreement` | Cases where multiple judges disagree |

---

### `package` — Build a remediation skill bundle

Compiles bad cases from a run into a structured remediation package:  
`issue-brief.md`, `remediation-spec.yaml`, `badcases.jsonl`, `acceptance-gate.yaml`.

```bash
npm run zeval -- package --run-id <id> [options]
```

| Option | Description | Default |
|---|---|---|
| `--run-id <id>` | **Required.** Run ID from a previous `evaluate` | — |
| `--case-keys <k1,k2>` | Only include specific bad case keys | all cases |
| `--baseline-customer-id <id>` | Customer ID for the acceptance gate | — |

**Examples:**

```bash
# Package all bad cases from a run
npm run zeval -- package --run-id sprint-42-eval

# Package only specific cases
npm run zeval -- package --run-id sprint-42-eval \
  --case-keys bc_001,bc_007,bc_012

# Package with acceptance gate tied to a customer baseline
npm run zeval -- package --run-id sprint-42-eval \
  --baseline-customer-id customer_prod_a
```

Output is saved to `artifacts/remediation-packages/<package-id>/`.

---

### `runs list` — List saved evaluate runs

```bash
npm run zeval -- runs list [options]
```

| Option | Description | Default |
|---|---|---|
| `--limit <n>` | Max runs to display | `20` |
| `--project-id <id>` | Filter by project | all projects |

```bash
npm run zeval -- runs list
npm run zeval -- runs list --limit 5
```

---

### `runs show` — Inspect a saved run

```bash
npm run zeval -- runs show <run-id>
```

Prints objective metrics, subjective dimensions with mini bar charts, bad case list, and warnings.

```bash
npm run zeval -- runs show run_1748965432000
```

---

## Step-by-Step Workflow

A complete beginner workflow from first run to remediation package:

### Step 1 — Prepare your chatlog file

Your file must have four columns:

```csv
sessionId,timestamp,role,content
sess_01,2026-05-01T09:00:00Z,user,你好我想退款
sess_01,2026-05-01T09:00:12Z,assistant,好的请提供一下订单号
sess_01,2026-05-01T09:00:25Z,user,订单号是 123456
sess_02,2026-05-01T10:00:00Z,user,我的包裹什么时候到
```

- `sessionId` — one value per conversation
- `timestamp` — ISO 8601 format (e.g. `2026-05-01T09:00:00Z`)
- `role` — `user`, `assistant`, or `system`
- `content` — the message text

> **Supported file types:** CSV · JSON · JSONL · TXT · MD · XLSX  
> See [Input File Format](#input-file-format) for non-CSV formats.

---

### Step 2 — Run evaluation

```bash
npm run zeval -- evaluate ./my-chatlog.csv
```

Watch the spinner. When done, you'll see a results table.  
The result is automatically saved to `eval-runs/<run-id>/evaluate.json`.

---

### Step 3 — Review results

```bash
npm run zeval -- runs list                          # find your run ID
npm run zeval -- runs show run_1748965432000        # inspect it
```

Look at:
- **bad cases detected** — conversations the system flagged as problematic
- **subjective dimensions** — LLM judge scores for quality dimensions
- **user repeat rate** — users repeating questions (sign of poor resolution)
- **escalation hit rate** — conversations that escalated (high = bad)

---

### Step 4 — Harvest bad cases

```bash
npm run zeval -- harvest --run-id run_1748965432000
```

This pushes the bad cases into the local dataset pool (`eval-datasets/`).  
You can also view them in the browser at **http://localhost:3000/datasets**.

---

### Step 5 — Build remediation package

```bash
npm run zeval -- package --run-id run_1748965432000
```

Find the output at:

```
artifacts/remediation-packages/<package-id>/
├── manifest.json           ← metadata
└── reference/
    ├── issue-brief.md          ← plain-language problem description
    ├── remediation-spec.yaml   ← structured fix specification
    ├── badcases.jsonl          ← evidence conversations
    └── acceptance-gate.yaml    ← test criteria for verifying the fix
```

Hand `issue-brief.md` and `remediation-spec.yaml` to your agent or engineering team.

---

### One-liner (evaluate + harvest in one step)

```bash
npm run zeval -- evaluate ./my-chatlog.csv --harvest --baseline-version v1.3
```

---

## Input File Format

### CSV (recommended)

Required columns: `sessionId`, `timestamp`, `role`, `content`

```csv
sessionId,timestamp,role,content
sess_01,2026-05-01T09:00:00Z,user,Hello
sess_01,2026-05-01T09:00:05Z,assistant,Hi! How can I help?
```

### JSON / JSONL

Array of row objects (JSON) or one object per line (JSONL):

```json
[
  { "sessionId": "sess_01", "timestamp": "2026-05-01T09:00:00Z", "role": "user", "content": "Hello" },
  { "sessionId": "sess_01", "timestamp": "2026-05-01T09:00:05Z", "role": "assistant", "content": "Hi!" }
]
```

### XLSX

Export your spreadsheet as `.xlsx`. The first sheet is used.  
Columns must match the CSV spec above. Column order doesn't matter.

### TXT / MD

Free-form text is auto-parsed using heuristics. Results may vary — CSV/JSON are recommended for production use.

---

## Environment Variables

Copy `.env.example` to `.env` and fill in values.

### Minimum required (CLI + Web)

```bash
ZEVAL_JUDGE_API_KEY=sk-xxxxxxxx          # Your LLM API key
ZEVAL_JUDGE_BASE_URL=https://api.siliconflow.cn/v1
ZEVAL_JUDGE_MODEL=Qwen/Qwen3-7B
```

### All variables

| Variable | Description | Default |
|---|---|---|
| `ZEVAL_JUDGE_API_KEY` | LLM API key (OpenAI-compatible) | — |
| `ZEVAL_JUDGE_BASE_URL` | LLM gateway base URL | — |
| `ZEVAL_JUDGE_MODEL` | Model name | — |
| `ZEVAL_RUBRIC_DEEPSEARCH_MODEL` | Optional DeepSearch/web-research model for rubric source discovery | falls back to judge model |
| `ZEVAL_RUBRIC_DEEPSEARCH_EXTRA_BODY` | Optional JSON merged into rubric DeepSearch chat request for provider-specific search flags | — |
| `ZEVAL_JUDGE_CONCURRENCY` | Max concurrent judge calls | `4` |
| `ZEVAL_JUDGE_ENABLE_THINKING` | Enable chain-of-thought (model-dependent) | `false` |
| `ZEVAL_DATABASE_ADAPTER` | `local-json` or `postgres` | `local-json` |
| `DATASET_STORE_PROVIDER` | `filesystem` or `database` | `filesystem` |
| `ZEVAL_ADMISSION_TN_SAMPLE_RATE` | Fraction of clean sessions sampled as gold | `0.05` |
| `ZEVAL_ADMISSION_HUMAN_SAMPLING_RATE` | Fraction of TP/TN requiring review | `1.0` |
| `ZEVAL_DEFAULT_ORGANIZATION_ID` | Default org for multi-tenant use | `default-org` |

### CLI-only (optional)

```bash
ZEVAL_PROJECT_ID=my-project     # default: "default"
ZEVAL_USER_ID=my-user           # default: "cli-user"
ZEVAL_ORG_ID=my-org             # default: "default-org"
```

---

## REST API

The web server exposes the same pipeline as an HTTP API.  
Start the server first: `npm run dev`

### Ingest + evaluate

```bash
curl -X POST http://localhost:3000/api/ingest \
  -H "Content-Type: application/json" \
  -d '{
    "text": "sessionId,timestamp,role,content\nsess_01,2026-05-01T09:00:00Z,user,退款",
    "format": "csv",
    "fileName": "chatlog.csv"
  }'
```

```bash
curl -X POST http://localhost:3000/api/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "useLlm": true,
    "rawRows": [
      { "sessionId": "s1", "timestamp": "2026-05-01T09:00:00Z", "role": "user",      "content": "我想申请退款" },
      { "sessionId": "s1", "timestamp": "2026-05-01T09:00:10Z", "role": "assistant", "content": "好的请提供订单号" }
    ]
  }'
```

Response shape:
```
meta + objectiveMetrics + subjectiveMetrics + charts + suggestions + badCaseAssets
```

### Harvest bad cases

```bash
curl -X POST http://localhost:3000/api/eval-datasets/harvest-badcases \
  -H "Content-Type: application/json" \
  -d '{ "evaluate": <evaluate-response-body> }'
```

### Generate remediation package

```bash
curl -X POST http://localhost:3000/api/remediation-packages \
  -H "Content-Type: application/json" \
  -d '{ "evaluate": <evaluate-response-body> }'
```

---

## Project Structure

```
app/                        Next.js App Router — pages and API routes
  api/                      HTTP API endpoints (ingest, evaluate, harvest, package, …)

src/
  cli/                      ← CLI entry point and commands
    index.ts                Commander program
    display.ts              Terminal output helpers (ANSI, spinner, tables)
    context.ts              CLI workspace context
    commands/
      evaluate.ts           zeval evaluate <file>
      harvest.ts            zeval harvest --run-id <id>
      package.ts            zeval package --run-id <id>
      runs.ts               zeval runs list | show <id>

  pipeline/                 Evaluation pipeline (enrich → metrics → bad cases)
  eval-datasets/            5-channel admission pipeline and dataset store
  remediation/              Skill bundle builder and package store
  parsers/                  CSV / JSON / JSONL / TXT / MD parsers
  schemas/                  Zod request validation schemas
  persistence/              Evaluate result file-system store
  copilot/                  Chat skill registry and orchestrator
  components/               React UI components (web only)

bin/
  zeval.mjs                 Executable shim that runs src/cli/index.ts via tsx

eval-runs/                  Saved evaluate result artifacts (auto-created)
eval-datasets/              Dataset pool: bad cases, good cases, sample batches
artifacts/                  Remediation packages (auto-created)
docs/                       Project documentation
```

---

## Useful Scripts

```bash
# Development
npm run dev                  # Start web UI at http://localhost:3000

# CLI
npm run zeval -- --help      # Show all CLI commands
npm run zeval -- evaluate your-chatlog.csv --no-llm

# Type checking and linting
npx tsc --noEmit
npm run lint

# Smoke tests
npm run smoke:admission      # Test 5-channel admission pipeline (no LLM)
npm run smoke:e2e:clean      # End-to-end smoke test (requires .env)

# Background job worker (optional)
npm run jobs:work:once
```

---

## Documentation

- [Engineering status](docs/engineering-status.md)
- [Quality-loop roadmap](docs/roadmap-quality-loop.md)
- [PM product brief](docs/product-brief-pm.md)
- [Data architecture](docs/data-architecture.md)
- [Design guidelines](docs/design-guidelines.md)
- [Changelog](docs/changelog.md)

Agent rules: [AGENTS.md](AGENTS.md)
