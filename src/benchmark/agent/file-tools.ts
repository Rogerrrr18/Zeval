/**
 * @fileoverview Zeval Agent 文件系统工具 + 知识库工具
 *
 * 为 Agent 提供文件操作和知识库访问能力：
 * - read_file:      读取项目内或知识库中的文件
 * - write_file:     写入文件到项目目录
 * - list_directory: 列出目录内容
 * - read_knowledge_file: 读取知识库文件
 * - search_knowledge:    搜索知识库
 * - list_knowledge:      列出知识库文件
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentToolHandler, AgentToolRegistry, AgentToolResult, AgentToolSchema } from "./types";
import {
  listKnowledgeFiles,
  readKnowledgeFileText,
  searchKnowledgeFiles,
  buildKnowledgeContext,
  buildKnowledgeFileList,
} from "./knowledge-store";

// ───────────────────────────────────────────────
// Schema 定义
// ───────────────────────────────────────────────

const readFileSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "read_file",
    description: "读取本地文件内容。支持项目文件和知识库文件。知识库文件使用 fileId 格式如 kf_xxx",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "文件路径（项目内）或文件 ID（知识库）" },
        isKnowledgeFile: { type: "boolean", description: "是否为知识库文件，默认 false" },
        userId: { type: "string", description: "用户 ID（读取知识库时需要）" },
        maxLength: { type: "number", description: "最大读取字符数，默认 10000" },
      },
      required: ["filePath"],
    },
  },
};

const writeFileSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "write_file",
    description: "写入内容到项目目录的文件（仅允许写入 artifacts/ 目录下）",
    parameters: {
      type: "object",
      properties: {
        filePath: { type: "string", description: "文件路径（相对项目根目录）" },
        content: { type: "string", description: "文件内容" },
        append: { type: "boolean", description: "是否追加模式，默认 false（覆盖）" },
      },
      required: ["filePath", "content"],
    },
  },
};

const listDirectorySchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "list_directory",
    description: "列出指定目录的内容",
    parameters: {
      type: "object",
      properties: {
        dirPath: { type: "string", description: "目录路径（相对项目根目录）" },
        recursive: { type: "boolean", description: "是否递归列出子目录，默认 false" },
      },
      required: ["dirPath"],
    },
  },
};

const readKnowledgeFileSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "read_knowledge_file",
    description: "读取知识库中的文件内容。需要先调用 list_knowledge 获取 fileId",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "用户 ID" },
        fileId: { type: "string", description: "知识库文件 ID（如 kf_123456_abc）" },
        maxLength: { type: "number", description: "最大读取字符数，默认 10000" },
      },
      required: ["userId", "fileId"],
    },
  },
};

const searchKnowledgeSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "search_knowledge",
    description: "搜索知识库文件。支持关键词、文件类型、标签筛选",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "用户 ID" },
        keyword: { type: "string", description: "搜索关键词" },
        fileType: {
          type: "string",
          description: "文件类型筛选",
          enum: ["text", "markdown", "json", "csv", "pdf", "doc", "code", "unknown"],
        },
        tags: { type: "array", description: "标签筛选", items: { type: "string" } },
        limit: { type: "number", description: "返回数量上限，默认 10" },
      },
      required: ["userId"],
    },
  },
};

const listKnowledgeSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "list_knowledge",
    description: "列出用户知识库中的所有文件",
    parameters: {
      type: "object",
      properties: {
        userId: { type: "string", description: "用户 ID" },
      },
      required: ["userId"],
    },
  },
};

// ───────────────────────────────────────────────
// 安全检查
// ───────────────────────────────────────────────

const ALLOWED_WRITE_ROOT = path.resolve(process.cwd(), "artifacts", "agent-output");

function sanitizePath(inputPath: string): string {
  const normalized = path.normalize(inputPath);
  // 禁止路径穿越
  if (normalized.includes("..") || normalized.startsWith("/") || normalized.match(/^[A-Za-z]:/)) {
    throw new Error("非法路径：禁止路径穿越或绝对路径");
  }
  return normalized;
}

function resolveSafePath(inputPath: string): string {
  const safe = sanitizePath(inputPath);
  return path.resolve(process.cwd(), safe);
}

function ensureWriteSafe(targetPath: string): void {
  const resolved = path.resolve(targetPath);
  const relativeToCwd = path.relative(process.cwd(), resolved);
  // 只允许写入 artifacts/agent-output/ 目录
  if (!relativeToCwd.startsWith("artifacts/agent-output/") && !relativeToCwd.startsWith("artifacts\\agent-output\\")) {
    throw new Error("写入路径受限：只允许写入 artifacts/agent-output/ 目录下");
  }
}

// ───────────────────────────────────────────────
// 工具实现
// ───────────────────────────────────────────────

const readFileHandler: AgentToolHandler = async (args) => {
  const filePath = String(args.filePath ?? "");
  const isKnowledgeFile = Boolean(args.isKnowledgeFile ?? false);
  const userId = String(args.userId ?? "default");
  const maxLength = Math.min(Number(args.maxLength ?? 10000), 50000);

  if (!filePath) return errorResult("read_file", "文件路径不能为空");

  try {
    if (isKnowledgeFile) {
      const result = await readKnowledgeFileText(userId, filePath);
      if (!result) return errorResult("read_file", `知识库文件不存在: ${filePath}`);
      const text = result.text.length > maxLength ? result.text.slice(0, maxLength) + "\n... [内容已截断]" : result.text;
      return successResult("read_file", {
        fileId: filePath,
        fileName: result.record.originalName,
        fileType: result.record.fileType,
        sizeBytes: result.record.sizeBytes,
        content: text,
      });
    }

    const safePath = resolveSafePath(filePath);
    const content = await readFile(safePath, "utf8");
    const text = content.length > maxLength ? content.slice(0, maxLength) + "\n... [内容已截断]" : content;

    return successResult("read_file", {
      filePath: safePath,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      content: text,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("read_file", `读取失败: ${message}`);
  }
};

const writeFileHandler: AgentToolHandler = async (args) => {
  const filePath = String(args.filePath ?? "");
  const content = String(args.content ?? "");
  const append = Boolean(args.append ?? false);

  if (!filePath) return errorResult("write_file", "文件路径不能为空");

  try {
    const safePath = path.join(ALLOWED_WRITE_ROOT, sanitizePath(filePath));
    ensureWriteSafe(safePath);

    const dir = path.dirname(safePath);
    await mkdir(dir, { recursive: true });

    if (append) {
      await writeFile(safePath, content, { flag: "a" });
    } else {
      await writeFile(safePath, content, "utf8");
    }

    return successResult("write_file", {
      filePath: safePath,
      bytesWritten: Buffer.byteLength(content, "utf8"),
      mode: append ? "append" : "overwrite",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("write_file", `写入失败: ${message}`);
  }
};

const listDirectoryHandler: AgentToolHandler = async (args) => {
  const dirPath = String(args.dirPath ?? ".");
  const recursive = Boolean(args.recursive ?? false);

  try {
    const safePath = resolveSafePath(dirPath);
    const items = await readdir(safePath, { withFileTypes: true });

    const result = await Promise.all(
      items.map(async (item) => {
        const itemPath = path.join(safePath, item.name);
        const relativePath = path.relative(process.cwd(), itemPath);

        let size: number | undefined;
        let children: unknown[] | undefined;

        if (item.isFile()) {
          try {
            const s = await stat(itemPath);
            size = s.size;
          } catch { /* ignore */ }
        } else if (item.isDirectory() && recursive) {
          try {
            const subItems = await readdir(itemPath, { withFileTypes: true });
            children = subItems.map((sub) => ({
              name: sub.name,
              type: sub.isDirectory() ? "directory" : "file",
            }));
          } catch { /* ignore */ }
        }

        return {
          name: item.name,
          type: item.isDirectory() ? "directory" : "file",
          path: relativePath,
          size,
          children,
        };
      })
    );

    return successResult("list_directory", {
      dirPath,
      itemCount: result.length,
      items: result,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("list_directory", `列出目录失败: ${message}`);
  }
};

