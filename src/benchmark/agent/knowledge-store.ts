/**
 * @fileoverview Zeval 知识库存储系统
 *
 * 用户上传的文件持久化保存，作为 Agent 的上下文知识库：
 * - 文件上传与存储（artifacts/knowledge-base/{userId}/）
 * - 文件元数据索引（JSON manifest）
 * - 按用户隔离的知识库空间
 * - 文件检索（按名称、标签、类型搜索）
 * - 内容提取、本地 chunk index、轻量 embedding 检索与 provenance
 */

import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { splitCsvLine } from "@/lib/csv";
import { readZevalEnvValue } from "@/lib/siliconflow";

const KNOWLEDGE_BASE_ROOT = path.join("artifacts", "knowledge-base");
const CHUNK_INDEX_VERSION = "2.0";
const EMBEDDING_DIMENSION = 128;
const DEFAULT_CHUNK_CHAR_LIMIT = 1800;
const DEFAULT_EMBEDDING_TIMEOUT_MS = 30000;

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

export type KnowledgeChunkRecord = {
  chunkId: string;
  userId: string;
  fileId: string;
  fileName: string;
  fileType: KnowledgeFileType;
  title: string;
  text: string;
  preview: string;
  startLine: number;
  endLine: number;
  keywords: string[];
  embedding: number[];
  embeddingProvider: string;
  embeddingModel: string;
  embeddingSignature: string;
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeChunkIndex = {
  userId: string;
  version: string;
  embeddingProvider: string;
  embeddingModel: string;
  embeddingDimension: number;
  embeddingSignature: string;
  chunks: KnowledgeChunkRecord[];
  createdAt: string;
  updatedAt: string;
};

export type KnowledgeChunkSearchHit = {
  chunk: KnowledgeChunkRecord;
  file: KnowledgeFileRecord;
  score: number;
  lexicalScore: number;
  vectorScore: number;
};

export type KnowledgeChunkSearchInput = {
  userId: string;
  query: string;
  fileIds?: string[];
  limit?: number;
};

export type KnowledgeContextBuildInput = {
  userId: string;
  fileIds?: string[];
  query?: string;
  maxFiles?: number;
  maxSnippetsPerFile?: number;
  maxCharsPerSnippet?: number;
  maxTotalChars?: number;
};

type KnowledgeSnippet = {
  title: string;
  text: string;
  score: number;
};

type KnowledgeFileAnalysis = {
  record: KnowledgeFileRecord;
  text?: string;
  structure: string[];
  snippets: KnowledgeSnippet[];
  score: number;
};

type KnowledgeEmbeddingConfig = {
  provider: "local" | "openai_compatible";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  dimensions?: number;
  signature: string;
};

type KnowledgeEmbeddingBatchResult = {
  vectors: number[][];
  config: KnowledgeEmbeddingConfig;
};

type EmbeddingsResponse = {
  data?: Array<{ embedding?: number[]; index?: number }>;
  error?: { message?: string };
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

/**
 * Resolve the chunk index path for one user.
 *
 * @param userId Knowledge-base owner.
 * @returns Local JSON chunk index path.
 */
function getChunkIndexPath(userId: string): string {
  return path.join(getUserDir(userId), "chunks.json");
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

/**
 * Read the persisted chunk index for one user.
 *
 * @param userId Knowledge-base owner.
 * @returns Chunk index, creating an empty in-memory index when absent.
 */
async function readChunkIndex(userId: string): Promise<KnowledgeChunkIndex> {
  const indexPath = getChunkIndexPath(userId);
  const embeddingConfig = resolveKnowledgeEmbeddingConfig();
  const expectedDimension = resolveEmbeddingDimension(embeddingConfig);
  try {
    const raw = await readFile(indexPath, "utf8");
    const parsed = JSON.parse(raw) as KnowledgeChunkIndex;
    if (
      parsed.version !== CHUNK_INDEX_VERSION ||
      parsed.embeddingSignature !== embeddingConfig.signature ||
      (expectedDimension > 0 && parsed.embeddingDimension !== expectedDimension)
    ) {
      return emptyChunkIndex(userId);
    }
    return parsed;
  } catch {
    return emptyChunkIndex(userId);
  }
}

/**
 * Persist one user's chunk index.
 *
 * @param index Chunk index to write.
 */
async function writeChunkIndex(index: KnowledgeChunkIndex): Promise<void> {
  const indexPath = getChunkIndexPath(index.userId);
  await mkdir(path.dirname(indexPath), { recursive: true });
  await writeFile(indexPath, `${JSON.stringify({ ...index, updatedAt: new Date().toISOString() }, null, 2)}\n`, "utf8");
}

/**
 * Create an empty chunk index shell.
 *
 * @param userId Knowledge-base owner.
 * @returns Empty chunk index.
 */
function emptyChunkIndex(userId: string): KnowledgeChunkIndex {
  const now = new Date().toISOString();
  const embeddingConfig = resolveKnowledgeEmbeddingConfig();
  return {
    userId,
    version: CHUNK_INDEX_VERSION,
    embeddingProvider: embeddingConfig.provider,
    embeddingModel: embeddingConfig.model,
    embeddingDimension: resolveEmbeddingDimension(embeddingConfig),
    embeddingSignature: embeddingConfig.signature,
    chunks: [],
    createdAt: now,
    updatedAt: now,
  };
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
  await upsertKnowledgeFileChunks(input.userId, record);

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
  await removeKnowledgeFileChunks(userId, fileId);
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

/**
 * Search local knowledge chunks with hybrid vector and lexical scoring.
 *
 * @param input User scope, retrieval query, optional file filter and hit limit.
 * @returns Ranked chunk hits with file metadata and score breakdown.
 */
export async function searchKnowledgeChunks(input: KnowledgeChunkSearchInput): Promise<KnowledgeChunkSearchHit[]> {
  const manifest = await readManifest(input.userId);
  const index = await ensureKnowledgeChunkIndex(input.userId);
  const fileById = new Map(manifest.files.map((file) => [file.fileId, file]));
  const queryTerms = extractQueryTerms(input.query);
  const queryEmbeddingResult = await buildEmbeddingsForTexts([input.query]);
  const queryEmbedding = queryEmbeddingResult.vectors[0] ?? buildLocalEmbedding(input.query);
  const fileIdSet = input.fileIds?.length ? new Set(input.fileIds) : null;
  const limit = clampInt(input.limit ?? 12, 1, 80);

  return index.chunks
    .filter((chunk) => fileById.has(chunk.fileId))
    .filter((chunk) => !fileIdSet || fileIdSet.has(chunk.fileId))
    .map((chunk) => {
      const lexicalScore = scoreText(`${chunk.title}\n${chunk.keywords.join(" ")}\n${chunk.text}`, queryTerms);
      const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
      const querylessBoost = queryTerms.length === 0 ? 0.1 : 0;
      const score = vectorScore * 10 + lexicalScore + querylessBoost;
      return {
        chunk,
        file: fileById.get(chunk.fileId)!,
        score,
        lexicalScore,
        vectorScore,
      };
    })
    .sort((left, right) => right.score - left.score || Date.parse(right.chunk.updatedAt) - Date.parse(left.chunk.updatedAt))
    .slice(0, limit);
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
  return buildKnowledgeContextForQuery({ userId, fileIds });
}

/**
 * Build a query-aware local knowledge context for rubric/research grounding.
 *
 * @param input User scope, optional file selection, and retrieval query.
 * @returns Prompt-ready context with file structure and relevant snippets.
 */
export async function buildKnowledgeContextForQuery(input: KnowledgeContextBuildInput): Promise<string> {
  const manifest = await readManifest(input.userId);
  let files = manifest.files;
  const query = input.query?.trim() ?? "";
  const queryTerms = extractQueryTerms(query);
  const maxFiles = clampInt(input.maxFiles ?? 6, 1, 20);
  const maxSnippetsPerFile = clampInt(input.maxSnippetsPerFile ?? 3, 1, 8);
  const maxCharsPerSnippet = clampInt(input.maxCharsPerSnippet ?? 1200, 200, 4000);
  const maxTotalChars = clampInt(input.maxTotalChars ?? 18000, 2000, 60000);
  const maxChunkHits = clampInt(input.maxSnippetsPerFile ?? 12, 3, 30);

  if (input.fileIds && input.fileIds.length > 0) {
    const idSet = new Set(input.fileIds);
    files = files.filter((file) => idSet.has(file.fileId));
  }

  if (files.length === 0) {
    return "";
  }

  const chunkContext = await buildChunkIndexContext({
    userId: input.userId,
    query,
    fileIds: files.map((file) => file.fileId),
    maxChunkHits,
    maxTotalChars,
  });
  if (chunkContext) {
    return chunkContext;
  }

  const analyses = await Promise.all(
    files.map((file) => analyzeKnowledgeFile(input.userId, file, queryTerms, maxSnippetsPerFile, maxCharsPerSnippet)),
  );
  const ranked = analyses
    .sort((left, right) => right.score - left.score || Date.parse(right.record.updatedAt) - Date.parse(left.record.updatedAt))
    .slice(0, maxFiles);

  const parts: string[] = [
    "## 本地知识库检索上下文",
    query
      ? `检索问题：${query.slice(0, 800)}`
      : "检索问题：未提供，以下为当前选中文件/知识库文件的结构化摘要。",
    `文件范围：${files.length} 个文件；已选取 ${ranked.length} 个最相关文件。`,
    "使用要求：优先从这些本地资料中抽取行业流程、验收标准、风险边界、字段 schema、术语、正负例；每个 rubric 指标尽量绑定资料中的证据片段或结构化规则。",
    "",
  ];

  for (const analysis of ranked) {
    appendAnalysisContext(parts, analysis);
    if (parts.join("\n").length >= maxTotalChars) {
      parts.push("", "... (本地知识库上下文已按长度限制截断)");
      break;
    }
  }

  return parts.join("\n").slice(0, maxTotalChars);
}

/**
 * Rebuild the persisted chunk index for one user.
 *
 * @param userId Knowledge-base owner.
 * @param fileIds Optional file subset to rebuild; omitted means all current files.
 * @returns Rebuilt index summary.
 */
export async function rebuildKnowledgeChunkIndex(
  userId: string,
  fileIds?: string[],
): Promise<{ chunkCount: number; fileCount: number; embeddingProvider: string; embeddingModel: string }> {
  const manifest = await readManifest(userId);
  const fileIdSet = fileIds?.length ? new Set(fileIds) : null;
  const files = manifest.files.filter((file) => !fileIdSet || fileIdSet.has(file.fileId));
  const existing = fileIdSet ? await readChunkIndex(userId) : emptyChunkIndex(userId);
  existing.chunks = fileIdSet
    ? existing.chunks.filter((chunk) => !fileIdSet.has(chunk.fileId))
    : [];

  for (const file of files) {
    const chunks = await buildChunksForFile(userId, file);
    applyChunkMetadataToIndex(existing, chunks);
    existing.chunks.push(...chunks);
  }
  await writeChunkIndex(existing);
  return {
    chunkCount: existing.chunks.length,
    fileCount: files.length,
    embeddingProvider: existing.embeddingProvider,
    embeddingModel: existing.embeddingModel,
  };
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

/**
 * Ensure the chunk index exists and covers every current textual file.
 *
 * @param userId Knowledge-base owner.
 * @returns Fresh or existing chunk index.
 */
async function ensureKnowledgeChunkIndex(userId: string): Promise<KnowledgeChunkIndex> {
  const manifest = await readManifest(userId);
  const index = await readChunkIndex(userId);
  const indexedFileIds = new Set(index.chunks.map((chunk) => chunk.fileId));
  const currentFileIds = new Set(manifest.files.map((file) => file.fileId));
  const originalChunkCount = index.chunks.length;
  let changed = false;

  index.chunks = index.chunks.filter((chunk) => currentFileIds.has(chunk.fileId));
  if (index.chunks.length !== originalChunkCount) {
    changed = true;
  }

  for (const file of manifest.files) {
    if (!isTextualKnowledgeFile(file)) continue;
    if (!indexedFileIds.has(file.fileId)) {
      const chunks = await buildChunksForFile(userId, file);
      applyChunkMetadataToIndex(index, chunks);
      index.chunks.push(...chunks);
      changed = true;
    }
  }

  if (changed) {
    await writeChunkIndex(index);
  }
  return index;
}

/**
 * Replace chunk records for one uploaded or updated file.
 *
 * @param userId Knowledge-base owner.
 * @param file File record to index.
 */
async function upsertKnowledgeFileChunks(userId: string, file: KnowledgeFileRecord): Promise<void> {
  const index = await readChunkIndex(userId);
  const chunks = await buildChunksForFile(userId, file);
  applyChunkMetadataToIndex(index, chunks);
  index.chunks = [
    ...index.chunks.filter((chunk) => chunk.fileId !== file.fileId),
    ...chunks,
  ];
  await writeChunkIndex(index);
}

/**
 * Remove all chunk records for one deleted file.
 *
 * @param userId Knowledge-base owner.
 * @param fileId Deleted file id.
 */
async function removeKnowledgeFileChunks(userId: string, fileId: string): Promise<void> {
  const index = await readChunkIndex(userId);
  const nextChunks = index.chunks.filter((chunk) => chunk.fileId !== fileId);
  if (nextChunks.length === index.chunks.length) return;
  await writeChunkIndex({ ...index, chunks: nextChunks });
}

/**
 * Align chunk-index embedding metadata with newly produced chunks.
 *
 * @param index Mutable chunk index.
 * @param chunks Newly built chunks that share one embedding config.
 */
function applyChunkMetadataToIndex(index: KnowledgeChunkIndex, chunks: KnowledgeChunkRecord[]): void {
  const firstChunk = chunks[0];
  if (!firstChunk) return;
  index.embeddingProvider = firstChunk.embeddingProvider;
  index.embeddingModel = firstChunk.embeddingModel;
  index.embeddingSignature = firstChunk.embeddingSignature;
  index.embeddingDimension = firstChunk.embedding.length;
}

/**
 * Build chunk records for one knowledge file.
 *
 * @param userId Knowledge-base owner.
 * @param file File metadata record.
 * @returns Chunk records with embeddings and line provenance.
 */
async function buildChunksForFile(userId: string, file: KnowledgeFileRecord): Promise<KnowledgeChunkRecord[]> {
  if (!isTextualKnowledgeFile(file)) return [];
  const result = await readKnowledgeFileText(userId, file.fileId);
  const text = result?.text ?? file.contentPreview;
  const chunks = splitTextIntoIndexedChunks(file.fileType, text);
  const now = new Date().toISOString();
  const embeddingResult = await buildEmbeddingsForTexts(chunks.map((chunk) => `${chunk.title}\n${chunk.text}`));
  return chunks.map((chunk, index) => {
    const keywords = extractQueryTerms(`${chunk.title}\n${chunk.text}`).slice(0, 40);
    return {
      chunkId: `kc_${file.fileId}_${String(index + 1).padStart(4, "0")}_${stableHash(`${chunk.title}\n${chunk.text}`).slice(0, 8)}`,
      userId,
      fileId: file.fileId,
      fileName: file.originalName,
      fileType: file.fileType,
      title: chunk.title,
      text: chunk.text,
      preview: chunk.text.slice(0, 360),
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      keywords,
      embedding: embeddingResult.vectors[index] ?? buildLocalEmbedding(`${chunk.title}\n${chunk.text}`),
      embeddingProvider: embeddingResult.config.provider,
      embeddingModel: embeddingResult.config.model,
      embeddingSignature: embeddingResult.config.signature,
      createdAt: now,
      updatedAt: now,
    };
  });
}

/**
 * Build prompt context from ranked chunk hits.
 *
 * @param input User, query, file filter and output limits.
 * @returns Context string with provenance, or empty when no chunks are available.
 */
async function buildChunkIndexContext(input: {
  userId: string;
  query: string;
  fileIds: string[];
  maxChunkHits: number;
  maxTotalChars: number;
}): Promise<string> {
  const hits = await searchKnowledgeChunks({
    userId: input.userId,
    query: input.query,
    fileIds: input.fileIds,
    limit: input.maxChunkHits,
  });
  if (hits.length === 0) return "";

  const files = new Map(hits.map((hit) => [hit.file.fileId, hit.file]));
  const parts: string[] = [
    "## 本地知识库检索上下文",
    input.query
      ? `检索问题：${input.query.slice(0, 800)}`
      : "检索问题：未提供，以下为当前知识库 chunk index 的高优先级片段。",
    `检索方式：本地 chunk index + 轻量 embedding/关键词混合排序；命中 ${hits.length} 个片段，覆盖 ${files.size} 个文件。`,
    "使用要求：生成 rubric 时优先引用这些 chunk 的 provenance。每个由本地知识库支撑的指标，应在 criteria 或 references.relevance 中保留 fileId/chunkId/line 范围。",
    "",
    "### 命中文件",
    ...[...files.values()].map((file) => `- ${file.originalName} (fileId=${file.fileId}, type=${file.fileType}, tags=${file.tags.join(", ") || "none"})`),
    "",
    "### 命中片段",
  ];

  for (const hit of hits) {
    const chunk = hit.chunk;
    parts.push(`#### ${chunk.title}`);
    parts.push(`provenance: file=${hit.file.originalName}; fileId=${chunk.fileId}; chunkId=${chunk.chunkId}; lines=${chunk.startLine}-${chunk.endLine}; score=${hit.score.toFixed(3)}; vector=${hit.vectorScore.toFixed(3)}; lexical=${hit.lexicalScore.toFixed(3)}`);
    if (chunk.keywords.length > 0) {
      parts.push(`keywords: ${chunk.keywords.slice(0, 16).join(", ")}`);
    }
    parts.push("```");
    parts.push(chunk.text.trim());
    parts.push("```");
    parts.push("");
    if (parts.join("\n").length >= input.maxTotalChars) {
      parts.push("... (chunk context truncated)");
      break;
    }
  }

  return parts.join("\n").slice(0, input.maxTotalChars);
}

type IndexedTextChunk = {
  title: string;
  text: string;
  startLine: number;
  endLine: number;
};

/**
 * Split text into persisted chunks with line ranges.
 *
 * @param fileType Knowledge file type.
 * @param text Source text.
 * @returns Indexed chunks.
 */
function splitTextIntoIndexedChunks(fileType: KnowledgeFileType, text: string): IndexedTextChunk[] {
  if (!text.trim()) return [];
  if (fileType === "markdown") return splitMarkdownIndexedChunks(text);
  if (fileType === "csv") return splitCsvIndexedChunks(text);
  if (fileType === "json") return splitJsonIndexedChunks(text);
  return splitPlainIndexedChunks(text, fileType === "code" ? "Code" : "Text");
}

/**
 * Split Markdown by headings while preserving line ranges.
 *
 * @param text Markdown text.
 * @returns Indexed chunks.
 */
function splitMarkdownIndexedChunks(text: string): IndexedTextChunk[] {
  const lines = text.split(/\r?\n/);
  const headingIndexes = lines
    .map((line, index) => ({ line, index }))
    .filter((item) => /^#{1,6}\s+/.test(item.line.trim()))
    .map((item) => item.index);
  if (headingIndexes.length === 0) return splitPlainIndexedChunks(text, "Markdown");

  const chunks: IndexedTextChunk[] = [];
  for (let index = 0; index < headingIndexes.length; index += 1) {
    const start = headingIndexes[index];
    const end = (headingIndexes[index + 1] ?? lines.length) - 1;
    const sectionLines = lines.slice(start, end + 1);
    const title = sectionLines[0]?.replace(/^#+\s+/, "").trim() || `Markdown section ${index + 1}`;
    chunks.push(...splitLongLineChunk(title, sectionLines.join("\n"), start + 1));
  }
  return chunks;
}

/**
 * Split CSV into header-preserving row windows.
 *
 * @param text CSV text.
 * @returns Indexed chunks.
 */
function splitCsvIndexedChunks(text: string): IndexedTextChunk[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length === 0) return [];
  const header = lines[0];
  const chunks: IndexedTextChunk[] = [];
  for (let index = 1; index < lines.length; index += 25) {
    const endIndex = Math.min(index + 24, lines.length - 1);
    chunks.push({
      title: `CSV rows ${index}-${endIndex}`,
      text: [header, ...lines.slice(index, endIndex + 1)].join("\n"),
      startLine: index + 1,
      endLine: endIndex + 1,
    });
  }
  return chunks.length ? chunks : [{ title: "CSV header", text: header, startLine: 1, endLine: 1 }];
}

/**
 * Split JSON into object fields or array item windows.
 *
 * @param text JSON text.
 * @returns Indexed chunks.
 */
function splitJsonIndexedChunks(text: string): IndexedTextChunk[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.slice(0, 80).map((item, index) => ({
        title: `JSON item ${index + 1}`,
        text: JSON.stringify(item, null, 2),
        startLine: 1,
        endLine: text.split(/\r?\n/).length,
      }));
    }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>).slice(0, 80).map(([key, value]) => ({
        title: `JSON field ${key}`,
        text: JSON.stringify({ [key]: value }, null, 2),
        startLine: 1,
        endLine: text.split(/\r?\n/).length,
      }));
    }
  } catch {
    // fall back to plain chunks
  }
  return splitPlainIndexedChunks(text, "JSON text");
}

/**
 * Split generic text into bounded chunks.
 *
 * @param text Source text.
 * @param prefix Chunk title prefix.
 * @returns Indexed chunks.
 */
function splitPlainIndexedChunks(text: string, prefix: string): IndexedTextChunk[] {
  const lines = text.split(/\r?\n/);
  const chunks: IndexedTextChunk[] = [];
  let buffer: string[] = [];
  let startLine = 1;

  for (const [index, line] of lines.entries()) {
    const next = [...buffer, line].join("\n");
    if (next.length > DEFAULT_CHUNK_CHAR_LIMIT && buffer.length > 0) {
      chunks.push({
        title: `${prefix} chunk ${chunks.length + 1}`,
        text: buffer.join("\n").trim(),
        startLine,
        endLine: index,
      });
      buffer = [line];
      startLine = index + 1;
    } else {
      buffer.push(line);
    }
  }
  if (buffer.join("\n").trim()) {
    chunks.push({
      title: `${prefix} chunk ${chunks.length + 1}`,
      text: buffer.join("\n").trim(),
      startLine,
      endLine: lines.length,
    });
  }
  return chunks;
}

/**
 * Split a long section into sub-chunks while keeping approximate start lines.
 *
 * @param title Parent section title.
 * @param text Section text.
 * @param startLine One-based section start line.
 * @returns One or more indexed chunks.
 */
function splitLongLineChunk(title: string, text: string, startLine: number): IndexedTextChunk[] {
  if (text.length <= DEFAULT_CHUNK_CHAR_LIMIT) {
    const lineCount = text.split(/\r?\n/).length;
    return [{ title, text, startLine, endLine: startLine + lineCount - 1 }];
  }
  return splitPlainIndexedChunks(text, title).map((chunk, index) => ({
    ...chunk,
    title: `${title} · part ${index + 1}`,
    startLine: startLine + chunk.startLine - 1,
    endLine: startLine + chunk.endLine - 1,
  }));
}

/**
 * Build embeddings for multiple texts using configured provider with local fallback.
 *
 * @param texts Text batch.
 * @returns Embedding vectors and the provider config that actually produced them.
 */
async function buildEmbeddingsForTexts(texts: string[]): Promise<KnowledgeEmbeddingBatchResult> {
  const config = resolveKnowledgeEmbeddingConfig();
  if (texts.length === 0) return { vectors: [], config };
  if (config.provider === "local") {
    return { vectors: texts.map(buildLocalEmbedding), config };
  }
  try {
    return { vectors: await requestOpenAiCompatibleEmbeddings(texts, config), config };
  } catch {
    const fallbackConfig = resolveLocalKnowledgeEmbeddingConfig();
    return { vectors: texts.map(buildLocalEmbedding), config: fallbackConfig };
  }
}

/**
 * Request embeddings from an OpenAI-compatible provider.
 *
 * @param texts Text batch.
 * @param config Embedding provider config.
 * @returns Embedding vectors aligned with input texts.
 */
async function requestOpenAiCompatibleEmbeddings(
  texts: string[],
  config: KnowledgeEmbeddingConfig,
): Promise<number[][]> {
  if (!config.baseUrl || !config.apiKey) {
    throw new Error("Embedding provider is missing baseUrl or apiKey.");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_EMBEDDING_TIMEOUT_MS);
  try {
    const requestBody: Record<string, unknown> = {
      model: config.model,
      input: texts,
    };
    if (typeof config.dimensions === "number" && config.dimensions > 0) {
      requestBody.dimensions = config.dimensions;
    }
    const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({}))) as EmbeddingsResponse;
    if (!response.ok) {
      throw new Error(`Embedding request failed: ${response.status} ${payload.error?.message ?? ""}`.trim());
    }
    const byIndex = new Map<number, number[]>();
    for (const [fallbackIndex, item] of (payload.data ?? []).entries()) {
      if (!Array.isArray(item.embedding)) continue;
      byIndex.set(typeof item.index === "number" ? item.index : fallbackIndex, normalizeEmbedding(item.embedding));
    }
    const vectors = texts.map((text, index) => byIndex.get(index) ?? buildLocalEmbedding(text));
    if (vectors.length !== texts.length) {
      throw new Error("Embedding provider returned a mismatched vector count.");
    }
    return vectors;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Resolve knowledge embedding provider configuration.
 *
 * @returns Local or OpenAI-compatible embedding config.
 */
function resolveKnowledgeEmbeddingConfig(): KnowledgeEmbeddingConfig {
  const model = readZevalEnvValue([
    "ZEVAL_KNOWLEDGE_EMBEDDING_MODEL",
    "ZEVAL_EMBEDDING_MODEL",
  ])?.trim();
  const apiKey = readZevalEnvValue([
    "ZEVAL_KNOWLEDGE_EMBEDDING_API_KEY",
    "ZEVAL_EMBEDDING_API_KEY",
    "ZEVAL_JUDGE_API_KEY",
    "SILICONFLOW_API_KEY",
  ])?.trim();
  const baseUrl = readZevalEnvValue([
    "ZEVAL_KNOWLEDGE_EMBEDDING_BASE_URL",
    "ZEVAL_EMBEDDING_BASE_URL",
    "ZEVAL_JUDGE_BASE_URL",
    "SILICONFLOW_BASE_URL",
  ])?.trim();
  const dimensions = Number(readZevalEnvValue([
    "ZEVAL_KNOWLEDGE_EMBEDDING_DIMENSIONS",
    "ZEVAL_EMBEDDING_DIMENSIONS",
  ]));

  if (model && apiKey && baseUrl && !isPlaceholderApiKey(apiKey)) {
    const normalizedDimensions = Number.isFinite(dimensions) && dimensions > 0 ? Math.round(dimensions) : undefined;
    return {
      provider: "openai_compatible",
      model,
      apiKey,
      baseUrl,
      dimensions: normalizedDimensions,
      signature: [
        "openai_compatible",
        baseUrl.replace(/\/$/, ""),
        model,
        normalizedDimensions ?? "provider_default",
      ].join(":"),
    };
  }
  return resolveLocalKnowledgeEmbeddingConfig();
}

/**
 * Resolve the deterministic local embedding fallback config.
 *
 * @returns Local embedding config used when no external provider is available.
 */
function resolveLocalKnowledgeEmbeddingConfig(): KnowledgeEmbeddingConfig {
  return {
    provider: "local",
    model: "lexical_hash_v2",
    signature: `local:lexical_hash_v2:${EMBEDDING_DIMENSION}`,
  };
}

function resolveEmbeddingDimension(config: KnowledgeEmbeddingConfig): number {
  return config.provider === "local" ? EMBEDDING_DIMENSION : config.dimensions ?? -1;
}

function isPlaceholderApiKey(value: string): boolean {
  return /^(YOUR_API_KEY_HERE|REPLACE_ME|TODO|CHANGEME)$/i.test(value.trim());
}

function normalizeEmbedding(values: number[]): number[] {
  const norm = Math.sqrt(values.reduce((sum, value) => sum + value ** 2, 0));
  if (norm === 0) return values;
  return values.map((value) => Number((value / norm).toFixed(6)));
}

/**
 * Build a deterministic local embedding with feature hashing.
 *
 * @param text Text to embed.
 * @returns L2-normalized vector.
 */
function buildLocalEmbedding(text: string): number[] {
  const vector = Array.from({ length: EMBEDDING_DIMENSION }, () => 0);
  const terms = extractEmbeddingTerms(text);
  for (const term of terms) {
    const hash = hashNumber(term);
    const index = Math.abs(hash) % EMBEDDING_DIMENSION;
    const sign = hash % 2 === 0 ? 1 : -1;
    vector[index] += sign * termWeight(term);
  }
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value ** 2, 0));
  return norm > 0 ? vector.map((value) => Number((value / norm).toFixed(6))) : vector;
}

