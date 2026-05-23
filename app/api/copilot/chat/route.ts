/**
 * @fileoverview POST /api/copilot/chat — Eval Copilot turn endpoint.
 *
 * Streams Server-Sent-Events (text/event-stream) of CopilotEvent objects so the
 * UI can render plan/tool_call/tool_result/final progressively.
 *
 * Body:
 *   {
 *     messages: [{ role: "user"|"assistant", content: string }, ...],
 *     attachments?: { rawRows?: RawRow[]; scenarioId?: string; sourceFileName?: string }
 *   }
 */

import { getZeroreRequestContext } from "@/auth/context";
import { runCopilotTurn } from "@/copilot/orchestrator";

/**
 * Handle a copilot chat turn.
 *
 * @param request Incoming HTTP request.
 * @returns SSE stream response.
 */
export async function POST(request: Request) {
  let context;
  try {
    context = getZeroreRequestContext(request);
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "鉴权失败", detail: e instanceof Error ? e.message : String(e) }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: "无效 JSON" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(b.messages)
    ? (b.messages as Array<{ role: "user" | "assistant" | "system"; content: string }>)
    : [];
  if (messages.length === 0) {
    return new Response(JSON.stringify({ error: "messages 不能为空" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  const attachments = b.attachments && typeof b.attachments === "object"
    ? (b.attachments as { rawRows?: unknown[]; scenarioId?: string; sourceFileName?: string })
    : undefined;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        const line = `data: ${JSON.stringify(event)}\n\n`;
        controller.enqueue(encoder.encode(line));
      };
      try {
        await runCopilotTurn(
          { messages, attachments, workspaceId: context.workspaceId },
          send,
        );
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
