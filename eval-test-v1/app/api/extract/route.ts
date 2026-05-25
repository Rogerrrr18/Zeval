import { NextResponse } from "next/server";
import { getMergedSettings } from "@/lib/settings";
import { readLocked, readSessionsFile, writeLocked } from "@/lib/store";
import { runExtractionOnce } from "@/lib/extract";

/**
 * 对指定 session 执行一次抽取；若已有绑定抽取结果，则直接返回，保证同一 session 后续复现稳定。
 */
export async function POST(req: Request) {
  try {
    const { sessionId, force } = (await req.json()) as { sessionId?: string; force?: boolean };
    if (!sessionId) {
      return NextResponse.json({ error: "缺少 sessionId" }, { status: 400 });
    }
    const file = readSessionsFile();
    const bundle = file?.sessions.find((s) => s.session_id === sessionId);
    if (!bundle) {
      return NextResponse.json({ error: "未找到 session，请先上传 CSV" }, { status: 404 });
    }

    const bound = readLocked(sessionId);
    if (bound && !force) {
      return NextResponse.json({ extraction: bound, bound: true, raw_preview: "" });
    }

    const settings = getMergedSettings();
    const { extraction, raw } = await runExtractionOnce(settings, sessionId, bundle.rows);
    if (force) {
      return NextResponse.json({ extraction, bound: false, raw_preview: raw.slice(0, 2000) });
    }
    writeLocked(sessionId, extraction);
    return NextResponse.json({ extraction, bound: true, raw_preview: raw.slice(0, 2000) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
