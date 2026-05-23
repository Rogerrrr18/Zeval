/**
 * @fileoverview ZERORE SDK public entry point.
 *
 * Usage:
 *   ```ts
 *   import { ZeroreClient } from "@zerore/sdk";
 *   const zerore = new ZeroreClient({ baseUrl: "http://localhost:3010" });
 *
 *   // 1. evaluate
 *   const result = await zerore.evaluate({ rawRows, scenarioId: "toB-customer-support" });
 *
 *   // 2. ingest a trace from your production agent
 *   await zerore.ingestTrace(trace);
 *
 *   // 3. synthesize evaluation cases
 *   const cases = await zerore.synthesize({ scenarioDescription: "...", count: 10 });
 *   ```
 */

export type RawChatRow = {
  sessionId: string;
  timestamp: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type EvaluateInput = {
  rawRows: RawChatRow[];
  runId?: string;
  scenarioId?: string;
  useLlm?: boolean;
  extendedInputs?: {
    retrievalContexts?: Array<{
      query: string;
      response: string;
      contexts: string[];
      turnIndex?: number;
      sessionId?: string;
    }>;
    toolCalls?: Array<{
      sessionId: string;
      turnIndex: number;
      toolName: string;
      arguments: Record<string, unknown>;
      expectedToolName?: string;
      expectedArguments?: Record<string, unknown>;
      succeeded?: boolean;
    }>;
    retentionFacts?: Array<{ factId: string; introducedAtTurn: number; factText: string }>;
    roleProfile?: { roleName: string; characterDescription: string; prohibitedBehaviors?: string[] };
  };
};

export type EvaluateResponseLite = {
  runId: string;
  meta: { warnings: string[] };
  objectiveMetrics: Record<string, unknown>;
  subjectiveMetrics: Record<string, unknown>;
  extendedMetrics?: Record<string, unknown>;
  badCaseAssets: Array<Record<string, unknown>>;
  scenarioEvaluation: Record<string, unknown> | null;
};

export type ZeroreClientOptions = {
  baseUrl: string;
  apiKey?: string;
  /** Optional workspace header */
  workspaceId?: string;
};

/**
 * High-level client wrapping the ZERORE HTTP API.
 */
export class ZeroreClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;

  constructor(options: ZeroreClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.headers = {
      "content-type": "application/json",
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      ...(options.workspaceId ? { "x-zerore-workspace-id": options.workspaceId } : {}),
    };
  }

  /**
   * Run the full evaluate pipeline.
   *
   * @param input Evaluate input.
   * @returns Evaluate response (lite shape).
   */
  async evaluate(input: EvaluateInput): Promise<EvaluateResponseLite> {
    return this.post<EvaluateResponseLite>("/api/evaluate", input);
  }

  /**
   * Ingest one or more OTel GenAI traces (production observability).
   *
   * @param traces Trace array.
   * @param options Ingest options.
   * @returns Ingest result.
   */
  async ingestTrace(
    traces: unknown[],
    options: { evaluateInline?: boolean; useLlm?: boolean; scenarioId?: string } = {},
  ): Promise<{ ingestedCount: number }> {
    return this.post("/api/traces/ingest", { traces, ...options });
  }

  /**
   * Synthesize evaluation conversations.
   *
   * @param input Synthesis input.
   * @returns Generated conversations + warnings.
   */
  async synthesize(input: {
    scenarioDescription: string;
    targetFailureModes?: string[];
    count?: number;
    turnRange?: { min: number; max: number };
    styleHint?: string;
  }): Promise<{ conversations: unknown[]; count: number; warnings: string[] }> {
    return this.post("/api/eval-datasets/synthesize", input);
  }

  /**
   * Create a remediation package from an evaluate result.
   *
   * @param input Package input.
   * @returns Package response.
   */
  async createRemediationPackage(input: {
    sourceFileName?: string;
    baselineCustomerId?: string;
    selectedCaseKeys?: string[];
    evaluate: Record<string, unknown>;
  }): Promise<{ package?: Record<string, unknown> | null; skipped?: boolean }> {
    return this.post("/api/remediation-packages", input);
  }

  /**
   * Run a validation (replay or offline_eval).
   *
   * @param input Validation input.
   * @returns Validation run snapshot.
   */
  async runValidation(input: {
    packageId: string;
    mode: "replay" | "offline_eval";
    baselineCustomerId?: string;
    replyApiBaseUrl?: string;
    sampleBatchId?: string;
    useLlm?: boolean;
  }): Promise<{ validationRun: Record<string, unknown> }> {
    return this.post("/api/validation-runs", input);
  }

  /**
   * Internal POST helper.
   *
   * @param path API path.
   * @param body JSON body.
   * @returns Parsed response.
   */
  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`POST ${path} -> ${response.status}: ${text.slice(0, 400)}`);
    }
    return JSON.parse(text) as T;
  }
}

export { langchainCallbackToOtel, convertLangChainRunToTrace } from "./adapters/langchain";
export {
  convertOpenAIChatToTrace,
  convertOpenAIAgentRunToTrace,
} from "./adapters/openai";
