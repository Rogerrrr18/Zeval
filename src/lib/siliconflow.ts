/**
 * @fileoverview SiliconFlow chat completion client for subjective evaluation.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { appendJudgeLog } from "@/lib/judgeLog";
import {
  ZEVAL_JUDGE_MAX_TOKENS,
  ZEVAL_JUDGE_TEMPERATURE,
  ZEVAL_JUDGE_TOP_P,
  getPromptVersionForRequestStage,
  getZevalJudgeProfileSnapshot,
} from "@/llm/judgeProfile";

type SiliconFlowMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type SiliconFlowChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: {
    message?: string;
  };
};

const DEFAULT_LLM_RETRY_ATTEMPTS = 3;
const DEFAULT_LLM_TIMEOUT_MS = 45000;

type SiliconFlowLogContext = {
  stage: string;
  runId?: string;
  sessionId?: string;
  segmentId?: string;
  /** Optional per-stage model override. */
  model?: string;
  /** Override default judge temperature for deterministic extraction stages. */
  temperature?: number;
  /** Optional seed for deterministic outputs (intent extraction, etc.). */
  seed?: number;
  /** Provider-specific request extensions, for example search/deep-research flags. */
  providerOptions?: Record<string, unknown>;
  /** Override default max output tokens for long JSON stages such as rubric draft. */
  maxTokens?: number;
  /** Override default request timeout in milliseconds. */
  timeoutMs?: number;
};

/**
 * Execute a chat completion request against SiliconFlow.
 * @param messages OpenAI-compatible chat messages.
 * @param context Logging context for this request stage.
 * @returns Raw model content string.
 */
