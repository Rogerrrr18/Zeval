/**
 * @fileoverview SDK re-export of LangChain adapter (decoupled from server-side @/types path).
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

export type OtelGenAiSpanLite = {
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: "chat" | "embeddings" | "tool" | "agent" | "retrieval" | "custom";
  attributes?: Record<string, unknown>;
  input?: unknown;
  output?: unknown;
  startTime: string;
  endTime?: string;
  status?: "ok" | "error";
  error?: string;
};

export type OtelGenAiTraceLite = {
  traceId: string;
  sessionId?: string;
  userId?: string;
  name?: string;
  metadata?: Record<string, unknown>;
  spans: OtelGenAiSpanLite[];
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
): OtelGenAiTraceLite {
  const spans: OtelGenAiSpanLite[] = [];

  /**
   * Walk run tree and collect spans.
   *
   * @param run LangChain run.
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

function toSpan(run: LangChainRunMinimal): OtelGenAiSpanLite {
  const startTime = typeof run.start_time === "number" ? new Date(run.start_time).toISOString() : String(run.start_time);
  const endTime =
    run.end_time != null
      ? typeof run.end_time === "number"
        ? new Date(run.end_time).toISOString()
        : String(run.end_time)
      : undefined;

  const kindMap: Record<LangChainRunMinimal["run_type"], OtelGenAiSpanLite["kind"]> = {
    llm: "chat",
    embedding: "embeddings",
    tool: "tool",
    retriever: "retrieval",
    chain: "agent",
    prompt: "custom",
    parser: "custom",
  };

  return {
    spanId: run.id,
    parentSpanId: run.parent_run_id,
    name: run.name,
    kind: kindMap[run.run_type] ?? "custom",
    attributes: { system: "langchain" },
    input: run.inputs,
    output: run.outputs,
    startTime,
    endTime,
    status: run.error ? "error" : "ok",
    error: run.error,
  };
}

/**
 * Build a LangChain-compatible callback that ingests traces to ZERORE on chain end.
 *
 * @param options Callback options.
 * @returns Callback handler.
 */
export function langchainCallbackToOtel(options: {
  ingestUrl: string;
  apiKey?: string;
  sessionId?: string;
  userId?: string;
  evaluateInline?: boolean;
}): { name: string; handleChainEnd?: (run: LangChainRunMinimal) => Promise<void> } {
  return {
    name: "ZeroreOtelCallback",
    /**
     * Send the trace to ZERORE on chain end.
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
        console.warn("[zerore-langchain] ingest failed", err);
      }
    },
  };
}
