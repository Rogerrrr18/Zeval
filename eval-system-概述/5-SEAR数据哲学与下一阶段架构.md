# SEAR 数据哲学与下一阶段架构策略

本文用于沉淀 SEAR 论文对 Zeval System 的启发，并把下一阶段开发从“继续堆功能”收敛到“结构化质量信号 + 可追踪质量闭环”的工程路线。

核心判断：

- 不应该把 SEAR 当成要完整复刻的产品形态。
- 应该吸收它的 schema-first 数据哲学：评测结果不是一个总分，而是一组可以 join、追踪、解释、回放和审计的结构化信号。
- Zeval 下一阶段的数据库设计，应围绕“质量信号仓库”而不是“报告快照仓库”展开。

---

## 1. 从 SEAR 学什么

SEAR 的关键启发不在于某一个模型、某一个网关或某套打分公式，而在于它把 AI 系统运行过程拆成了可以持久化、关联和解释的结构化对象。

对 Zeval 最有价值的是三点：

1. **Schema-first**
   - 先定义数据结构，再定义 dashboard。
   - 评测、证据、bad case、gold label、judge prediction、修复包和验证结果都应该有稳定 schema。

2. **Signal-first**
   - 一个 eval run 不只是 `score=82`。
   - 它应该产出 objective signals、subjective signals、business KPI signals、evidence spans、topic segments、risk tags、judge traces 等多张可 join 的表。

3. **Traceable-first**
   - 任意一个结论都应该能追溯到：
     - 哪个 workspace
     - 哪个 dataset / session / turn
     - 哪次 evaluate run
     - 哪个 judge / rule / prompt version
     - 哪段原始对话证据
     - 哪个 baseline 或 remediation package

这意味着 Zeval 不能长期停留在“生成一个 JSON 报告，然后展示图表”的形态。JSON artifact 可以继续保留，但它应该是审计快照，不应该是系统主存储模型。

---

## 2. 对当前项目的架构结论

### 2.1 不建议完整照搬 SEAR

Zeval 当前产品目标是 AI 客服 / AI agent 质量操作系统，核心闭环是：

```txt
真实对话 -> 结构化评测 -> bad case/gold set -> remediation package -> agent 执行 -> replay/sandbox 验证
```

SEAR 的技术哲学适合指导数据层，但不应该把项目重构成一个论文式系统。原因：

- 当前商业化优先级是让客户团队能导入真实 chatlog、发现问题、协作标注、生成修复包并验证效果。
- 完整照搬会过早引入复杂度，拖慢 P1/P2 的产品验证。
- Zeval 需要保留工作台、gold set、agent package、workspace 权限等产品层，而不只是一个 eval backend。

### 2.2 应该采用 SEAR 式关系型信号模型

下一阶段数据库应该采用 PostgreSQL/Supabase 优先，而不是继续扩展本地 JSON 文件。

本地文件仍然保留三个用途：

- 开发环境 fallback
- smoke / fixture artifact
- 可导出的审计快照

但生产主路径应该是关系型数据库，因为项目未来一定需要：

- workspace / tenant 级隔离
- 多人标注和审核
- gold set 版本管理
- baseline 对比
- run 历史查询
- evidence 溯源
- bad case 聚类和复用
- agent run 与 validation run 关联
- 权限、审计和客户级数据删除

这些需求用纯文件系统会越来越脆弱。

---

## 3. 目标数据模型：质量信号仓库

下一阶段建议把数据库建成以下几组表。

### 3.1 租户与权限

- `workspaces`
- `users`
- `workspace_members`
- `api_keys`
- `audit_logs`

用途：

- 支持 SaaS 多租户。
- 支持 owner/admin/member/viewer 权限。
- 支持客户级数据隔离和审计。

### 3.2 原始对话与数据集

- `datasets`
- `dataset_imports`
- `sessions`
- `message_turns`
- `scenario_contexts`

用途：

- 保存原始 chatlog 的结构化形态。
- 将 scenario onboarding answers 从 `meta.scenarioContext` 升级为可查询上下文。
- 支持同一 session 被多个 evaluate run、gold set、baseline 复用。

