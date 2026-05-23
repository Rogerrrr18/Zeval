/**
 * @fileoverview Project an OTel GenAI trace into Zeval's evaluable inputs.
 *
 * 把不同来源的 trace（OTel/OpenAI/LangChain/手工）拍平成：
 *   - rawRows         (用于 evaluate pipeline)
 *   - retrievalContexts (用于 faithfulness/relevancy 等扩展指标)
 *   - toolCalls       (用于 toolCorrectness)
 */

import type { OtelGenAiSpan, OtelGenAiTrace, TraceProjection } from "@/types/otel-genai";

/**
 * Project an OTel GenAI trace into Zeval evaluable inputs.
 *
 * @param trace OTel-shaped trace.
 * @returns Projection used by the evaluate pipeline + extended metrics.
 */
export function projectGenAiTrace(trace: OtelGenAiTrace): TraceProjection {
  const sessionId = trace.sessionId ?? trace.traceId;
  const warnings: string[] = [];
  const rawRows: TraceProjection["rawRows"] = [];
  const retrievalContexts: TraceProjection["retrievalContexts"] = [];
  const toolCalls: TraceProjection["toolCalls"] = [];

  // 1. Sort spans by startTime to preserve causal order
  const ordered = [...trace.spans].sort((a, b) => parseTime(a.startTime) - parseTime(b.startTime));

  let turnCounter = 0;
  for (const span of ordered) {
    if (span.kind === "chat") {
      // chat span: 提取 messages 作为 rawRows
      const extracted = extractChatMessages(span);
      if (extracted.length === 0) {
        warnings.push(`chat span ${span.spanId} 缺少 messages，跳过`);
        continue;
      }
      const lastUser = [...extracted].reverse().find((m) => m.role === "user");
      const assistantOutput = extractAssistantOutput(span);

      for (const msg of extracted) {
        rawRows.push({
          sessionId,
          timestamp: span.startTime,
          role: msg.role,
          content: msg.content,
        });
      }
      if (assistantOutput) {
        rawRows.push({
          sessionId,
          timestamp: span.endTime ?? span.startTime,
          role: "assistant",
          content: assistantOutput,
        });
      }

      // 如果同 trace 内有 retrieval span，把它们与该 chat 配对
      const associatedRetrievals = ordered
        .filter((s) => s.kind === "retrieval" && parseTime(s.endTime ?? s.startTime) <= parseTime(span.startTime))
        .map((s) => extractRetrievalDocs(s))
        .flat();

      if (lastUser && assistantOutput) {
        retrievalContexts.push({
          query: lastUser.content,
          response: assistantOutput,
          contexts: associatedRetrievals,
          turnIndex: turnCounter,
          sessionId,
        });
        turnCounter += 1;
      }
    } else if (span.kind === "tool") {
      const args = extractToolArguments(span);
      toolCalls.push({
        sessionId,
        turnIndex: turnCounter,
        toolName: span.attributes?.toolName ?? span.name,
        arguments: args,
        succeeded: span.status === "ok",
      });
    }
  }

  return { rawRows, retrievalContexts, toolCalls, warnings };
}

/**
 * Parse ISO timestamp into ms.
 *
 * @param value ISO string.
 * @returns Numeric ms or 0 when invalid.
 */
function parseTime(value?: string): number {
  if (!value) return 0;
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : 0;
}

/**
 * Extract chat messages from a chat span (OpenAI / Anthropic / OTel-compatible shapes).
 *
 * @param span OTel chat span.
 * @returns Normalized chat messages.
 */
function extractChatMessages(span: OtelGenAiSpan): Array<{ role: "user" | "assistant" | "system"; content: string }> {
  const result: Array<{ role: "user" | "assistant" | "system"; content: string }> = [];
  const input = span.input as unknown;
  if (!input) return result;

  // Common shape: { messages: [{role, content}, ...] }
  if (typeof input === "object" && input !== null && "messages" in input) {
    const messages = (input as { messages?: unknown }).messages;
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (typeof msg === "object" && msg !== null) {
          const role = (msg as { role?: string }).role;
          const content = extractMessageContent((msg as { content?: unknown }).content);
          if (role === "user" || role === "assistant" || role === "system") {
            if (content) result.push({ role, content });
          }
        }
      }
    }
  }

  // Common shape (LangChain): { input: "..." } only-user
  if (result.length === 0 && typeof input === "object" && input !== null && "input" in input) {
    const text = (input as { input?: unknown }).input;
    if (typeof text === "string") {
      result.push({ role: "user", content: text });
    }
  }

  return result;
}

/**
 * Extract content string from a possibly-object content field.
 *
 * @param value Raw content.
 * @returns Plain text content or empty string.
 */
function extractMessageContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    // OpenAI multi-part content blocks
    return value
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "object" && part !== null && "text" in part) {
          return String((part as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .join(" ")
      .trim();
  }
  if (typeof value === "object" && value !== null && "text" in value) {
    return String((value as { text?: unknown }).text ?? "");
  }
  return "";
}

/**
 * Extract assistant output from a chat span.
 *
 * @param span OTel chat span.
 * @returns Assistant output text or null.
 */
function extractAssistantOutput(span: OtelGenAiSpan): string | null {
  const output = span.output as unknown;
  if (!output) return null;
  if (typeof output === "string") return output;
  if (typeof output === "object" && output !== null) {
    // OpenAI shape: { choices: [{ message: { content } }] }
    const choices = (output as { choices?: unknown }).choices;
    if (Array.isArray(choices) && choices.length > 0) {
      const first = choices[0];
      if (typeof first === "object" && first !== null) {
        const message = (first as { message?: { content?: unknown } }).message;
        if (message && typeof message.content !== "undefined") {
          return extractMessageContent(message.content);
        }
      }
    }
    // LangChain shape: { output: "..." } or { content: "..." }
    if ("output" in output) {
      const text = (output as { output?: unknown }).output;
      if (typeof text === "string") return text;
    }
    if ("content" in output) {
      return extractMessageContent((output as { content?: unknown }).content);
    }
  }
  return null;
}

/**
 * Extract documents from a retrieval span.
 *
 * @param span OTel retrieval span.
 * @returns Document strings.
 */
function extractRetrievalDocs(span: OtelGenAiSpan): string[] {
  const output = span.output as unknown;
  if (!output) return [];
  if (Array.isArray(output)) {
    return output
      .map((doc) => {
        if (typeof doc === "string") return doc;
        if (typeof doc === "object" && doc !== null) {
          if ("page_content" in doc) return String((doc as { page_content?: unknown }).page_content ?? "");
          if ("text" in doc) return String((doc as { text?: unknown }).text ?? "");
        }
        return "";
      })
      .filter(Boolean);
  }
  if (typeof output === "object" && output !== null && "documents" in output) {
    const docs = (output as { documents?: unknown }).documents;
    if (Array.isArray(docs)) {
      return docs.map((d) => String(d)).filter(Boolean);
    }
  }
  return [];
}

/**
 * Extract tool arguments from a tool span.
 *
 * @param span OTel tool span.
 * @returns Argument record.
 */
function extractToolArguments(span: OtelGenAiSpan): Record<string, unknown> {
  const input = span.input as unknown;
  if (!input) return {};
  if (typeof input === "object" && input !== null) {
    if ("arguments" in input) {
      const args = (input as { arguments?: unknown }).arguments;
      if (typeof args === "object" && args !== null) {
        return args as Record<string, unknown>;
      }
      if (typeof args === "string") {
        try {
          return JSON.parse(args);
        } catch {
          return { raw: args };
        }
      }
    }
    return input as Record<string, unknown>;
  }
  return {};
}
