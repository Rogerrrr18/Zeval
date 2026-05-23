# Zeval 当前开发进展说明

更新日期：2026-05-04

本文档面向合作开发者，用于快速理解 Zeval 当前已经实现的能力、工程状态、如何本地运行验证，以及下一阶段优先事项。

## 1. 产品当前定位

Zeval 是一个面向 AI Agent / 客服 Agent / 对话系统的评测与调优工作台。当前 MVP 的核心目标是打通：

前端接收数据 -> 后端解析 -> 客观指标计算 -> LLM Judge 主观评估 -> 报告图表与优化建议 -> 调优包 / 基线趋势 / 集成能力。

现阶段优先级仍然是：

1. 端到端 pipeline 可跑通。
2. 指标结果可解释、可回归。
3. UI 可演示且信息结构清晰。
4. 为后续真实工程部署补齐队列、稳定性与 CI gate。

## 2. 当前已实现的主要功能

### 2.1 UI 与产品壳

- 产品名已统一为 `Zeval`。
- 顶部导航已重构为左侧固定侧边栏。
- 左侧栏固定不随右侧内容滚动。
- 原 `Copilot` 已改为 `Chat`。
- Chat 页面支持多 channel / 多对话。
- Chat history 通过 localStorage 自动保存，并保留旧 key 的兼容读取。
- 首页、侧边栏和主要 UI 已接入新的 Zeval logo 组件。

关键文件：

- `src/components/shell/AppShell.tsx`
- `src/components/brand/ZevalLogo.tsx`
- `src/components/copilot/CopilotConsole.tsx`
- `src/components/home/LandingPage.tsx`

### 2.2 评测 pipeline

当前 pipeline 已覆盖 MVP 所需的主链路：

- 输入解析：CSV / JSON / TXT / MD。
- 字段归一化：对话、session、topic、message 等结构统一。
- 客观指标：轮次、topic 切换、断点、响应间隔、活跃时段等。
- 主观指标：情绪、共情、追问、答非所问风险、说教风险、目标达成、恢复策略等。
- 报告生成：图表数据、建议、触发指标、结论摘要。

关键目录：

- `src/pipeline/`
- `src/parser/`
- `src/normalizer/`
- `src/report/`

### 2.3 LLM 接入与 Judge 工程化

LLM Judge 已从“能调用”升级为可审计、可回归的工程化模块：

- 固定 judge profile。
- 固定 prompt version。
- 固定 model / temperature / topP / maxTokens。
- Judge 调用日志中记录 `judgeProfile` 与 `promptVersion`。
- 支持 Zeval 命名的环境变量，同时兼容旧 SiliconFlow 变量。
- 新增 gold set 回归。
- 新增 judge agreement 检查。
- 新增 drift 检测。
- 新增 calibration CI gate。

推荐环境变量：

```bash
ZEVAL_JUDGE_API_KEY=...
ZEVAL_JUDGE_BASE_URL=...
ZEVAL_JUDGE_MODEL=...
ZEVAL_JUDGE_ENABLE_THINKING=false
```

兼容旧变量：

```bash
SILICONFLOW_API_KEY=...
SILICONFLOW_BASE_URL=...
SILICONFLOW_MODEL=...
SILICONFLOW_ENABLE_THINKING=false
```

关键文件：

- `src/llm/judgeProfile.ts`
- `src/lib/siliconflow.ts`
- `src/calibration/judgeGate.ts`
- `calibration/judge-profile.json`
- `calibration/scripts/run-judge-on-gold.mts`
- `calibration/scripts/ci-gate.mts`

### 2.4 任务队列与长任务执行

当前已补齐 MVP 级别的本地持久化 job queue，解决长任务、失败恢复、状态追踪的基础问题：

- job 状态：`queued` / `running` / `succeeded` / `failed` / `canceled`。
- 支持 attempts / maxAttempts。
- 支持失败重试。
- 支持 stale running job 恢复。
- 支持 heartbeat 时间记录。
- 支持 workspace 隔离。
- 支持 `evaluate` 与 `validation_run` 两类任务。
- 新增 worker CLI。

常用命令：

```bash
npm run jobs:work
npm run jobs:work:once
```

关键文件：

