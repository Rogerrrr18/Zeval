# Zeval Scenario 技能化评估框架 v2

## 1. 设计目标

Zeval 后续不应该把所有业务都塞进同一套固定指标，而应该采用：

```text
通用评估内核 + Scenario Skill 模板 + 可替换 Judge Rubric + 业务 KPI 映射
```

核心原则：

- 通用内核负责稳定、可迁移、低成本的结构化评估。
- Scenario Skill 负责定义某个业务场景下“什么才算好”。
- LLM Judge 只处理难量化、语义性、主观性、证据归因类问题。
- 业务 KPI 不是直接由 LLM 打总分，而是由多类指标加权映射得到。
- 每个指标必须说明来源、适用场景、方向、阈值、证据与降级策略。

## 2. 分层指标体系

### 2.1 Data Quality Layer

目标：判断输入数据是否能被可靠评估。

这层是所有 scenario 通用层，应该尽量使用确定性规则。

| 指标 | 是否通用 | 计算方式 | 是否需要 LLM |
| --- | --- | --- | --- |
| message_count | 通用 | 统计消息数 | 否 |
| session_count | 通用 | 统计 session 数 | 否 |
| role_validity | 通用 | role 是否属于 user/assistant/system | 否 |
| timestamp_coverage | 通用 | 有 timestamp 的消息占比 | 否 |
| empty_content_rate | 通用 | 空内容占比 | 否 |
| duplicate_message_rate | 通用 | 近似重复消息占比 | 否 |

用途：

- 决定本次评估可信度。
- 控制哪些时序指标可以启用。
- 在报告里明确提示降级原因。

### 2.2 Interaction Quality Layer

目标：评估交互节奏、轮次、断点和基础行为模式。

这层大部分通用，但阈值需要 scenario 定制。

| 指标 | 是否通用 | 场景化方式 | 是否需要 LLM |
| --- | --- | --- | --- |
| sessionDepthDistribution | 通用 | 阈值按任务复杂度配置 | 否 |
| dropoffTurnDistribution | 通用 | 断点严重性按场景配置 | 否 |
| avgResponseGapSec | 通用 | 实时/异步/工具调用场景阈值不同 | 否 |
| activeHourDistribution | 通用 | 更多用于运营洞察 | 否 |
| userQuestionRate | 通用 | 学习/检索场景权重更高 | 否 |
| userQuestionRepeatRate | 通用 | 客服/工具型场景权重更高 | 否 |
| avgUserMessageLength | 通用 | 情绪陪伴中可反映表达意愿 | 否 |
| userMessageLengthTrend | 通用 | 结合场景解释为兴趣衰减或任务收敛 | 否 |
| avgAssistantMessageLength | 通用 | 不同产品有不同理想长度 | 否 |

### 2.3 Semantic Quality Layer

目标：判断模型是否理解用户、保持上下文、避免答非所问。

这层是 LLM Judge 的主要工作区之一，但不是全部交给 LLM。规则先提供候选信号，LLM 负责语义裁决和证据归因。

| 指标 | 是否通用 | 场景化方式 | 是否需要 LLM |
| --- | --- | --- | --- |
| topicSwitchRate | 半通用 | 创意陪聊允许更高，客服/检索要求更低 | 可选 |
| offTopicRisk | 通用语义维度 | rubric 按场景重写 | 是 |
| understandingBarrierRisk | 通用风险信号 | 困惑表达词表与证据解释按场景扩展 | 可选 |
| contextRetention | 建议新增 | 长对话/多轮任务更重要 | 是 |
| instructionFollowing | 建议新增 | 工具型/代码/检索场景更重要 | 是 |

### 2.4 Subjective Experience Layer

目标：评估体验感、语气、信任、压迫感、情绪处理等难量化质量。

这层应该主要由 LLM Judge 负责。