/**
 * Compute cosine similarity for two normalized-ish vectors.
 *
 * @param left First vector.
 * @param right Second vector.
 * @returns Cosine similarity in the approximate range [-1, 1].
 */
function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const length = Math.min(left.length, right.length);
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
    leftNorm += (left[index] ?? 0) ** 2;
    rightNorm += (right[index] ?? 0) ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / Math.sqrt(leftNorm * rightNorm);
}

/**
 * Extract terms for the local embedding.
 *
 * @param text Text to tokenize.
 * @returns Unique lexical and CJK n-gram terms.
 */
function extractEmbeddingTerms(text: string): string[] {
  const baseTerms = extractQueryTerms(text);
  const latinTokens = text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [];
  const terms = new Set(baseTerms);
  for (const token of latinTokens) {
    terms.add(token);
    for (let index = 0; index <= token.length - 4; index += 1) {
      terms.add(token.slice(index, index + 4));
    }
  }
  return [...terms].slice(0, 400);
}

/**
 * Build a short stable hash string.
 *
 * @param value Input text.
 * @returns Unsigned hex hash.
 */
function stableHash(value: string): string {
  return (hashNumber(value) >>> 0).toString(16).padStart(8, "0");
}

/**
 * Hash a string into a signed 32-bit integer.
 *
 * @param value Input text.
 * @returns Signed integer hash.
 */
