/**
 * @fileoverview Base LLM adapter for Benchmark Mode.
 *
 * All agent frameworks (claude_code, codex, hermes, openclaw) share the same
 * underlying OpenAI-compatible API endpoint. The differences are:
 * - system prompt / persona
 * - model selection
 * - output parsing strategy
 */

import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
} from "@/benchmark/types";
import type { AgentAdapter, AgentAdapterConfig, AgentAdapterContext } from "./types";

type OpenAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type OpenAiChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | null;
      reasoning_content?: string | null;
    };
  }>;
  error?: { message?: string };
};

export type BaseAdapterOptions = {
  frameworkId: string;
  systemPrompt: string;
  userPromptTemplate: (taskCase: BenchmarkCase) => string;
  parseOutput: (raw: string, taskCase: BenchmarkCase) => Record<string, unknown> | undefined;
};

/**
 * Build a concrete agent adapter from a configuration object.
 */
export function buildBaseAdapter(options: BaseAdapterOptions): AgentAdapter {
  return {
    frameworkId: options.frameworkId,
    async submit(
      taskCase: BenchmarkCase,
      context: AgentAdapterContext,
      config: AgentAdapterConfig,
    ): Promise<BenchmarkAgentSubmission> {
      const startedAt = new Date().toISOString();
      const startedMs = Date.now();

      const messages: OpenAiMessage[] = [
        { role: "system", content: options.systemPrompt },
        { role: "user", content: options.userPromptTemplate(taskCase) },
      ];

      const response = await callOpenAiCompatibleChat(
        messages,
        context.matrixCell.model,
        config,
      );

      const rawOutput = response.raw;
      const parsedOutput = options.parseOutput(rawOutput, taskCase);
      const completedMs = Date.now();

      return {
        submissionId: `${context.runId}_${context.matrixCell.agentFramework}_${slug(context.matrixCell.model)}_${taskCase.caseId}`,
        runId: context.runId,
        benchmarkId: context.benchmarkId,
        taskId: context.taskId,
        caseId: taskCase.caseId,
        agentFramework: context.matrixCell.agentFramework,
        model: context.matrixCell.model,
        status: "completed",
        rawOutput,
        parsedOutput,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: completedMs - startedMs,
        artifacts: {
          evaluatorResults: {},
        },
      };
    },
  };
}

async function callOpenAiCompatibleChat(
  messages: OpenAiMessage[],
  model: string,
  config: AgentAdapterConfig,
): Promise<{ raw: string }> {
  const timeoutMs = config.timeoutMs ?? 120000;
  const maxRetries = config.maxRetries ?? 3;
  const baseUrl = config.baseUrl.replace(/\/$/, "");

  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.2,
          max_tokens: 2048,
          stream: false,
        }),
        signal: controller.signal,
        cache: "no-store",
      });

      clearTimeout(timer);

      // Handle rate limiting with longer backoff before parsing body
      if (response.status === 429) {
        const retryAfter = Math.min(parseInt(response.headers.get("retry-after") ?? "5", 10), 30);
        const backoffMs = retryAfter * 1000 || Math.min(2000 * Math.pow(2, attempt - 1), 30000);
        console.warn(`[adapter] 429 rate limited (model=${model}), waiting ${backoffMs}ms before retry ${attempt}/${maxRetries}`);
        await sleep(backoffMs);
        continue;
      }

      const payload = (await response.json()) as OpenAiChatResponse;

      if (!response.ok) {
        const msg = payload.error?.message ? ` ${payload.error.message}` : "";
        throw new Error(`API error: ${response.status}${msg}`);
      }

      const content =
        payload.choices?.[0]?.message?.content ??
        payload.choices?.[0]?.message?.reasoning_content;

      if (!content) {
        throw new Error("API returned empty content");
      }

      return { raw: content };
    } catch (error) {
      clearTimeout(timer);
      const message = error instanceof Error ? error.message : String(error);
      // Don't retry on client-side errors (4xx except 429)
      if (message.includes("API error: 4") && !message.includes("429")) {
        throw new Error(`Agent call failed: ${message}`);
      }
      if (attempt === maxRetries) {
        throw new Error(`Agent call failed after ${maxRetries} attempts: ${message}`);
      }
      // Exponential backoff before retry
      await sleep(Math.min(2000 * Math.pow(2, attempt - 1), 15000));
    }
  }

  throw new Error("Unexpected exit from retry loop");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}