| 指标 | 是否通用 | 场景化方式 | 是否需要 LLM |
| --- | --- | --- | --- |
| empathy | 半通用 | 客服/陪伴高权重，检索/代码低权重 | 是 |
| preachiness | 半通用 | 陪伴/教育高权重，客服中等 | 是 |
| emotionalSafety | 场景化 | 情绪陪伴、心理支持、安全场景高权重 | 是 |
| toneFit | 场景化 | 品牌客服/销售/陪伴需要定制 | 是 |
| trustworthiness | 场景化 | 医疗、金融、法律、学术检索高权重 | 是 |

### 2.5 Outcome Quality Layer

目标：判断用户目标是否达成。它是最重要的质量层。

这一层指标名可以通用，但判定标准必须由 scenario 定制。

| 指标 | 是否通用 | 场景化方式 | 是否需要 LLM |
| --- | --- | --- | --- |
| goalCompletion | 通用框架 | 每个 scenario 定义 goal 类型、成功证据和失败证据 | 规则优先，LLM 裁决模糊样本 |
| recoveryTrace | 通用框架 | 每个 scenario 定义失败类型和恢复动作 | 规则检测 + LLM 总结 |
| badCaseAssets | 通用框架 | bad case tag 按场景扩展 | 可选 |
| evidenceQuality | 建议新增 | 学术/法律/检索场景高权重 | 是 |
| taskSuccess | 场景化 | 客服解决、学习掌握、检索命中、销售转化等 | 规则 + LLM |

### 2.6 Business KPI Layer

目标：把质量信号映射成业务负责人能理解的 KPI。

这层必须 scenario 定制，不应该放在通用内核里写死。

示例：

| 场景 | KPI |
| --- | --- |
| ToB 客服 | 一次解决率、升级控制力、服务效率 |
| 电商售后 | 退款/补发完成率、投诉风险、安抚有效性 |
| 教育辅导 | 理解确认率、引导质量、纠错质量 |
| 情绪陪伴 | 情绪恢复率、表达意愿、压迫感控制 |
| 文献检索 | 检索相关性、证据覆盖、排序解释质量、遗漏风险 |
| 销售转化 | 需求识别、异议处理、下一步推进率 |

## 3. LLM Judge 分工原则

### 3.1 应该交给 LLM Judge 的任务

- 判断是否答非所问。
- 判断是否真正理解用户意图。
- 判断共情是否有效，而不是只看关键词。
- 判断说教感、压迫感、语气适配。
- 判断目标达成的模糊样本。
- 判断复杂任务中的结果质量。
- 提取或校验证据片段。
- 总结失败后的修复策略。
- 根据场景 rubric 给主观维度打分。

### 3.2 不应该交给 LLM Judge 的任务

- 消息数、轮次数、session 数。
- 响应时间、活跃时段。
- 空字段、重复行、role 校验。
- 明确关键词命中。
- 简单比例、均值、分布。
- 可由确定性规则稳定计算的指标。

### 3.3 推荐执行顺序

```text
Raw rows
  -> Data quality checks
  -> Normalization
  -> Objective metrics
  -> Rule-based candidate signals
  -> LLM Judge only for semantic / subjective / ambiguous outcome
  -> Scenario KPI mapping
  -> Suggestions + bad cases + remediation package
```

## 4. Scenario Skill 模板结构

每个 scenario 建议是一份可版本化的 skill 包，而不是单个 YAML。

```text
scenarios/<scenario-id>/
  scenario-template.yaml
  rubric.md
  judge-prompts.md
  metric-dictionary.md
  examples/
    good.jsonl
    bad.jsonl
    borderline.jsonl
  calibration/
    gold-labels.jsonl
    agreement-report.md
```

### 4.1 scenario-template.yaml 建议字段

