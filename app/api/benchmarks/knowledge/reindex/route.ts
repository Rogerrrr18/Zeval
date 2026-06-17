/**
 * @fileoverview Knowledge-base chunk reindex API.
 *
 * POST /api/benchmarks/knowledge/reindex  Rebuild local chunk index.
 */

import { NextResponse } from "next/server";
import { rebuildKnowledgeChunkIndex } from "@/benchmark/agent/knowledge-store";

type ReindexRequestBody = {
  userId?: string;
  fileIds?: string[];
};

/**
 * Rebuild the persisted chunk index for selected or all knowledge files.
 *
 * @param request JSON body with optional userId and fileIds.
 * @returns Reindex summary, or an observable error message.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as ReindexRequestBody;
    const userId = typeof body.userId === "string" && body.userId.trim() ? body.userId.trim() : "default";
    const fileIds = Array.isArray(body.fileIds)
      ? body.fileIds.filter((fileId): fileId is string => typeof fileId === "string" && fileId.trim().length > 0)
      : undefined;
    const summary = await rebuildKnowledgeChunkIndex(userId, fileIds);
    return NextResponse.json({ success: true, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `重建索引失败: ${message}` }, { status: 500 });
  }
}