const readKnowledgeFileHandler: AgentToolHandler = async (args) => {
  const userId = String(args.userId ?? "default");
  const fileId = String(args.fileId ?? "");
  const maxLength = Math.min(Number(args.maxLength ?? 10000), 50000);

  if (!fileId) return errorResult("read_knowledge_file", "fileId 不能为空");

  const result = await readKnowledgeFileText(userId, fileId);
  if (!result) return errorResult("read_knowledge_file", `知识库文件不存在: ${fileId}`);

  const text = result.text.length > maxLength ? result.text.slice(0, maxLength) + "\n... [内容已截断]" : result.text;

  return successResult("read_knowledge_file", {
    fileId,
    fileName: result.record.originalName,
    fileType: result.record.fileType,
    tags: result.record.tags,
    description: result.record.description,
    sizeBytes: result.record.sizeBytes,
    content: text,
  });
};

const searchKnowledgeHandler: AgentToolHandler = async (args) => {
  const userId = String(args.userId ?? "default");
  const keyword = args.keyword ? String(args.keyword) : undefined;
  const fileType = args.fileType ? String(args.fileType) as import("./knowledge-store").KnowledgeFileType : undefined;
  const tags = Array.isArray(args.tags) ? args.tags.map(String) : undefined;
  const limit = Number(args.limit ?? 10);

  const result = await searchKnowledgeFiles({ userId, keyword, fileType, tags, limit });

  return successResult("search_knowledge", {
    total: result.total,
    files: result.files.map((f) => ({
      fileId: f.fileId,
      fileName: f.originalName,
      fileType: f.fileType,
      sizeBytes: f.sizeBytes,
      tags: f.tags,
      description: f.description,
      preview: f.contentPreview.slice(0, 500),
    })),
  });
};

