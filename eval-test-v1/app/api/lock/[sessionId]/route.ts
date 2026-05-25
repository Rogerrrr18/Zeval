import { NextResponse } from "next/server";
import { readLocked } from "@/lib/store";

type Params = { params: Promise<{ sessionId: string }> };

/**
 * 读取锁版 JSON 文本。
 */
export async function GET(_req: Request, ctx: Params) {
  const { sessionId } = await ctx.params;
  const decoded = decodeURIComponent(sessionId);
  const data = readLocked(decoded);
  if (!data) {
    return NextResponse.json({ error: "无锁版文件" }, { status: 404 });
  }
  return NextResponse.json(data);
}