function hashNumber(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

/**
 * Analyze one knowledge file into structure hints and relevant snippets.
 *
 * @param userId Knowledge-base owner.
 * @param file File metadata record.
 * @param queryTerms Tokenized retrieval query.
 * @param maxSnippets Max snippets to keep.
 * @param maxCharsPerSnippet Max characters per snippet.
 * @returns File-level analysis for prompt context.
 */
async function analyzeKnowledgeFile(
  userId: string,
  file: KnowledgeFileRecord,
  queryTerms: string[],
  maxSnippets: number,
  maxCharsPerSnippet: number,
): Promise<KnowledgeFileAnalysis> {
  const metadataText = [
    file.originalName,
    file.fileName,
    file.description,
    file.tags.join(" "),
    file.contentPreview,
  ].join("\n");
  const metadataScore = scoreText(metadataText, queryTerms);

  if (!isTextualKnowledgeFile(file)) {
    return {
      record: file,
      structure: [`非文本文件：当前只能提供文件元数据；需要后续接入 PDF/DOC 解析器。`],
      snippets: [{
        title: "文件预览",
        text: file.contentPreview,
        score: metadataScore,
      }],
      score: metadataScore,
    };
  }

  const result = await readKnowledgeFileText(userId, file.fileId);
  const text = result?.text ?? file.contentPreview;
  const structure = analyzeTextStructure(file.fileType, text);
  const snippets = buildKnowledgeSnippets(text, file.fileType)
    .map((snippet) => ({
      ...snippet,
      score: snippet.score + scoreText(`${snippet.title}\n${snippet.text}`, queryTerms),
      text: snippet.text.slice(0, maxCharsPerSnippet),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, maxSnippets);

  if (snippets.length === 0 && text.trim()) {
    snippets.push({
      title: "文件开头",
      text: text.trim().slice(0, maxCharsPerSnippet),
      score: metadataScore,
    });
  }

  return {
    record: file,
    text,
    structure,
    snippets,
    score: metadataScore + snippets.reduce((score, snippet) => score + snippet.score, 0),
  };
}

/**
 * Append one file analysis to the prompt context.
 *
 * @param parts Mutable prompt parts.
 * @param analysis File analysis.
 */
function appendAnalysisContext(parts: string[], analysis: KnowledgeFileAnalysis): void {
  const file = analysis.record;
  parts.push(`### ${file.originalName} (ID: ${file.fileId})`);
  parts.push(`类型: ${file.fileType} | 大小: ${formatBytes(file.sizeBytes)} | 相关度: ${analysis.score.toFixed(2)}`);
  if (file.description.trim()) parts.push(`描述: ${file.description.trim()}`);
  if (file.tags.length > 0) parts.push(`标签: ${file.tags.join(", ")}`);
  if (analysis.structure.length > 0) {
    parts.push("结构化线索:");
    for (const line of analysis.structure.slice(0, 8)) {
      parts.push(`- ${line}`);
    }
  }
  if (analysis.snippets.length > 0) {
    parts.push("相关片段:");
    for (const snippet of analysis.snippets) {
      parts.push(`#### ${snippet.title} (score ${snippet.score.toFixed(2)})`);
      parts.push("```");
      parts.push(snippet.text.trim());
      parts.push("```");
    }
  }
  parts.push("");
}

function isTextualKnowledgeFile(file: KnowledgeFileRecord): boolean {
  return (
    file.fileType === "text" ||
    file.fileType === "markdown" ||
    file.fileType === "json" ||
    file.fileType === "csv" ||
    file.fileType === "code"
  );
}

function analyzeTextStructure(fileType: KnowledgeFileType, text: string): string[] {
  if (!text.trim()) return [];
  if (fileType === "csv") return analyzeCsvStructure(text);
  if (fileType === "json") return analyzeJsonStructure(text);
  if (fileType === "markdown") return analyzeMarkdownStructure(text);
  if (fileType === "code") return analyzeCodeStructure(text);
  return analyzePlainTextStructure(text);
}

function analyzeCsvStructure(text: string): string[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 30);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((cell) => cell.trim()).filter(Boolean);
  const sampleRows = Math.max(0, lines.length - 1);
  return [
    headers.length ? `CSV 字段: ${headers.slice(0, 24).join(", ")}` : "CSV 未识别到表头。",
    `样例行数: ${sampleRows}${text.split(/\r?\n/).length > lines.length ? "；文件更长，已截取前部分析" : ""}`,
  ];
}

function analyzeJsonStructure(text: string): string[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      const first = parsed.find((item) => item && typeof item === "object") as Record<string, unknown> | undefined;
      return [
        `JSON 数组: ${parsed.length} 项`,
        first ? `首项字段: ${Object.keys(first).slice(0, 24).join(", ")}` : "首项不是对象。",
      ];
    }
    if (parsed && typeof parsed === "object") {
      return [`JSON 对象字段: ${Object.keys(parsed as Record<string, unknown>).slice(0, 30).join(", ")}`];
    }
    return [`JSON 标量: ${typeof parsed}`];
  } catch {
    return ["JSON 解析失败，按文本片段处理。"];
  }
}

