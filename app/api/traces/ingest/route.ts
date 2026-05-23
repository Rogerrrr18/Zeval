import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { listRecentTraces, pushTrace } from "@/observability/traceBuffer";
import { projectGenAiTrace } from "@/observability/traceProjector";
import { runEvaluatePipeline } from "@/pipeline/evaluateRun";
import { otelTraceIngestRequestSchema } from "@/schemas/otel";

/**
 * Ingest one or more OTel GenAI semconv-compatible traces.
 *
 * 用法：
 *  - 接 LangChain / OpenAI Agents SDK 的 trace 直接 POST 进来
 *  - 可选立即跑一次 evaluate（每条 trace 单独评估）
 *
 * @param request Incoming HTTP request.
 */
export async function POST(request: Request) {
  try {
    const context = getZeroreRequestContext(request);
    const parsed = otelTraceIngestRequestSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: "请求体不合法。", details: parsed.error.flatten() },
        { status: 400 },
      );
    }
    const body = parsed.data;
    const ingested: Array<{ traceId: string; ingestedAt: string }> = [];
    const evaluations: Array<{ traceId: string; runId: string; warningCount: number }> = [];

    for (const trace of body.traces) {
      const stored = pushTrace(trace, context.workspaceId);
      ingested.push({ traceId: stored.traceId, ingestedAt: stored.ingestedAt });

      if (body.evaluateInline) {
        const projection = projectGenAiTrace(trace);
        if (projection.rawRows.length === 0) continue;

        const runId = `trace_${trace.traceId}_${Date.now()}`;
        const evaluate = await runEvaluatePipeline(projection.rawRows, {
          useLlm: body.useLlm,
          runId,
          scenarioId: body.scenarioId,
          extendedInputs: {
            retrievalContexts: projection.retrievalContexts,
            toolCalls: projection.toolCalls,
          },
        });
        evaluations.push({
          traceId: trace.traceId,
          runId,
          warningCount: evaluate.meta.warnings.length,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      ingestedCount: ingested.length,
      ingested,
      evaluations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "trace ingest 失败。", detail: message }, { status: 500 });
  }
}

/**
 * List recent traces from the in-memory ring buffer.
 *
 * @param request Incoming HTTP request.
 */
export async function GET(request: Request) {
  try {
    const context = getZeroreRequestContext(request);
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const sessionId = url.searchParams.get("sessionId") ?? undefined;
    const traces = listRecentTraces({ limit, sessionId, workspaceId: context.workspaceId });
    return NextResponse.json({ traces, count: traces.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "读取 trace 失败。", detail: message }, { status: 500 });
  }
}
