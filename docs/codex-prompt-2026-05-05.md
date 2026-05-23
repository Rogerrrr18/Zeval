# Codex 优化任务（基于 5.5 产品复盘会议纪要）

## 你是谁
你是 Zeval（zerore-eval-system）的 senior engineer，正在执行一轮基于产品复盘会议的优化任务。本仓库是一个 Next.js 16 + TypeScript + zod 4 的 AI 对话评测系统，已在 `Zeval` 分支上。

阅读本任务前，请先阅读：
- `AGENTS.md`（仓库工程约束）
- `src/pipeline/evaluateRun.ts`（核心评估管线）
- `src/components/home/EvalConsole.tsx`（工作台主控制台）
- `src/components/datasets/DatasetConsole.tsx`（案例池控制台）
- `src/remediation/builder.ts`（调优包生成器）
- `app/api/copilot/chat/route.ts` + `src/copilot/`（Chat agent 编排器）

## 总原则
1. **不要做架构级重写**，所有改动优先增量、可回滚
2. **不要破坏现有 smoke 测试**：`scripts/smoke-end-to-end.mjs` 与 `scripts/smoke-extended-metrics.mjs` 必须仍能 ✅ ALL PASS
3. **TypeScript 必须 0 错误**：`npx tsc --noEmit` 退出码 0
4. **每完成一个 P0/P1，跑一遍 typecheck + 相关 smoke**，再进入下一项
5. 所有新增 UI 文案使用中文，技术 ID 用英文 snake_case
6. 任何"删除功能"前先确认是否有外部依赖（API、smoke、SDK examples）

---

## P0 · 体验闭环（必做）

### P0-1 · 工作台首屏可视化执行进度
**背景**：用户跑评估时是黑盒，不知道执行到哪一步、报错原因不清楚。

**目标**：
- 在「开始评估」按钮点击后，主区域顶部显示一条 **横向阶段进度条**（不是顶部全局 stepper），至少包含：解析数据 → 客观指标 → 主观指标 → 扩展指标 → bad case 抽取 → 完成
- 每个阶段三态：pending / running（带 spinner）/ done（带 ✓）；失败显示 ✗ 和原因
- 对应后端 `runEvaluatePipeline` 已经分阶段，把每阶段开始/结束通过 SSE 流（仿 `app/api/copilot/chat/route.ts`）推到前端
- 完成后自动隐藏，结果区淡入

**关键文件**：
- 前端：`src/components/home/EvalConsole.tsx`、新增 `src/components/home/EvaluationProgress.tsx` + `.module.css`
- 后端：`app/api/evaluate/route.ts` 增加 SSE 模式（`?stream=1`），`src/pipeline/evaluateRun.ts` 暴露阶段事件回调

**验收**：上传内置示例数据，点开始评估，能看到 6 个阶段依次点亮，最终结果正常展示。失败场景（如 LLM API key 缺失）显示具体阶段失败而不是页面崩。

---

### P0-2 · 删除 trace 观测功能（已决策）
**背景**：会议结论 — trace 观测和我们的差异化（隐式信号推断层 + 自动分类主客观指标）冲突，且会暴露我们对 trace 链路的弱势。删除该模块。

**保留**：trace 上报 API 接口（`/api/traces/ingest`）保留为内部能力，不在 UI 暴露
**删除**：
- 路由：`app/observability/`
- 组件：`src/components/observability/`
- 顶部导航中的「观测」入口（`src/components/shell/AppShell.tsx`）
- 落地页 / 集成页里所有 "trace 观测" 相关文案 → 替换为 "历史 baseline 趋势叠加"
- `src/components/integrations/IntegrationsConsole.tsx` 中保留 trace 接入 snippet（作为内部 API 仍可用），但首页 features 卡片移除「OTel GenAI Trace」一项

**新增**：
- 在工作台顶部 KPI 区或单独 panel，加一个 **「基线趋势」简易图**：拉用户最近 N 次 evaluate run 的核心 4 个指标（情绪分、目标达成率、bad case 数、业务 KPI），用 sparkline 叠加显示
- 数据来源：`src/persistence/evaluateRunStore.ts`（如果不存在，从现有 baseline store / artifact 目录读取）

**验收**：导航无「观测」；落地页/集成页搜不到 "trace 观测" 字样；smoke 仍 PASS；工作台能看到至少 2 次以上历史 run 的趋势线。

---

### P0-3 · 调优包从 4 文件改为 Skill 文件夹形式
**背景**：会议结论 — 当前 4 个 markdown/yaml 文件交付形式很怪，用户不理解；改为 Claude Code Skill 标准形式，关注「人类可读性 + agent 可读性」两点。

**目标**：调优包输出结构调整为：
```
remediation-skill-<packageId>/
  SKILL.md                  # 给人类看的入口（≤ 200 行，问题摘要 + 修复策略 + 验收标准）
  reference/                # 给 agent 看的细节
    issue-brief.md
    badcases.jsonl
    remediation-spec.yaml
    acceptance-gate.yaml
  README.md                 # 给 Claude Code / Codex 的"如何使用此 skill"指引
```