- `src/queue/index.ts`
- `src/jobs/handlers.ts`
- `scripts/run-job-worker.mts`
- `app/api/jobs/route.ts`
- `app/api/jobs/[jobId]/route.ts`
- `app/api/jobs/run/route.ts`
- `app/api/evaluate/route.ts`
- `app/api/validation-runs/route.ts`

### 2.5 指标 DAG 文档

根目录新增了指标 DAG HTML 文件，用于梳理主客观评测指标之间的依赖关系：

- `zeval-metrics-dag.html`

该文件可直接用浏览器打开，用于产品、算法和工程讨论。

### 2.6 文档与品牌统一

已将主要产品命名从 `ZERORE` 统一为 `Zeval`：

- README 标题与产品描述。
- PM 方案文档。
- 执行规划。
- eval-system 概述文档。
- SDK / integration 示例。
- 环境变量说明。

注意：部分 `ZERORE_*`、`x-zerore-*`、`zerore_records` 仍保留，是为了兼容旧配置、旧 header 或历史数据库表，不是新的产品命名。

## 3. 本地运行与验证方式

### 3.1 安装依赖

```bash
npm install
```

### 3.2 启动开发服务

```bash
npm run dev
```

默认访问：

```text
http://127.0.0.1:3000
```

### 3.3 类型检查

```bash
npx tsc --noEmit
```

### 3.4 Lint

```bash
npm run lint
```

### 3.5 构建

```bash
npm run build
```

当前 build 可通过。构建中仍可能出现一个 Turbopack NFT warning，来源于已有的 workbench baseline 文件追踪路径，不影响构建完成。

### 3.6 Judge CI gate

```bash
npm run calibration:ci
```

如需输出报告：

```bash
npm run calibration:ci -- --out ./calibration-ci-report.md
```

### 3.7 Worker smoke test

```bash
npm run jobs:work:once
```

如果没有排队任务，正常输出应类似：

```text
[jobs:worker] workspace=default handled=0
```

## 4. 当前真实工程化差距

### 4.1 Queue 仍是本地持久化，不是生产级分布式队列

当前 queue 已能支持 MVP 长任务和失败恢复，但还不是 Redis / Postgres / SQS 级别的生产队列。下一阶段建议：

- 接入 Postgres-backed job table 或 BullMQ。
- 增加 job lease / lock 的强一致保证。
- 增加 worker 横向扩展策略。
- 增加 job 指标监控面板。

### 4.2 Judge 工程化已有骨架，但 gold set 还需要继续扩充

当前 CI gate 已可跑，但 gold set 数量和覆盖面仍偏 MVP。下一阶段建议：

- 为客服、销售、教育、医疗咨询等场景分别补 gold set。
- 每个主观维度至少补 20-50 条人工标注样本。
- 引入双 judge / 多 judge agreement。
- 将 drift 报告接入 CI 或 release checklist。

### 4.3 产品链路还需要真实数据压测

目前 mock 与本地回归可以跑通，但真实工程使用前还需要：

- 长对话文件压测。
- 大 CSV / JSON 导入压测。
- 异常字段、脏数据、缺失字段测试。
- LLM 超时与降级测试。
- 多 workspace 数据隔离测试。

### 4.4 SDK 与集成仍是 demo 级

Integration 页面已有示例，但 SDK 分发、版本管理和真实客户接入流程还未完成。下一阶段建议：

- 定义 `@zeval/sdk` 的正式 API surface。
- 增加 npm package 发布流程。
- 增加 webhook / API key 管理。
- 增加最小真实接入 demo。

## 5. 建议下一步优先级

1. 扩充 calibration gold set，并让 `npm run calibration:ci` 成为默认 PR gate。
2. 将本地 queue 替换或适配到 Postgres / Redis 生产队列。
3. 为上传评测链路补端到端测试。
4. 做一次真实客服数据导入压测。
5. 整理 `.env.example`，明确 Zeval 新变量与 legacy fallback。
6. 将 SDK / integration 从展示代码推进到可安装、可运行、可验证。

## 6. 最近一次验证状态

已验证通过：

- `npm run lint`
- `npx tsc --noEmit`
- `npm run calibration:ci -- --out /private/tmp/zeval-ci-gate.md`
- `npm run jobs:work:once`
- `npm run build`

剩余已知提示：

- `npm run build` 中 Turbopack 可能提示 NFT warning，当前不阻塞构建。
