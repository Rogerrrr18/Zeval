# 执行规划（五步质量闭环版）

本文用于指导 Zeval 从“可运行评估 MVP”升级为“可持续调优的质量闭环系统”。

当前阶段不再追求大而全的平台化，而是优先把以下 5 步闭环做扎实：

1. 发现问题
2. 提取证据
3. 生成调优包
4. 交给 agent 执行
5. 回放 / 沙箱验证

---

## 0. 当前阶段判断

截至当前代码状态：

- 已完成：
  - `CSV / JSON / TXT / MD` 四种格式 ingest
  - `Raw -> Enriched -> ChartPayload` 三层数据链路
  - `POST /api/ingest`、`POST /api/evaluate`
  - 基线保存与在线回放对比
  - 一版客观指标、主观指标、隐式信号和建议输出
- 当前缺口：
  - 结果更像“分析报告”，还不是“修复工作流”
  - bad case 尚未稳定沉淀为长期资产
  - 调优建议还不能直接驱动 coding agent 工作
  - replay 能力已具雏形，但 sandbox / 仿真尚未成型

结论：

- 当前项目已经完成 `P0 可运行评估工作台`
- 下一阶段目标是 `P1 质量闭环系统`

---

## 1. 北极星目标

### 1.1 产品目标

把真实生产中的坏体验，自动转成：

- 可以复盘的问题诊断
- 可以复用的 bad case 资产
- 可以执行的调优任务
- 可以验证的回归结论

### 1.2 一句话定义

Zeval 不是一个只看图表的 eval dashboard，而是一套把失败案例自动编译成修复任务和验证结果的质量操作系统。

### 1.2.1 SEAR 数据哲学补充

下一阶段的数据层采用 SEAR 启发的 schema-first 思路：评测不再被视为一个总分或一份 JSON 报告，而是一组可以 join、可追踪、可解释、可回放的结构化质量信号。

具体策略已沉淀到 `eval-system-概述/5-SEAR数据哲学与下一阶段架构.md`：

- JSON artifact 继续保留为导出、调试和审计快照。
- 生产主路径逐步迁移到 PostgreSQL/Supabase 风格的关系型数据模型。
- `evaluation_runs`、`topic_segments`、`objective_signals`、`subjective_signals`、`business_kpi_signals`、`evidence_spans`、`gold_labels`、`judge_predictions`、`bad_cases`、`remediation_packages`、`validation_runs` 等对象应成为可查询表。
- 每条核心信号必须能追溯到 workspace、run、session、turn/segment、source 和 evidence。
- 下一步优先做 `database/schema.sql` 与 evaluate projection layer，而不是直接大规模重写现有评测 pipeline。

### 1.3 阶段优先级

- `P0` 可跑通
- `P1` 可解释
- `P2` 可执行
- `P3` 可验证
- `P4` 可规模化

---

## 2. 五步闭环的产品拆解

### Step 1 · 发现问题

目标：

- 在线上评测 / 离线评测后找到最该修的问题。

本阶段必须产出：

- 风险会话列表
- 关键失败轮次
- topic / emotion / signal 层面的异常定位
- 典型 bad case 聚类

对应模块：

- `parser`
- `normalizer`
- `segmenter`
- `objectiveMetrics`
- `subjectiveMetrics`
- `signals`

### Step 2 · 提取证据

目标：

- 不是只给分数，而是给“这句话为什么有问题”的证据链。

本阶段必须产出：

- `score / reason / evidence / confidence`
- turning point 片段
- 触发指标与风险原因
- baseline vs current 的差异点

### Step 3 · 生成调优包

目标：

- 把 bad case 编译成人和 agent 都能直接执行的任务包。

建议固定交付物：

- `issue-brief.md`
- `remediation-spec.yaml`
- `badcases.jsonl`
- `acceptance-gate.yaml`

调优包必须写清：

- 改什么
- 为什么改
- 优先改哪一层
- 哪些地方不能动
- 怎样算改好了
- 怎样判断改坏了

### Step 4 · 交给 agent 执行

目标：

- 让 `Claude Code / Codex` 等 coding agent 能根据调优包持续工作。

第一阶段先做到：

- 生成可直接喂给 agent 的修复说明文件
- 支持将调优包挂到 issue / PR / 任务流

第二阶段再做：

- 自动触发 coding agent
- 自动拉取变更结果
- 自动回写执行状态

### Step 5 · 回放 / 沙箱验证

目标：

- 证明“修复后真的变好”，而不是只产出新版本。

验证顺序：

1. baseline replay
2. 固定 sample batch 离线回归
3. sandbox / synthetic / perturbation 验证

