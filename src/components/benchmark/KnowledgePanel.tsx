/**
 * @fileoverview 知识库面板 — 文件上传、管理、预览
 *
 * 用户上传的文件持久化保存，作为 Zeval Agent 的知识库上下文。
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import styles from "./benchmarkConsole.module.css";

type KnowledgeFile = {
  fileId: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  tags: string[];
  description: string;
  uploadedAt: string;
  accessCount: number;
  preview?: string;
};

type KnowledgePanelProps = {
  userId?: string;
};

export function KnowledgePanel(props: KnowledgePanelProps) {
  const userId = props.userId ?? "default";
  const [files, setFiles] = useState<KnowledgeFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const [selectedFile, setSelectedFile] = useState<KnowledgeFile | null>(null);
  const [filePreview, setFilePreview] = useState("");
  const [tagsInput, setTagsInput] = useState("");
  const [descriptionInput, setDescriptionInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchFiles = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const url = searchKeyword
        ? `/api/benchmarks/knowledge?userId=${encodeURIComponent(userId)}&keyword=${encodeURIComponent(searchKeyword)}`
        : `/api/benchmarks/knowledge?userId=${encodeURIComponent(userId)}`;
      const res = await fetch(url);
      const data = (await res.json()) as { files: KnowledgeFile[]; total: number; error?: string };
      if (!res.ok) throw new Error(data.error ?? "查询失败");
      setFiles(data.files);
    } catch (err) {
      setError(err instanceof Error ? err.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }, [userId, searchKeyword]);

  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  async function handleUpload(filesList: FileList | null) {
    if (!filesList || filesList.length === 0) return;
    setUploading(true);
    setError("");

    for (const file of Array.from(filesList)) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", userId);
      formData.append("tags", tagsInput);
      formData.append("description", descriptionInput);

      try {
        const res = await fetch("/api/benchmarks/knowledge", { method: "POST", body: formData });
        const data = (await res.json()) as { success?: boolean; error?: string };
        if (!res.ok || !data.success) {
          throw new Error(data.error ?? "上传失败");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "上传失败");
        setUploading(false);
        return;
      }
    }

    setUploading(false);
    setTagsInput("");
    setDescriptionInput("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    fetchFiles();
  }

  async function handleDelete(fileId: string) {
    if (!confirm("确定要删除这个文件吗？")) return;
    setError("");
    try {
      const res = await fetch(
        `/api/benchmarks/knowledge?userId=${encodeURIComponent(userId)}&fileId=${encodeURIComponent(fileId)}`,
        { method: "DELETE" }
      );
      const data = (await res.json()) as { success?: boolean; error?: string };
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? "删除失败");
      }
      setSelectedFile(null);
      setFilePreview("");
      fetchFiles();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  async function handlePreview(file: KnowledgeFile) {
    setSelectedFile(file);
    setFilePreview("");
    if (file.fileType === "text" || file.fileType === "markdown" || file.fileType === "json" || file.fileType === "csv" || file.fileType === "code") {
      try {
        const res = await fetch(`/api/benchmarks/knowledge/file?userId=${encodeURIComponent(userId)}&fileId=${encodeURIComponent(file.fileId)}`);
        const data = (await res.json()) as { text?: string; error?: string };
        if (data.text) {
          setFilePreview(data.text.slice(0, 3000));
        } else {
          setFilePreview("[无法预览此文件内容]");
        }
      } catch {
        setFilePreview("[预览加载失败]");
      }
    } else {
      setFilePreview(`[${file.fileType} 文件，暂不支持预览]`);
    }
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i] ?? "B"}`;
  }

  function getFileIcon(fileType: string): string {
    switch (fileType) {
      case "text": return "📄";
      case "markdown": return "📝";
      case "json": return "📋";
      case "csv": return "📊";
      case "code": return "💻";
      case "pdf": return "📕";
      case "doc": return "📘";
      default: return "📁";
    }
  }

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {/* 上传区域 */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>📤 上传文件</h2>
            <p>上传文件到知识库，Zeval Agent 可以读取作为评测上下文</p>
          </div>
        </div>

        <div style={{ display: "grid", gap: 10 }}>
          <div
            style={{
              border: "2px dashed var(--bm-line)",
              borderRadius: 8,
              padding: 24,
              textAlign: "center",
              cursor: "pointer",
              background: "var(--bm-bg-2)",
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              handleUpload(e.dataTransfer.files);
            }}
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: "none" }}
              onChange={(e) => handleUpload(e.target.files)}
            />
            <div style={{ fontSize: 32, marginBottom: 8 }}>📂</div>
            <p style={{ margin: 0, color: "var(--bm-ink-2)" }}>
              点击选择文件 或 拖拽文件到此处
            </p>
            <p style={{ margin: "4px 0 0", color: "var(--bm-ink-3)", fontSize: 11 }}>
              支持文本、Markdown、JSON、CSV、代码文件等
            </p>
          </div>

          <div className={styles.formGrid}>
            <div className={styles.field}>
              <span>标签（用逗号分隔）</span>
              <input
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="例如: hr标准, 评测规范, 业务规则"
              />
            </div>
            <div className={styles.field}>
              <span>描述</span>
              <input
                value={descriptionInput}
                onChange={(e) => setDescriptionInput(e.target.value)}
                placeholder="文件用途说明..."
              />
            </div>
          </div>

          {uploading && (
            <p className={styles.notice}>正在上传...</p>
          )}
        </div>
      </div>

      {/* 文件列表 */}
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>📚 知识库文件</h2>
            <p>共 {files.length} 个文件</p>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={searchKeyword}
              onChange={(e) => setSearchKeyword(e.target.value)}
              placeholder="搜索文件..."
              style={{
                minHeight: 32,
                padding: "0 10px",
                border: "1px solid var(--bm-line)",
                borderRadius: 6,
                background: "var(--bm-bg-2)",
                color: "var(--bm-ink)",
                fontSize: 12,
                outline: "none",
              }}
            />
            <button className={styles.secondaryButton} onClick={fetchFiles} disabled={loading}>
              {loading ? "刷新中..." : "刷新"}
            </button>
          </div>
        </div>

        {error && <p className={styles.error}>{error}</p>}

        {files.length === 0 ? (
          <div className={styles.empty}>
            知识库为空。上传文件后，Zeval Agent 可以在评测时引用这些文件作为上下文。
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {files.map((file) => (
              <div
                key={file.fileId}
                style={{
                  display: "grid",
                  gap: 6,
                  padding: 12,
                  border: `1px solid ${selectedFile?.fileId === file.fileId ? "rgba(124, 58, 237, 0.3)" : "var(--bm-line-2)"}`,
                  borderRadius: 6,
                  background: selectedFile?.fileId === file.fileId ? "rgba(124, 58, 237, 0.05)" : "var(--bm-bg-2)",
                  cursor: "pointer",
                }}
                onClick={() => handlePreview(file)}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 18 }}>{getFileIcon(file.fileType)}</span>
                  <strong style={{ fontSize: 13, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {file.fileName}
                  </strong>
                  <span style={{ fontSize: 11, color: "var(--bm-ink-3)", whiteSpace: "nowrap" }}>
                    {formatBytes(file.sizeBytes)}
                  </span>
                  <button
                    className={styles.textButton}
                    onClick={(e) => { e.stopPropagation(); handleDelete(file.fileId); }}
                    style={{ padding: "2px 8px", fontSize: 11, color: "#b91c1c" }}
                  >
                    删除
                  </button>
                </div>

                {file.description && (
                  <p style={{ margin: 0, fontSize: 12, color: "var(--bm-ink-2)" }}>{file.description}</p>
                )}

                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {file.tags.map((tag) => (
                    <span
                      key={tag}
                      style={{
                        padding: "2px 8px",
                        borderRadius: 999,
                        background: "rgba(124, 58, 237, 0.1)",
                        color: "#7c3aed",
                        fontSize: 10,
                        fontWeight: 760,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                  <span style={{ fontSize: 10, color: "var(--bm-ink-3)" }}>
                    上传于 {new Date(file.uploadedAt).toLocaleDateString("zh-CN")} · 访问 {file.accessCount} 次
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 预览区域 */}
      {selectedFile && (
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <div>
              <h2>👁️ 文件预览</h2>
              <p>{selectedFile.fileName}</p>
            </div>
            <button className={styles.secondaryButton} onClick={() => { setSelectedFile(null); setFilePreview(""); }}>
              关闭预览
            </button>
          </div>
          <pre
            style={{
              background: "var(--bm-bg-2)",
              border: "1px solid var(--bm-line-2)",
              borderRadius: 6,
              padding: 12,
              fontSize: 12,
              lineHeight: 1.6,
              maxHeight: 400,
              overflow: "auto",
              color: "var(--bm-ink)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
            }}
          >
            {filePreview || "加载中..."}
          </pre>
        </div>
      )}
    </div>
  );
}
