import { NextResponse } from "next/server";
import { parseSessionsCsv } from "@/lib/csv";
import { writeSessionsFile } from "@/lib/store";
import type { CsvRow } from "@/lib/types";

/**
 * 扁平化所有会话行，供前端预览表使用。
 * @param sessions 已解析会话列表。
 */
function flattenRowsForPreview(
  sessions: { session_id: string; rows: CsvRow[] }[],
): { columns: string[]; rows: Record<string, string | number>[] } {
  const columns = [
    "session_id",
    "turn_index",
    "role",
    "content",
    "services",
    "active_intents",
    "slot_values",
  ];
  const rows: Record<string, string | number>[] = [];
  for (const s of sessions) {
    for (const r of s.rows) {
      rows.push({
        session_id: s.session_id,
        turn_index: r.turn_index,
        role: r.role,
        content: r.content,
        services: r.services ?? "",
        active_intents: r.active_intents ?? "",
        slot_values: r.slot_values ?? "",
      });
    }
  }
  return { columns, rows };
}

/**
 * 上传 CSV 文本并解析为 sessions 快照。
 * 支持首期冻结 MultiWOZ 7 列（v1.0-csv-multiwoz）与 legacy 最小四列，见 lib/csv.ts。
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { csvText?: string };
    const csvText = body.csvText?.trim();
    if (!csvText) {
      return NextResponse.json({ error: "缺少 csvText" }, { status: 400 });
    }
    const sessions = parseSessionsCsv(csvText);
    writeSessionsFile({ sessions });
    const preview = flattenRowsForPreview(sessions);
    return NextResponse.json({
      ok: true,
      count: sessions.length,
      session_ids: sessions.map((s) => s.session_id),
      preview,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
