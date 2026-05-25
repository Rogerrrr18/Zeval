import { NextResponse } from "next/server";
import { parseJsonObjectFromLlm } from "@/lib/json";
import { validateExtraction } from "@/lib/validate-extraction";
import { writeLocked } from "@/lib/store";
import type { ExtractionRoot } from "@/lib/types";

/**
 * 校验并锁版抽取 JSON。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { sessionId?: string; jsonText?: string };
    if (!body.sessionId || body.jsonText == null) {
      return NextResponse.json({ error: "缺少 sessionId 或 jsonText" }, { status: 400 });
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.jsonText) as unknown;
    } catch {
      parsed = parseJsonObjectFromLlm(body.jsonText);
    }
    const v = validateExtraction(parsed);
    if (!v.ok) {
      return NextResponse.json({ error: v.errors }, { status: 400 });
    }
    const data = parsed as ExtractionRoot;
    data.session_id = body.sessionId;
    data.schema_lock_revision = (data.schema_lock_revision ?? 0) + 1;
    writeLocked(body.sessionId, data);
    return NextResponse.json({ ok: true, schema_lock_revision: data.schema_lock_revision });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
