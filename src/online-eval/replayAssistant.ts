/**
 * @fileoverview Replace assistant turns by calling an external reply HTTP API.
 */

import type { RawChatlogRow } from "@/types/pipeline";

export type ReplyApiMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * Resolve POST URL for customer reply API.
 * @param baseUrlOrFull User-provided base or full URL.
 * @returns Absolute reply endpoint.
 */
export function resolveReplyEndpoint(baseUrlOrFull: string): string {
  const trimmed = baseUrlOrFull.trim().replace(/\/$/, "");
  if (trimmed.endsWith("/reply")) {
    return trimmed;
  }
  return `${trimmed}/reply`;
}

/**
 * Replay all assistant messages by calling the reply endpoint; user/system rows are preserved.
 * @param rawRows Original transcript rows in conversation order.
 * @param replyEndpoint Full URL to POST JSON `{ messages, userQuery }`.
 * @param options Fetch options.
 * @returns New raw rows with assistant `content` replaced.
 */
export async function replayAssistantRowsWithHttpApi(
  rawRows: RawChatlogRow[],
  replyEndpoint: string,
  options: { timeoutMs?: number } = {},
): Promise<RawChatlogRow[]> {
  const timeoutMs = options.timeoutMs ?? 45_000;
  const output: RawChatlogRow[] = [];

  for (const row of rawRows) {
    if (row.role !== "assistant") {
      output.push({ ...row });
      continue;
    }

    const history = output.map<ReplyApiMessage>((item) => ({
      role: item.role,
      content: item.content,
    }));

    const lastUser = [...history].reverse().find((message) => message.role === "user");
    if (!lastUser) {
      throw new Error("assistant 行前缺少 user 话术，无法调用回复 API。");
    }

    const messages = history.slice(0, -1);
    const userQuery = lastUser.content;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetch(replyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages, userQuery }),
        signal: controller.signal,
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`无法连接回复 API：${replyEndpoint}。请确认客户侧 /reply 服务已启动且地址填写正确。原始错误：${detail}`);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`回复 API 返回 ${response.status}：${text.slice(0, 400)}`);
    }

    const payload = (await response.json()) as { reply?: string; error?: string };
    if (payload.error) {
      throw new Error(String(payload.error));
    }
    const reply = String(payload.reply ?? "").trim();
    if (!reply) {
      throw new Error("回复 API 未返回 reply 字段。");
    }

    output.push({ ...row, content: reply });
  }

  return output;
}
