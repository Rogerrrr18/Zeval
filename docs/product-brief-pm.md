# Zeval 项目方案说明（PM版）

## 1. 文档目的

本文用于完整说明当前 `Zeval MVP` 的项目方案，面向产品经理、项目负责人和业务协同方。

目标是回答 4 个核心问题：

- 这个项目要解决什么问题
- 当前 MVP 方案是怎么设计的
- 第一阶段到底落哪些核心指标
- 这些指标的计算口径和公式是什么

## 2. 项目一句话定义

`Zeval` 是一个面向长对话数据的评估系统 MVP，用于把原始 chatlog 自动转换为可解释的中间数据，再输出结构化指标、情绪趋势、风险信号、图表和优化建议，帮助团队快速判断 AI 对话质量与可优化方向。

## 3. 为什么要做这个 MVP

在业务场景尚未完全收敛前，团队需要的不是一个“最终版评估平台”，而是一套能快速验证方向的通用评估框架。

当前 MVP 的核心价值有 3 个：

- 用统一方式接入多种原始对话数据，降低试错成本
- 在“客观指标 + 主观判断 + 隐式推断”三个层面形成最小闭环
- 输出可展示、可解释、可复核的结果，而不是只给一个黑盒总分

## 4. MVP 目标与边界

### 4.1 当前目标

第一阶段目标不是做大而全平台，而是先打通一条完整链路：

1. 接收原始 chatlog
2. 统一解析为标准结构
3. 补全中间层字段
4. 计算客观指标与主观指标
5. 输出图表、摘要与优化建议

### 4.2 当前不做的内容

以下内容不在本阶段范围内：

- 登录权限系统
- 多租户隔离
- 复杂任务队列
- 长周期留存分析
- 高度业务定制化指标模板

## 5. 总体方案概览

### 5.1 总体思路

当前系统采用“三层数据 + 两类评估 + 一层信号”的结构设计：

- `Raw Layer`（原始日志层）：原始日志层
- `Enriched Layer`（补全中间层）：补全后的标准中间层
- `Presentation Layer`（展示结果层）：面向前端和报告展示的结果层

同时，评估逻辑分为：

- 客观指标：基于规则和算法确定性计算
- 主观指标：由 LLM 负责主观判断，规则做兜底或修正
- 隐式推断信号：从行为模式中提取潜在风险

### 5.2 三层数据结构

#### `Raw Layer`（原始日志层）

原始输入只要求尽量包含以下字段：

- `sessionId`（会话编号）
- `timestamp`（消息时间）
- `role`（消息角色）
- `content`（消息内容）

这一层不要求自带：

- `topic`（主题标签）
- `turnIndex`（轮次编号）
- 情绪分
- 风险标签

#### `Enriched Layer`（补全中间层）

这是整个评估系统的核心中间层，所有评估计算都默认以这一层作为输入。

典型字段包括：

- `turnIndex`（轮次编号）
- `topicSegmentId`（主题分段编号）
- `topicSummary`（主题摘要）
- `emotionPolarity`（情绪倾向）
- `emotionBaseScore`（情绪基准分）
- `emotionScore`（情绪最终分）
- `responseGapSec`（响应间隔秒数）
- `isQuestion`（是否提问）
- `isTopicSwitch`（是否主题切换）
- `tokenCountEstimate`（估算 token 数）

#### `Presentation Layer`（展示结果层）

这是最终交付层，主要服务于前端页面和业务复盘，内容包括：

- 摘要卡片
- 图表数据
- 风险信号
- 优化建议
- JSON / CSV 导出结果

## 6. 系统架构设计

### 6.1 前端架构

前端当前是一个评估控制台，承担 4 类职责：

- 上传原始日志
- 预览标准化结果
- 展示执行状态
- 展示摘要、图表、建议和导出结果

### 6.2 后端架构

后端按管线方式组织，当前核心模块如下：

- `parser`：识别并解析 `CSV / JSON / TXT / MD`
- `normalize`：标准化字段、排序、补齐基础信息
- `segmenter`：按 `session` 内部做 topic segment 切分
- `emotion`：做 segment 级结构化情绪评分
- `objectiveMetrics`：计算客观指标
- `signals`：抽取隐式推断信号
- `subjectiveMetrics`：做主观维度判断
- `summary / chartBuilder / suggest`：组装业务交付结果

### 6.3 API 设计

当前 MVP 保留两个核心接口：

- `POST /api/ingest`
  - 输入：原始文本 + 格式类型
  - 输出：标准化后的 `rawRows` 与预览数据