const listKnowledgeHandler: AgentToolHandler = async (args) => {
  const userId = String(args.userId ?? "default");
  const files = await listKnowledgeFiles(userId);

  return successResult("list_knowledge", {
    total: files.length,
    files: files.map((f) => ({
      fileId: f.fileId,
      fileName: f.originalName,
      fileType: f.fileType,
      sizeBytes: f.sizeBytes,
      tags: f.tags,
      description: f.description,
      uploadedAt: f.uploadedAt,
      accessCount: f.accessCount,
    })),
  });
};

// ───────────────────────────────────────────────
// 注册表
// ───────────────────────────────────────────────

export function createFileToolRegistry(): AgentToolRegistry {
  const registry = new Map();
  registry.set("read_file", { schema: readFileSchema, handler: readFileHandler });
  registry.set("write_file", { schema: writeFileSchema, handler: writeFileHandler });
  registry.set("list_directory", { schema: listDirectorySchema, handler: listDirectoryHandler });
  registry.set("read_knowledge_file", { schema: readKnowledgeFileSchema, handler: readKnowledgeFileHandler });
  registry.set("search_knowledge", { schema: searchKnowledgeSchema, handler: searchKnowledgeHandler });
  registry.set("list_knowledge", { schema: listKnowledgeSchema, handler: listKnowledgeHandler });
  return registry;
}

// ───────────────────────────────────────────────
// 辅助函数
// ───────────────────────────────────────────────

function successResult(name: string, result: unknown): AgentToolResult {
  return { tool_call_id: "", name, status: "success", result };
}

function errorResult(name: string, error: string): AgentToolResult {
  return { tool_call_id: "", name, status: "error", result: null, error };
}

export { buildKnowledgeContext, buildKnowledgeFileList };
