/**
 * @fileoverview OpenTelemetry GenAI semconv-compatible trace ingest contracts.
 *
 * 参考：
 *   - https://opentelemetry.io/docs/specs/semconv/gen-ai/
 *   - DeepEval `@observe` decorator 产出的 trace 形态
 *
 * 我们在保持与 OTel 兼容的前提下，也允许 LangChain / OpenAI Agents SDK 的常见字段。
 */

/**
 * 一条 GenAI 语义约定的 span。
 */
export type OtelGenAiSpan = {
  /** trace 内唯一 id */
  spanId: string;
  /** 父 spanId（顶层为空） */
  parentSpanId?: string;
  /** OTel name，例如 "chat gpt-4o" 或 "tool execute" */
  name: string;
  /**
   * OTel 标准类型，对齐 `gen_ai.operation.name`：
   *   - "chat"       chat completion
   *   - "embeddings" 检索向量化
   *   - "tool"       工具调用
   *   - "agent"      agent 顶层 span
   *   - "retrieval"  RAG 检索
   *   - "custom"     自定义
   */
  kind: "chat" | "embeddings" | "tool" | "agent" | "retrieval" | "custom";
  /** 模型/provider/工具名等 */
  attributes?: {
    /** gen_ai.system，例如 "openai" */
    system?: string;
    /** gen_ai.request.model */
    model?: string;
    /** gen_ai.usage.prompt_tokens */
    promptTokens?: number;
    /** gen_ai.usage.completion_tokens */
    completionTokens?: number;
    /** 工具名 */
    toolName?: string;
    /** 自定义键值 */
    [key: string]: unknown;
  };
  /** input payload（messages / tool args / query 等） */
  input?: unknown;
  /** output payload */
  output?: unknown;
  /** ISO 时间 */
  startTime: string;
  /** ISO 时间 */
  endTime?: string;
  /** 状态 */
  status?: "ok" | "error";
  /** 错误信息 */
  error?: string;
};

/**
 * 一次完整的 GenAI trace（一次 user-turn 或一次 agent run）。
 */
export type OtelGenAiTrace = {
  traceId: string;
  /** 业务侧 sessionId（可选；缺失时按 traceId 处理） */
  sessionId?: string;
  /** 业务侧 userId（可选） */
  userId?: string;
  /** 多轮场景下属于哪个 turn */
  turnIndex?: number;
  /** trace 名 */
  name?: string;
  /** trace 级 metadata */
  metadata?: Record<string, unknown>;
  /** 全部 spans */
  spans: OtelGenAiSpan[];
  /** 服务端 ingest 时间戳 */
  ingestedAt?: string;
};

/**
 * 从 trace 提取出的可评估对话片段（送给 evaluate / extendedMetrics）。
 */
export type TraceProjection = {
  /** 提取出的 raw chatlog rows */
  rawRows: Array<{
    sessionId: string;
    timestamp: string;
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  /** 提取出的 retrieval contexts（用于 faithfulness 等） */
  retrievalContexts: Array<{
    contexts: string[];
    query: string;
    response: string;
    turnIndex?: number;
    sessionId?: string;
  }>;
  /** 提取出的 tool calls */
  toolCalls: Array<{
    sessionId: string;
    turnIndex: number;
    toolName: string;
    arguments: Record<string, unknown>;
    succeeded?: boolean;
  }>;
  /** 警告 */
  warnings: string[];
};