- `POST /api/evaluate`
  - 输入：`rawRows` + 是否启用 LLM
  - 输出：完整评估结果

## 7. LLM 在方案中的角色

当前方案不是“全靠 LLM 打分”，而是采用“规则优先 + LLM 辅助”的混合模式。

LLM 目前只介入 3 个阶段：

1. `topic_continuity_review`（主题连续性复核）
   - 用途：长间隔后判断当前消息是否还延续前一个 topic
2. `segment_emotion_baseline`（分段情绪基准判断）
   - 用途：为每个 topic segment 给出情绪倾向、强度和基准分
3. `subjective_dimension_judge`（主观维度评审）
   - 用途：给每个 session 输出主观维度评分

当前接入方案：

- Provider：`SiliconFlow`
- 默认模型：`Qwen/Qwen3.5-27B`

设计原则：

- 让 LLM 负责“主观判断”
- 让规则和公式负责“确定性聚合”
- 让最终结果更稳定、更可解释

## 8. MVP 阶段核心指标白名单

### 8.1 客观指标

第一阶段已纳入的客观指标：

- `sessionDepthDistribution`（会话深度分布）
- `dropoffTurnDistribution`（流失轮次分布）
- `avgResponseGapSec`（平均响应间隔）
- `activeHourDistribution`（活跃时段分布）
- `topicSwitchRate`（主题切换率）
- `userQuestionRate`（用户提问率）
- `userMessageLengthTrend`（用户消息长度趋势）
- `avgAssistantMessageLength`（AI 平均消息长度）

这些指标的共同特点是：

- 场景无关
- 解释稳定
- 可以为产品与运营提供直接洞察

### 8.2 主观指标

第一阶段已纳入的主观指标：

- `emotionCurve`（情绪曲线）
- `emotionTurningPoints`（情绪拐点）
- `emotionRecovery`（情绪恢复能力）
- `empathyScore`（共情得分）
- `offTopicOrIgnoreRisk`（答非所问/忽视风险）
- `preachinessRisk`（说教压迫风险）

### 8.3 隐式推断信号

这是当前 MVP 的亮点层，负责把“看起来说不清的问题”转换成可结构化的风险：

- `interestDeclineRisk`（兴趣下降风险）
- `understandingBarrierRisk`（理解障碍风险）
- `emotionRecoveryFailureRisk`（情绪恢复失败风险）

## 9. 核心评估逻辑

### 9.1 Topic Segment 切分

系统不是简单按整段 session 评估，而是先把同一个 `session` 内的多主题内容切开。

切分逻辑分两步：

#### 第一步：规则优先切分

核心规则如下：

```text
if previous.domain（上一段主题域） == current.domain（当前主题域）:
  不切

if previous.domain（上一段主题域） 与 current.domain（当前主题域） 属于兼容域:
  不切

if user 行命中强切词（扮演/练习/模拟/剧情/模板/...）:
  切

if current.domain（当前主题域） == casual（寒暄域）:
  不切

if assistant 行且未命中收尾强信号:
  不切

否则当 currentCandidate.confidence（当前主题候选置信度） >= 0.84:
  切
```

#### 第二步：长间隔场景由 LLM 辅助

仅在以下条件同时满足时调用 LLM：

```text
gapSec（消息间隔秒数） >= 180
and useLlm（启用大模型） = true
and 当前消息不命中显式 continuation 词
```

LLM 只输出一个最小判断：

```text
isContinuation（是否延续上一主题） = true / false
```

这保证了：

- LLM 只做必要判断
- 成本可控
- 结果更容易解释

### 9.2 Segment 级情绪评分

当前项目的情绪分不是简单关键词打标签，而是两段式结构化评分：

1. LLM 给出基准情绪判断
2. 本地评分函数做确定性校正

#### 第一步：LLM 输出基准情绪

LLM 只输出：

- `emotionPolarity`（情绪倾向）
- `emotionIntensity`（情绪强度）
- `emotionBaseScore`（情绪基准分）
- `emotionEvidence`（情绪证据）
- `emotionConfidence`（情绪判断置信度）

#### 第二步：本地评分函数修正

最终公式：

```text
emotionScore（情绪最终分） =
  emotionBaseScore（情绪基准分）
  + emotionValenceWeight（情绪倾向修正）
  + emotionLengthWeight（长度结构修正）
  + emotionStyleWeight（表达风格修正）
  + emotionGapWeight（响应节奏修正）
  + emotionRecoveryWeight（恢复迹象修正）
  - emotionRiskPenalty（风险惩罚项）
```