**关键文件**：
- `src/remediation/builder.ts` 改输出结构（保留旧字段做兼容字段）
- `src/remediation/skill-template/`（新增模板目录，含 SKILL.md / README.md 模板）
- `src/components/remediation/RemediationConsole.tsx` 渲染调整：tab 改为「概览（SKILL.md）」+「Reference 文件」+「使用说明」
- `app/api/remediation-packages/route.ts` 返回结构里增加 `skillFolder` 字段

**约束**：
- 现有 `RemediationPackageBuildResult.package.files[]` 字段保留（兼容旧 smoke / SDK），但增加 `package.skillBundle` 新字段
- 模板里的字段全部从评估结果动态生成，**不要 hardcode 业务领域文案**

**验收**：跑一次评估生成调优包后，下载的产物是一个完整 skill 目录，cd 进 reference 能找到原 4 个文件；SKILL.md 用户能在 5 分钟读懂"哪儿出问题、怎么修、怎么验证"。

---

### P0-4 · 案例池修复 + 自动化标注
**背景**：
- bug：切换页面后示例数据丢失（无内存/localStorage 持久化）
- bug：人力标注界面问题
- 决策：**最小化甚至消除人工标注**，全用自动化覆盖

**子任务**：

**P0-4a · 持久化 fix**
- 工作台、案例池在切换路由时通过 localStorage 持久化当前 raw rows、ingestResult、evaluateResult
- 复用 `src/components/copilot/CopilotConsole.tsx` 里的 `zeval.chat.channels.v1` 模式
- key 规范：`zeval.workbench.snapshot.v1`、`zeval.datasets.snapshot.v1`

**P0-4b · 案例切分改为 topic 粒度**
- 当前：按 session 粒度判定 good/bad
- 改为：按 topic 粒度切分。规则（无 LLM）：
  - 检测用户消息中的「话题切换关键词」：`这个/上面/刚才/还有/另外/再问/换个/ok 那` 等
  - 或检测用户负面反馈关键词触发切点：`错了/不对/不是/不行/重来/换一个` 作为新 topic 起点
  - 同 session 内每个 topic 单独判定 good / bad
- 实现：`src/pipeline/segmenter.ts` 增加 `segmentByTopic()` 导出
- 输出 schema 调整：`evaluateResult.badCaseAssets[].sessionId` 配合新增 `topicIndex` / `topicRange`

**P0-4c · 混合自动标注策略**
- 在 `src/pipeline/badCaseHarvest.ts`（如不存在则新建）实现：
  ```ts
  type BadCaseSignal =
    | { kind: "negative_keyword"; keyword: string; turnIndex: number }
    | { kind: "metric"; metric: "responseGap" | "shortTurns" | "topicSwitch"; value: number }
    | { kind: "implicit_signal"; signalId: string };
  
  function harvestBadCases(rows, metrics, signals): { topicId, severity, signals: BadCaseSignal[] }[]
  ```
- 关键词词典：`src/pipeline/keywords/negative-zh.ts`，至少 30 词，分级（强/中/弱）
- 客观指标阈值：长回复间隔 ≥ 60s、轮次 ≤ 2 但有负面词 等
- **不调 LLM**，纯规则
- 现有 `subjectiveMetrics.ts` 的 LLM 路径保留，但 bad case 抽取层不依赖它

**P0-4d · 移除人力标注 UI**
- `src/components/datasets/DatasetConsole.tsx` 删除 / 隐藏标注按钮区
- 改为只读视图：每条 case 展示：自动判定的标签、命中信号、被分类原因、可手动覆盖（"标记错判"按钮，落到一个独立的 `manualOverrides` 字段，不是主标注流）

**验收**：上传一条长 session 数据，能切出多个 topic；案例池里看到 topic 粒度卡片，每张卡片能看到"为什么被判为 bad"的信号清单；切换页面回来数据还在；smoke PASS。

---

### P0-5 · 工作台指标聚类 + tooltip 解释
**背景**：会议结论 — 当前指标平铺一堆百分比，用户没有「整体感受」；需要分级聚类 + 每个指标可点击查看含义。

**目标**：
- 一级指标（顶层 4 张大卡）：**对话质量** / **任务完成度** / **工具调用可用性** / **风险信号**
- 每张大卡里展开二级指标（现在的明细），二级指标右侧有 ⓘ icon
- ⓘ 点击 / hover 弹出 tooltip：解释含义 + 计算口径 + 阈值建议（来源于 `src/pipeline/metricRegistry.ts`，如不存在新建）

**实现**：
- 新增 `src/components/home/MetricGroup.tsx`（接收 group 配置 + child cards）
- 新增 `src/components/home/MetricTooltip.tsx`（基于 `<details>` 或轻量 popover）
- `src/pipeline/metricRegistry.ts` 集中维护：每个指标的 displayName / oneLineExplain / formula / threshold / category
- `src/components/home/SummaryGrid.tsx` 改为读 metricRegistry 渲染

