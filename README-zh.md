# Zeval 2.1

**Zeval** 是一套 AI 对话质量评测工作台。  
上传聊天记录文件，运行客观指标 + LLM 评审主观指标，将坏案例收割进数据集池，并生成修复技能包 —— 可通过浏览器 UI **或终端 CLI** 完成全流程。

```
聊天记录文件
    │
    ▼
zeval evaluate           ← 解析 → 增强 → 客观 + 主观指标
    │
    ├──▶ zeval runs show  ← 查看结果、浏览坏案例
    │
    ├──▶ zeval harvest    ← 五通道准入流水线 → 数据集池
    │
    └──▶ zeval package    ← 构建修复技能包（YAML + Markdown）
```

> 英文文档：[README.md](README.md)

---

## 目录

1. [环境要求](#环境要求)
2. [安装](#安装)
3. [快速开始 — CLI](#快速开始--cli)
4. [快速开始 — Web UI](#快速开始--web-ui)
5. [CLI 命令参考](#cli-命令参考)
6. [分步工作流](#分步工作流)
7. [输入文件格式](#输入文件格式)
8. [环境变量](#环境变量)
9. [REST API](#rest-api)
10. [项目结构](#项目结构)
11. [文档](#文档)

---

## 环境要求

| 依赖 | 版本 | 检查命令 |
|---|---|---|
| Node.js | ≥ 18 | `node -v` |
| npm | ≥ 9 | `npm -v` |
| LLM API Key | 任意 OpenAI 兼容网关 | — |

> **本地使用无需数据库。**  
> 默认存储适配器（`local-json`）将所有数据写入本地文件系统。

---

## 安装

### 方式 A — 从源码构建全局 CLI

构建 CLI 包后，将本项目安装为全局命令：

```bash
git clone https://github.com/Rogerrrr18/Zeval_2.0.git -b zeval-2.1
cd Zeval_2.0
npm install
npm run build:cli
npm install -g .
```

验证安装：

```bash
zeval --version   # → 2.1.0
zeval --help
```

在运行命令的目录下创建 `.env` 文件：

```bash
# .env — 最低配置
ZEVAL_JUDGE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
ZEVAL_JUDGE_BASE_URL=https://api.siliconflow.cn/v1
ZEVAL_JUDGE_MODEL=Qwen/Qwen3-7B
```

> **提示：** `zeval` 会自动读取当前工作目录下的 `.env`。

---

### 方式 B — 完整项目安装（CLI + Web UI）

```bash
# 1. 克隆并安装依赖
git clone https://github.com/Rogerrrr18/Zeval_2.0.git -b zeval-2.1
cd Zeval_2.0
npm install

# 2. 创建环境变量文件
cp .env.example .env
```

编辑 `.env`，填入 LLM API Key（唯一必填项）：

```bash
# .env — 最低配置
ZEVAL_JUDGE_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx
ZEVAL_JUDGE_BASE_URL=https://api.siliconflow.cn/v1   # 或任意 OpenAI 兼容端点
ZEVAL_JUDGE_MODEL=Qwen/Qwen3-7B                      # 任意能力足够的对话模型
```

完成，可以开始使用了。

---

## 快速开始 — CLI

评测聊天记录文件的最快方式。

**若已全局安装**（方式 A）：

```bash
# 运行评测（不调用 LLM，仅客观指标 — 速度快）
zeval evaluate your-chatlog.csv --no-llm

# 完整评测（需在 .env 中配置 ZEVAL_JUDGE_API_KEY）
zeval evaluate your-chatlog.csv

# 查看所有已保存的评测运行
zeval runs list

# 查看某次运行的详情
zeval runs show <run-id>
```

**若使用完整项目**（方式 B），命令前加 `npm run zeval --`：

```bash
npm run zeval -- evaluate your-chatlog.csv --no-llm
npm run zeval -- runs list
```

预期输出示例：

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

## 快速开始 — Web UI

```bash
npm run dev
```

打开 **http://localhost:3000**，使用浏览器界面：

| 页面 | 路径 | 用途 |
|---|---|---|
| 项目指挥台 Command Center | `/` | 查看项目状态与质量闭环下一步 |
| 案例校准 Dataset Pool | `/datasets` | 浏览已收割的坏案例、人工复核 |
| 修复验证 Remediation | `/remediation-packages` | 查看与验证技能包 |
| Benchmark | `/benchmark` | 离线回归测试 |
| Copilot | `/chat` | AI 助手，辅助解读评测结果 |

---

## CLI 命令参考

> 所有命令格式：  
> `npm run zeval -- <command> [options]`

---

### `evaluate` — 运行评测流水线

```bash
npm run zeval -- evaluate <file> [options]
```

| 选项 | 说明 | 默认值 |
|---|---|---|
| `--run-id <id>` | 自定义运行 ID | 自动生成 |
| `--format <fmt>` | `csv` / `json` / `jsonl` / `txt` / `md` | 自动检测 |
| `--no-llm` | 跳过 LLM 评审，仅客观指标（快） | 默认开启 LLM |
| `--no-persist` | 不保存结果到 `eval-runs/` | 默认保存 |
| `--harvest` | 评测后自动收割坏案例 | 关闭 |
| `--baseline-version <ver>` | 收割案例的版本标签 | `"cli"` |

**示例：**

```bash
# 最快运行 — 无 LLM，约 1 秒出结果
npm run zeval -- evaluate ./chatlog.csv --no-llm

# 完整运行，自定义 run ID
npm run zeval -- evaluate ./chatlog.csv --run-id sprint-42-eval

# 评测 + 自动收割，一条命令完成
npm run zeval -- evaluate ./chatlog.csv --harvest --baseline-version v1.3

# JSON 格式，不保存产物
npm run zeval -- evaluate ./sessions.json --format json --no-persist
```

---

### `harvest` — 将坏案例准入数据集池

对已保存的评测结果运行五通道准入流水线，并持久化通过的案例。

```bash
npm run zeval -- harvest --run-id <id> [options]
```

| 选项 | 说明 | 默认值 |
|---|---|---|
| `--run-id <id>` | **必填。** 先前 `evaluate` 产生的 run ID | — |
| `--baseline-version <ver>` | 准入案例的版本标签 | `"cli"` |
| `--near-duplicate` | 允许近似重复案例 | 默认拒绝 |
| `--tn-sample-rate <0-1>` | TN（黄金正例）案例采样率 | `0.05` |
| `--human-sampling-rate <0-1>` | 需人工复核的 TP/TN 比例 | `1.0` |
| `--capability-dimension <tag>` | 本批次案例的能力维度标签 | — |

**示例：**

```bash
# 从 run "sprint-42-eval" 收割坏案例
npm run zeval -- harvest --run-id sprint-42-eval

# 带版本标签，跳过人工复核门控
npm run zeval -- harvest --run-id sprint-42-eval \
  --baseline-version v1.3 \
  --human-sampling-rate 0

# 为所有案例打上能力维度标签
npm run zeval -- harvest --run-id sprint-42-eval \
  --capability-dimension intent_understanding
```

**五通道准入说明：**

| 通道 | 捕获内容 |
|---|---|
| `auto_tp` | 真阳性 — 已确认的坏案例 |
| `auto_fn` | 假阴性 — 评审漏判的坏案例 |
| `auto_tn` | 真阴性 — 黄金正例会话 |
| `auto_uncertainty` | 评审置信度低的边界案例 |
| `auto_disagreement` | 多评审分歧案例 |

---

### `package` — 构建修复技能包

将某次运行中的坏案例编译为结构化修复包：  
`issue-brief.md`、`remediation-spec.yaml`、`badcases.jsonl`、`acceptance-gate.yaml`。

```bash
npm run zeval -- package --run-id <id> [options]
```

| 选项 | 说明 | 默认值 |
|---|---|---|
| `--run-id <id>` | **必填。** 先前 `evaluate` 产生的 run ID | — |
| `--case-keys <k1,k2>` | 仅包含指定坏案例 key | 全部案例 |
| `--baseline-customer-id <id>` | 验收门控关联的客户 ID | — |

**示例：**

```bash
# 打包某次运行的全部坏案例
npm run zeval -- package --run-id sprint-42-eval

# 仅打包指定案例
npm run zeval -- package --run-id sprint-42-eval \
  --case-keys bc_001,bc_007,bc_012

# 关联客户基线的验收门控
npm run zeval -- package --run-id sprint-42-eval \
  --baseline-customer-id customer_prod_a
```

输出保存在 `artifacts/remediation-packages/<package-id>/`。

---

### `runs list` — 列出已保存的评测运行

```bash
npm run zeval -- runs list [options]
```

| 选项 | 说明 | 默认值 |
|---|---|---|
| `--limit <n>` | 最多显示条数 | `20` |
| `--project-id <id>` | 按项目过滤 | 全部项目 |

```bash
npm run zeval -- runs list
npm run zeval -- runs list --limit 5
```

---

### `runs show` — 查看某次运行详情

```bash
npm run zeval -- runs show <run-id>
```

输出客观指标、主观维度迷你条形图、坏案例列表与警告信息。

```bash
npm run zeval -- runs show run_1748965432000
```

---

## 分步工作流

从首次运行到生成修复包的完整入门流程：

### 第一步 — 准备聊天记录文件

文件需包含四列：

```csv
sessionId,timestamp,role,content
sess_01,2026-05-01T09:00:00Z,user,你好我想退款
sess_01,2026-05-01T09:00:12Z,assistant,好的请提供一下订单号
sess_01,2026-05-01T09:00:25Z,user,订单号是 123456
sess_02,2026-05-01T10:00:00Z,user,我的包裹什么时候到
```

- `sessionId` — 每个会话一个唯一值
- `timestamp` — ISO 8601 格式（如 `2026-05-01T09:00:00Z`）
- `role` — `user`、`assistant` 或 `system`
- `content` — 消息正文

> **支持的文件类型：** CSV · JSON · JSONL · TXT · MD · XLSX  
> 非 CSV 格式详见 [输入文件格式](#输入文件格式)。

---

### 第二步 — 运行评测

```bash
npm run zeval -- evaluate ./my-chatlog.csv
```

等待进度完成，终端会显示结果表格。  
结果自动保存到 `eval-runs/<run-id>/evaluate.json`。

---

### 第三步 — 查看结果

```bash
npm run zeval -- runs list                          # 找到 run ID
npm run zeval -- runs show run_1748965432000        # 查看详情
```

重点关注：
- **bad cases detected** — 系统标记为有问题的会话
- **subjective dimensions** — LLM 评审的质量维度得分
- **user repeat rate** — 用户重复提问率（高说明问题解决差）
- **escalation hit rate** — 升级转人工率（高通常表示体验差）

---

### 第四步 — 收割坏案例

```bash
npm run zeval -- harvest --run-id run_1748965432000
```

坏案例写入本地数据集池（`eval-datasets/`）。  
也可在浏览器 **http://localhost:3000/datasets** 查看。

---

### 第五步 — 构建修复包

```bash
npm run zeval -- package --run-id run_1748965432000
```

输出目录：

```
artifacts/remediation-packages/<package-id>/
├── manifest.json           ← 元数据
└── reference/
    ├── issue-brief.md          ← 问题描述（自然语言）
    ├── remediation-spec.yaml   ← 结构化修复规格
    ├── badcases.jsonl          ← 证据对话
    └── acceptance-gate.yaml    ← 验证修复的验收标准
```

将 `issue-brief.md` 与 `remediation-spec.yaml` 交给 Agent 或工程团队即可。

---

### 一条命令（评测 + 收割）

```bash
npm run zeval -- evaluate ./my-chatlog.csv --harvest --baseline-version v1.3
```

---

## 输入文件格式

### CSV（推荐）

必填列：`sessionId`、`timestamp`、`role`、`content`

```csv
sessionId,timestamp,role,content
sess_01,2026-05-01T09:00:00Z,user,Hello
sess_01,2026-05-01T09:00:05Z,assistant,Hi! How can I help?
```

### JSON / JSONL

行对象数组（JSON）或每行一个对象（JSONL）：

```json
[
  { "sessionId": "sess_01", "timestamp": "2026-05-01T09:00:00Z", "role": "user", "content": "Hello" },
  { "sessionId": "sess_01", "timestamp": "2026-05-01T09:00:05Z", "role": "assistant", "content": "Hi!" }
]
```

### XLSX

将表格导出为 `.xlsx`，使用第一个工作表。  
列名需与 CSV 规范一致，列顺序不限。

### TXT / MD

自由文本通过启发式规则自动解析，结果可能不稳定 —— 生产环境建议使用 CSV/JSON。

---

## 环境变量

复制 `.env.example` 为 `.env` 并填写。

### 最低配置（CLI + Web）

```bash
ZEVAL_JUDGE_API_KEY=sk-xxxxxxxx          # LLM API Key
ZEVAL_JUDGE_BASE_URL=https://api.siliconflow.cn/v1
ZEVAL_JUDGE_MODEL=Qwen/Qwen3-7B
```

### 全部变量

| 变量 | 说明 | 默认值 |
|---|---|---|
| `ZEVAL_JUDGE_API_KEY` | LLM API Key（OpenAI 兼容） | — |
| `ZEVAL_JUDGE_BASE_URL` | LLM 网关 Base URL | — |
| `ZEVAL_JUDGE_MODEL` | 模型名称 | — |
| `ZEVAL_RUBRIC_DEEPSEARCH_MODEL` | 可选：Rubric 来源发现的 DeepSearch/联网研究模型 | 回退到 judge 模型 |
| `ZEVAL_RUBRIC_DEEPSEARCH_EXTRA_BODY` | 可选：合并进 Rubric DeepSearch 请求的 JSON（供应商特定搜索参数） | — |
| `ZEVAL_JUDGE_CONCURRENCY` | 评审并发上限 | `4` |
| `ZEVAL_JUDGE_ENABLE_THINKING` | 启用思维链（视模型而定） | `false` |
| `ZEVAL_DATABASE_ADAPTER` | `local-json` 或 `postgres` | `local-json` |
| `DATASET_STORE_PROVIDER` | `filesystem` 或 `database` | `filesystem` |
| `ZEVAL_ADMISSION_TN_SAMPLE_RATE` | 作为黄金样本的干净会话采样比例 | `0.05` |
| `ZEVAL_ADMISSION_HUMAN_SAMPLING_RATE` | 需人工复核的 TP/TN 比例 | `1.0` |
| `ZEVAL_DEFAULT_ORGANIZATION_ID` | 多租户默认组织 ID | `default-org` |

### 仅 CLI（可选）

```bash
ZEVAL_PROJECT_ID=my-project     # 默认："default"
ZEVAL_USER_ID=my-user           # 默认："cli-user"
ZEVAL_ORG_ID=my-org             # 默认："default-org"
```

---

## REST API

Web 服务暴露与 CLI 相同的流水线。  
先启动服务：`npm run dev`

### 导入 + 评测

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

响应结构：

```
meta + objectiveMetrics + subjectiveMetrics + charts + suggestions + badCaseAssets
```

### 收割坏案例

```bash
curl -X POST http://localhost:3000/api/eval-datasets/harvest-badcases \
  -H "Content-Type: application/json" \
  -d '{ "evaluate": <evaluate-response-body> }'
```

### 生成修复包

```bash
curl -X POST http://localhost:3000/api/remediation-packages \
  -H "Content-Type: application/json" \
  -d '{ "evaluate": <evaluate-response-body> }'
```

---

## 项目结构

```
app/                        Next.js App Router — 页面与 API 路由
  api/                      HTTP API（ingest、evaluate、harvest、package 等）

src/
  cli/                      ← CLI 入口与命令
    index.ts                Commander 程序
    display.ts              终端输出（ANSI、spinner、表格）
    context.ts              CLI 工作区上下文
    commands/
      evaluate.ts           zeval evaluate <file>
      harvest.ts            zeval harvest --run-id <id>
      package.ts            zeval package --run-id <id>
      runs.ts               zeval runs list | show <id>

  pipeline/                 评测流水线（增强 → 指标 → 坏案例）
  eval-datasets/            五通道准入与数据集存储
  remediation/              技能包构建与包存储
  parsers/                  CSV / JSON / JSONL / TXT / MD 解析器
  schemas/                  Zod 请求校验
  persistence/              评测结果文件系统存储
  copilot/                  Chat 技能注册与编排
  components/               React UI 组件（仅 Web）

bin/
  zeval.mjs                 通过 tsx 运行 src/cli/index.ts 的可执行入口

eval-runs/                  已保存的评测产物（自动创建）
eval-datasets/              数据集池：坏案例、好案例、抽样批次
artifacts/                  修复包（自动创建）
docs/                       项目文档
```

---

## 常用脚本

```bash
# 开发
npm run dev                  # 启动 Web UI，http://localhost:3000

# CLI
npm run zeval -- --help      # 查看所有 CLI 命令
npm run zeval -- evaluate your-chatlog.csv --no-llm

# 类型检查与 Lint
npx tsc --noEmit
npm run lint

# 冒烟测试
npm run smoke:admission      # 五通道准入流水线（无需 LLM）
npm run smoke:e2e:clean      # 端到端冒烟（需配置 .env）

# 后台任务 Worker（可选）
npm run jobs:work:once
```

---

## 文档

- [工程现状](docs/engineering-status.md)
- [质量闭环路线图](docs/roadmap-quality-loop.md)
- [PM 产品简报](docs/product-brief-pm.md)
- [数据架构](docs/data-architecture.md)
- [设计规范](docs/design-guidelines.md)
- [变更日志](docs/changelog.md)

Agent 规则：[AGENTS.md](AGENTS.md)