结果约束：

```text
emotionScore（情绪最终分） ∈ [0, 100]
保留 1 位小数
```

#### 各项修正因子

`emotionValenceWeight`（情绪倾向修正）

```text
emotionValenceWeight（情绪倾向修正） =
  clamp(
    ((positiveCount（正向表达次数） - negativeCount（负向表达次数）) / totalRows（总消息数）) * 12,
    -8,
    8
  )
```

`emotionLengthWeight`（长度结构修正）

```text
if avgUserLength（用户平均消息长度） >= 14: +2.5
if avgUserLength（用户平均消息长度） <= 7:  -2.5

if avgAssistantLength（AI 平均消息长度） >= 28: -1.5
if avgAssistantLength（AI 平均消息长度） <= 10: -1.0
else: +0.8

emotionLengthWeight（长度结构修正） = clamp(userPart（用户长度部分） + assistantPart（AI 长度部分）, -8, 8)
```

`emotionStyleWeight`（表达风格修正）

```text
emotionStyleWeight（表达风格修正） =
  clamp(empathyCount（共情表达次数） * 1.5 - preachyCount（说教表达次数） * 3, -8, 8)
```

`emotionGapWeight`（响应节奏修正）

```text
if avgGapSec（平均响应间隔） > 90:  -5
else if avgGapSec（平均响应间隔） > 45: -2
else if 0 < avgGapSec（平均响应间隔） < 20: +1.5
else: 0
```

`emotionRecoveryWeight`（恢复迹象修正）

```text
if firstUser（首条用户消息） is negative and lastUser（末条用户消息） is positive:
  +6
else if firstUser is negative and assistant has empathy:
  +3.5
else if polarity == negative and no supportive assistant:
  -3
else:
  0
```

`emotionRiskPenalty`（风险惩罚项）

```text
riskPenalty（风险惩罚项） =
  1.2 if last row role（最后一条消息角色） == assistant
  + 2.8 if polarity（情绪倾向） == negative and intensity（情绪强度） == high
  + 1.5 if avgUserLength（用户平均消息长度） <= 6 and polarity（情绪倾向） == negative

riskPenalty = clamp(riskPenalty, 0, 8)
```

#### 情绪分解释区间

```text
0-20   : 强负向，明显失衡
20-40  : 负向，高压/低落
40-60  : 中性偏压抑
60-80  : 稳定/缓和
80-100 : 明显正向/恢复良好
```

## 10. 指标计算方法与公式

### 10.1 客观指标

#### `sessionDepthDistribution`（会话深度分布）

用途：判断流失发生在浅层还是深层对话。

```text
sessionDepth（会话深度）(session) = max(turnIndex（轮次编号） in session)

bucket(sessionDepth) =
  1-3, if sessionDepth <= 3
  4-8, if 4 <= sessionDepth <= 8
  9+,  if sessionDepth >= 9

sessionDepthDistribution（会话深度分布）[bucket（分桶）] = count(session in bucket)
```

#### `dropoffTurnDistribution`（流失轮次分布）

用途：定位用户停止对话主要发生在哪一轮。

```text
dropoffTurnDistribution（流失轮次分布）[turnIndex（轮次编号）] =
  count(row where isDropoffTurn（是否流失轮次） = true and row.turnIndex（轮次编号） = turnIndex)
```

#### `avgResponseGapSec`（平均响应间隔）

用途：判断交互节奏、犹豫程度和响应成本。

```text
responseGapSec（响应间隔秒数）(i) = timestamp（消息时间）(i) - timestamp（消息时间）(i-1)

avgResponseGapSec（平均响应间隔） =
  sum(all valid responseGapSec（响应间隔秒数）) / count(all valid responseGapSec（响应间隔秒数）)
```

#### `activeHourDistribution`（活跃时段分布）

用途：看用户主要在哪些时段活跃。

```text
activeHour（活跃小时） = hour(timestamp（消息时间）)

activeHourDistribution（活跃时段分布）[activeHour（活跃小时）] =
  count(row where row.activeHour（活跃小时） = activeHour)
```

#### `topicSwitchRate`（主题切换率）

用途：判断对话是否碎片化，主题是否缺少延展。

```text
topicSwitchCount（主题切换次数）(session) = unique(topicSegmentId（主题分段编号） in session) - 1

topicSwitchRate（主题切换率） =
  sum(max(0, topicSwitchCount（主题切换次数）(session))) / count(session)
```