export async function requestSiliconFlowChatCompletion(
  messages: SiliconFlowMessage[],
  context: SiliconFlowLogContext,
): Promise<string> {
  const config = getSiliconFlowRuntimeConfig();
  const apiKey = config.apiKey;
  const baseUrl = config.baseUrl;
  const primaryModel = context.model?.trim() || config.model;
  const modelVariants = buildModelVariants(primaryModel);
  const providerRequestVariants = buildProviderRequestVariants(primaryModel, messages);

  if (!isUsableApiKey(apiKey)) {
    throw new Error("未配置有效的 ZEVAL_JUDGE_API_KEY / SILICONFLOW_API_KEY，请不要使用 YOUR_API_KEY_HERE 占位符。");
  }

  const startedAt = Date.now();
  const logPrefix = buildLlmLogPrefix(context);
  const promptVersion = getPromptVersionForRequestStage(context.stage);
  const judgeProfile = getZevalJudgeProfileSnapshot();
  const maxAttempts = Math.max(
    resolvePositiveInteger(
      readZevalEnvValue(["ZEVAL_JUDGE_RETRY_ATTEMPTS", "ZEVAL_LLM_RETRY_ATTEMPTS", "SILICONFLOW_RETRY_ATTEMPTS"]),
      DEFAULT_LLM_RETRY_ATTEMPTS,
    ),
    providerRequestVariants.length,
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeoutMs = context.timeoutMs ?? DEFAULT_LLM_TIMEOUT_MS;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const providerVariant =
      providerRequestVariants[(attempt - 1) % providerRequestVariants.length] ?? {
        model: modelVariants[0] ?? config.model,
        messages,
      };
    console.info(
      `${logPrefix} START attempt=${attempt}/${maxAttempts} model=${providerVariant.model} judgeProfile=${judgeProfile.profileVersion} promptVersion=${promptVersion ?? "unversioned"} messages=${providerVariant.messages.length}`,
    );
    try {
      // Some providers / model deployments don't support response_format:json_object
      // and respond with an empty streaming response (choices:[], completion_tokens:0).
      // Set ZEVAL_JUDGE_JSON_MODE=false in .env to disable this parameter and rely
      // solely on the system-prompt instruction to produce JSON output.
      const jsonModeEnabled = resolveOptionalBoolean(
        readZevalEnvValue(["ZEVAL_JUDGE_JSON_MODE", "ZEVAL_LLM_JSON_MODE"]),
      ) ?? true;

      // This provider always returns SSE (even when stream:false), but only
      // produces content tokens when stream:true is explicitly set.  Sending
      // stream:false causes every chunk to have choices:[] with
      // completion_tokens:0.  We read the SSE body regardless via
      // parseSseChatCompletionContent, so forcing stream:true is safe.
      const requestBody: Record<string, unknown> = {
        model: providerVariant.model,
        messages: providerVariant.messages,
        stream: true,
        temperature: context.temperature ?? ZEVAL_JUDGE_TEMPERATURE,
        top_p: ZEVAL_JUDGE_TOP_P,
        max_tokens: context.maxTokens ?? ZEVAL_JUDGE_MAX_TOKENS,
        ...(jsonModeEnabled ? { response_format: { type: "json_object" } } : {}),
        ...(context.providerOptions ?? {}),
      };
      if (typeof context.seed === "number") {
        requestBody.seed = context.seed;
      }
      const enableThinking = resolveOptionalBoolean(
        readZevalEnvValue([
          "ZEVAL_JUDGE_ENABLE_THINKING",
          "ZEVAL_LLM_ENABLE_THINKING",
          "SILICONFLOW_ENABLE_THINKING",
        ]),
      );
      if (typeof enableThinking === "boolean") {
        requestBody.enable_thinking = enableThinking;
      }

      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        cache: "no-store",
      });

      const payload = await parseSiliconFlowResponse(response);
      if (!response.ok) {
        const providerMessage = payload.error?.message ? ` ${payload.error.message}` : "";
        throw new Error(`SiliconFlow 请求失败: ${response.status}${providerMessage}`);
      }

      const content =
        payload.choices?.[0]?.message?.content ??
        payload.choices?.[0]?.message?.reasoning_content;
      if (!content) {
        const providerMessage = payload.error?.message ? ` providerError=${payload.error.message}` : "";
        throw new Error(
          `SiliconFlow 未返回有效内容。${providerMessage} message=${JSON.stringify(payload.choices?.[0]?.message ?? null)}`,
        );
      }

      const durationMs = Date.now() - startedAt;
      console.info(`${logPrefix} SUCCESS attempt=${attempt}/${maxAttempts} durationMs=${durationMs}`);
      void appendJudgeLog({
        ts: new Date().toISOString(),
        stage: context.stage,
        runId: context.runId,
        sessionId: context.sessionId,
        model: providerVariant.model,
        durationMs,
        attempt,
        success: true,
      });
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const durationMs = Date.now() - startedAt;
      console.error(
        `${logPrefix} ERROR attempt=${attempt}/${maxAttempts} durationMs=${durationMs} message=${message}`,
      );
      void appendJudgeLog({
        ts: new Date().toISOString(),
        stage: context.stage,
        runId: context.runId,
        sessionId: context.sessionId,
        model: providerVariant.model,
        durationMs,
        attempt,
        success: false,
        errorMessage: message,
      });
      if (attempt >= maxAttempts || !isRetryableLlmError(error)) {
        throw error;
      }
      await sleep(buildRetryDelayMs(attempt));
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("LLM Judge 重试耗尽。");
}

/**
 * Extract the first JSON object from model output.
 * @param value Raw model output.
 * @returns Parsed JSON object.
 */
export function parseJsonObjectFromLlmOutput(value: string): unknown {
  const normalized = stripMarkdownCodeFence(value.trim());
  try {
    return JSON.parse(normalized);
  } catch {
    const jsonObject = extractFirstBalancedJsonObject(normalized);
    if (!jsonObject) {
      throw new Error("LLM 输出中未找到 JSON 对象。");
    }
    return JSON.parse(jsonObject);
  }
}

/**
 * Extract the first balanced JSON object from model output.
 * @param value Raw model output that may include extra text after JSON.
 * @returns First complete JSON object string, or null when absent.
 */
/**
 * Remove optional Markdown code fences around model JSON output.
 *
 * @param value Raw model output.
 * @returns Fence-stripped text.
 */
function stripMarkdownCodeFence(value: string): string {
  const fenced = value.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced?.[1]?.trim() ?? value;
}

function extractFirstBalancedJsonObject(value: string): string | null {
  const start = value.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }

  return null;
}

/**
 * Build a concise log prefix for one LLM request.
 * @param context Logging context for the current request.
 * @returns Structured log prefix.
 */
