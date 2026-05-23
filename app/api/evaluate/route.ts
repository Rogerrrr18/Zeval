import { NextResponse } from "next/server";
import type { z } from "zod";
import { getZeroreRequestContext, getZevalDataScope } from "@/auth/context";
import { buildEvaluationProjection, persistEvaluationProjection } from "@/db/evaluation-projection";
import { createZeroreDatabase } from "@/db";
import { redactRawRows } from "@/pii/redaction";
import { runEvaluatePipeline } from "@/pipeline/evaluateRun";
import { enqueueLocalJob } from "@/queue";
import { persistEvaluateResult } from "@/persistence/evaluateResultStore";
import { evaluateRequestSchema } from "@/schemas/api";
import type { EvaluationProgressEvent } from "@/types/evaluation-progress";

/**
 * Execute MVP evaluation chain from raw rows.
 * @param request Next.js request object.
 * @returns Unified evaluate payload with enriched rows, metrics, charts, and (optionally) dynamic replay results.
 */
export async function POST(request: Request) {
  try {
    const context = getZeroreRequestContext(request);
    const dataScope = getZevalDataScope(context);
    const streamMode = new URL(request.url).searchParams.get("stream") === "1";
    const parsedBody = evaluateRequestSchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "请求体不合法，请先完成 ingest 并传入 rawRows。" },
        { status: 400 },
      );
    }
    const body = parsedBody.data;

    // Validate dynamic replay prerequisites
    if (body.enableDynamicReplay && !body.agentApiEndpoint) {
      return NextResponse.json(
        { error: "enableDynamicReplay=true 时必须提供 agentApiEndpoint。" },
        { status: 400 },
      );
    }

    const redaction = redactRawRows(body.rawRows);
    const rawRows = redaction.rows;
    const runId = body.runId ?? `run_${Date.now()}`;
    const useLlm = body.useLlm ?? true;
    const judgeRequired = body.judgeRequired ?? true;

    if (judgeRequired && !useLlm) {
      return NextResponse.json(
        { error: "当前产品链路要求 LLM Judge 必须开启，不能以降级模式运行。" },
        { status: 400 },
      );
    }

    if (streamMode) {
      return streamEvaluateRun({
        context,
        rawRows,
        body,
        redactionReport: redaction.report,
        runId,
        useLlm,
        judgeRequired,
      });
    }

    if (body.asyncMode) {
      const job = await enqueueLocalJob({
        workspaceId: context.workspaceId,
        organizationId: context.organizationId,
        projectId: context.projectId,
        type: "evaluate",
        payload: {
          ...body,
          dataScope,
          rawRows,
          runId,
          useLlm,
          judgeRequired,
          piiRedaction: redaction.report,
        },
        maxAttempts: 2,
      });
      return NextResponse.json({ queued: true, job, runId }, { status: 202 });
    }

    console.info(`[EVALUATE] runId=${runId} START messages=${rawRows.length} useLlm=${useLlm} dynamicReplay=${body.enableDynamicReplay}`);
    const response = await runEvaluatePipeline(rawRows, {
      useLlm,
      judgeRequired,
      runId,
      scenarioId: body.scenarioId,
      scenarioContext: body.scenarioContext
        ? {
            scenarioId: body.scenarioId,
            onboardingAnswers: body.scenarioContext.onboardingAnswers,
          }
        : undefined,
      structuredTaskMetrics: body.structuredTaskMetrics,
      trace: body.trace,
      persistArtifact: body.persistArtifact ?? Boolean(body.artifactBaseName),
      artifactBaseName: body.artifactBaseName,
      extendedInputs: body.extendedInputs,
      enableDynamicReplay: body.enableDynamicReplay,
      agentApiEndpoint: body.agentApiEndpoint,
    });
    response.meta.organizationId = context.organizationId;
    response.meta.projectId = context.projectId;
    response.meta.workspaceId = context.workspaceId;
    response.meta.piiRedaction = redaction.report;

    if (redaction.report.redactedFields > 0) {
      response.meta.warnings.push(
        `PII 脱敏已处理 ${redaction.report.redactedFields} 处：${redaction.report.categories.join(", ")}。`,
      );
    }

    await persistCompletedEvaluateResult(response);

    try {
      const projection = buildEvaluationProjection(response, {
        projectId: context.projectId ?? context.workspaceId,
        runId,
        useLlm,
        enableDynamicReplay: body.enableDynamicReplay,
      });
      const database = await createZeroreDatabase();
      await persistEvaluationProjection(database, projection);
      console.info(
        `[EVALUATE] runId=${runId} PROJECTION records=${projection.dbRecords.length} intentSeqs=${projection.summary.intentSequences} evidence=${projection.summary.evidenceSpans}`,
      );
    } catch (projectionError) {
      const projectionMessage =
        projectionError instanceof Error ? projectionError.message : "evaluation projection 未知错误";
      response.meta.warnings.push(`结构化质量信号写入失败：${projectionMessage}`);
      console.warn(`[EVALUATE] runId=${runId} PROJECTION_FAILED ${projectionMessage}`);
    }

    console.info(`[EVALUATE] runId=${runId} DONE dynamicReplayStatus=${response.dynamicReplayStatus} warnings=${response.meta.warnings.length}`);
    return NextResponse.json(response);
  } catch (error) {
    const message = error instanceof Error ? error.message : "evaluate 未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Stream a synchronous evaluation run as SSE stage events followed by result.
 */
function streamEvaluateRun(input: {
  context: ReturnType<typeof getZeroreRequestContext>;
  rawRows: ReturnType<typeof redactRawRows>["rows"];
  body: z.infer<typeof evaluateRequestSchema>;
  redactionReport: ReturnType<typeof redactRawRows>["report"];
  runId: string;
  useLlm: boolean;
  judgeRequired: boolean;
}): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const onProgress = (event: EvaluationProgressEvent) => send(event);
      try {
        console.info(
          `[EVALUATE] runId=${input.runId} STREAM_START messages=${input.rawRows.length} useLlm=${input.useLlm} dynamicReplay=${input.body.enableDynamicReplay}`,
        );
        const response = await runEvaluatePipeline(input.rawRows, {
          useLlm: input.useLlm,
          judgeRequired: input.judgeRequired,
          runId: input.runId,
          scenarioId: input.body.scenarioId,
          scenarioContext: input.body.scenarioContext
            ? {
                scenarioId: input.body.scenarioId,
                onboardingAnswers: input.body.scenarioContext.onboardingAnswers,
              }
            : undefined,
          structuredTaskMetrics: input.body.structuredTaskMetrics,
          trace: input.body.trace,
          persistArtifact: input.body.persistArtifact ?? Boolean(input.body.artifactBaseName),
          artifactBaseName: input.body.artifactBaseName,
          extendedInputs: input.body.extendedInputs,
          enableDynamicReplay: input.body.enableDynamicReplay,
          agentApiEndpoint: input.body.agentApiEndpoint,
          onProgress,
        });
        response.meta.organizationId = input.context.organizationId;
        response.meta.projectId = input.context.projectId;
        response.meta.workspaceId = input.context.workspaceId;
        response.meta.piiRedaction = input.redactionReport;
        if (input.redactionReport.redactedFields > 0) {
          response.meta.warnings.push(
            `PII 脱敏已处理 ${input.redactionReport.redactedFields} 处：${input.redactionReport.categories.join(", ")}。`,
          );
        }
        await persistCompletedEvaluateResult(response);
        try {
          const projection = buildEvaluationProjection(response, {
            projectId: input.context.projectId ?? input.context.workspaceId,
            runId: input.runId,
            useLlm: input.useLlm,
            enableDynamicReplay: input.body.enableDynamicReplay,
          });
          const database = await createZeroreDatabase();
          await persistEvaluationProjection(database, projection);
          console.info(
            `[EVALUATE] runId=${input.runId} STREAM_PROJECTION records=${projection.dbRecords.length} evidence=${projection.summary.evidenceSpans}`,
          );
        } catch (projectionError) {
          const projectionMessage =
            projectionError instanceof Error ? projectionError.message : "evaluation projection 未知错误";
          response.meta.warnings.push(`结构化质量信号写入失败：${projectionMessage}`);
          console.warn(`[EVALUATE] runId=${input.runId} STREAM_PROJECTION_FAILED ${projectionMessage}`);
        }
        send({ type: "result", result: response });
      } catch (error) {
        const message = error instanceof Error ? error.message : "evaluate 未知错误";
        send({ type: "error", message });
      } finally {
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

async function persistCompletedEvaluateResult(
  response: Awaited<ReturnType<typeof runEvaluatePipeline>>,
): Promise<void> {
  try {
    const savedPath = await persistEvaluateResult(response);
    console.info(`[EVALUATE] runId=${response.runId} SAVED path=${savedPath}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "评估结果保存失败";
    response.meta.warnings.push(`评估结果保存失败：${message}`);
    console.warn(`[EVALUATE] runId=${response.runId} SAVE_FAILED ${message}`);
  }
}
