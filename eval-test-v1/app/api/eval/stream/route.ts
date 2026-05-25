import { getMergedSettings } from "@/lib/settings";
import { readSessionsFile, readLocked, writeEvalResult } from "@/lib/store";
import { runDynamicEval } from "@/lib/eval-loop";
import { computeBaselineVector } from "@/lib/baseline";
import { validateExtraction } from "@/lib/validate-extraction";
import type { ExtractionRoot, EvalTurnLog } from "@/lib/types";

/**
 * 解析请求中的抽取对象：优先 body.extraction，否则读锁版文件。
 */
function resolveExtraction(sessionId: string, extraction: unknown | undefined): ExtractionRoot {
  if (extraction != null) {
    const v = validateExtraction(extraction);
    if (!v.ok) {
      throw new Error(`Schema 校验失败: ${v.errors}`);
    }
    const root = extraction as ExtractionRoot;
    root.session_id = sessionId;
    return root;
  }
  const fromDisk = readLocked(sessionId);
  if (!fromDisk) {
    throw new Error("未提供 extraction 且无锁版文件：请先运行抽取或传入 extraction");
  }
  return fromDisk;
}

/**
 * NDJSON 流式动态评测：先推送基线，再每轮推送 turn，最后 metrics + done。
 * 请求体：`{ sessionId, extraction?: ExtractionRoot }`（extraction 与锁版二选一，推荐前者）。
 */
export async function POST(req: Request) {
  const encoder = new TextEncoder();
  const body = (await req.json()) as { sessionId?: string; extraction?: unknown };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };
      try {
        if (!body.sessionId) {
          send({ type: "error", message: "缺少 sessionId" });
          controller.close();
          return;
        }
        const sessionId = body.sessionId;
        send({ type: "start", sessionId });

        const file = readSessionsFile();
        const bundle = file?.sessions.find((s) => s.session_id === sessionId);
        if (!bundle) {
          send({ type: "error", message: "未找到 session 行数据" });
          controller.close();
          return;
        }

        const extraction = resolveExtraction(sessionId, body.extraction);
        const settings = getMergedSettings();

        send({ type: "phase", phase: "baseline" });
        const baseline = await computeBaselineVector(settings, bundle.rows);
        const baseline_radar = {
          intent_completion_rate: baseline.intent_completion_rate,
          followup_quality: baseline.followup_efficiency,
          inverse_deviation: 1 - baseline.deviation_rate,
          turn_quality: baseline.turn_efficiency,
        };
        send({ type: "baseline", baseline, baseline_radar });

        send({ type: "phase", phase: "dynamic" });
        const logs: EvalTurnLog[] = [];
        const { metrics } = await runDynamicEval(settings, extraction, bundle.rows, {
          onTurn: async (log) => {
            logs.push(log);
            send({ type: "turn", log });
          },
        });

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
        send({ type: "metrics", dynamic_raw: metrics, dynamic_radar, logs });
        send({ type: "done" });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        send({ type: "error", message: msg });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
