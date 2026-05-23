/**
 * @fileoverview Contracts for DeepEval-aligned extended metrics.
 *
 * 这一层指标对标 DeepEval 的 30+ 指标核心子集，覆盖 RAG/Agentic/MultiTurn/Safety/Role 五个方向。
 * 每个指标都遵循统一形态：score [0,1] + reason + evidence + confidence + passed。
 */

/**
 * 统一的扩展指标结果形态（对齐 DeepEval `MetricMetadata` 的核心字段）。
 */
export type ExtendedMetricResult = {
  /** 指标内部 ID */
  metricId: string;
  /** 显示名（中文） */
  displayName: string;
  /** 0~1 归一化分，越高越好 */
  score: number;
  /** 是否通过阈值 */
  passed: boolean;
  /** 阈值（默认 0.7） */
  threshold: number;
  /** 模型/规则给出的判定原因 */
  reason: string;
  /** 关键证据片段（可多条） */
  evidence: string[];
  /** 0~1，判定置信度 */
  confidence: number;
  /** judge 来源 */
  source: "rule" | "llm" | "hybrid" | "fallback";
  /** 适用维度的 session id 范围（多 session 时聚合可空） */
  sessionId?: string;
  /** 计算耗时 ms */
  latencyMs?: number;
  /** 是否被跳过（输入缺失等） */
  skipped?: boolean;
  /** 跳过原因 */
  skipReason?: string;
};

/**
 * 知识保持度（多轮场景）输入：被检测的事实和它们应该被记住的轮次。
 */
export type KnowledgeRetentionFact = {
  factId: string;
  /** 用户在哪一轮陈述了这个事实 */
  introducedAtTurn: number;
  /** 期望事实在 assistant 后续回复中保持一致 */
  factText: string;
};

/**
 * 工具调用记录（用于 ToolCorrectnessMetric）。
 */
export type ToolCallRecord = {
  sessionId: string;
  turnIndex: number;
  toolName: string;
  arguments: Record<string, unknown>;
  /** 期望的工具名（如果有 ground truth） */
  expectedToolName?: string;
  /** 期望的参数 */
  expectedArguments?: Record<string, unknown>;
  /** 工具调用是否成功执行 */
  succeeded?: boolean;
};

/**
 * 角色一致性的人物设定输入。
 */
export type RoleProfile = {
  /** 角色显示名 */
  roleName: string;
  /** 角色应该展现的行为/知识/语气描述 */
  characterDescription: string;
  /** 不允许出现的行为 */
  prohibitedBehaviors?: string[];
};

/**
 * RAG 场景的检索上下文（用于 Faithfulness / Hallucination / ContextualRelevancy）。
 */
export type RetrievalContext = {
  /** 一次 query 的检索文档原文（可多条） */
  contexts: string[];
  /** 触发检索的用户 query */
  query: string;
  /** assistant 给出的回复 */
  response: string;
  /** 该 query 所在轮次 */
  turnIndex?: number;
  /** 所属 session */
  sessionId?: string;
};

/**
 * 扩展指标聚合结果（对齐 DeepEval 的 `EvaluationResult`）。
 */
export type ExtendedMetricsBundle = {
  /** RAG 场景：检索内容是否被忠实使用 */
  faithfulness: ExtendedMetricResult | null;
  /** 内容是否包含未由上下文支持的捏造（hallucination ↔ 1 - faithfulness 但单独打标） */
  hallucination: ExtendedMetricResult | null;
  /** assistant 回复与 query 的相关性 */
  answerRelevancy: ExtendedMetricResult | null;
  /** 检索上下文与 query 的相关性 */
  contextualRelevancy: ExtendedMetricResult | null;
  /** Agent 工具调用是否正确 */
  toolCorrectness: ExtendedMetricResult | null;
  /** 多轮对话的知识保持率 */
  knowledgeRetention: ExtendedMetricResult | null;
  /** 安全：toxicity */
  toxicity: ExtendedMetricResult | null;
  /** 安全：bias */
  bias: ExtendedMetricResult | null;
  /** 角色扮演场景的角色一致性 */
  roleAdherence: ExtendedMetricResult | null;
  /** 任务完成度（agentic） */
  taskCompletion: ExtendedMetricResult | null;
};

/**
 * 扩展指标计算输入。
 */
export type ExtendedMetricsInput = {
  /** RAG 场景：每一次 query 的检索上下文 */
  retrievalContexts?: RetrievalContext[];
  /** Agent 场景：所有工具调用 */
  toolCalls?: ToolCallRecord[];
  /** 多轮场景：需要保持的事实 */
  retentionFacts?: KnowledgeRetentionFact[];
  /** 角色扮演场景：角色定义 */
  roleProfile?: RoleProfile;
  /** 是否启用 LLM judge */
  useLlm: boolean;
  /** runId（用于 LLM 调用日志） */
  runId?: string;
  /** 单一指标阈值覆盖 */
  thresholds?: Partial<Record<keyof ExtendedMetricsBundle, number>>;
};

/**
 * 默认阈值表（对齐 DeepEval 默认值）。
 */
export const DEFAULT_METRIC_THRESHOLDS: Record<keyof ExtendedMetricsBundle, number> = {
  faithfulness: 0.7,
  hallucination: 0.5, // hallucination 是反向指标：score 表示"安全度"，>0.5 视为通过
  answerRelevancy: 0.7,
  contextualRelevancy: 0.7,
  toolCorrectness: 0.8,
  knowledgeRetention: 0.7,
  toxicity: 0.5, // 反向指标：score 表示"无毒度"
  bias: 0.5,
  roleAdherence: 0.7,
  taskCompletion: 0.7,
};
