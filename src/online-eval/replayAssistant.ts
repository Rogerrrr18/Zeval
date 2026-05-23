/**
 * @fileoverview Replace assistant turns by calling an external reply HTTP API.
 */

import type { RawChatlogRow } from "@/types/pipeline";

export type ReplyApiMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export const DEMO_MOCK_REPLY_API = "mock://customer-demo";

/**
 * Resolve POST URL for customer reply API (expects `/reply` contract compatible with mock-customer-api).
 * @param baseUrlOrFull User-provided base or full URL.
 * @returns Absolute reply endpoint.
 */
export function resolveReplyEndpoint(baseUrlOrFull: string): string {
  const trimmed = baseUrlOrFull.trim().replace(/\/$/, "");
  if (trimmed === DEMO_MOCK_REPLY_API) {
    return DEMO_MOCK_REPLY_API;
  }
  if (trimmed.endsWith("/reply")) {
    return trimmed;
  }
  return `${trimmed}/reply`;
}

/**
 * Replay all assistant messages with the built-in product demo reply function.
 * @param rawRows Original transcript rows in conversation order.
 * @returns New raw rows with assistant `content` replaced by deterministic demo replies.
 */
export async function replayAssistantRowsWithDemoMock(rawRows: RawChatlogRow[]): Promise<RawChatlogRow[]> {
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
      throw new Error("assistant 行前缺少 user 话术，无法生成 demo 回复。");
    }

    output.push({ ...row, content: buildDemoMockReply(lastUser.content, history.slice(0, -1)) });
  }

  return output;
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

/**
 * Build a deterministic mock reply for local PM demos.
 * @param userQuery Current user query.
 * @param messages Conversation history before the current user query.
 * @returns Demo assistant reply.
 */
function buildDemoMockReply(userQuery: string, messages: ReplyApiMessage[]): string {
  const latestContent = userQuery || String(messages[messages.length - 1]?.content || "");
  if (/退款|订单|到账/.test(latestContent)) {
    return "已帮您提交退款申请，订单将在 1 到 3 个工作日原路退回；我也会把处理进度同步给您。";
  }
  if (/下一步|怎么办|进度/.test(latestContent)) {
    return "已为您处理好了：退款申请已经提交，您接下来只需要等待到账通知；如果 3 个工作日未到账，我会继续为您跟进。";
  }
  if (/焦虑|害怕|难受|委屈/.test(latestContent)) {
    return "我先接住你的感受。你现在最想解决的，是情绪本身，还是下一步怎么回应对方？";
  }
  if (/主管|汇报|客户|工作/.test(latestContent)) {
    return "可以，我们先把你的目标压缩成一句核心表达，再拆成 3 个沟通点。";
  }
  if (/不懂|什么意思|没明白/.test(latestContent)) {
    return "我换一种更直接的说法，并先回答你刚才那个核心问题。";
  }
  return "收到。我会先总结你的关键诉求，再给一个更具体、可执行的下一步建议。";
}