function buildLlmLogPrefix(context: SiliconFlowLogContext): string {
  const parts = ["[LLM]", `stage=${context.stage}`];
  if (context.runId) {
    parts.push(`runId=${context.runId}`);
  }
  if (context.sessionId) {
    parts.push(`sessionId=${context.sessionId}`);
  }
  if (context.segmentId) {
    parts.push(`segmentId=${context.segmentId}`);
  }
  return parts.join(" ");
}

/**
 * Build model/message combinations for retrying brittle provider responses.
 * @param primaryModel Primary configured model.
 * @param messages Original chat messages.
 * @returns Ordered request variants.
 */
function buildProviderRequestVariants(
  primaryModel: string,
  messages: SiliconFlowMessage[],
): Array<{ model: string; messages: SiliconFlowMessage[] }> {
  const modelVariants = buildModelVariants(primaryModel);
  const messageVariants = buildProviderMessageVariants(messages);
  // Interleave models across message variants so that when the primary model
  // consistently fails (e.g. it doesn't support response_format:json_object and
  // returns streaming chunks with choices:[] and completion_tokens:0), the
  // fallback model is tried on the NEXT attempt rather than after all message
  // variants of the primary model are exhausted.
  //
  // Old order (block): [mini+v1, mini+v2, mini+v3, full+v1, full+v2, full+v3]
  // New order (interleaved): [mini+v1, full+v1, mini+v2, full+v2, mini+v3, full+v3]
  return messageVariants.flatMap((variant) => modelVariants.map((model) => ({ model, messages: variant })));
}

/**
 * Build model fallback order from root .env.
 * @param primaryModel Primary model.
 * @returns Deduplicated model list.
 */
function buildModelVariants(primaryModel: string): string[] {
  const fallbackModels =
    readZevalEnvValue(["ZEVAL_JUDGE_FALLBACK_MODELS", "ZEVAL_LLM_FALLBACK_MODELS", "SILICONFLOW_FALLBACK_MODELS"])
      ?.split(",")
      .map((model) => model.trim())
      .filter(Boolean) ?? [];
  return dedupeStrings([primaryModel, ...fallbackModels]);
}

/**
 * Build message variants for OpenAI-compatible gateways with brittle system-role handling.
 * @param messages Original chat messages.
 * @returns Provider-ready message variants in retry order.
 */
function buildProviderMessageVariants(messages: SiliconFlowMessage[]): SiliconFlowMessage[][] {
  const flattenSystemPrompt =
    resolveOptionalBoolean(
      readZevalEnvValue([
        "ZEVAL_JUDGE_FLATTEN_SYSTEM_PROMPT",
        "ZEVAL_LLM_FLATTEN_SYSTEM_PROMPT",
        "SILICONFLOW_FLATTEN_SYSTEM_PROMPT",
      ]),
    ) ?? false;
  if (!flattenSystemPrompt || !messages.some((message) => message.role === "system")) {
    return [messages];
  }

  const systemContent = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const withoutSystem = messages.filter((message) => message.role !== "system");
  const firstUserIndex = withoutSystem.findIndex((message) => message.role === "user");
  const systemBlock = `[系统指令]\n${systemContent}`;
  const roleLabeledMessage: SiliconFlowMessage = {
    role: "user",
    content: messages.map((message) => `[${message.role}]\n${message.content}`).join("\n\n"),
  };
  if (firstUserIndex < 0) {
    return [[{ role: "user", content: systemBlock }, ...withoutSystem], messages, [roleLabeledMessage]];
  }

  const flattened = withoutSystem.map((message, index) =>
    index === firstUserIndex
      ? {
          ...message,
          content: `${systemBlock}\n\n[用户输入]\n${message.content}`,
        }
      : message,
  );
  return [flattened, messages, [roleLabeledMessage]];
}

type SiliconFlowRuntimeConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

let cachedEnvConfig: Partial<SiliconFlowRuntimeConfig> | null = null;
let cachedRootEnvFile: Record<string, string> | null = null;
let hasLoggedEnvFallback = false;

/**
 * Resolve runtime config from process.env first, then local .env, then example fallback.
 * Zeval-prefixed variables are preferred; SiliconFlow-prefixed variables remain
 * backward-compatible aliases for existing local environments.
 *
 * @returns Stable SiliconFlow runtime config.
 */
