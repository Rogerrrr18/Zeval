/**
 * @fileoverview First built-in scenario template for ToB support agents.
 */

import type { ScenarioTemplate } from "@/types/scenario";

/**
 * Default scenario template for ToB customer-support agents.
 */
export const TOB_CUSTOMER_SUPPORT_SCENARIO: ScenarioTemplate = {
  scenarioId: "toB-customer-support",
  displayName: "ToB 客服 Agent",
  evaluationMetrics: [
    {
      id: "goal_completion_dag",
      displayName: "目标达成 DAG",
      description: "按理解目标、承接动作、解决证据三步判断用户目标是否达成。",
      kind: "llm_dag",
      scope: "session",
      threshold: 0.7,
      direction: "higher-is-better",
      requiredFields: ["turns"],
      criteria: "用户初始问题是否被 assistant 完整理解、承接并推进到解决态。",
      evaluationSteps: [
        "识别用户在首两轮中的核心目标。",
        "判断 assistant 是否围绕该目标给出具体处理动作。",
        "判断会话末尾是否出现解决、转交、明确下一步或失败说明。",
      ],
      fallback: "rule_proxy",
      mapsToMetricId: "goalCompletion",
    },
    {
      id: "empathy_geval",
      displayName: "共情质量 G-Eval",
      description: "评估客服是否先接住用户情绪，再进入问题处理。",
      kind: "llm_geval",
      scope: "session",
      threshold: 0.68,
      direction: "higher-is-better",
      requiredFields: ["turns"],
      criteria: "assistant 是否识别用户情绪、避免说教，并用清晰动作降低用户焦虑。",
      evaluationSteps: [
        "检查 assistant 是否承认用户处境或情绪。",
        "检查是否避免机械模板、推责和压迫式表达。",
        "检查共情之后是否给出可执行处理路径。",
      ],
      fallback: "rule_proxy",
      mapsToMetricId: "empathy",
    },
    {
      id: "handoff_risk_rule",
      displayName: "升级风险规则",
      description: "基于投诉、转人工、主管等关键词判断升级失控风险。",
      kind: "rule",
      scope: "dataset",
      threshold: 0.72,
      direction: "higher-is-better",
      requiredFields: ["turns"],
      evaluationSteps: [
        "统计升级相关关键词命中率。",
        "结合情绪恢复失败信号判断是否需要人工介入。",
      ],
      fallback: "skip",
      mapsToMetricId: "offTopicRisk",
    },
    {
      id: "tool_grounding_structured",
      displayName: "工具调用证据链",
      description: "当存在 service_call/service_results 时，验证调用参数和结果是否可追溯。",
      kind: "structured",
      scope: "trace",
      threshold: 0.85,
      direction: "higher-is-better",
      requiredFields: ["state", "service_call", "service_results"],
      evaluationSteps: [
        "检查 service_call 参数是否来自此前 state。",
        "检查 service_results 是否能支撑 assistant 的后续回复。",
      ],
      fallback: "skip",
      mapsToMetricId: "serviceCallGrounding",
    },
  ],
  syntheticCaseSeeds: [
    {
      id: "angry-escalation-risk",
      userPersona: "高价值企业客户管理员，已经多次反馈同一故障。",
      situation: "用户强烈要求立刻解决，否则升级投诉并转人工。",
      expectedFailureMode: "assistant 只给模板化安抚，没有承接升级风险，也没有给出明确处理路径。",
      targetMetrics: ["empathy_geval", "goal_completion_dag", "handoff_risk_rule"],
    },
    {
      id: "ambiguous-problem-description",
      userPersona: "首次使用产品的新客户，无法准确描述问题。",
      situation: "用户只说“系统又坏了”，缺少账号、页面、错误码等信息。",
      expectedFailureMode: "assistant 没有追问关键诊断信息，直接给泛化建议。",
      targetMetrics: ["goal_completion_dag", "empathy_geval"],
    },
    {
      id: "tool-result-ignored",
      userPersona: "正在等待工单处理进度的客户。",
      situation: "工具返回已有工单和预计完成时间，但 assistant 没有引用结果。",
      expectedFailureMode: "assistant 回复与 service_results 不一致或缺少证据支撑。",
      targetMetrics: ["tool_grounding_structured", "goal_completion_dag"],
    },
  ],
  businessKpis: [
    {
      id: "resolution_rate",
      displayName: "一次解决率",
      description: "用户问题是否在当次会话内被承接并进入解决态。",
      direction: "higher-is-better",
      mappedTo: {
        primary: [
          { source: "subjective", metricId: "goalCompletion", weight: 0.5 },
          { source: "objective", metricId: "agentResolutionSignalRate", weight: 0.3 },
          { source: "objective", metricId: "userQuestionRepeatRate", weight: -0.2 },
        ],
        secondary: [{ source: "signal", metricId: "understandingBarrierRisk", weight: -0.2 }],
      },
      successThreshold: 0.75,
      degradedThreshold: 0.5,
    },
    {
      id: "escalation_control",
      displayName: "升级控制力",
      description: "用户是否被及时接住，避免投诉、转人工或对话失控。",
      direction: "higher-is-better",
      mappedTo: {
        primary: [
          { source: "objective", metricId: "escalationKeywordHitRate", weight: -0.45 },
          { source: "subjective", metricId: "offTopicRisk", weight: 0.35 },
          { source: "signal", metricId: "emotionRecoveryFailureRisk", weight: -0.2 },
        ],
        secondary: [{ source: "objective", metricId: "avgResponseGapSec", weight: -0.1 }],
      },
      successThreshold: 0.72,
      degradedThreshold: 0.48,
    },
    {
      id: "service_efficiency",
      displayName: "服务效率",
      description: "回复节奏、主题连贯性与收敛效率是否达到业务可接受水平。",
      direction: "higher-is-better",
      mappedTo: {
        primary: [
          { source: "objective", metricId: "avgResponseGapSec", weight: -0.35 },
          { source: "objective", metricId: "topicSwitchRate", weight: -0.25 },
          { source: "objective", metricId: "agentResolutionSignalRate", weight: 0.2 },
        ],
        secondary: [
          { source: "signal", metricId: "understandingBarrierRisk", weight: -0.1 },
          { source: "subjective", metricId: "empathy", weight: 0.1 },
        ],
      },
      successThreshold: 0.7,
      degradedThreshold: 0.45,
    },
  ],
  onboardingQuestions: [
    {
      id: "primary_channel",
      question: "这批数据来自 Web / App / 电话哪种渠道？",
    },
    {
      id: "has_human_handoff",
      question: "对话流里是否存在转人工分支？若有，标记字段名是什么？",
    },
    {
      id: "resolution_field",
      question: "原始数据里是否已有“问题是否解决”的字段？字段名是什么？",
    },
  ],
};
