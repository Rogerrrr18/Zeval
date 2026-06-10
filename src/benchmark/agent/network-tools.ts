/**
 * @fileoverview Zeval Agent 网络工具
 *
 * 为 Agent 提供网络访问能力：
 * - web_search: 网络搜索
 * - fetch_url: 抓取网页内容
 * - fetch_api: 调用 API 接口
 */

import type { AgentToolHandler, AgentToolRegistry, AgentToolResult, AgentToolSchema } from "./types";

// ───────────────────────────────────────────────
// Schema 定义
// ───────────────────────────────────────────────

const webSearchSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "web_search",
    description: "网络搜索：使用搜索引擎查询信息",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        limit: { type: "number", description: "返回结果数量上限，默认 5" },
      },
      required: ["query"],
    },
  },
};

const fetchUrlSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "fetch_url",
    description: "抓取网页内容：获取指定 URL 的文本内容",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "目标 URL" },
        maxLength: { type: "number", description: "最大字符数，默认 5000" },
      },
      required: ["url"],
    },
  },
};

const fetchApiSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "fetch_api",
    description: "调用 API 接口：发送 HTTP 请求到指定接口",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "API 地址" },
        method: {
          type: "string",
          description: "HTTP 方法",
          enum: ["GET", "POST", "PUT", "DELETE", "PATCH"],
        },
        headers: { type: "object", description: "请求头" },
        body: { type: "object", description: "请求体（JSON）" },
        timeoutMs: { type: "number", description: "超时时间（毫秒）" },
      },
      required: ["url"],
    },
  },
};

// ───────────────────────────────────────────────
// 工具实现
// ───────────────────────────────────────────────

const webSearchHandler: AgentToolHandler = async (args) => {
  const query = String(args.query ?? "");
  const limit = Math.min(Number(args.limit ?? 5), 10);

  if (!query) {
    return errorResult("web_search", "搜索关键词不能为空");
  }

  try {
    // 使用 Bing / DuckDuckGo 等免费搜索 API
    // 这里用 DuckDuckGo 的 HTML 端点作为演示
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ZevalAgent/1.0)",
        Accept: "text/html",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      return errorResult("web_search", `搜索服务返回错误: ${response.status}`);
    }

    const html = await response.text();

    // 简单解析搜索结果
    const results: Array<{ title: string; url: string; snippet: string }> = [];
    const resultPattern = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi;
    const snippetPattern = /<a[^>]*class="result__snippet"[^>]*>(.*?)<\/a>/gi;

    let match: RegExpExecArray | null;
    const titles: Array<{ url: string; title: string }> = [];
    while ((match = resultPattern.exec(html)) !== null && titles.length < limit) {
      const url = match[1].replace(/^\/l\?\?.*?uddg=/, "").replace(/&rut=.*$/, "");
      const title = stripHtml(match[2]);
      titles.push({ url: decodeURIComponent(url), title });
    }

    const snippets: string[] = [];
    while ((match = snippetPattern.exec(html)) !== null && snippets.length < limit) {
      snippets.push(stripHtml(match[1]));
    }

    for (let i = 0; i < Math.min(titles.length, snippets.length); i++) {
      results.push({
        title: titles[i].title,
        url: titles[i].url,
        snippet: snippets[i],
      });
    }

    return successResult("web_search", {
      query,
      resultCount: results.length,
      results: results.slice(0, limit),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("web_search", `搜索失败: ${message}`);
  }
};

const fetchUrlHandler: AgentToolHandler = async (args) => {
  const url = String(args.url ?? "");
  const maxLength = Math.min(Number(args.maxLength ?? 5000), 10000);

  if (!url) {
    return errorResult("fetch_url", "URL 不能为空");
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ZevalAgent/1.0)",
        Accept: "text/html, text/plain, application/json",
      },
      signal: AbortSignal.timeout(20000),
    });

    if (!response.ok) {
      return errorResult("fetch_url", `HTTP 错误: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") ?? "";
    let content = "";

    if (contentType.includes("application/json")) {
      const json = await response.json();
      content = JSON.stringify(json, null, 2);
    } else {
      const text = await response.text();
      // 移除 HTML 标签
      content = stripHtml(text);
    }

    const truncated = content.length > maxLength ? content.slice(0, maxLength) + "\n... [内容已截断]" : content;

    return successResult("fetch_url", {
      url,
      contentType,
      length: content.length,
      content: truncated,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("fetch_url", `抓取失败: ${message}`);
  }
};

const fetchApiHandler: AgentToolHandler = async (args) => {
  const url = String(args.url ?? "");
  const method = String(args.method ?? "GET").toUpperCase();
  const headers = (args.headers ?? {}) as Record<string, string>;
  const body = args.body as Record<string, unknown> | undefined;
  const timeoutMs = Math.min(Number(args.timeoutMs ?? 15000), 60000);

  if (!url) {
    return errorResult("fetch_api", "URL 不能为空");
  }

  try {
    const options: RequestInit = {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    };

    if (body && ["POST", "PUT", "PATCH"].includes(method)) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(url, options);
    let responseBody: unknown;
    const contentType = response.headers.get("content-type") ?? "";

    if (contentType.includes("application/json")) {
      responseBody = await response.json();
    } else {
      responseBody = await response.text();
    }

    return successResult("fetch_api", {
      url,
      method,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      body: responseBody,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("fetch_api", `API 调用失败: ${message}`);
  }
};

// ───────────────────────────────────────────────
// 注册表
// ───────────────────────────────────────────────

export function createNetworkToolRegistry(): AgentToolRegistry {
  const registry = new Map();
  registry.set("web_search", { schema: webSearchSchema, handler: webSearchHandler });
  registry.set("fetch_url", { schema: fetchUrlSchema, handler: fetchUrlHandler });
  registry.set("fetch_api", { schema: fetchApiSchema, handler: fetchApiHandler });
  return registry;
}

// ───────────────────────────────────────────────
// 辅助函数
// ───────────────────────────────────────────────

function successResult(name: string, result: unknown): AgentToolResult {
  return {
    tool_call_id: "",
    name,
    status: "success",
    result,
  };
}

function errorResult(name: string, error: string): AgentToolResult {
  return {
    tool_call_id: "",
    name,
    status: "error",
    result: null,
    error,
  };
}

function stripHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
