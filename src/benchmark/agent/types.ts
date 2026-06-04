/**
 * @fileoverview Zeval Agent 核心类型定义
 *
 * 面向评测垂直领域的 Agent 架构，模仿 Hermes 设计：
 * - 多轮工具调用循环 (Agent Loop)
 * - 可序列化的状态机
 * - <tool_call> XML 格式的工具调用解析
 */

import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkCapabilityDimension,
  BenchmarkMetricEvaluationResult,
  BenchmarkRubricMetric,
  BenchmarkRunResult,
  BenchmarkTaskPackage,
} from "@/benchmark/types";

// ───────────────────────────────────────────────
// Agent 消息类型
// ───────────────────────────────────────────────

export type AgentMessageRole = "system" | "user" | "assistant" | "tool";

export type AgentMessage =
  | {
      role: "system" | "user" | "assistant";
      content: string;
    }
  | {
      role: "tool";
      tool_call_id: string;
      name: string;
      content: string;
    };

// ───────────────────────────────────────────────
// 工具定义
// ───────────────────────────────────────────────

export type AgentToolParameter = {
  type: string;
  description: string;
  enum?: string[];
  items?: { type: string };
};

export type AgentToolSchema = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, AgentToolParameter>;
      required: string[];
    };
  };
};

export type AgentToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type AgentToolResult = {
  tool_call_id: string;
  name: string;
  status: "success" | "error";
  result: unknown;
  error?: string;
};

export type AgentToolHandler = (
  args: Record<string, unknown>,
  context: AgentExecutionContext,
) => Promise<AgentToolResult>;

export type AgentToolRegistry = Map<string, { schema: AgentToolSchema; handler: AgentToolHandler }>;

// ───────────────────────────────────────────────
// 执行上下文
// ───────────────────────────────────────────────

export type AgentExecutionContext = {
  /** 当前运行 ID */
  runId: string;
  /** 当前任务 */
  task?: BenchmarkTaskPackage;
  /** 当前评测案例 */
  currentCase?: BenchmarkCase;
  /** 当前提交 */
  currentSubmission?: BenchmarkAgentSubmission;
  /** 当前指标 */
  currentMetric?: BenchmarkRubricMetric;
  /** 已完成的评测结果 */
  metricResults: BenchmarkMetricEvaluationResult[];
  /** 用户额外上下文 */
  metadata: Record<string, unknown>;
  /** 状态存取 */
  state: AgentState;
};

// ───────────────────────────────────────────────
// 状态管理
// ───────────────────────────────────────────────

export type AgentPhase =
  | "idle"
  | "planning"      // 规划阶段：分析任务，决定工具调用策略
  | "acting"        // 执行阶段：调用工具
  | "observing"     // 观察阶段：等待工具结果
  | "evaluating"    // 评估阶段：判断任务是否完成
  | "completed"     // 完成
  | "failed";       // 失败

export type AgentTurn = {
  turnId: number;
  phase: AgentPhase;
  messages: AgentMessage[];
  toolCalls?: AgentToolCall[];
  toolResults?: AgentToolResult[];
  timestamp: string;
  durationMs: number;
};

export type AgentState = {
  stateId: string;
  runId: string;
  phase: AgentPhase;
  currentTurn: number;
  maxTurns: number;
  turns: AgentTurn[];
  memory: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

// ───────────────────────────────────────────────
// Agent Loop 配置
// ───────────────────────────────────────────────

export type AgentLoopConfig = {
  /** 最大轮数 */
  maxTurns: number;
  /** 温度 */
  temperature: number;
  /** 最大 token */
  maxTokens?: number;
  /** 工具超时(ms) */
  toolTimeoutMs: number;
  /** 模型 ID */
  model: string;
  /** API 配置 */
  apiKey: string;
  baseUrl: string;
  /** 是否流式输出 */
  stream?: boolean;
  /** 工具注册表 */
  tools: AgentToolRegistry;
};

// ───────────────────────────────────────────────
// Agent 执行结果
// ───────────────────────────────────────────────

export type AgentLoopResult = {
  success: boolean;
  finalAnswer?: string;
  state: AgentState;
  metricResults?: BenchmarkMetricEvaluationResult[];
  error?: string;
};

// ───────────────────────────────────────────────
// 评测垂直 Skills
// ───────────────────────────────────────────────

export type EvalSkillType =
  | "metric_evaluation"    // 指标评估
  | "cross_comparison"     // 横向对比
  | "rubric_analysis"      // Rubric 分析
  | "badcase_mining"       // Badcase 挖掘
  | "report_generation";   // 报告生成

export type EvalSkillConfig = {
  skillType: EvalSkillType;
  displayName: string;
  description: string;
  requiredTools: string[];
  systemPrompt: string;
};

export type AgentSkillResult = {
  skillType: EvalSkillType;
  success: boolean;
  output: Record<string, unknown>;
  reasoning: string;
  durationMs: number;
};