#### `userQuestionRate`（用户提问率）

用途：判断用户探索意愿和参与度。

```text
isQuestion（是否提问） = content（消息内容） contains "?" or "？"

userQuestionRate（用户提问率） =
  count(user row where isQuestion（是否提问） = true) / count(all user row)
```

#### `avgUserMessageLength`（用户平均消息长度）

用途：观察用户表达投入程度。

```text
avgUserMessageLength（用户平均消息长度） =
  sum(length(content（消息内容）) for user rows) / count(user rows)
```

#### `avgAssistantMessageLength`（AI 平均消息长度）

用途：识别 AI 是否过长压迫或过短敷衍。

```text
avgAssistantMessageLength（AI 平均消息长度） =
  sum(length(content（消息内容）) for assistant rows) / count(assistant rows)
```

#### `userMessageLengthTrend`（用户消息长度趋势）

用途：观察用户回复是否逐步变短或变长。

```text
x（序列位置） = message index within user rows
y（消息长度） = message length

slope（趋势斜率） =
  sum((x（序列位置） - xMean（位置均值）) * (y（消息长度） - yMean（长度均值）)) / sum((x（序列位置） - xMean（位置均值）)^2)
```

解读：

- `slope < 0`：用户回复逐步变短，可能兴趣下降
- `slope > 0`：用户回复逐步变长，可能参与度上升
- `slope ≈ 0`：长度基本稳定

### 10.2 主观维度分

主观维度统一输出 `1-5` 分，且每一项都要返回：

- `score`
- `reason`
- `evidence`
- `confidence`

#### `empathyScore`（共情得分）

```text
empathyHitRate（共情命中率） =
  count(assistant row contains empathy words) / count(assistant rows)

empathyScore（共情得分） = round(clamp(empathyHitRate（共情命中率） * 5, 1, 5))
```

#### `offTopicOrIgnoreRisk`（答非所问/忽视风险）

```text
topicSwitchRowRate（主题切换行占比） =
  count(row where isTopicSwitch（是否主题切换） = true) / count(all rows)

offTopicScore（答非所问得分） =
  round(clamp(5 - topicSwitchRowRate（主题切换行占比） * 8 - understandingBarrierRisk（理解障碍风险） * 2, 1, 5))
```

#### `preachinessRisk`（说教压迫风险）

```text
preachyRate（说教命中率） =
  count(assistant row contains preachy words) / count(assistant rows)

preachinessScore（说教得分） =
  round(clamp(5 - preachyRate（说教命中率） * 10, 1, 5))
```

#### `emotionRecovery`（情绪恢复能力）

```text
lowEmotionCount（低情绪轮次数） = count(row where emotionScore（情绪最终分） <= 40)
positiveCount（高情绪轮次数）   = count(row where emotionScore（情绪最终分） >= 65)
recoveryFailureRisk（恢复失败风险） = signal(emotionRecoveryFailureRisk（情绪恢复失败风险）).score

if lowEmotionCount == 0:
  emotionRecovery（情绪恢复能力） = round(clamp(4 - recoveryFailureRisk（恢复失败风险）, 1, 5))
else:
  emotionRecovery（情绪恢复能力） =
    round(clamp((positiveCount（高情绪轮次数） / lowEmotionCount（低情绪轮次数）) * 2.5 + (1 - recoveryFailureRisk（恢复失败风险）), 1, 5))
```

#### `emotionTurningPoints`（情绪拐点）

```text
scoreDelta（分数变化值） = current.emotionScore（当前情绪分） - previous.emotionScore（上一轮情绪分）

if abs(scoreDelta) >= 12:
  记为 turning point
```

## 11. 隐式推断信号层

信号层统一输出 `score ∈ [0,1]`，并划分为：

```text
high   : score >= 0.70
medium : 0.40 <= score < 0.70
low    : score < 0.40
```

### `interestDeclineRisk`（兴趣下降风险）

用途：识别用户兴趣衰减、接近流失的趋势。

```text
score = 0.22

if lateAvgLength < earlyAvgLength * 0.78:
  score += 0.26

if lateAvgGap > max(30, earlyAvgGap * 1.4):
  score += 0.28

if lateQuestionRate < earlyQuestionRate and earlyQuestionRate > 0:
  score += 0.18
```

### `understandingBarrierRisk`（理解障碍风险）

用途：识别 AI 是否没有理解用户，或表达不够清晰。

```text
score = 0.20

if confusionRows > 0:
  score += 0.30

if any normalizedQuestion count >= 2:
  score += 0.28

if user asked question and next assistant row isTopicSwitch:
  score += 0.18
```

