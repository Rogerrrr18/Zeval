/**
 * @fileoverview Zeval Agent Adapter — 接入 Benchmark 系统
 *
 * 这是 Zeval 自己的 Agent adapter，区别于 claude_code / codex / hermes / openclaw。
 * 它使用 Zeval Agent Loop（模仿 Hermes 的多轮工具调用架构）来执行评测任务，
 * 具备评测垂直领域的 Skills 能力。
 */

import {
  ZevalAgentLoop,
  createEvalToolRegistry,
  runEvalAgent,
  type AgentExecutionContext,
} from "@/benchmark/agent";
import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
} from "@/benchmark/types";
import type {
  AgentAdapter,
  AgentAdapterConfig,
  AgentAdapterContext,
} from "./types";

const ZEVAL_SYSTEM_PROMPT = [
  "你是 Zeval 评测助手，专门负责自动化评估 AI Agent 的业务任务表现。",
  "",
  "你的核心能力包括：",
  "- 指标评估：对比 Agent 输出与预期，给出结构化评分",
  "- 横向对比：对比多个 Agent 框架在同一任务上的表现差异",
  "- 根因分析：分析 badcase 的根本原因",
  "- 报告生成：生成可读的评测分析报告",
  "",
  "评测原则：",
  "1. 客观公正：基于事实和数据评分，不带偏见",
  "2. 详细记录：每个评分给出明确理由和证据",
  "3. 可追溯：所有判断都有依据，可被人工复核",
  "4. 中文优先：评测结果和报告使用中文",
  "",
  "输出格式要求：",
  "- 评估结果必须是结构化数据",
  "- 评分需附带详细的理由说明",
  "- 使用证据支持每个判断",
].join("\n");

/**
 * 构建 Zeval Agent adapter
 *
 * 与 claude_code / codex 等 adapter 的区别：
 * - 使用 Zeval Agent Loop（多轮工具调用）而非单次 LLM 调用
 * - 内置评测垂直工具集（evaluate_metric, compare_submissions 等）
 * - 支持复杂评测场景（需要多步分析的指标）
 */
export function createZevalAgentAdapter(): AgentAdapter {
  return {
    frameworkId: "zeval",
    async submit(
      taskCase: BenchmarkCase,
      context: AgentAdapterContext,
      config: AgentAdapterConfig,
    ): Promise<BenchmarkAgentSubmission> {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();

      // 构建任务描述
      const taskDescription = buildZevalTaskDescription(taskCase, context);

      // 使用 Zeval Agent Loop 执行任务
      const loopResult = await runEvalAgent({
        runId: context.runId,
        taskDescription,
        model: context.matrixCell.model,
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        maxTurns: context.matrixCell.maxTurns ?? 15,
        temperature: 0.2,
        task: {
          benchmarkId: context.benchmarkId,
          taskId: context.taskId,
        } as AgentExecutionContext["task"],
        currentSubmission: {
          submissionId: `${context.runId}_zeval_${slug(context.matrixCell.model)}_${taskCase.caseId}`,
          runId: context.runId,
          benchmarkId: context.benchmarkId,
          taskId: context.taskId,
          caseId: taskCase.caseId,
          agentFramework: "zeval",
          model: context.matrixCell.model,
        } as AgentExecutionContext["currentSubmission"],
      });

      const completedMs = Date.now();

      // 解析 Agent Loop 的最终输出
      let parsedOutput: Record<string, unknown> | undefined;
      if (loopResult.success && loopResult.finalAnswer) {
        parsedOutput = tryParseZevalOutput(loopResult.finalAnswer);
      }

      return {
        submissionId: `${context.runId}_zeval_${slug(context.matrixCell.model)}_${taskCase.caseId}`,
        runId: context.runId,
        benchmarkId: context.benchmarkId,
        taskId: context.taskId,
        caseId: taskCase.caseId,
        agentFramework: "zeval",
        model: context.matrixCell.model,
        status: loopResult.success ? "completed" : "failed",
        rawOutput: loopResult.finalAnswer ?? loopResult.error ?? "",
        parsedOutput,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: completedMs - startedMs,
        artifacts: {
          agentState: loopResult.state,
          toolCallsCount: loopResult.state.turns.reduce(
            (sum, t) => sum + (t.toolCalls?.length ?? 0),
            0,
          ),
          metricResults: loopResult.metricResults,
        },
        error: loopResult.error,
      };
    },
  };
}