function analyzeMarkdownStructure(text: string): string[] {
  const headings = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^#{1,6}\s+/.test(line))
    .slice(0, 12);
  return headings.length
    ? headings.map((heading) => `标题: ${heading.replace(/^#+\s+/, "")}`)
    : analyzePlainTextStructure(text);
}

function analyzeCodeStructure(text: string): string[] {
  const exported = [...text.matchAll(/\b(export\s+)?(function|class|type|interface|const)\s+([A-Za-z0-9_$]+)/g)]
    .map((match) => `${match[2]} ${match[3]}`)
    .slice(0, 16);
  return exported.length ? exported.map((item) => `代码符号: ${item}`) : analyzePlainTextStructure(text);
}

function analyzePlainTextStructure(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return [
    `文本行数: ${lines.length}`,
    `前置主题: ${lines.slice(0, 3).join(" / ").slice(0, 300)}`,
  ];
}

function buildKnowledgeSnippets(text: string, fileType: KnowledgeFileType): KnowledgeSnippet[] {
  if (!text.trim()) return [];
  if (fileType === "markdown") return splitMarkdownSnippets(text);
  if (fileType === "csv") return splitCsvSnippets(text);
  if (fileType === "json") return splitJsonSnippets(text);
  return splitTextSnippets(text);
}