### `emotionRecoveryFailureRisk`（情绪恢复失败风险）

用途：识别安抚失败、情绪低谷持续的问题。

```text
score = 0.22

if exists low emotion row and no recovery within next 4 turns:
  score += 0.34

if dropoff occurs and previous row emotionScore <= 40:
  score += 0.22
```

## 12. 当前交付产物

当前系统已经能输出以下内容：

- `summaryCards`（摘要卡片）：业务摘要卡片
- `enrichedRows`（补全明细行）：补全后的中间层明细
- `enrichedCsv`（补全结果 CSV）：可下载 CSV 中间产物
- `objectiveMetrics`（客观指标结果）：客观指标
- `subjectiveMetrics`（主观指标结果）：主观指标
- `topicSegments`（主题分段结果）：主题切分结果
- `charts`（图表数据）：图表数据
- `suggestions`（优化建议）：优化建议

这意味着系统不是只生成一个总分，而是能为 PM、算法、运营和标注复核提供多种视角的解释材料。

## 13. 当前项目状态判断

结论：当前项目已经完成“第一阶段 P0 可运行 MVP”。

目前已经具备：

- 多格式原始数据接入
- `Raw -> Enriched -> Presentation` 主链路
- 一组稳定的客观指标
- 一组可运行的主观指标
- topic segment 切分
- segment 级结构化情绪评分
- 隐式推断信号层
- 前端工作台展示与结果导出

## 14. 下一阶段建议

如果进入下一阶段，最建议优先补的不是"更多功能"，而是"更强准确性和更高泛化能力"，并把产品定位从"对话质量评估工具"升级到"Agent 优化决策系统"：

1. 让信号层与建议生成的联动更细
2. 增加更多跨场景的指标模板
3. 让情绪评分函数参数可配置
4. 提升 topic 切分和主观证据模板的稳定性
5. 增加批量评估、复核与对比能力
6. **评测集按能力维度切片**：每条 case 显式标 `capabilityDimension`（多轮一致性 / 工具调用正确性 / 知识忠实度等 12 个白名单）+ `failureLayer`（Canonical Agent Harness 的 9 层 L0-L8）。详见 `Zeval 重构方案/重构方案梳理/15-能力维度评测与归因.md`。
7. **故障层归因**：Copilot 给出的优化建议必须能定位到"该改模型 / prompt / retrieval / tool schema / memory / state ..."的具体层，不再笼统"调 prompt"。
8. **候选实验路由**：让用户跑"同一组 eval cases × 候选维度矩阵（model × temperature × prompt × tool schema）"的对照实验，由系统推荐性价比最高的组合。

## 15. PM 视角总结

从 PM 视角看，当前 MVP 已经证明了以下事情：

- 原始长对话可以被自动转成结构化评估对象
- 不同主题、不同情绪阶段可以被切分并单独评估
- 系统不仅能看"表层统计"，还能看"情绪走势"和"潜在风险"
- 结果具备一定可解释性，可以支持产品讨论、策略迭代和后续业务验证

因此，当前方案已经适合作为第一阶段对外演示、内部评审和下一轮需求收敛的基础版本。

## 16. 产品定位升级（重构目标）

当前 MVP 是"**对话质量评估工具**"。重构目标是"**Agent 优化决策系统**"——能告诉用户"该改模型还是改 harness 哪一层"。市面上做 eval 的工具不少，但能给出"先改什么、再改什么、性价比多少"决策建议的几乎没有，这是 Zeval 的差异化点。

升级靠四块：

1. **数据立方体**：每条评测 case 落到 `(capabilityDimension × source × failureLayer)` 三元组（详见 `Zeval 重构方案/重构方案梳理/15-能力维度评测与归因.md`）。
2. **9 层 Canonical Harness**：L0 Model / L1 Input / L2 Planning / L3 Memory / L4 Retrieval / L5 Tool Selection / L6 Tool Execution / L7 State / L8 Generation——收敛自 Claude Agent SDK / LangGraph / OpenAI Assistants / Agentic RAG。
3. **能力 ↔ 层归因矩阵**：12 个能力维度各有"主因层 + 次因层"映射，是 Copilot 做归因建议的基石。
4. **Copilot 决策 skills**：`diagnose_capability_gap` / `compose_eval_dataset_for_capability` / `attribute_failure_to_layer` / `suggest_optimization_path` 四个新 skill，把用户痛点直达优化路径推荐。
