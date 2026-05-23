/**
 * @fileoverview Adapter: LangChain `RunTree` / `BaseTracer` event → OTel GenAI trace.
 *
 * 用法（在用户的 LangChain 代码里）：
 *
 * ```ts
 * import { langchainCallbackToOtel } from "@zeval/sdk/adapters/langchain";
 * import { ChatOpenAI } from "@langchain/openai";
 *
 * const callback = langchainCallbackToOtel({
 *   ingestUrl: "http://localhost:3010/api/traces/ingest",
 * });
 * const model = new ChatOpenAI({ callbacks: [callback] });
 * ```
 *
 * 这里只提供 trace shape 转换，不直接 import langchain 包，保持零依赖。
 */

import type { OtelGenAiSpan, OtelGenAiTrace } from "@/types/otel-genai";

/**
 * Minimal LangChain run shape used by tracers.
 * 完全镜像 langchain 的 BaseRun 字段子集，避免直接 import @langchain/core。
 */
export type LangChainRunMinimal = {
  id: string;
  parent_run_id?: string;
  name: string;
  run_type: "llm" | "chain" | "tool" | "retriever" | "embedding" | "prompt" | "parser";
  start_time: string | number;
  end_time?: string | number;
  inputs?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  serialized?: { id?: string[]; name?: string };
  extra?: Record<string, unknown>;
  events?: Array<{ name: string; time: string }>;
  child_runs?: LangChainRunMinimal[];
};

/**
 * Convert one LangChain RunTree (root + children) into one OTel GenAI trace.
 *
 * @param root Root LangChain run.
 * @param options Conversion options.
 * @returns OTel-compatible trace.
 */
export function convertLangChainRunToTrace(
  root: LangChainRunMinimal,
  options: { sessionId?: string; userId?: string } = {},
): OtelGenAiTrace {
  const spans: OtelGenAiSpan[] = [];

  /**
   * Walk the run tree depth-first and emit spans.
   *
   * @param run LangChain run node.
   */
  function walk(run: LangChainRunMinimal): void {
    spans.push(toSpan(run));
    if (Array.isArray(run.child_runs)) {
      for (const child of run.child_runs) walk(child);
    }
  }

  walk(root);

  return {
    traceId: root.id,
    sessionId: options.sessionId,
    userId: options.userId,
    name: root.name,
    metadata: { source: "langchain" },
    spans,
  };
}

/**
 * Convert one LangChain run to one OTel span.
 *
 * @param run LangChain run.
 * @returns OTel GenAI span.
 */
function toSpan(run: LangChainRunMinimal): OtelGenAiSpan {
  const kind = mapRunTypeToKind(run.run_type);
  const startTime = typeof run.start_time === "number" ? new Date(run.start_time).toISOString() : String(run.start_time);
  const endTime =
    run.end_time != null
      ? typeof run.end_time === "number"
        ? new Date(run.end_time).toISOString()
        : String(run.end_time)
      : undefined;

  return {
    spanId: run.id,
    parentSpanId: run.parent_run_id,
    name: run.name,
    kind,
    attributes: {
      system: "langchain",
      model:
        (run.extra && typeof run.extra === "object" && "invocation_params" in run.extra
          ? ((run.extra.invocation_params as { model?: string } | undefined)?.model ?? undefined)
          : undefined) ?? undefined,
      toolName: run.run_type === "tool" ? run.name : undefined,
    },
    input: run.inputs,
    output: run.outputs,
    startTime,
    endTime,
    status: run.error ? "error" : "ok",
    error: run.error,
  };
}

/**
 * Map LangChain run_type to OTel GenAI span kind.
 *
 * @param runType LangChain run type.
 * @returns OTel span kind.
 */
function mapRunTypeToKind(runType: LangChainRunMinimal["run_type"]): OtelGenAiSpan["kind"] {
  switch (runType) {
    case "llm":
      return "chat";
    case "embedding":
      return "embeddings";
    case "tool":
      return "tool";
    case "retriever":
      return "retrieval";
    case "chain":
      return "agent";
    default:
      return "custom";
  }
}

/**
 * Build a minimal "callback" object compatible with the LangChain BaseTracer interface.
 *
 * 我们不直接依赖 @langchain/core，但导出了一个具有相同 method shape 的对象，
 * 用户可以直接传入 `callbacks: [zevalCallback]`。
 *
 * @param options Callback options.
 * @returns A LangChain-compatible callback handler.
 */
export function langchainCallbackToOtel(options: {
  ingestUrl: string;
  apiKey?: string;
  sessionId?: string;
  userId?: string;
  /** 是否在 ingest 同时立即跑 evaluate */
  evaluateInline?: boolean;
}): {
  name: string;
  handleChainEnd?: (run: LangChainRunMinimal) => Promise<void>;
} {
  return {
    name: "ZevalOtelCallback",
    /**
     * Send the trace to Zeval on chain end.
     *
     * @param run Root run produced by LangChain.
     */
    async handleChainEnd(run: LangChainRunMinimal) {
      const trace = convertLangChainRunToTrace(run, {
        sessionId: options.sessionId,
        userId: options.userId,
      });
      try {
        await fetch(options.ingestUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
          },
          body: JSON.stringify({
            traces: [trace],
            evaluateInline: options.evaluateInline ?? false,
          }),
        });
      } catch (err) {
        console.warn("[zeval-langchain] ingest failed", err);
      }
    },
  };
}