function splitMarkdownSnippets(text: string): KnowledgeSnippet[] {
  const sections = text.split(/(?=^#{1,6}\s+)/m).map((section) => section.trim()).filter(Boolean);
  return sections.slice(0, 40).map((section, index) => {
    const firstLine = section.split(/\r?\n/, 1)[0]?.replace(/^#+\s+/, "").trim();
    return {
      title: firstLine || `Markdown section ${index + 1}`,
      text: section,
      score: 0,
    };
  });
}

function splitCsvSnippets(text: string): KnowledgeSnippet[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const header = lines[0] ?? "";
  const chunks: KnowledgeSnippet[] = [];
  for (let index = 1; index < lines.length && chunks.length < 20; index += 12) {
    chunks.push({
      title: `CSV rows ${index}-${Math.min(index + 11, lines.length - 1)}`,
      text: [header, ...lines.slice(index, index + 12)].join("\n"),
      score: 0,
    });
  }
  return chunks.length ? chunks : [{ title: "CSV preview", text: lines.slice(0, 20).join("\n"), score: 0 }];
}

function splitJsonSnippets(text: string): KnowledgeSnippet[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.slice(0, 20).map((item, index) => ({
        title: `JSON item ${index + 1}`,
        text: JSON.stringify(item, null, 2),
        score: 0,
      }));
    }
    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed as Record<string, unknown>).slice(0, 24).map(([key, value]) => ({
        title: `JSON field ${key}`,
        text: JSON.stringify({ [key]: value }, null, 2),
        score: 0,
      }));
    }
  } catch {
    // fall through to text snippets
  }
  return splitTextSnippets(text);
}

