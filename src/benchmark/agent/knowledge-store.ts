/**
 * @fileoverview Zeval 知识库存储系统
 *
 * 用户上传的文件持久化保存，作为 Agent 的上下文知识库：
 * - 文件上传与存储（artifacts/knowledge-base/{userId}/）
 * - 文件元数据索引（JSON manifest）
 * - 按用户隔离的知识库空间
 * - 文件检索（按名称、标签、类型搜索）
 * - 内容提取（文本文件直接读取，未来可扩展为向量化检索）
 */

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

const KNOWLEDGE_BASE_ROOT = path.join("artifacts", "knowledge-base");

// ───────────────────────────────────────────────
// 类型定义
// ───────────────────────────────────────────────

export type KnowledgeFileType =
  | "text"
  | "markdown"
  | "json"
  | "csv"
  | "pdf"
  | "doc"
  | "code"
  | "unknown";

export type KnowledgeFileRecord = {
  fileId: string;
  userId: string;
  fileName: string;
  originalName: string;
  fileType: KnowledgeFileType;
  mimeType: string;
  sizeBytes: number;
  contentPreview: string;
  tags: string[];
  description: string;
  uploadedAt: string;
  updatedAt: string;
  accessCount: number;
  lastAccessedAt?: string;
};

export type KnowledgeBaseManifest = {
  userId: string;
  version: string;
  files: KnowledgeFileRecord[];
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeSearchQuery = {
  userId: string;
  keyword?: string;
  fileType?: KnowledgeFileType;
  tags?: string[];
  limit?: number;
};

export type KnowledgeSearchResult = {
  files: KnowledgeFileRecord[];
  total: number;
};

// ───────────────────────────────────────────────
// 文件类型检测
// ───────────────────────────────────────────────

export function detectFileType(fileName: string, mimeType: string): KnowledgeFileType {
  const ext = path.extname(fileName).toLowerCase();
  const lowerMime = mimeType.toLowerCase();

  if (/\.(txt|log|md|markdown)$/.test(ext) || lowerMime.includes("text/plain") || lowerMime.includes("text/markdown")) {
    return ext === ".md" || ext === ".markdown" ? "markdown" : "text";
  }
  if (/\.json$/.test(ext) || lowerMime.includes("application/json")) return "json";
  if (/\.csv$/.test(ext) || lowerMime.includes("text/csv")) return "csv";
  if (/\.pdf$/.test(ext) || lowerMime.includes("application/pdf")) return "pdf";
  if (/\.(doc|docx)$/.test(ext) || lowerMime.includes("word")) return "doc";
  if (/\.(ts|js|tsx|jsx|py|java|go|rs|c|cpp|h|php|rb)$/.test(ext)) return "code";

  return "unknown";
}

// ───────────────────────────────────────────────
// 存储路径
// ───────────────────────────────────────────────

function getUserDir(userId: string): string {
  return path.join(KNOWLEDGE_BASE_ROOT, sanitizeUserId(userId));
}

function getManifestPath(userId: string): string {
  return path.join(getUserDir(userId), "manifest.json");
}

function getFilePath(userId: string, fileId: string, fileName: string): string {
  return path.join(getUserDir(userId), "files", `${fileId}_${sanitizeFileName(fileName)}`);
}

function sanitizeUserId(userId: string): string {
  return userId.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "default";
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_");
}

function generateFileId(): string {
  return `kf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ───────────────────────────────────────────────
// Manifest 读写
// ───────────────────────────────────────────────

async function readManifest(userId: string): Promise<KnowledgeBaseManifest> {
  const manifestPath = getManifestPath(userId);
  try {
    const raw = await readFile(manifestPath, "utf8");
    return JSON.parse(raw) as KnowledgeBaseManifest;
  } catch {
    return {
      userId,
      version: "1.0",
      files: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
}

async function writeManifest(manifest: KnowledgeBaseManifest): Promise<void> {
  const manifestPath = getManifestPath(manifest.userId);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify({ ...manifest, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

// ───────────────────────────────────────────────
// 核心 CRUD 操作
// ───────────────────────────────────────────────

export type UploadKnowledgeFileInput = {
  userId: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  content: Buffer;
  tags?: string[];
  description?: string;
};

/**
 * 上传文件到知识库
 */
export async function uploadKnowledgeFile(input: UploadKnowledgeFileInput): Promise<KnowledgeFileRecord> {
  const userDir = getUserDir(input.userId);
  const filesDir = path.join(userDir, "files");
  await mkdir(filesDir, { recursive: true });

  const fileId = generateFileId();
  const fileType = detectFileType(input.fileName, input.mimeType);
  const filePath = getFilePath(input.userId, fileId, input.fileName);

  // 写入文件
  await writeFile(filePath, input.content);

  // 提取文本预览（前 2000 字符）
  let contentPreview = "";
  if (fileType === "text" || fileType === "markdown" || fileType === "json" || fileType === "csv" || fileType === "code") {
    try {
      contentPreview = input.content.toString("utf8").slice(0, 2000);
    } catch {
      contentPreview = "[二进制文件，无法预览]";
    }
  } else {
    contentPreview = `[${fileType} 文件，大小 ${formatBytes(input.content.length)}]`;
  }

  const record: KnowledgeFileRecord = {
    fileId,
    userId: input.userId,
    fileName: input.fileName,
    originalName: input.originalName,
    fileType,
    mimeType: input.mimeType,
    sizeBytes: input.content.length,
    contentPreview,
    tags: input.tags ?? [],
    description: input.description ?? "",
    uploadedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    accessCount: 0,
  };

  // 更新 manifest
  const manifest = await readManifest(input.userId);
  manifest.files.push(record);
  await writeManifest(manifest);

  return record;
}

/**
 * 列出用户的知识库文件
 */
export async function listKnowledgeFiles(userId: string): Promise<KnowledgeFileRecord[]> {
  const manifest = await readManifest(userId);
  return manifest.files.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

/**
 * 读取单个知识库文件内容
 */
export async function readKnowledgeFile(userId: string, fileId: string): Promise<{ record: KnowledgeFileRecord; content: Buffer } | null> {
  const manifest = await readManifest(userId);
  const record = manifest.files.find((f) => f.fileId === fileId);
  if (!record) return null;

  const filePath = getFilePath(userId, fileId, record.fileName);
  try {
    const content = await readFile(filePath);
    // 更新访问计数
    record.accessCount += 1;
    record.lastAccessedAt = new Date().toISOString();
    await writeManifest(manifest);
    return { record, content };
  } catch {
    return null;
  }
}

/**
 * 读取知识库文件的文本内容（仅文本类文件）
 */
export async function readKnowledgeFileText(userId: string, fileId: string): Promise<{ record: KnowledgeFileRecord; text: string } | null> {
  const result = await readKnowledgeFile(userId, fileId);
  if (!result) return null;

  const text = result.content.toString("utf8");
  return { record: result.record, text };
}

/**
 * 删除知识库文件
 */
export async function deleteKnowledgeFile(userId: string, fileId: string): Promise<boolean> {
  const manifest = await readManifest(userId);
  const index = manifest.files.findIndex((f) => f.fileId === fileId);
  if (index === -1) return false;

  const record = manifest.files[index];
  const filePath = getFilePath(userId, fileId, record.fileName);

  try {
    await unlink(filePath);
  } catch {
    // 文件可能已不存在，继续删除 manifest 记录
  }

  manifest.files.splice(index, 1);
  await writeManifest(manifest);
  return true;
}

/**
 * 更新文件标签和描述
 */
export async function updateKnowledgeFileMeta(
  userId: string,
  fileId: string,
  updates: { tags?: string[]; description?: string }
): Promise<KnowledgeFileRecord | null> {
  const manifest = await readManifest(userId);
  const record = manifest.files.find((f) => f.fileId === fileId);
  if (!record) return null;

  if (updates.tags !== undefined) record.tags = updates.tags;
  if (updates.description !== undefined) record.description = updates.description;
  record.updatedAt = new Date().toISOString();

  await writeManifest(manifest);
  return record;
}

// ───────────────────────────────────────────────
// 搜索
// ───────────────────────────────────────────────

/**
 * 搜索知识库文件
 */
export async function searchKnowledgeFiles(query: KnowledgeSearchQuery): Promise<KnowledgeSearchResult> {
  const manifest = await readManifest(query.userId);
  let results = manifest.files;

  if (query.keyword) {
    const kw = query.keyword.toLowerCase();
    results = results.filter(
      (f) =>
        f.fileName.toLowerCase().includes(kw) ||
        f.originalName.toLowerCase().includes(kw) ||
        f.description.toLowerCase().includes(kw) ||
        f.contentPreview.toLowerCase().includes(kw) ||
        f.tags.some((t) => t.toLowerCase().includes(kw))
    );
  }

  if (query.fileType) {
    results = results.filter((f) => f.fileType === query.fileType);
  }

  if (query.tags && query.tags.length > 0) {
    results = results.filter((f) => query.tags!.some((t) => f.tags.includes(t)));
  }

  const total = results.length;
  const limit = query.limit ?? 50;
  results = results.slice(0, limit);

  return { files: results, total };
}

// ───────────────────────────────────────────────
// 知识库上下文构建（注入 Agent Prompt）
// ───────────────────────────────────────────────

/**
 * 构建知识库上下文文本，用于注入 Agent 系统提示
 *
 * @param userId 用户 ID
 * @param fileIds 要包含的文件 ID 列表，不传则包含全部
 * @returns 格式化的知识库上下文
 */
export async function buildKnowledgeContext(userId: string, fileIds?: string[]): Promise<string> {
  const manifest = await readManifest(userId);
  let files = manifest.files;

  if (fileIds && fileIds.length > 0) {
    const idSet = new Set(fileIds);
    files = files.filter((f) => idSet.has(f.fileId));
  }

  if (files.length === 0) {
    return "";
  }

  const parts: string[] = [
    "## 知识库文件",
    `你拥有 ${files.length} 个知识库文件作为参考上下文：`,
    "",
  ];

  for (const file of files) {
    parts.push(`### ${file.originalName} (ID: ${file.fileId})`);
    if (file.description) {
      parts.push(`描述: ${file.description}`);
    }
    if (file.tags.length > 0) {
      parts.push(`标签: ${file.tags.join(", ")}`);
    }
    parts.push(`类型: ${file.fileType} | 大小: ${formatBytes(file.sizeBytes)}`);

    // 文本类文件直接附上前 1000 字符内容
    if (
      file.fileType === "text" ||
      file.fileType === "markdown" ||
      file.fileType === "json" ||
      file.fileType === "csv" ||
      file.fileType === "code"
    ) {
      const result = await readKnowledgeFileText(userId, file.fileId);
      if (result) {
        const preview = result.text.slice(0, 1000);
        parts.push("```");
        parts.push(preview);
        if (result.text.length > 1000) {
          parts.push("... (内容已截断，使用 read_knowledge_file 工具读取完整内容)");
        }
        parts.push("```");
      }
    } else {
      parts.push("[非文本文件，使用 read_knowledge_file 工具读取]");
    }

    parts.push("");
  }

  return parts.join("\n");
}

