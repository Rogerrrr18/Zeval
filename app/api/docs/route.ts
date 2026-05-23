import { NextResponse } from "next/server";

/**
 * Hand-written OpenAPI 3.0 spec for the public Zeval HTTP surface.
 *
 * 这里只列出对外稳定的核心端点；内部 db/auth 工具不暴露。
 */
const OPENAPI_SPEC = {
  openapi: "3.0.3",
  info: {
    title: "Zeval HTTP API",
    version: "0.1.0",
    description:
      "Zeval 提供从 chatlog 上传到调优包生成、回放验证、trace 接入的完整闭环。\n本文档列出对外稳定的端点，可作为 Postman / SDK 生成 / Claude Code 接入参考。",
  },
  servers: [{ url: "http://127.0.0.1:3010", description: "Local dev" }],
  paths: {
    "/api/evaluate": {
      post: {
        summary: "Run the full evaluation pipeline",
        description: "把一组 raw chatlog 跑完整的 enrich → metrics → scenario → bad case 流水线，并可附带扩展指标输入。",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/EvaluateRequest" },
            },
          },
        },
        responses: {
          "200": { description: "Full evaluate response" },
          "400": { description: "Invalid request" },
          "500": { description: "Pipeline error" },
        },
      },
    },
    "/api/traces/ingest": {
      post: {
        summary: "Ingest OTel GenAI semconv-compatible traces",
        description:
          "接 LangChain / OpenAI Agents SDK / OpenInference 等任何 OTel GenAI 兼容的 trace。可选 evaluateInline=true 做实时评估。",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TraceIngestRequest" },
            },
          },
        },
        responses: { "200": { description: "Ingest receipt" } },
      },
      get: {
        summary: "List recent ingested traces",
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
          { name: "sessionId", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Trace list" } },
      },
    },
    "/api/eval-datasets/synthesize": {
      post: {
        summary: "Synthesize evaluation conversations on demand",
        description: "DeepEval Synthesizer 等价物。给场景描述 + 数量，让 LLM 合成可评估的对话样本。",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SynthesizeRequest" },
            },
          },
        },
        responses: { "200": { description: "Generated conversations" } },
      },
    },
    "/api/remediation-packages": {
      post: {
        summary: "Build one remediation package from an evaluate result",
        responses: { "200": { description: "Package or skipped flag" } },
      },
      get: {
        summary: "List saved remediation packages",
        responses: { "200": { description: "Package list" } },
      },
    },
    "/api/validation-runs": {
      post: {
        summary: "Run replay or offline_eval validation against a remediation package",
        responses: { "200": { description: "Validation run" } },
      },
      get: {
        summary: "List saved validation runs",
        responses: { "200": { description: "Validation run list" } },
      },
    },
    "/api/agent-runs": {
      post: {
        summary: "Track an agent execution linked to a remediation package",
        responses: { "200": { description: "Agent run" } },
      },
    },
    "/api/workbench-baselines": {
      post: {
        summary: "Save a workbench baseline snapshot",
        responses: { "200": { description: "Baseline" } },
      },
    },
  },
  components: {
    schemas: {
      RawChatlogRow: {
        type: "object",
        required: ["sessionId", "timestamp", "role", "content"],
        properties: {
          sessionId: { type: "string" },
          timestamp: { type: "string" },
          role: { type: "string", enum: ["user", "assistant", "system"] },
          content: { type: "string" },
        },
      },
      RetrievalContext: {
        type: "object",
        required: ["query", "response", "contexts"],
        properties: {
          query: { type: "string" },
          response: { type: "string" },
          contexts: { type: "array", items: { type: "string" } },
          turnIndex: { type: "integer" },
          sessionId: { type: "string" },
        },
      },
      ToolCallRecord: {
        type: "object",
        required: ["sessionId", "turnIndex", "toolName"],
        properties: {
          sessionId: { type: "string" },
          turnIndex: { type: "integer" },
          toolName: { type: "string" },
          arguments: { type: "object" },
          expectedToolName: { type: "string" },
          expectedArguments: { type: "object" },
          succeeded: { type: "boolean" },
        },
      },
      EvaluateRequest: {
        type: "object",
        required: ["rawRows"],
        properties: {
          rawRows: { type: "array", items: { $ref: "#/components/schemas/RawChatlogRow" } },
          runId: { type: "string" },
          scenarioId: { type: "string" },
          useLlm: { type: "boolean" },
          extendedInputs: {
            type: "object",
            properties: {
              retrievalContexts: { type: "array", items: { $ref: "#/components/schemas/RetrievalContext" } },
              toolCalls: { type: "array", items: { $ref: "#/components/schemas/ToolCallRecord" } },
              retentionFacts: {
                type: "array",
                items: {
                  type: "object",
                  required: ["factId", "introducedAtTurn", "factText"],
                  properties: {
                    factId: { type: "string" },
                    introducedAtTurn: { type: "integer" },
                    factText: { type: "string" },
                  },
                },
              },
              roleProfile: {
                type: "object",
                required: ["roleName", "characterDescription"],
                properties: {
                  roleName: { type: "string" },
                  characterDescription: { type: "string" },
                  prohibitedBehaviors: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
      },
      OtelGenAiSpan: {
        type: "object",
        required: ["spanId", "name", "kind", "startTime"],
        properties: {
          spanId: { type: "string" },
          parentSpanId: { type: "string" },
          name: { type: "string" },
          kind: { type: "string", enum: ["chat", "embeddings", "tool", "agent", "retrieval", "custom"] },
          attributes: { type: "object" },
          input: {},
          output: {},
          startTime: { type: "string" },
          endTime: { type: "string" },
          status: { type: "string", enum: ["ok", "error"] },
        },
      },
      OtelGenAiTrace: {
        type: "object",
        required: ["traceId", "spans"],
        properties: {
          traceId: { type: "string" },
          sessionId: { type: "string" },
          userId: { type: "string" },
          name: { type: "string" },
          metadata: { type: "object" },
          spans: { type: "array", items: { $ref: "#/components/schemas/OtelGenAiSpan" } },
        },
      },
      TraceIngestRequest: {
        type: "object",
        required: ["traces"],
        properties: {
          traces: { type: "array", items: { $ref: "#/components/schemas/OtelGenAiTrace" } },
          evaluateInline: { type: "boolean" },
          useLlm: { type: "boolean" },
          scenarioId: { type: "string" },
        },
      },
      SynthesizeRequest: {
        type: "object",
        required: ["scenarioDescription", "count"],
        properties: {
          scenarioDescription: { type: "string" },
          count: { type: "integer", minimum: 1, maximum: 50 },
          targetFailureModes: { type: "array", items: { type: "string" } },
          turnRange: {
            type: "object",
            properties: {
              min: { type: "integer" },
              max: { type: "integer" },
            },
          },
          styleHint: { type: "string" },
        },
      },
    },
  },
};

/**
 * Serve the OpenAPI spec as JSON.
 */
export function GET() {
  return NextResponse.json(OPENAPI_SPEC);
}
