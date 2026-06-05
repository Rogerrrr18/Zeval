/**
 * @fileoverview Zeval Agent Loop — 多轮工具调用循环
 *
 * 模仿 Hermes AgentLoop 设计：
 * - ReAct 范式：plan → act → observe → evaluate
 * - 支持多工具并行调用
 * - 可序列化状态，支持断点恢复
 * - 每轮包含完整的对话历史
 *
 * 工作流程：
 * 1. 接收用户任务
 * 2. 构建系统提示（含工具定义）
 * 3. 循环（最多 maxTurns 轮）：
 *    a. planning: LLM 决定策略
 *    b. acting: 解析并执行 tool calls
 *    c. observing: 收集工具结果
 *    d. evaluating: 判断任务是否完成
 * 4. 返回最终结果
 */

import { parseToolCalls } from "./tool-parser";
import { AgentStateManager } from "./state";
import { createFullToolRegistry, executeToolCall, getToolSchemas } from "./tools";
import type {
  AgentExecutionContext,
  AgentLoopConfig,
  AgentLoopResult,
  AgentMessage,
  AgentState,
  AgentToolRegistry,
  AgentToolResult,
} from "./types";
import type { BenchmarkMetricEvaluationResult } from "@/benchmark/types";
import { buildKnowledgeFileList } from "./file-tools";

type OpenAiMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  name?: string;
  tool_call_id?: string;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
      role?: string;
    };
  }>;
  error?: { message?: string };
};

/**
 * Zeval Agent Loop 主类
 */
export class ZevalAgentLoop {
  private config: AgentLoopConfig;
  private stateManager: AgentStateManager;
  private context: AgentExecutionContext;
  private registry: AgentToolRegistry;
  private userId?: string;

  constructor(config: AgentLoopConfig, context: AgentExecutionContext, userId?: string) {
    this.config = config;
    this.registry = config.tools;
    this.stateManager = new AgentStateManager(context.runId, config.maxTurns);
    this.context = context;
    this.context.state = this.stateManager.getState();
    this.userId = userId;
  }