/**
 * 构建轻量级知识库上下文（仅文件列表，不含内容）
 */
export async function buildKnowledgeFileList(userId: string): Promise<string> {
  const manifest = await readManifest(userId);
  if (manifest.files.length === 0) {
    return "";
  }

  const lines = manifest.files.map(
    (f) => `- ${f.originalName} (ID: ${f.fileId}, 类型: ${f.fileType}, 标签: ${f.tags.join(", ") || "无"})`
  );

  return ["## 可用知识库文件", ...lines, "", "你可以使用 read_knowledge_file 工具读取文件内容。"].join("\n");
}

// ───────────────────────────────────────────────
// 统计
// ───────────────────────────────────────────────

export type KnowledgeBaseStats = {
  totalFiles: number;
  totalSizeBytes: number;
  byType: Record<KnowledgeFileType, number>;
  recentlyAccessed: KnowledgeFileRecord[];
};

export async function getKnowledgeBaseStats(userId: string): Promise<KnowledgeBaseStats> {
  const manifest = await readManifest(userId);
  const byType: Record<string, number> = {};

  for (const f of manifest.files) {
    byType[f.fileType] = (byType[f.fileType] ?? 0) + 1;
  }

  const recentlyAccessed = [...manifest.files]
    .filter((f) => f.lastAccessedAt)
    .sort((a, b) => Date.parse(b.lastAccessedAt!) - Date.parse(a.lastAccessedAt!))
    .slice(0, 5);

  return {
    totalFiles: manifest.files.length,
    totalSizeBytes: manifest.files.reduce((s, f) => s + f.sizeBytes, 0),
    byType: byType as Record<KnowledgeFileType, number>,
    recentlyAccessed,
  };
}

// ───────────────────────────────────────────────
// 工具函数
// ───────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i] ?? "B"}`;
}