验收标准：

- 至少一个对比维度显著改善
- 关键风险维度不得退化
- 高优先级 bad case 通过率提升

---

## 3. PRD 到开发的标准工作流

### 3.1 先把 PRD 压成 6 个工程问题

每次接到 PRD，不要直接开写代码，先强制拆成：

1. 目标用户是谁
2. 本次要解决的核心动作是什么
3. 成功指标是什么
4. 输入输出契约是什么
5. 新能力插在哪条链路里
6. 验收和回归怎么做

### 3.2 推荐的工程拆解顺序

1. **写契约**
   - schema
   - API request / response
   - 中间产物类型
2. **定状态机**
   - 上传
   - 评估
   - 保存基线
   - 生成调优包
   - 执行回放
   - 跑沙箱
3. **定存储模型**
   - 哪些是元数据
   - 哪些是大对象 / artifact
   - 哪些需要版本化
4. **定最小 UI**
   - 不先做大工作台
   - 先做单链路能演示的入口
5. **最后补异步与自动化**
   - 任务队列
   - agent orchestration
   - 通知与门禁

### 3.3 推荐的开发节奏

- 第一步：先让 API 可用
- 第二步：再让指标和证据可用
- 第三步：再让调优包可用
- 第四步：再接 agent 执行
- 第五步：最后补验证门禁

---

## 4. 系统模块规划

### 4.1 评估与证据层

- `parser`
- `normalize`
- `segmenter`
- `objectiveEvaluator`
- `subjectiveEvaluator`
- `signalExtractor`
- `evidenceBuilder`

说明：

- 这是现有代码最成熟的部分，优先继续增强而不是重写。

### 4.2 资产与调优层

新增建议模块：

- `badcaseExtractor`
- `caseClusterer`
- `remediationPackageBuilder`
- `acceptanceGateBuilder`

说明：

- bad case 不是一条建议，而是一条长期资产。
- 资产层必须有版本号、标签、来源 runId 和证据引用。

### 4.3 agent 执行层

新增建议模块：

- `agentTaskEmitter`
- `agentRunTracker`
- `agentPatchReviewer`

说明：

- 第一阶段先输出文件，不直接控制 agent。
- 第二阶段再接 GitHub / issue / workflow。

### 4.4 验证层

新增建议模块：

- `replayRunner`
- `offlineBatchRunner`
- `sandboxScenarioRunner`
- `validationReporter`

说明：

- replay 是最近的验证层，优先级最高。
- sandbox 必须基于真实失败模式扩展，不要做脱离真实数据的纯 demo。

---

## 5. 分阶段交付建议

### Phase 1：把“诊断 + 证据 + replay”做到极强

目标：

- 首页工作台能明确告诉用户问题在哪
- 在线回放能明确告诉用户改完有没有变好

交付：

- 问题卡片
- 证据片段
- baseline vs current 对比
- 高优先级风险排序

### Phase 2：把 bad case 变成长期资产

目标：

- 每次失败都能沉淀进案例池

交付：

- bad case 标签体系
- 去重规则
- 聚类视图
- sample batch 稳定抽样

### Phase 3：生成 agent-readable 调优包

目标：

- 调优结果可以直接交给 coding agent 执行

交付：

- `issue-brief.md`
- `remediation-spec.yaml`
- `badcases.jsonl`
- `acceptance-gate.yaml`

### Phase 4：接入 agent 执行与自动回归

目标：

- 形成 24x7 的质量修复 loop

交付：

- 调优包 -> issue / PR
- replay gate
- offline regression gate

### Phase 5：补齐 sandbox / 仿真

目标：

- 发版前能在仿真环境里验证安全性和鲁棒性

交付：

- synthetic seed
- scenario suite
- perturbation suite
- sandbox verdict

---

## 6. 数据库与存储策略

### 6.1 设计原则

- 业务代码依赖接口，不直接依赖文件路径或 SQL 细节
- 元数据放数据库，重文件 / 大 JSON artifact 放对象存储或文件系统
- 先保证可迁移性，再考虑查询性能优化

### 6.2 当前代码里的正确切口

当前已经存在：

- `DatasetStore`：适合作为数据库迁移入口

当前还缺少：

- `WorkbenchBaselineStore`
- `RemediationPackageStore`
- `ValidationRunStore`

说明：

- `src/eval-datasets/storage/dataset-store.ts` 已经是对的抽象层
- `src/workbench/baseline-file-store.ts` 还在直接写文件，下一步应先抽象

### 6.3 推荐技术选型

建议优先采用：

