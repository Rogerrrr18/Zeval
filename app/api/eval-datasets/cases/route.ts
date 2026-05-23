import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { getZeroreRequestContext } from "@/auth/context";
import { computeNormalizedTranscriptHash } from "@/eval-datasets/case-transcript-hash";
import { createDatasetStore } from "@/eval-datasets/storage";
import type { DatasetBaselineRecord, DatasetCaseRecord } from "@/eval-datasets/storage/types";
import { evalDatasetCreateCaseBodySchema, evalDatasetListCasesQuerySchema } from "@/schemas/eval-datasets";

/**
 * List dataset cases with optional set filter.
 * @param request Incoming HTTP request.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsedQuery = evalDatasetListCasesQuerySchema.safeParse({
      caseSetType: url.searchParams.get("caseSetType") || undefined,
      source: url.searchParams.get("source") || undefined,
    });
    if (!parsedQuery.success) {
      return NextResponse.json({ error: "查询参数不合法。", details: parsedQuery.error.flatten() }, { status: 400 });
    }

    const context = getZeroreRequestContext(request);
    const store = createDatasetStore({ workspaceId: context.workspaceId });
    const allCases = await store.listCases(parsedQuery.data.caseSetType);
    const cases = parsedQuery.data.source
      ? allCases.filter((c) => c.source === parsedQuery.data.source)
      : allCases;
    return NextResponse.json({ cases, count: cases.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "列出评测案例失败。", detail: message }, { status: 500 });
  }
}

/**
 * Create one dataset case with transcript hash and duplicate checks.
 * @param request Incoming HTTP request.
 */
export async function POST(request: Request) {
  try {
    const parsedBody = evalDatasetCreateCaseBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json({ error: "请求体不合法。", details: parsedBody.error.flatten() }, { status: 400 });
    }

    const body = parsedBody.data;
    const context = getZeroreRequestContext(request);
    const store = createDatasetStore({ workspaceId: context.workspaceId });
    const normalizedTranscriptHash = computeNormalizedTranscriptHash(body.transcript);
    const duplicate = await store.checkDuplicate({
      normalizedTranscriptHash,
      topicLabel: body.topicLabel,
      baselineCaseScore: body.baselineCaseScore,
    });

    if (duplicate.isDuplicate && duplicate.reason === "exact_hash") {
      return NextResponse.json(
        {
          error: "与已有案例 transcript 哈希完全一致，拒绝入库。",
          duplicate,
          normalizedTranscriptHash,
        },
        { status: 409 },
      );
    }

    if (duplicate.isDuplicate && duplicate.reason === "near_duplicate" && !body.allowNearDuplicate) {
      return NextResponse.json(
        {
          error: "命中近重复规则；若确认仍要入库，请设置 allowNearDuplicate=true。",
          duplicate,
          normalizedTranscriptHash,
        },
        { status: 409 },
      );
    }

    const now = new Date().toISOString();
    const caseId = body.caseId ?? allocateCaseId(body.caseSetType);
    const record: DatasetCaseRecord = {
      caseId,
      caseSetType: body.caseSetType,
      source: body.source ?? (body.caseSetType === "goodcase" ? "auto_tn" : "auto_tp"),
      sessionId: body.sessionId,
      topicSegmentId: body.topicSegmentId,
      topicLabel: body.topicLabel,
      topicSummary: body.topicSummary,
      normalizedTranscriptHash,
      duplicateGroupKey: body.duplicateGroupKey,
      baselineVersion: body.baselineVersion,
      baselineCaseScore: body.baselineCaseScore,
      tags: body.tags,
      createdAt: now,
      updatedAt: now,
    };

    await store.createCase(record);

    let baseline: DatasetBaselineRecord | undefined;
    if (body.baseline) {
      const baselineRecord: DatasetBaselineRecord = {
        caseId,
        baselineCaseScore: body.baselineCaseScore,
        baselineObjectiveScore: body.baseline.baselineObjectiveScore,
        baselineSubjectiveScore: body.baseline.baselineSubjectiveScore,
        baselineRiskPenaltyScore: body.baseline.baselineRiskPenaltyScore,
        baselineSignals: body.baseline.baselineSignals,
        baselineGeneratedAt: now,
        baselineProductVersion: body.baseline.baselineProductVersion,
      };
      await store.saveBaseline(baselineRecord);
      baseline = baselineRecord;
    }

    return NextResponse.json({ case: record, baseline, duplicateChecked: duplicate, normalizedTranscriptHash });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "创建评测案例失败。", detail: message }, { status: 500 });
  }
}

/**
 * Allocate a new case id with set prefix when client omits caseId.
 * @param caseSetType Dataset set type.
 * @returns New case identifier.
 */
function allocateCaseId(caseSetType: "goodcase" | "badcase"): string {
  const prefix = caseSetType === "goodcase" ? "gc" : "bc";
  return `${prefix}_${Date.now()}_${randomBytes(3).toString("hex")}`;
}
