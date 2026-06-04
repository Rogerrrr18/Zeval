/**
 * @fileoverview 知识库文件内容读取 API
 *
 * GET /api/benchmarks/knowledge/file?userId=xxx&fileId=xxx
 */

import { NextResponse } from "next/server";
import { readKnowledgeFileText } from "@/benchmark/agent/knowledge-store";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = String(url.searchParams.get("userId") ?? "default");
    const fileId = url.searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json({ error: "缺少 fileId 参数" }, { status: 400 });
    }

    const result = await readKnowledgeFileText(userId, fileId);
    if (!result) {
      return NextResponse.json({ error: "文件不存在" }, { status: 404 });
    }

    return NextResponse.json({
      fileId: result.record.fileId,
      fileName: result.record.originalName,
      fileType: result.record.fileType,
      text: result.text,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `读取失败: ${message}` }, { status: 500 });
  }
}