function getSiliconFlowRuntimeConfig(): SiliconFlowRuntimeConfig {
  const envConfig = readEnvConfig();
  const apiKey =
    readZevalEnvValue(["ZEVAL_JUDGE_API_KEY", "ZEVAL_LLM_API_KEY", "SILICONFLOW_API_KEY"]) ??
    envConfig.apiKey;
  const baseUrl =
    readZevalEnvValue(["ZEVAL_JUDGE_BASE_URL", "ZEVAL_LLM_BASE_URL", "SILICONFLOW_BASE_URL"]) ??
    envConfig.baseUrl ??
    "https://api.siliconflow.cn/v1";
  const model =
    readZevalEnvValue(["ZEVAL_JUDGE_MODEL", "ZEVAL_LLM_MODEL", "SILICONFLOW_MODEL"]) ??
    envConfig.model ??
    "Qwen/Qwen3.5-27B";

  if (!isUsableApiKey(apiKey)) {
    throw new Error("未配置有效的 ZEVAL_JUDGE_API_KEY / SILICONFLOW_API_KEY，请不要使用 YOUR_API_KEY_HERE 占位符。");
  }

  if (
    !process.env.ZEVAL_JUDGE_API_KEY &&
    !process.env.ZEVAL_LLM_API_KEY &&
    !process.env.SILICONFLOW_API_KEY &&
    envConfig.apiKey &&
    !hasLoggedEnvFallback
  ) {
    console.warn("[LLM] Using .env fallback for Zeval judge credentials.");
    hasLoggedEnvFallback = true;
  }

  return {
    apiKey,
    baseUrl,
    model,
  };
}

/**
 * Parse a provider response body while preserving the HTTP status for errors.
 * @param response Fetch response from SiliconFlow.
 * @returns Parsed provider payload.
 */
async function parseSiliconFlowResponse(response: Response): Promise<SiliconFlowChatResponse> {
  const text = await response.text();
  try {
    return JSON.parse(text) as SiliconFlowChatResponse;
  } catch {
    const streamedContent = parseSseChatCompletionContent(text);
    if (streamedContent) {
      return { choices: [{ message: { content: streamedContent } }] };
    }
    const preview = text.replace(/\s+/g, " ").slice(0, 180);
    return {
      error: {
        message: `SiliconFlow 返回了非 JSON 响应: ${response.status}${preview ? ` preview=${preview}` : ""}`,
      },
    };
  }
}

/**
 * Read one environment value from process.env first, then root .env.
 * @param keys Candidate environment keys in priority order.
 * @returns First non-empty configured value.
 */
export function readZevalEnvValue(keys: string[]): string | undefined {
  const fileEnv = readRootEnvFile();
  for (const key of keys) {
    const value = process.env[key] ?? fileEnv[key];
    if (value !== undefined && value.trim() !== "") {
      return value;
    }
  }
  return undefined;
}

/**
 * Extract concatenated assistant content from an SSE chat-completion response.
 * @param text Raw text/event-stream response body.
 * @returns Concatenated content, or null when no content chunk exists.
 */
function parseSseChatCompletionContent(text: string): string | null {
  const parts: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") {
      continue;
    }

    try {
      const chunk = JSON.parse(data) as { choices?: unknown };
      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      for (const choice of choices) {
        if (!choice || typeof choice !== "object") {
          continue;
        }
        const item = choice as {
          delta?: { content?: unknown; reasoning_content?: unknown };
          message?: { content?: unknown; reasoning_content?: unknown };
          text?: unknown;
        };
        const content =
          item.delta?.content ??
          item.delta?.reasoning_content ??
          item.message?.content ??
          item.message?.reasoning_content ??
          item.text;
        if (typeof content === "string") {
          parts.push(content);
        }
      }
    } catch {
      continue;
    }
  }

  const content = parts.join("").trim();
  return content.length > 0 ? content : null;
}

/**
 * Validate that a configured API key is not empty or a documented placeholder.
 * @param value Raw API key value.
 * @returns Whether the key can be used for a provider request.
 */