- `PostgreSQL`
- `Drizzle ORM`
- `drizzle-kit` 做 migration

原因：

- 当前项目是 `Next.js + TypeScript`
- Drizzle 更轻，和现有 route handlers 结合简单
- 类型契约更贴近现在的 TS 工程风格

### 6.4 推荐的表结构边界

第一阶段最少需要这些表：

- `customers`
  - `id`
  - `customer_key`
  - `display_name`
  - `created_at`

- `evaluation_runs`
  - `id`
  - `run_id`
  - `customer_id`
  - `source_file_name`
  - `messages_count`
  - `sessions_count`
  - `status`
  - `meta_json`
  - `created_at`

- `baseline_snapshots`
  - `id`
  - `customer_id`
  - `run_id`
  - `label`
  - `evaluate_json`
  - `raw_rows_json`
  - `created_at`

- `dataset_cases`
  - `id`
  - `case_id`
  - `case_set_type`
  - `session_id`
  - `topic_segment_id`
  - `topic_label`
  - `normalized_transcript_hash`
  - `baseline_case_score`
  - `tags_json`
  - `created_at`
  - `updated_at`

- `dataset_case_baselines`
  - `id`
  - `case_id`
  - `baseline_product_version`
  - `baseline_case_score`
  - `baseline_objective_score`
  - `baseline_subjective_score`
  - `baseline_signals_json`
  - `created_at`

- `sample_batches`
  - `id`
  - `sample_batch_id`
  - `strategy`
  - `target_version`
  - `case_ids_json`
  - `warnings_json`
  - `created_at`

- `run_case_results`
  - `id`
  - `run_id`
  - `sample_batch_id`
  - `case_id`
  - `baseline_case_score`
  - `current_case_score`
  - `score_delta`
  - `judge_reason`
  - `created_at`

- `remediation_packages`
  - `id`
  - `package_id`
  - `source_run_id`
  - `customer_id`
  - `status`
  - `issue_brief_path`
  - `remediation_spec_path`
  - `badcases_path`
  - `acceptance_gate_path`
  - `created_at`

- `validation_runs`
  - `id`
  - `validation_run_id`
  - `package_id`
  - `mode`
  - `status`
  - `summary_json`
  - `created_at`

### 6.5 数据库连接方式

建议约定环境变量：

```bash
DATABASE_PROVIDER=filesystem
DATABASE_URL=
ARTIFACT_STORAGE_PROVIDER=filesystem
ARTIFACT_ROOT=./artifacts
```

切到数据库时：

```bash
DATABASE_PROVIDER=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/zeval?sslmode=require
ARTIFACT_STORAGE_PROVIDER=filesystem
ARTIFACT_ROOT=./artifacts
```

连接原则：

- route handlers 不直接 new 数据库客户端
- 统一从 `src/server/db` 或 `src/lib/db` 暴露连接
- store factory 根据 `DATABASE_PROVIDER` 选择实现

### 6.6 推荐迁移顺序

1. 先抽象 `WorkbenchBaselineStore`
2. 再上 `PostgresDatasetStore`
3. 保留文件系统双写
4. 做读路径灰度切换
5. 最后把 replay / remediation / validation 也纳入数据库

---

## 7. 团队协作建议

### 7.1 PM / 研发对齐方式

每个 PRD 进入开发前，必须补齐这 4 个东西：

- 成功指标
- 输入输出契约
- 非目标范围
- 验收脚本

### 7.2 研发分工建议

- 工程负责人
  - 拆 PRD
  - 定接口
  - 定存储与状态机
- 后端 / 全栈
  - pipeline
  - stores
  - replay / validation API
- 前端
  - workbench
  - evidence panel
  - remediation package viewer
- 算法 / prompt
  - judge prompt
  - evidence quality
  - remediation heuristics

---

## 8. 近期必须完成的事

### P0

- 把问题输出从“图表 + 建议”升级成“问题卡 + 证据卡”
- 把 baseline replay 变成首页主链路的一部分

### P1

- 抽象 `WorkbenchBaselineStore`
- 设计 `remediation package` 文件契约
- 把 bad case 正式写入案例池

### P2

- 接入 Postgres 元数据层
- 建立 replay / batch validation 结果表

### P3

- 让调优包可以直接喂给 `Claude Code / Codex`
- 建立 agent 执行后的自动回归门禁

---

## 9. 最后判断

当前最重要的不是做更多指标，而是把已有评测能力编译成：

- 真实问题
- 真实证据
- 真实修复任务
- 真实验证结论

只要这条链打通，Zeval 才会从一个“会分析”的工具，变成一个“能驱动产品持续变好”的系统。