```yaml
scenarioId: toB-customer-support
displayName: ToB 客服 Agent
version: 1
description: 面向企业客服 Agent 的质量评估场景

applicability:
  domains:
    - customer-support
    - after-sales
  conversationStyle:
    - task-oriented
    - multi-turn
  notSuitableFor:
    - open-ended-companion
    - academic-search

dataRequirements:
  requiredFields:
    - sessionId
    - role
    - content
  recommendedFields:
    - timestamp
    - customerId
    - channel
  degradation:
    missingTimestamp: disable_time_metrics
    missingSessionId: infer_single_session

metricProfile:
  enabledCoreMetrics:
    - avgResponseGapSec
    - topicSwitchRate
    - userQuestionRepeatRate
    - agentResolutionSignalRate
    - escalationKeywordHitRate
  disabledCoreMetrics: []
  customMetrics:
    - refundActionCoverage
    - handoffAppropriateness

judgeRubrics:
  subjectiveDimensions:
    - id: empathy
      displayName: 共情程度
      scale: 1-5
      weight: 0.15
      llmRequired: true
    - id: offTopicRisk
      displayName: 答非所问/无视风险
      scale: 1-5
      weight: 0.2
      llmRequired: true
  outcomeJudges:
    - id: goalCompletion
      displayName: 目标达成
      ruleFirst: true
      llmFallback: true

businessKpis:
  - id: resolution_rate
    displayName: 一次解决率
    direction: higher-is-better
    successThreshold: 0.75
    degradedThreshold: 0.5
    mappedTo:
      primary:
        - source: subjective
          metricId: goalCompletion
          weight: 0.5
        - source: objective
          metricId: agentResolutionSignalRate
          weight: 0.3
      secondary:
        - source: objective
          metricId: userQuestionRepeatRate
          weight: -0.2

reporting:
  priorityRules:
    - if: escalationKeywordHitRate > 0.2
      priority: P0
    - if: goalCompletion < 0.5
      priority: P1
  suggestionFormat: problem-impact-action
```

## 5. 推荐指标注册表

后续实现时建议把指标注册为统一对象，而不是散落在 pipeline 里。

```ts
type MetricDefinition = {
  metricId: string;
  displayName: string;
  layer:
    | "data_quality"
    | "interaction"
    | "semantic"
    | "subjective_experience"
    | "outcome"
    | "business_kpi";
  source: "rule" | "algorithm" | "llm" | "hybrid" | "scenario";
  direction: "higher_is_better" | "lower_is_better" | "neutral";
  scale: "count" | "rate_0_1" | "score_1_5" | "score_0_100" | "seconds";
  defaultEnabled: boolean;
  scenarioConfigurable: boolean;
  requiresTimestamp: boolean;
  requiresLlm: boolean;
  degradation: string;
};
```

这样每个 scenario 只需要选择、改权重、改阈值、补 rubric，而不是复制整套 pipeline。

## 6. 推荐开发顺序

### Phase 1：先把模板能力做清楚

- 扩展 `ScenarioTemplate` 类型，支持 `metricProfile`、`judgeRubrics`、`dataRequirements`、`reporting`。
- 为 `scenarios/toB-customer-support/` 补齐 rubric 和 metric dictionary。
- 保持运行时仍使用内置 TypeScript 模板，避免 MVP 被 YAML loader 拖慢。

### Phase 2：让模板真的影响评估

- Scenario 决定启用哪些指标。
- Scenario 决定指标阈值和权重。
- Scenario 决定 LLM Judge rubric。
- Scenario 决定 bad case tag 和建议生成口径。

### Phase 3：技能化与校准

- 每个 scenario skill 配一组 good/bad/borderline 样本。
- 每个 scenario skill 配 gold labels。
- judge 更新后跑 agreement / drift。
- 只有通过校准门槛的 scenario skill 才进入演示或客户环境。

## 7. 产品层结论

Zeval 的长期形态应该是：

```text
一个通用 AI 对话质量评估内核
+ 一组可安装、可版本化、可校准的 Scenario Skills
```

通用内核解决“怎么评估”，scenario skill 解决“在这个业务里什么叫好”。这能保证迁移性、兼容性和商业化扩展空间。
