import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { createDatasetStore } from "@/eval-datasets/storage";
import { readZevalEnvValue } from "@/lib/siliconflow";
import { saveOnlineEvalRun } from "@/lib/onlineEvalRunStore";
import { runEvaluatePipeline } from "@/pipeline/evaluateRun";
import {
  DEMO_MOCK_REPLY_API,
  replayAssistantRowsWithDemoMock,
  replayAssistantRowsWithHttpApi,
  resolveReplyEndpoint,
} from "@/online-eval/replayAssistant";
import { createWorkbenchBaselineStore } from "@/workbench";
import { onlineReplayEvaluateBodySchema } from "@/schemas/online-eval";
import type { DatasetCaseRecord, SampleBatchRecord } from "@/eval-datasets/storage/types";
import type { ChatRole, EvaluateResponse, RawChatlogRow } from "@/types/pipeline";

/**
 * Replay assistant lines via HTTP reply API, then run the full evaluate pipeline.
 * @param request JSON body with baselineRef or rawRows and optional replyApiBaseUrl.
 */
export async function POST(request: Request) {
  try {
    const parsed = onlineReplayEvaluateBodySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;
    const context = getZeroreRequestContext(request);

    let rawRows = body.rawRows;
    let baselineEvaluate: EvaluateResponse | undefined;
    let sampleBatch: SampleBatchRecord | undefined;
    let sampleCases: DatasetCaseRecord[] | undefined;
    if (body.baselineRef) {
      const store = createWorkbenchBaselineStore({ workspaceId: context.workspaceId });
      const snapshot = await store.read(body.baselineRef.customerId, body.baselineRef.runId);
      if (!snapshot) {
        return NextResponse.json({ error: "未找到基线快照，请检查 customerId 与 runId。" }, { status: 404 });
      }
      rawRows = snapshot.rawRows;
      baselineEvaluate = snapshot.evaluate;
    }
    if (body.sampleBatchId) {
      const store = createDatasetStore({ workspaceId: context.workspaceId });
      const loadedBatch = await store.getSampleBatch(body.sampleBatchId);
      if (!loadedBatch) {
        return NextResponse.json({ error: `未找到 sample batch: ${body.sampleBatchId}` }, { status: 404 });
      }
      const loadedCases = await Promise.all(loadedBatch.caseIds.map((caseId) => store.getCaseById(caseId)));
      sampleCases = loadedCases.filter((item): item is DatasetCaseRecord => Boolean(item?.transcript));
      if (sampleCases.length === 0) {
        return NextResponse.json({ error: "sample batch 中没有带 transcript 的可回放 case。" }, { status: 400 });
      }
      sampleBatch = loadedBatch;
      rawRows = buildRawRowsFromDatasetCases(sampleCases);
    }

    if (!rawRows?.length) {
      return NextResponse.json({ error: "rawRows 为空。" }, { status: 400 });
    }

    const baseUrl =
      body.replyApiBaseUrl?.trim() ||
      readZevalEnvValue(["SILICONFLOW_CUSTOMER_API_URL", "ZEVAL_CUSTOMER_API_URL"])?.trim() ||
      "http://127.0.0.1:4200";
    const replyEndpoint = resolveReplyEndpoint(baseUrl);

    const replayedRows =
      replyEndpoint === DEMO_MOCK_REPLY_API
        ? await replayAssistantRowsWithDemoMock(rawRows)
        : await replayAssistantRowsWithHttpApi(rawRows, replyEndpoint, {
            timeoutMs: body.replyTimeoutMs,
          });

    const runId = body.runId ?? `online_${Date.now()}`;
    const scenarioId = body.scenarioId ?? baselineEvaluate?.scenarioEvaluation?.scenarioId;
    const evaluate = await runEvaluatePipeline(replayedRows, {
      useLlm: body.useLlm ?? true,
      runId,
      scenarioId,
    });
    evaluate.meta.workspaceId = context.workspaceId;

    // Fire-and-forget: persist run to .zeval-db/online-eval-runs/{runId}.json
    void saveOnlineEvalRun({
      runId: evaluate.runId,
      createdAt: new Date().toISOString(),
      replyEndpoint,
      replayedRowCount: replayedRows.length,
      ...(body.baselineRef?.runId ? { baselineRunId: body.baselineRef.runId } : {}),
      ...(body.sampleBatchId ? { sampleBatchId: body.sampleBatchId } : {}),
      evaluate,
    });

    return NextResponse.json({
      runId: evaluate.runId,
      replyEndpoint,
      replayedRowCount: replayedRows.length,
      baselineRunId: body.baselineRef?.runId,
      baselineEvaluate,
      sampleBatch,
      sampleCases,
      sampleBaselineSummary: sampleCases ? summarizeSampleCases(sampleCases) : undefined,
      evaluate,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "在线回放评估失败。", detail: message }, { status: 500 });
  }
}

/**
 * Convert stored dataset case transcripts into replayable raw chatlog rows.
 * @param cases Dataset cases with transcript strings.
 * @returns Raw rows with synthetic timestamps.
 */
function buildRawRowsFromDatasetCases(cases: DatasetCaseRecord[]): RawChatlogRow[] {
  return cases.flatMap((datasetCase, caseIndex) => {
    const rows = parseStoredTranscript(datasetCase.transcript ?? "");
    return rows.map((row, rowIndex) => ({
      sessionId: datasetCase.caseId,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, caseIndex, rowIndex)).toISOString(),
      role: row.role,
      content: row.content,
    }));
  });
}

/**
 * Parse stored bad-case transcript lines such as `[turn 1] [user] text`.
 * @param transcript Stored transcript.
 * @returns Parsed role/content rows.
 */
function parseStoredTranscript(transcript: string): Array<{ role: ChatRole; content: string }> {
  return transcript
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\[turn\s+\d+\]\s+\[(user|assistant|system)\]\s*(.*)$/i);
      if (!match) {
        return null;
      }
      return {
        role: match[1].toLowerCase() as ChatRole,
        content: match[2].trim(),
      };
    })
    .filter((item): item is { role: ChatRole; content: string } => Boolean(item?.content));
}

/**
 * Summarize baseline scores from stored dataset cases.
 * @param cases Dataset cases selected for replay.
 * @returns Baseline score summary.
 */
function summarizeSampleCases(cases: DatasetCaseRecord[]): {
  caseCount: number;
  badcaseCount: number;
  goodcaseCount: number;
  avgBaselineCaseScore: number;
  avgFailureSeverityScore: number;
} {
  const caseCount = cases.length;
  const avgBaselineCaseScore = caseCount
    ? cases.reduce((sum, item) => sum + item.baselineCaseScore, 0) / caseCount
    : 0;
  const avgFailureSeverityScore = caseCount
    ? cases.reduce((sum, item) => sum + (item.failureSeverityScore ?? 0), 0) / caseCount
    : 0;
  return {
    caseCount,
    badcaseCount: cases.filter((item) => item.caseSetType === "badcase").length,
    goodcaseCount: cases.filter((item) => item.caseSetType === "goodcase").length,
    avgBaselineCaseScore: Number(avgBaselineCaseScore.toFixed(4)),
    avgFailureSeverityScore: Number(avgFailureSeverityScore.toFixed(4)),
  };
}