### 3.3 评测运行与信号

- `evaluation_runs`
- `topic_segments`
- `objective_signals`
- `subjective_signals`
- `business_kpi_signals`
- `evidence_spans`
- `risk_tags`

用途：

- 把一次评测拆成多类结构化信号。
- 所有信号都应包含 `workspace_id`、`run_id`、`session_id`、可选 `turn_id`、`segment_id`、`metric_key`、`score/value`、`reason`、`confidence`、`source`。
- `evidence_spans` 用来连接结论和原始文本，不让评测变成黑盒分数。

### 3.4 Gold Set 与 Judge 校准

- `gold_sets`
- `gold_cases`
- `gold_annotation_tasks`
- `gold_label_drafts`
- `gold_labels`
- `judge_runs`
- `judge_predictions`
- `judge_agreement_reports`
- `judge_drift_reports`

用途：

- 支持人工标注、审核、导入、版本化。
- 支持 rule judge / LLM judge / candidate judge 的横向对比。
- 支持 agreement 和 drift 报告长期积累，而不是只保存在 markdown 文件里。

### 3.5 Bad Case 与调优闭环

- `bad_cases`
- `bad_case_tags`
- `bad_case_clusters`
- `remediation_packages`
- `remediation_artifacts`
- `agent_runs`
- `validation_runs`
- `validation_results`
- `jobs`

用途：

- 将 bad case 变成长期资产。
- 将 remediation package、agent run、validation run 串起来。
- 支持客户查看“这个问题从发现到修复到验证”的完整链路。

---

## 4. 数据原则

### 4.1 Artifact 不是主数据

现有 evaluate JSON、baseline JSON、smoke artifact 继续保留，但定位调整为：

- 调试快照
- 导出交付物
- 审计归档
- 回放输入

生产查询、权限隔离、统计聚合、gold set 协作不应该依赖直接读 JSON 文件。

### 4.2 每条信号必须可追溯

所有核心信号至少包含：

- `workspace_id`
- `run_id`
- `session_id`
- `metric_key`
- `source`
- `created_at`

按需增加：

- `dataset_id`
- `turn_id`
- `segment_id`
- `judge_id`
- `prompt_version`
- `rule_version`
- `baseline_run_id`
- `evidence_span_id`

### 4.3 分数和证据分离

分数适合聚合，证据适合解释。二者不应该混在一个大字段里。

建议：

- `objective_signals` / `subjective_signals` 存结构化 score/value/reason/confidence。
- `evidence_spans` 存证据文本位置、原始片段、证据类型和关联 signal。

### 4.4 Gold label 是产品资产，不是测试夹具

Gold set v2 已经从手写伪标签升级到可审核标注流程。下一阶段应该继续把它产品化：

- 标注任务分配
- label draft 保存
- reviewer 审核
- approved label 导入
- judge agreement / drift 自动挂到版本

这部分应进入数据库主路径。

### 4.5 PII 脱敏要在入库前完成

现有 PII redaction 已接入 ingest/evaluate。数据库阶段要保持原则：

- 默认入库的是脱敏文本。
- 必须保留 redaction metadata，便于解释字段被处理过。
- 除非客户私有化部署且显式开启，否则不保存明文 PII。

---

## 5. 下一阶段开发策略

建议下一阶段从“先定义 schema，再渐进替换存储”开始，避免一次性重构全系统。

### P1-A：关系型 schema 定稿

交付物：

- `database/schema.sql`
- `database/README.md`
- `src/db/schema.ts` 或等价类型定义

范围：

- workspace/users/members
- datasets/sessions/message_turns
- evaluation_runs
- topic_segments
- objective_signals
- subjective_signals
- business_kpi_signals
- evidence_spans
- gold set / annotation / judge 校准核心表
- bad case / remediation / validation / jobs 核心表

验收：

- schema 能表达当前所有 evaluate response、baseline、gold set、bad case、agent run、validation run。
- 每个核心实体有 workspace_id。
- 每个评测结论可以追溯到 evidence 或 source。

### P1-B：Evaluate projection layer

交付物：

