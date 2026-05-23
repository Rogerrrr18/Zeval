# Zeval Data Architecture

更新日期：2026-05-05

本文档说明 Zeval 当前和下一阶段的数据架构方向。目标是尽量贴近 Confident AI 的成熟产品形态：数据层以 `Organization -> Project` 为隔离边界，项目之间数据不可互相访问。

## 1. 核心原则

Zeval 的数据不是一份大报告 JSON，而是一组可追踪、可 join、可回归的质量信号。

核心隔离模型：

```text
Organization
  -> Project
    -> Dataset / Golden
    -> Evaluation Run
    -> Metric Result
    -> Trace / Span
    -> Human Annotation
    -> Job
```

当前代码里仍有 `workspaceId`，它是历史兼容字段。新的语义是：

```text
workspaceId = projectId 的兼容别名
```

所有新 API 和配置应优先使用：

```text
x-zeval-organization-id
x-zeval-project-id
x-zeval-user-id
x-zeval-role
```

旧 header 仍兼容：

```text
x-zeval-workspace-id
x-zerore-workspace-id
x-zerore-user-id
x-zerore-role
```

## 2. 用户数据在哪里

数据流向由部署环境变量决定。

### 2.1 本地开发模式

```bash
ZEVAL_DATABASE_ADAPTER=local-json
```

数据流向：

```text
用户上传数据 -> 本地 Zeval 服务 -> 本地 workspaces/<projectId>/...
```

适合：

- 本地开发
- 产品 demo
- 不连接云数据库的快速试验

### 2.2 Zeval SaaS 模式

```bash
ZEVAL_DATABASE_ADAPTER=postgres
DATABASE_URL=postgresql://...
```

如果 `DATABASE_URL` 指向我们的 Supabase：

```text
用户上传数据 -> Zeval 云服务 -> 我们的 Supabase Postgres / Storage
```

适合：

- 我们自己运营的 SaaS
- 多客户共用一套云服务
- 由 Zeval 负责数据隔离、权限和审计

### 2.3 客户私有化模式

如果客户自己部署 Zeval，并配置自己的数据库：

```text
用户上传数据 -> 客户自己的 Zeval 服务 -> 客户自己的 Postgres / Supabase
```

适合：

- 企业私有化部署
- 数据不能进入 Zeval 云的客户
- 需要客户自管数据库和网络边界的场景

## 3. 当前代码状态

当前已经实现：

- `src/auth/context.ts` 解析 Organization / Project / User / Role。
- `workspaceId` 继续作为 project 兼容别名，避免大范围破坏旧 store。
- `src/db/postgres-database.ts` 的 bridge writes 会写入：
  - `organization_id`
  - `project_id`
  - `workspace_id`
- `database/schema.sql` 已加入：
  - `organizations`
  - `projects`
  - `project_members`
  - compatibility `workspaces`
- `.env.example` 已改为 Zeval-first 配置。

当前仍保留：

- `zerore_records` JSONB bridge table
- `ZERORE_*` legacy env fallback
- `x-zerore-*` legacy header fallback

这些是兼容层，不是未来产品命名。

## 4. 推荐生产表结构

下一阶段应从 bridge 表迁到 typed Zeval tables：

```text
organizations
projects
project_members
api_keys
audit_logs

datasets
dataset_versions
goldens
golden_versions

evaluation_runs
evaluation_cases
objective_signals
subjective_signals
business_kpi_signals
evidence_spans
risk_tags

threads
traces
spans
llm_calls
tool_calls

annotations
annotation_queues
annotation_queue_items
review_decisions

judge_profiles
judge_runs
judge_predictions
judge_agreement_reports
judge_drift_reports

jobs
job_attempts
uploads
artifacts
```

## 5. 接下来最应该做的数据库工作

1. 把本地 queue 迁到 Postgres `jobs` / `job_attempts`。
2. 将 evaluate projection 从 `zerore_records` 双写到 typed tables。
3. 为所有 typed tables 加 `organization_id` / `project_id` 或强 FK 到 `projects`。
4. 在 Supabase 上启用 Row Level Security，并按 project membership 加 policy。
5. 原始上传文件放 Supabase Storage，数据库只存 metadata、hash、artifact uri 和结构化评测结果。
6. 增加数据保留策略：原始对话、脱敏后对话、LLM Judge payload 分开保留。

## 6. 隐私与 LLM Judge 注意事项

数据库位置不等于所有数据都不出域。

如果开启 LLM Judge：

```text
对话片段 -> Zeval 后端 -> LLM 厂商 API
```

因此企业场景必须明确：

- 是否默认脱敏
- 是否允许发送给第三方模型厂商
- 是否支持客户自己的模型网关
- Judge payload 保留多久
- 是否支持完全离线 / 私有模型部署

当前 Zeval 已有默认 PII redaction，但正式 SaaS 还需要把这些策略产品化。

