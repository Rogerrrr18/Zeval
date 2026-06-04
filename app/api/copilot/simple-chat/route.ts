/**
 * @fileoverview POST /api/copilot/simple-chat — 非流式 Copilot 聊天端点
 *
 * 供 FloatingCopilot 使用，返回完整 JSON 响应。
 */

import { getZeroreRequestContext } from "@/auth/context";
import { runCopilotTurn } from "@/copilot/orchestrator";

export async function POST(request: Request) {
  let context;
  try {
    context = getZeroreRequestContext(request);
  } catch (e) {
    return Response.json(
      { error: "鉴权失败", detail: e instanceof Error ? e.message : String(e) },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "无效 JSON" }, { status: 400 });
  }

  const b = (body ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(b.messages)
    ? (b.messages as Array<{ role: "user" | "assistant" | "system"; content: string }>)
    : [];

  if (messages.length === 0) {
    return Response.json({ error: "messages 不能为空" }, { status: 400 });
  }

  const attachments = b.attachments && typeof b.attachments === "object"
    ? (b.attachments as { rawRows?: unknown[]; scenarioId?: string; sourceFileName?: string })
    : undefined;

  try {
    const chunks: unknown[] = [];
    await runCopilotTurn(
      { messages, attachments, workspaceId: context.workspaceId },
      (event) => { chunks.push(event); }
    );

    // 提取 final 消息
    const finalEvent = chunks.findLast(
      (c) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "final"
    ) as { type: "final"; message: string } | undefined;

    const errorEvent = chunks.findLast(
      (c) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "error"
    ) as { type: "error"; message: string } | undefined;

    if (errorEvent) {
      return Response.json({ error: errorEvent.message }, { status: 500 });
    }

    if (finalEvent) {
      return Response.json({ reply: finalEvent.message });
    }

    return Response.json({ reply: "收到，正在处理中。" });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
