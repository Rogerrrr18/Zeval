import { NextResponse } from "next/server";
import { getMergedSettings } from "@/lib/settings";
import { readSessionsFile, readLocked, writeEvalResult } from "@/lib/store";
import { runDynamicEval } from "@/lib/eval-loop";
import { computeBaselineVector } from "@/lib/baseline";
import { validateExtraction } from "@/lib/validate-extraction";
import type { ExtractionRoot } from "@/lib/types";

/**
 * 解析请求中的抽取对象：优先 body.extraction，否则读锁版文件。
 */
function resolveExtraction(sessionId: string, extraction: unknown | undefined): ExtractionRoot | null {
  if (extraction != null) {
    const v = validateExtraction(extraction);
    if (!v.ok) {
      throw new Error(`Schema 校验失败: ${v.errors}`);
    }
    const root = extraction as ExtractionRoot;
    root.session_id = sessionId;
    return root;
  }
  return readLocked(sessionId);
}

/**
 * 运行动态评测并写结果文件。支持请求体传入 `extraction`（与锁版二选一，推荐前者）。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { sessionId?: string; extraction?: unknown };
    if (!body.sessionId) {
      return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
    }
    const locked = resolveExtraction(body.sessionId, body.extraction);
    if (!locked) {
      return NextResponse.json({ error: "请先运行抽取并确认表格，或在请求中传入 extraction" }, { status: 400 });
    }
    const file = readSessionsFile();
    const sessionId = body.sessionId;
    const bundle = file?.sessions.find((s) => s.session_id === sessionId);
    if (!bundle) {
      return NextResponse.json({ error: "未找到 session 行数据" }, { status: 404 });
    }
    const settings = getMergedSettings();
    const baseline = await computeBaselineVector(settings, bundle.rows);
    const { logs, metrics } = await runDynamicEval(settings, locked, bundle.rows);

    const baseline_radar = {
      intent_completion_rate: baseline.intent_completion_rate,
      followup_quality: baseline.followup_efficiency,
      inverse_deviation: 1 - baseline.deviation_rate,
      turn_quality: baseline.turn_efficiency,
    };
    const dynamic_radar = {
      intent_completion_rate: metrics.intent_completion_rate,
      followup_quality: 1 - Math.min(1, metrics.followup_efficiency),
      inverse_deviation: 1 - metrics.deviation_rate,
      turn_quality: Math.min(1, metrics.T_hist / Math.max(metrics.T_eval, 1)),
    };

    const payload = {
      session_id: sessionId,
      createdAt: new Date().toISOString(),
      baseline,
      baseline_radar,
      dynamic_raw: metrics,
      dynamic_radar,
      logs,
    };
    writeEvalResult(sessionId, payload);
    return NextResponse.json(payload);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
