import { NextResponse } from "next/server";
import { readSessionsFile } from "@/lib/store";

/**
 * 列出当前已导入的 sessions；可选返回全量行供页面刷新后重建预览。
 * Query: `includeRows=1` 时附带 `preview`（扁平行）。
 */
export async function GET(req: Request) {
  const data = readSessionsFile();
  if (!data) {
    return NextResponse.json({ sessions: [], preview: null });
  }
  const sessions = data.sessions.map((s) => ({
    session_id: s.session_id,
    turns: s.rows.length,
    user_turns: s.rows.filter((r) => r.role === "user").length,
  }));
  const url = new URL(req.url);
  if (url.searchParams.get("includeRows") !== "1") {
    return NextResponse.json({ sessions, preview: null });
  }
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
  for (const s of data.sessions) {
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
  return NextResponse.json({ sessions, preview: { columns, rows } });
}
