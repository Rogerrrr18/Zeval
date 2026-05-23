import http from "node:http";
import { readSiliconFlowConfig } from "./shared-env.mjs";

const PORT = Number(process.env.SILICONFLOW_CUSTOMER_API_PORT || 4200);
const config = readSiliconFlowConfig();

if (!config.apiKey) {
  throw new Error("未找到可用的 SILICONFLOW_API_KEY / ZEVAL_JUDGE_API_KEY，请检查项目根目录的 .env。");
}

/**
 * Start a mock customer API backed by SiliconFlow.
 */
const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/reply") {
    const startedAt = Date.now();
    try {
      const payload = await readJsonBody(request);
      const userQuery = String(payload.userQuery || "");
      const messages = Array.isArray(payload.messages) ? payload.messages : [];
      const reply = await generateReplyWithSiliconFlow(messages, userQuery);

      return writeJson(response, 200, {
        reply,
        provider: "siliconflow",
        model: config.model,
        latencyMs: Date.now() - startedAt,
      });
    } catch (error) {
      return writeJson(response, 500, {
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  if (request.method === "GET" && request.url === "/health") {
    return writeJson(response, 200, {
      ok: true,
      provider: "siliconflow",
      model: config.model,
    });
  }

  return writeJson(response, 404, { error: "Not found" });
});

server.listen(PORT, () => {
  console.log(`[mock-customer-api] siliconflow-customer-api listening on http://127.0.0.1:${PORT}`);
});

/**
 * Generate one reply via SiliconFlow.
 * @param {Array<{ role?: string, content?: string }>} messages Conversation history.
 * @param {string} userQuery Current user query.
 * @returns {Promise<string>}
 */
async function generateReplyWithSiliconFlow(messages, userQuery) {
  const normalizedMessages = normalizeMessages(messages, userQuery);
  const variants = buildRequestVariants(normalizedMessages);
  let lastError = "SiliconFlow 未返回有效内容。";

  for (const variant of variants) {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: variant.model,
        messages: variant.messages,
        stream: false,
        enable_thinking: false,
        temperature: 0.5,
        top_p: 0.7,
        max_tokens: 600,
      }),
    });

    const payload = await parseProviderResponse(response);
    if (!response.ok) {
      lastError = payload?.error?.message || `SiliconFlow 请求失败: ${response.status}`;
      continue;
    }

    const content =
      payload?.choices?.[0]?.message?.content ||
      payload?.choices?.[0]?.message?.reasoning_content;

    if (content) {
      return String(content).trim();
    }
    lastError = `SiliconFlow 未返回有效内容。message=${JSON.stringify(payload?.choices?.[0]?.message ?? null)}`;
  }

  throw new Error(lastError);
}

/**
 * Build model/message retry variants for the customer reply LLM.
 * @param {Array<{ role: 'system' | 'user' | 'assistant', content: string }>} normalizedMessages Conversation messages.
 * @returns {Array<{ model: string, messages: Array<{ role: 'system' | 'user' | 'assistant', content: string }> }>}
 */
function buildRequestVariants(normalizedMessages) {
  const systemMessage = {
    role: "system",
    content:
      "你是一个客户侧对话产品的回复函数。请基于上下文给出自然、共情、尽量减少说教感的中文回复。直接输出回复正文，不要输出 JSON。",
  };
  const messages = [systemMessage, ...normalizedMessages];
  const messageVariants = config.flattenSystemPrompt ? buildMessageVariants(messages) : [messages];
  const models = dedupeStrings([config.model, ...(config.fallbackModels || [])]);
  return models.flatMap((model) => messageVariants.map((variant) => ({ model, messages: variant })));
}

/**
 * Build message variants that avoid brittle system-role handling in local gateways.
 * @param {Array<{ role: 'system' | 'user' | 'assistant', content: string }>} messages Original messages.
 * @returns {Array<Array<{ role: 'system' | 'user' | 'assistant', content: string }>>}
 */
function buildMessageVariants(messages) {
  const withoutSystem = messages.filter((message) => message.role !== "system");
  const systemContent = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const firstUserIndex = withoutSystem.findIndex((message) => message.role === "user");
  const systemBlock = `[系统指令]\n${systemContent}`;
  const flattened =
    firstUserIndex < 0
      ? [{ role: "user", content: systemBlock }, ...withoutSystem]
      : withoutSystem.map((message, index) =>
          index === firstUserIndex
            ? { ...message, content: `${systemBlock}\n\n[用户输入]\n${message.content}` }
            : message,
        );
  const roleLabeled = [
    {
      role: "user",
      content: messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n"),
    },
  ];
  return [flattened, messages, roleLabeled];
}

/**
 * Parse one provider response as JSON or SSE content.
 * @param {Response} response Fetch response.
 * @returns {Promise<Record<string, any>>}
 */
async function parseProviderResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const content = parseSseContent(text);
    if (content) {
      return { choices: [{ message: { content } }] };
    }
    return { error: { message: `SiliconFlow 返回了非 JSON 响应: ${response.status}` } };
  }
}

/**
 * Extract content from text/event-stream chat chunks.
 * @param {string} text Raw provider body.
 * @returns {string | null}
 */
function parseSseContent(text) {
  const parts = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") continue;
    try {
      const chunk = JSON.parse(data);
      for (const choice of Array.isArray(chunk.choices) ? chunk.choices : []) {
        const content =
          choice?.delta?.content ||
          choice?.delta?.reasoning_content ||
          choice?.message?.content ||
          choice?.message?.reasoning_content ||
          choice?.text;
        if (typeof content === "string") parts.push(content);
      }
    } catch {
      continue;
    }
  }
  const content = parts.join("").trim();
  return content.length > 0 ? content : null;
}

/**
 * Deduplicate strings while preserving order.
 * @param {string[]} values Input strings.
 * @returns {string[]}
 */
function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(key);
  }
  return result;
}

/**
 * Normalize mixed payload into chat messages.
 * @param {Array<{ role?: string, content?: string }>} messages Conversation history.
 * @param {string} userQuery Current user query.
 * @returns {Array<{ role: 'system' | 'user' | 'assistant', content: string }>}
 */
function normalizeMessages(messages, userQuery) {
  const normalized = messages
    .filter((item) => item && typeof item.content === "string")
    .map((item) => ({
      role: normalizeRole(item.role),
      content: String(item.content),
    }));

  if (userQuery) {
    normalized.push({
      role: "user",
      content: userQuery,
    });
  }

  return normalized;
}

/**
 * Normalize an incoming role into a valid chat role.
 * @param {string | undefined} role Incoming role.
 * @returns {'system' | 'user' | 'assistant'}
 */
function normalizeRole(role) {
  return role === "system" || role === "assistant" ? role : "user";
}

/**
 * Read a JSON request body.
 * @param {import('node:http').IncomingMessage} request HTTP request.
 * @returns {Promise<Record<string, unknown>>}
 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

/**
 * Write a JSON response.
 * @param {import('node:http').ServerResponse} response HTTP response.
 * @param {number} statusCode HTTP status code.
 * @param {unknown} payload JSON payload.
 */
function writeJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}