/**
 * 创建高级 Zeval Agent adapter（使用 Agent Loop 实例）
 *
 * 适用于需要更精细控制的场景，如：
 * - 自定义工具注册
 * - 状态监控和断点恢复
 * - 流式输出
 */
export function createAdvancedZevalAdapter(
  customTools?: Map<string, { schema: import("@/benchmark/agent").AgentToolSchema; handler: import("@/benchmark/agent").AgentToolHandler }>,
): AgentAdapter {
  return {
    frameworkId: "zeval_advanced",
    async submit(
      taskCase: BenchmarkCase,
      context: AgentAdapterContext,
      config: AgentAdapterConfig,
    ): Promise<BenchmarkAgentSubmission> {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();

      const registry = customTools ?? createEvalToolRegistry();

      const agentContext: AgentExecutionContext = {
        runId: context.runId,
        task: {
          benchmarkId: context.benchmarkId,
          taskId: context.taskId,
        } as AgentExecutionContext["task"],
        currentCase: taskCase,
        currentSubmission: {
          submissionId: `${context.runId}_zeval_${slug(context.matrixCell.model)}_${taskCase.caseId}`,
          runId: context.runId,
          benchmarkId: context.benchmarkId,
          taskId: context.taskId,
          caseId: taskCase.caseId,
          agentFramework: "zeval",
          model: context.matrixCell.model,
        } as AgentExecutionContext["currentSubmission"],
        metricResults: [],
        metadata: {
          matrixCell: context.matrixCell,
          adapterConfig: config,
        },
        state: {} as AgentExecutionContext["state"],
      };

      const loop = new ZevalAgentLoop(
        {
          maxTurns: context.matrixCell.maxTurns ?? 20,
          temperature: 0.2,
          toolTimeoutMs: config.timeoutMs ?? 60000,
          model: context.matrixCell.model,
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          tools: registry,
        },
        agentContext,
      );

      const taskDescription = buildZevalTaskDescription(taskCase, context);
      const loopResult = await loop.run(taskDescription);

      const completedMs = Date.now();

      let parsedOutput: Record<string, unknown> | undefined;
      if (loopResult.success && loopResult.finalAnswer) {
        parsedOutput = tryParseZevalOutput(loopResult.finalAnswer);
      }

      return {
        submissionId: `${context.runId}_zeval_${slug(context.matrixCell.model)}_${taskCase.caseId}`,
        runId: context.runId,
        benchmarkId: context.benchmarkId,
        taskId: context.taskId,
        caseId: taskCase.caseId,
        agentFramework: "zeval_advanced",
        model: context.matrixCell.model,
        status: loopResult.success ? "completed" : "failed",
        rawOutput: loopResult.finalAnswer ?? loopResult.error ?? "",
        parsedOutput,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: completedMs - startedMs,
        artifacts: {
          agentState: loopResult.state,
          toolCallsCount: loopResult.state.turns.reduce(
            (sum, t) => sum + (t.toolCalls?.length ?? 0),
            0,
          ),
          metricResults: loopResult.metricResults,
        },
        error: loopResult.error,
      };
    },
  };
}

// ───────────────────────────────────────────────
// 辅助函数
// ───────────────────────────────────────────────

function buildZevalTaskDescription(
  taskCase: BenchmarkCase,
  context: AgentAdapterContext,
): string {
  const parts = [
    `任务: ${context.taskId}`,
    `案例 ID: ${taskCase.caseId}`,
    ``,
    "输入数据:",
    JSON.stringify(taskCase.input, null, 2),
    ``,
    "预期输出:",
    JSON.stringify(taskCase.expected, null, 2),
    ``,
    "请根据以上信息完成评测任务。如果需要使用工具进行分析，请调用相应工具。",
    "最终请返回结构化的评测结果。",
  ];

  return parts.join("\n");
}

function tryParseZevalOutput(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();

  // 尝试从 markdown 代码块中提取 JSON
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    try {
      return JSON.parse(codeBlockMatch[1].trim()) as Record<string, unknown>;
    } catch {
      // 忽略
    }
  }

  // 尝试直接解析 JSON
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    // 忽略
  }

  return undefined;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}