**指标分组建议**（具体内容根据实际现有字段微调）：
| 一级 | 二级 |
|---|---|
| 对话质量 | 平均情绪分、共情得分、平均响应间隔、话题切换率 |
| 任务完成度 | 目标达成率、Intent 覆盖率、Slot 覆盖率、调用参数追溯 |
| 工具调用可用性 | toolCorrectness、Slot 已确认率、结构化任务通过率 |
| 风险信号 | bad case 数、高风险信号、恢复轨迹、升级触发率 |

**验收**：工作台一打开能看到 4 张大卡（每张含数值 + 趋势 + 子项数量），点开任意一项能看到 tooltip 解释；信息密度比当前降低 ≥ 50%；UX 感受像 Stripe Dashboard 而不是 Excel。

---

## P1 · 数据与上报

### P1-1 · 自动化字段映射通用化
**背景**：当前字段映射对 SGD 开源数据集 hardcode，缺乏通用性。

**目标**：
- `src/pipeline/dataIngest`（或现有 `app/api/data-onboarding/`）增强字段推断：
  - 自动识别常见命名变体（user_id / userId / customer_id → sessionId；ts / time / created_at → timestamp 等）
  - 不识别的字段，调一次 LLM 让它猜映射，结果缓存到 `dataMappingPlan`
- 让用户在前端确认映射，可手动调整

### P1-2 · 大数据集重测
**背景**：会议结论 — 当前示例只有 24 条消息，不足以切出 topic 验证案例池。

**任务**：
- `mock-chatlog/raw-data/` 增加 1 个真实业务规模数据集（≥ 1000 sessions、≥ 20000 turns），可用 SGD multi-domain 拼接，或合成
- `scripts/smoke-end-to-end.mjs` 增加 `--scale large` 参数跑这份数据
- 在公开示例（`SGD_SAMPLE_DATASET`）旁增加「大数据集」备选项

### P1-3 · 集成页样本合成位置调整
**背景**：会议结论 — 样本合成不放进基础功能，改为项目制定制 + 官网留钩子。

**任务**：
- `app/synthesize/` 页面降级：保留路由但默认重定向 `/integrations#synthesize`
- `src/components/integrations/IntegrationsConsole.tsx` 增加一节 **「长尾数据合成（项目制合作）」**：放一段引导文案 + 「联系我们」按钮（暂占位）
- 落地页 Hero / Features 删除「样本合成」单独卖点，改为放在「企业版能力」区

---

## P2 · Chat / Copilot 增强

### P2-1 · Chat 已经是主入口，扩 skill 库
当前 `/chat` 只支持 3 个 skill。基于会议结论，把 skill 扩为：
- `run_evaluate`（已有）
- `summarize_findings`（已有）
- `build_remediation`（已有）— 适配新的 Skill 文件夹形式
- `save_baseline`（新增，调 `/api/workbench-baselines`）
- `run_validation`（新增，调 `/api/validation-runs`）
- `compare_baselines`（新增，调 `/api/online-eval`）

`src/copilot/skills.ts` 的 registry 加上述 3 个，每个 skill 把 `summary` 写得对 PM/CEO 友好（"这次比上次好了 X"，不是 "score 0.83"）。

### P2-2 · Chat 的"产品模式 vs 工程模式"
**背景**：用户提了双模式构想。先用最小代价：
- 在 `/chat` 顶部增加一个 toggle：**Producer / Engineer**
- Producer 模式：transcript 中隐藏 `tool_call` / `tool_result` 卡片，只显示 user + final（plan 折叠到一行 "正在分析…"）
- Engineer 模式：完整渲染所有事件
- 用 localStorage 持久化偏好

实现位置：`src/components/copilot/CopilotConsole.tsx`，加一个 `viewMode` state 控制渲染过滤。

---

## 不要做的事情（明确边界）
- ❌ 不要新建独立的 trace UI（已决策删除）
- ❌ 不要在主流程里做归因（toolcall 失败 vs 内容质量），统统进 bad case
- ❌ 不要训练 CNN / 任何模型（数据量不够，会议结论"先不投入精力"）
- ❌ 不要改 `@zerore/sdk` 包名为 `@zeval/sdk` 之外的别名（保持当前已生效的 zeval 命名）
- ❌ 不要新增任何外部依赖（推理、可视化都用现有库 / 简单 SVG）
- ❌ 不要清空 / 重写 `mock-chatlog/baselines/` 历史数据
- ❌ 不要改 `Zeval` 远程分支以外的分支

---

## 工作流程
1. 阅读 `AGENTS.md` 与本提示词
2. 把任务分到 todo list（用 TodoWrite），按 P0 → P1 → P2 顺序
3. 每完成一个子任务：
   - `npx tsc --noEmit`
   - 视情况跑相关 smoke
   - 简明 commit message（参考已有：`Align with DeepEval: 10 extended metrics, ...`）
4. 全部完成后输出一份「改动总结 + 截图建议」给我

## 交付时回答这 5 个问题
1. P0 全部完成了吗？哪些 partial？为什么？
2. tsc 是否 0 错误？
3. smoke 是否 PASS？
4. 案例池里能看到 topic 粒度切分了吗？
5. 调优包下载下来，是不是一个看起来像 Claude Code skill 的文件夹？

---

> 提示词版本：v1（基于 2026-05-05 产品优化会议）
> 维护者：roger