  /**
   * 运行 Agent Loop，执行用户任务
   */
  async run(taskDescription: string): Promise<AgentLoopResult> {
    try {
      // 初始化：构建系统提示并发送任务
      const systemPrompt = await this.buildSystemPrompt();
      const messages: AgentMessage[] = [
        { role: "system", content: systemPrompt },
        { role: "user", content: taskDescription },
      ];

      this.stateManager.transition("planning").startTurn(messages);

      // 主循环
      while (!this.stateManager.isMaxTurnsReached()) {
        const turnResult = await this.executeTurn();

        if (turnResult.done) {
          this.stateManager.transition("completed").endTurn();
          return {
            success: true,
            finalAnswer: turnResult.answer,
            state: this.stateManager.getState(),
          };
        }

        if (turnResult.error) {
          this.stateManager.transition("failed").endTurn();
          return {
            success: false,
            state: this.stateManager.getState(),
            error: turnResult.error,
          };
        }
      }

      // 达到最大轮数但未完成
      this.stateManager.transition("failed").endTurn();
      return {
        success: false,
        state: this.stateManager.getState(),
        error: `达到最大轮数限制 (${this.config.maxTurns})，任务未完成`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.stateManager.transition("failed");
      return {
        success: false,
        state: this.stateManager.getState(),
        error: message,
      };
    }
  }

  /**
   * 获取当前状态快照
   */
  getState(): AgentState {
    return this.stateManager.getSnapshot();
  }

  /**
   * 从断点恢复继续执行
   */
  async resume(): Promise<AgentLoopResult> {
    const state = this.stateManager.getState();
    if (state.phase === "completed" || state.phase === "failed") {
      return {
        success: state.phase === "completed",
        state,
        error: state.phase === "failed" ? "任务已失败，无法恢复" : undefined,
      };
    }

    // 从当前状态继续循环
    while (!this.stateManager.isMaxTurnsReached()) {
      const turnResult = await this.executeTurn();

      if (turnResult.done) {
        this.stateManager.transition("completed").endTurn();
        return {
          success: true,
          finalAnswer: turnResult.answer,
          state: this.stateManager.getState(),
        };
      }

      if (turnResult.error) {
        this.stateManager.transition("failed").endTurn();
        return {
          success: false,
          state: this.stateManager.getState(),
          error: turnResult.error,
        };
      }
    }

    this.stateManager.transition("failed").endTurn();
    return {
      success: false,
      state: this.stateManager.getState(),
      error: `恢复后达到最大轮数限制 (${this.config.maxTurns})`,
    };
  }

  // ───────────────────────────────────────────────
  // 私有方法
  // ───────────────────────────────────────────────

  private async executeTurn(): Promise<{
    done: boolean;
    answer?: string;
    error?: string;
  }> {
    // 1. planning: 构建消息历史，调用 LLM
    this.stateManager.transition("planning");
    const history = this.stateManager.buildHistory();

    const llmResponse = await this.callLlm(history);
    if (!llmResponse) {
      return { done: false, error: "LLM 调用失败，无法获取响应" };
    }

    // 2. 解析 tool calls
    const { toolCalls, remainingText, hasToolCalls } = parseToolCalls(llmResponse);

    if (!hasToolCalls) {
      // 没有 tool calls，视为最终答案
      this.stateManager.transition("completed");
      return { done: true, answer: remainingText || llmResponse };
    }

    // 3. acting: 执行工具调用
    this.stateManager.transition("acting");
    const toolResults: AgentToolResult[] = [];

    for (const toolCall of toolCalls) {
      const result = await executeToolCall(toolCall, this.registry, this.context);
      toolResults.push(result);

      // 更新上下文中的 metric results
      if (
        result.name === "evaluate_metric" &&
        result.status === "success" &&
        result.result
      ) {
        const evalResult = result.result as Record<string, unknown>;
        this.context.metricResults.push({
          runId: this.context.runId,
          benchmarkId: this.context.task?.benchmarkId ?? "",
          taskId: this.context.task?.taskId ?? "",
          caseId: String(evalResult.caseId ?? ""),
          submissionId: this.context.currentSubmission?.submissionId ?? "",
          agentFramework: this.context.currentSubmission?.agentFramework ?? "claude_code",
          model: this.context.currentSubmission?.model ?? "unknown",
          metricKey: String(evalResult.metricKey ?? ""),
          metricWeight: this.context.currentMetric?.weight ?? 1,
          capability: this.context.currentMetric?.capability ?? "task_completion",
          evaluatorType: "llm_judge",
          score: Number(evalResult.score ?? 0),
          normalizedScore: Number(evalResult.normalizedScore ?? evalResult.score ?? 0),
          passed: Boolean(evalResult.passed),
          status: "scored",
          reason: String(evalResult.reason ?? ""),
          evidence: Array.isArray(evalResult.evidence) ? evalResult.evidence.map(String) : [],
          confidence: Number(evalResult.confidence ?? 0.8),
          needsHumanReview: false,
          failureTags: [],
        });
      }
    }

    // 4. observing: 构建工具结果消息
    this.stateManager.transition("observing");
    const toolResultMessages: AgentMessage[] = toolResults.map((tr) => ({
      role: "tool",
      tool_call_id: tr.tool_call_id,
      name: tr.name,
      content: JSON.stringify(
        tr.status === "success" ? tr.result : { error: tr.error }
      ),
    }));

    // 5. evaluating: 记录本轮结果，继续下一轮
    this.stateManager.transition("evaluating").endTurn(toolCalls, toolResults);

    // 将工具结果加入下一轮的起始消息
    this.stateManager.startTurn(toolResultMessages);

    return { done: false };
  }

  private async callLlm(messages: AgentMessage[]): Promise<string | undefined> {
    const timeoutMs = this.config.toolTimeoutMs * 2; // LLM 调用给更长的超时
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const openAiMessages: OpenAiMessage[] = messages.map((m) => {
        if (m.role === "tool") {
          return {
            role: "tool",
            content: m.content,
            tool_call_id: m.tool_call_id,
            name: m.name,
          };
        }
        return {
          role: m.role,
          content: m.content,
        };
      });

      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: openAiMessages,
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens ?? 2048,
          stream: false,
        }),
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timer);

      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as OpenAiChatResponse;
        throw new Error(
          `API 错误 ${response.status}: ${payload.error?.message ?? "未知错误"}`
        );
      }

      const payload = (await response.json()) as OpenAiChatResponse;
      const content =
        payload.choices?.[0]?.message?.content ??
        payload.choices?.[0]?.message?.reasoning_content;

      return content ?? undefined;
    } catch (error) {
      clearTimeout(timer);
      console.error("[ZevalAgentLoop] LLM 调用失败:", error);
      return undefined;
    }
  }

  private async buildSystemPrompt(): Promise<string> {
    const schemas = getToolSchemas(this.registry);

    const toolDescriptions = schemas
      .map(
        (s) =>
          `## ${s.function.name}
${s.function.description}
参数: ${Object.entries(s.function.parameters.properties)
            .map(([k, v]) => `${k} (${v.type}) - ${v.description}`)
            .join("; ")}`
      )
      .join("\n\n");

    // 注入知识库上下文
    let knowledgeContext = "";
    if (this.userId) {
      try {
        knowledgeContext = await buildKnowledgeFileList(this.userId);
      } catch {
        // 知识库读取失败不影响系统提示构建
      }
    }

    const parts = [
      "你是 Zeval 评测助手，专门负责 AI Agent 的自动化评测。",
      "",
      "你可以使用以下工具来完成评测任务：",
      "",
      toolDescriptions,
      "",
      "使用工具的格式：",
      "当你需要调用工具时，使用以下 XML 格式输出：",
      "",
      '<tool_call>\n{"id": "call_1", "name": "工具名", "arguments": {"参数1": "值1"}}\n</tool_call>',
      "",
      "你可以一次调用多个工具（并行调用）。",
      "当不需要调用工具时，直接输出最终答案。",
      "",
      "评测原则：",
      "1. 客观公正：基于事实和数据评分，不带有偏见",
      "2. 详细记录：每个评分都给出明确的理由和证据",
      "3. 可追溯：所有判断都有依据，可以被人工复核",
      "4. 中文输出：所有评测结果和报告使用中文",
    ];

    if (knowledgeContext) {
      parts.push("", knowledgeContext);
    }

    return parts.join("\n");
  }
}

/**
 * 便捷函数：快速创建一个评测 Agent 并运行任务
 */
export async function runEvalAgent(input: {
  runId: string;
  taskDescription: string;
  model?: string;
  apiKey: string;
  baseUrl: string;
  maxTurns?: number;
  temperature?: number;
  task?: Record<string, unknown>;
  currentSubmission?: Record<string, unknown>;
  metricResults?: Record<string, unknown>[];
  userId?: string;
  includeFullTools?: boolean;
}): Promise<AgentLoopResult> {
  const registry = createFullToolRegistry();

  const context: AgentExecutionContext = {
    runId: input.runId,
    task: input.task as AgentExecutionContext["task"],
    currentSubmission: input.currentSubmission as AgentExecutionContext["currentSubmission"],
    metricResults: (input.metricResults ?? []) as BenchmarkMetricEvaluationResult[],
    metadata: {},
    state: {} as AgentState,
  };

  const loop = new ZevalAgentLoop(
    {
      maxTurns: input.maxTurns ?? 15,
      temperature: input.temperature ?? 0.2,
      toolTimeoutMs: 30000,
      model: input.model ?? "deepseek-v4-flash",
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      tools: registry,
    },
    context,
    input.userId
  );

  return loop.run(input.taskDescription);
}