function isUsableApiKey(value: string | undefined): value is string {
  if (!value?.trim()) {
    return false;
  }
  return !/^(YOUR_API_KEY_HERE|REPLACE_ME|TODO|CHANGEME)$/i.test(value.trim());
}

/**
 * Parse an optional boolean environment variable.
 * @param value Raw environment variable value.
 * @returns Boolean when explicitly configured, otherwise undefined.
 */
function resolveOptionalBoolean(value: string | undefined): boolean | undefined {
  if (value === undefined || value.trim() === "") {
    return undefined;
  }
  if (/^(1|true|yes)$/i.test(value.trim())) {
    return true;
  }
  if (/^(0|false|no)$/i.test(value.trim())) {
    return false;
  }
  return undefined;
}

/**
 * Resolve a positive integer environment override.
 * @param value Raw environment value.
 * @param fallback Fallback when the value is absent or invalid.
 * @returns Positive integer.
 */
function resolvePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Decide whether one LLM error is transient enough to retry.
 * @param error Error thrown by fetch or provider validation.
 * @returns Whether the request should be retried.
 */
function isRetryableLlmError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    /abort|timeout|timed out|fetch failed|network/i.test(message) ||
    /SiliconFlow 未返回有效内容/.test(message) ||
    /SiliconFlow 请求失败: (408|409|425|429|5\d\d)/.test(message) ||
    /非 JSON 响应: (408|409|425|429|5\d\d)/.test(message)
  );
}

/**
 * Remove duplicate strings while preserving order.
 * @param values Input values.
 * @returns Deduplicated non-empty strings.
 */
function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(key);
  }
  return result;
}

/**
 * Build a short exponential backoff with jitter for LLM retries.
 * @param attempt Current 1-based attempt number.
 * @returns Delay in milliseconds before the next attempt.
 */
function buildRetryDelayMs(attempt: number): number {
  const base = Math.min(5000, 500 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 250);
}

/**
 * Sleep for a bounded retry delay.
 * @param ms Delay in milliseconds.
 * @returns Promise resolved after the delay.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * Read root .env as a local runtime source.
 * @returns Parsed partial config from .env.
 */
function readEnvConfig(): Partial<SiliconFlowRuntimeConfig> {
  if (cachedEnvConfig) {
    return cachedEnvConfig;
  }

  cachedEnvConfig = readSiliconFlowConfigFromFile(".env");
  return cachedEnvConfig;
}

/**
 * Read SiliconFlow runtime keys from one env-style file.
 * @param fileName Root-level env file name.
 * @returns Parsed partial SiliconFlow config.
 */
function readSiliconFlowConfigFromFile(fileName: string): Partial<SiliconFlowRuntimeConfig> {
  const parsed = readRootEnvFile(fileName);
  return {
    apiKey: parsed.ZEVAL_JUDGE_API_KEY ?? parsed.ZEVAL_LLM_API_KEY ?? parsed.SILICONFLOW_API_KEY,
    baseUrl: parsed.ZEVAL_JUDGE_BASE_URL ?? parsed.ZEVAL_LLM_BASE_URL ?? parsed.SILICONFLOW_BASE_URL,
    model: parsed.ZEVAL_JUDGE_MODEL ?? parsed.ZEVAL_LLM_MODEL ?? parsed.SILICONFLOW_MODEL,
  };
}

/**
 * Read one root env file and cache the default .env lookup.
 * @param fileName Root-level env file name.
 * @returns Parsed env key-value map.
 */
function readRootEnvFile(fileName = ".env"): Record<string, string> {
  if (fileName === ".env" && cachedRootEnvFile) {
    return cachedRootEnvFile;
  }
  const envPath = path.join(/* turbopackIgnore: true */ process.cwd(), fileName);
  const parsed = existsSync(envPath) ? parseSimpleEnvFile(readFileSync(envPath, "utf8")) : {};
  if (fileName === ".env") {
    cachedRootEnvFile = parsed;
  }
  return parsed;
}

/**
 * Parse a simple .env-style text file into key-value pairs.
 * @param text Raw env file content.
 * @returns Parsed env map.
 */
function parseSimpleEnvFile(text: string): Record<string, string> {
  return text.split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return acc;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return acc;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    acc[key] = value;
    return acc;
  }, {});
}
