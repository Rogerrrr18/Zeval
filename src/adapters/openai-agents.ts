/**
 * @fileoverview Adapter: OpenAI Agents SDK / Chat Completions trace shape → OTel GenAI trace.
 *
 * 覆盖两类常见输入：
 *   - OpenAI Chat Completions raw response（旧的 chat.completions.create 返回）
 *   - OpenAI Agents SDK 的 `Run` 对象（新一代 agents-python / agents-js）
 */

import type { OtelGenAiSpan, OtelGenAiTrace } from "@/types/otel-genai";

/**
 * Minimal OpenAI Chat Completions response (镜像字段子集).
 */
export type OpenAIChatCompletion = {
  id: string;
  model: string;
  created: number;
  choices: Array<{
    index: number;
    message: { role: "assistant"; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};

/**
 * Minimal OpenAI Agents SDK Run shape.
 */
export type OpenAIAgentRun = {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "cancelled";
  agentId: string;
  threadId: string;
  startedAt: number;
  completedAt?: number;
  /** 工具调用清单 */
  toolCalls?: Array<{
    callId: string;
    toolName: string;
    arguments: Record<string, unknown>;
    output?: unknown;
    status: "ok" | "error";
    startedAt: number;
    completedAt?: number;
  }>;
  /** 模型调用清单 */
  modelCalls?: Array<{
    callId: string;
    model: string;
    messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
    output: string;
    startedAt: number;
    completedAt?: number;
  }>;
};

/**
 * Convert one OpenAI Chat Completion response + originating messages into a trace.
 *
 * @param input Conversion input.
 * @returns OTel GenAI trace.
 */
export function convertOpenAIChatToTrace(input: {
  traceId: string;
  sessionId?: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  response: OpenAIChatCompletion;
  startTime: string;
  endTime: string;
}): OtelGenAiTrace {
  const span: OtelGenAiSpan = {
    spanId: input.response.id,
    name: `chat ${input.response.model}`,
    kind: "chat",
    attributes: {
      system: "openai",
      model: input.response.model,
      promptTokens: input.response.usage?.prompt_tokens,
      completionTokens: input.response.usage?.completion_tokens,
    },
    input: { messages: input.messages },
    output: { choices: input.response.choices },
    startTime: input.startTime,
    endTime: input.endTime,
    status: "ok",
  };

  return {
    traceId: input.traceId,
    sessionId: input.sessionId,
    name: span.name,
    metadata: { source: "openai-chat" },
    spans: [span],
  };
}

/**
 * Convert one OpenAI Agents SDK Run into a trace with one parent agent span + children.
 *
 * @param run Agent run.
 * @param options Optional metadata.
 * @returns OTel GenAI trace.
 */
export function convertOpenAIAgentRunToTrace(
  run: OpenAIAgentRun,
  options: { sessionId?: string; userId?: string } = {},
): OtelGenAiTrace {
  const spans: OtelGenAiSpan[] = [];
  const startTime = new Date(run.startedAt).toISOString();
  const endTime = run.completedAt ? new Date(run.completedAt).toISOString() : undefined;

  // Parent agent span
  spans.push({
    spanId: run.id,
    name: `agent ${run.agentId}`,
    kind: "agent",
    attributes: { system: "openai-agents" },
    input: { threadId: run.threadId },
    startTime,
    endTime,
    status: run.status === "completed" ? "ok" : run.status === "failed" ? "error" : "ok",
  });

  // Model calls -> chat spans
  for (const mc of run.modelCalls ?? []) {
    spans.push({
      spanId: mc.callId,
      parentSpanId: run.id,
      name: `chat ${mc.model}`,
      kind: "chat",
      attributes: { system: "openai-agents", model: mc.model },
      input: { messages: mc.messages },
      output: mc.output,
      startTime: new Date(mc.startedAt).toISOString(),
      endTime: mc.completedAt ? new Date(mc.completedAt).toISOString() : undefined,
      status: "ok",
    });
  }

  // Tool calls -> tool spans
  for (const tc of run.toolCalls ?? []) {
    spans.push({
      spanId: tc.callId,
      parentSpanId: run.id,
      name: `tool ${tc.toolName}`,
      kind: "tool",
      attributes: { system: "openai-agents", toolName: tc.toolName },
      input: { arguments: tc.arguments },
      output: tc.output,
      startTime: new Date(tc.startedAt).toISOString(),
      endTime: tc.completedAt ? new Date(tc.completedAt).toISOString() : undefined,
      status: tc.status,
    });
  }

  return {
    traceId: run.id,
    sessionId: options.sessionId ?? run.threadId,
    userId: options.userId,
    name: `openai-agent-run ${run.agentId}`,
    metadata: { source: "openai-agents-sdk", agentId: run.agentId },
    spans,
  };
}
