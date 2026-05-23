import http from "node:http";

const PORT = Number(process.env.MOCK_CUSTOMER_API_PORT || 4100);

/**
 * Start a simple mock customer API server.
 */
const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/reply") {
    const payload = await readJsonBody(request);
    const userQuery = String(payload.userQuery || "");
    const messages = Array.isArray(payload.messages) ? payload.messages : [];
    const reply = buildMockReply(userQuery, messages);

    return writeJson(response, 200, {
      reply,
      provider: "mock-demo",
      model: "rule-based",
      latencyMs: 5,
    });
  }

  if (request.method === "GET" && request.url === "/health") {
    return writeJson(response, 200, { ok: true, provider: "mock-demo" });
  }

  return writeJson(response, 404, { error: "Not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[mock-customer-api] customer-demo-api listening on http://127.0.0.1:${PORT}`);
});

/**
 * Build a deterministic mock reply from the latest query.
 * @param {string} userQuery Current user query.
 * @param {Array<{ role?: string, content?: string }>} messages Conversation messages.
 * @returns {string}
 */
function buildMockReply(userQuery, messages) {
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