function splitTextSnippets(text: string): KnowledgeSnippet[] {
  const paragraphs = text.split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  const chunks: KnowledgeSnippet[] = [];
  let buffer = "";
  for (const paragraph of paragraphs.length ? paragraphs : text.split(/\r?\n/)) {
    const next = buffer ? `${buffer}\n\n${paragraph}` : paragraph;
    if (next.length > 1400 && buffer) {
      chunks.push({ title: `Text chunk ${chunks.length + 1}`, text: buffer, score: 0 });
      buffer = paragraph;
    } else {
      buffer = next;
    }
    if (chunks.length >= 40) break;
  }
  if (buffer.trim() && chunks.length < 40) {
    chunks.push({ title: `Text chunk ${chunks.length + 1}`, text: buffer, score: 0 });
  }
  return chunks;
}

function scoreText(text: string, terms: string[]): number {
  if (terms.length === 0) return 0;
  const normalized = text.toLowerCase();
  return terms.reduce((score, term) => {
    if (!term) return score;
    let count = 0;
    let index = normalized.indexOf(term);
    while (index >= 0 && count < 8) {
      count += 1;
      index = normalized.indexOf(term, index + term.length);
    }
    return score + count * termWeight(term);
  }, 0);
}

function termWeight(term: string): number {
  if (/^[\u4E00-\u9FFF]+$/.test(term)) return Math.min(3, Math.max(1, term.length / 2));
  return term.length >= 6 ? 2 : 1;
}

function extractQueryTerms(query: string): string[] {
  const normalized = query.toLowerCase();
  const tokens = normalized.match(/[\p{Script=Han}A-Za-z0-9_]+/gu) ?? [];
  const terms = new Set<string>();
  for (const token of tokens) {
    if (/^[a-z0-9_]+$/.test(token) && token.length >= 2) {
      terms.add(token);
      continue;
    }
    if (/^[\u4E00-\u9FFF]+$/.test(token)) {
      terms.add(token);
      for (const gram of buildCjkNgrams(token)) terms.add(gram);
    }
  }
  return [...terms].slice(0, 160);
}

function buildCjkNgrams(value: string): string[] {
  const grams: string[] = [];
  for (const size of [2, 3, 4]) {
    for (let index = 0; index <= value.length - size; index += 1) {
      grams.push(value.slice(index, index + size));
    }
  }
  return grams;
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${Number.parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i] ?? "B"}`;
}