- `src/db/evaluation-projection.ts`
- 单元测试或 smoke 验证脚本

目标：

- 不立刻重写 `evaluateRun`。
- 先把现有 `EvaluateResponse` 投影成 normalized records。
- 支持写入 local JSON database adapter，后续替换 Postgres adapter。

验收：

- 一次 `/api/evaluate` 可以生成：
  - `evaluation_runs`
  - `topic_segments`
  - `objective_signals`
  - `subjective_signals`
  - `business_kpi_signals`
  - `evidence_spans`
- 原有 JSON artifact 不破坏。

### P1-C：Postgres/Supabase adapter

交付物：

- `src/db/postgres-database.ts`
- `DATABASE_URL` 切换
- migration 文档

目标：

- 保持 `ZevalDatabase` 接口。
- 本地文件 adapter 继续可用。
- 生产可切 Postgres/Supabase。

验收：

- 同一 evaluate projection 可写入本地 JSON 或 Postgres。
- smoke 覆盖两种模式中的至少本地模式，Postgres 模式有手动验证路径。

### P1-D：Gold set 数据库化

交付物：

- annotation task / draft / label 的数据库 store
- `/datasets` 页面继续使用同一 API

目标：

- 当前 gold set v2 文件流程保留为导入导出工具。
- 协作、审核、导入主路径迁移到数据库。

验收：

- 多 workspace 下 gold set 互不污染。
- approved label 能被 judge calibration 读取。
- 仍可导出为 `cases.jsonl` / `labels.jsonl`。

### P1-E：异步任务队列替换

交付物：

- `QueueAdapter` 接口定稿
- local queue adapter
- Redis/BullMQ 或云队列 adapter 设计

目标：

- `/api/evaluate asyncMode` 不只是落文件，而是可被 worker 消费。
- 大文件评测、gold expansion、judge calibration、validation run 都走 job。

验收：

- job 有状态机：`queued -> running -> succeeded/failed/canceled`。
- job 关联 workspace、createdBy、artifact、error。

---

## 6. 商业化产品形态建议

### 6.1 主产品：Web 工作台

面向客户团队时，主产品应该是 Web 工作台，而不是 CLI。

原因：

- PM、运营、客服主管、算法工程师都需要看同一套证据和结论。
- gold set 标注、review、bad case 复盘天然需要多人协作。
- 客户采购时更容易理解“质量工作台 + 报告 + 闭环”。

### 6.2 CLI：集成与 CI 工具

CLI 仍然有价值，但定位应该是辅助能力：

- CI 中跑 regression eval。
- 批量导入 chatlog。
- 导出 gold set / baseline。
- 触发 validation run。

CLI 不应该成为商业化主入口。

### 6.3 API：企业集成层

API 是中后期商业化关键能力：

- 客户系统推送 conversation trace。
- 客户内部 BI 拉取 quality signals。
- GitHub/GitLab/agent workflow 接入 remediation package。
- 私有化部署时与客户 IAM / data lake 集成。

---

## 7. 当前状态与下一步

当前已完成：

- P0 Scenario Onboarding
- Gold Set v2 标注脚手架
- Dataset 页面 gold annotation UI
- bad case 转 gold candidate
- 自动预填 label draft
- gold set 扩展到 12 条 draft
- auth/workspace 基础层
- PII redaction
- local JSON database adapter
- local queue contract
- workspace-aware file store
- evaluate asyncMode job enqueue

下一步建议：

1. 新建 `database/schema.sql`，先把质量信号仓库 schema 定下来。
2. 实现 evaluate projection layer，把现有 evaluate response 映射为 normalized records。
3. 让 `/api/evaluate` 在保留 JSON artifact 的同时，额外写入结构化信号记录。
4. 再补 Postgres/Supabase adapter，不急着一刀切替换所有文件存储。
5. 最后把 gold set、agent runs、validation runs 逐步迁移到数据库主路径。

这条路线既吸收了 SEAR 的关系型 schema 思想，也保留了 Zeval 当前最重要的产品闭环：发现问题、提取证据、生成调优包、交给 agent 执行、验证效果。
