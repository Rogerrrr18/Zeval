/**
 * @fileoverview 知识库 API — 文件上传、列表、删除、搜索
 *
 * POST   /api/benchmarks/knowledge     上传文件
 * GET    /api/benchmarks/knowledge     列出/搜索文件
 * DELETE /api/benchmarks/knowledge     删除文件
 */

import { NextResponse } from "next/server";
import {
  deleteKnowledgeFile,
  listKnowledgeFiles,
  searchKnowledgeFiles,
  uploadKnowledgeFile,
} from "@/benchmark/agent/knowledge-store";

// ── POST: 上传文件 ──────────────────────────────

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const userId = String(formData.get("userId") ?? "default");
    const tagsRaw = String(formData.get("tags") ?? "");
    const description = String(formData.get("description") ?? "");

    if (!file) {
      return NextResponse.json({ error: "未提供文件" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const tags = tagsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const record = await uploadKnowledgeFile({
      userId,
      fileName: file.name,
      originalName: file.name,
      mimeType: file.type || "application/octet-stream",
      content: buffer,
      tags,
      description,
    });

    return NextResponse.json({ success: true, file: record });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `上传失败: ${message}` }, { status: 500 });
  }
}

// ── GET: 列出/搜索文件 ──────────────────────────

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = String(url.searchParams.get("userId") ?? "default");
    const keyword = url.searchParams.get("keyword") ?? undefined;
    const fileType = (url.searchParams.get("fileType") ?? undefined) as import("@/benchmark/agent/knowledge-store").KnowledgeFileType | undefined;
    const tagsRaw = url.searchParams.get("tags") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 50);

    const tags = tagsRaw?.split(",").map((t) => t.trim()).filter(Boolean);

    if (keyword || fileType || tags?.length) {
      const result = await searchKnowledgeFiles({ userId, keyword, fileType, tags, limit });
      return NextResponse.json({ files: result.files, total: result.total });
    }

    const files = await listKnowledgeFiles(userId);
    return NextResponse.json({ files, total: files.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `查询失败: ${message}` }, { status: 500 });
  }
}

// ── DELETE: 删除文件 ────────────────────────────

export async function DELETE(request: Request) {
  try {
    const url = new URL(request.url);
    const userId = String(url.searchParams.get("userId") ?? "default");
    const fileId = url.searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json({ error: "缺少 fileId 参数" }, { status: 400 });
    }

    const success = await deleteKnowledgeFile(userId, fileId);
    if (!success) {
      return NextResponse.json({ error: "文件不存在或删除失败" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `删除失败: ${message}` }, { status: 500 });
  }
}
