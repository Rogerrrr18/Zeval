/**
 * @fileoverview Agent 活动面板 — 展示 Zeval Agent 的工具调用历史
 *
 * 实时显示 Agent 执行过程中的：
 * - 网络搜索记录（web_search, fetch_url）
 * - GitHub MCP 操作（github_read_file, github_search_code, github_get_issue 等）
 * - 评测工具调用（evaluate_metric, compare_submissions 等）
 * - 文件系统操作（read_file, write_file）
 */

"use client";

import { useMemo } from "react";
import styles from "./benchmarkConsole.module.css";

type ToolCallRecord = {
  id: string;
  toolName: string;
  arguments: Record<string, unknown>;
  result?: unknown;
  error?: string;
  status: "running" | "success" | "error";
  timestamp: string;
  durationMs: number;
};

type AgentActivityPanelProps = {
  calls: ToolCallRecord[];
  onClose?: () => void;
};

export function AgentActivityPanel(props: AgentActivityPanelProps) {
  const { calls } = props;

  const grouped = useMemo(() => {
    const groups: Record<string, ToolCallRecord[]> = {
      github: [],
      web: [],
      eval: [],
      file: [],
      other: [],
    };

    for (const call of calls) {
      if (call.toolName.startsWith("github_")) {
        groups.github.push(call);
      } else if (call.toolName.startsWith("web_") || call.toolName === "fetch_url" || call.toolName === "fetch_api") {
        groups.web.push(call);
      } else if (
        call.toolName.startsWith("evaluate_") ||
        call.toolName.startsWith("compare_") ||
        call.toolName.startsWith("analyze_") ||
        call.toolName.startsWith("mine_") ||
        call.toolName.startsWith("generate_") ||
        call.toolName.startsWith("summarize_")
      ) {
        groups.eval.push(call);
      } else if (call.toolName.startsWith("read_") || call.toolName.startsWith("write_") || call.toolName.startsWith("list_")) {
        groups.file.push(call);
      } else {
        groups.other.push(call);
      }
    }

    return groups;
  }, [calls]);

  function getToolIcon(toolName: string): string {
    if (toolName.startsWith("github_")) return "🐙";
    if (toolName.startsWith("web_")) return "🔍";
    if (toolName === "fetch_url" || toolName === "fetch_api") return "🌐";
    if (toolName.startsWith("evaluate_")) return "📊";
    if (toolName.startsWith("compare_")) return "⚖️";
    if (toolName.startsWith("analyze_")) return "🔬";
    if (toolName.startsWith("generate_")) return "📄";
    if (toolName.startsWith("read_")) return "📖";
    if (toolName.startsWith("write_")) return "✍️";
    return "🔧";
  }

  function getToolCategoryLabel(category: string): string {
    switch (category) {
      case "github": return "GitHub MCP";
      case "web": return "网络搜索";
      case "eval": return "评测工具";
      case "file": return "文件系统";
      default: return "其他";
    }
  }

  function formatArgs(args: Record<string, unknown>): string {
    const entries = Object.entries(args).filter(([k]) => k !== "userId");
    return entries.map(([k, v]) => `${k}=${String(v).slice(0, 60)}`).join(", ");
  }

  function renderResult(result: unknown): string {
    if (typeof result === "object" && result !== null) {
      const obj = result as Record<string, unknown>;
      // 提取最有用的信息
      if (obj.title) return String(obj.title);
      if (obj.query) return `查询: ${obj.query}`;
      if (obj.content) return String(obj.content).slice(0, 200);
      if (obj.results && Array.isArray(obj.results)) {
        return `找到 ${obj.results.length} 条结果`;
      }
      if (obj.items && Array.isArray(obj.items)) {
        return `${obj.items.length} 个项目`;
      }
      if (obj.issues && Array.isArray(obj.issues)) {
        return `${obj.issues.length} 个 issues`;
      }
      if (obj.commits && Array.isArray(obj.commits)) {
        return `${obj.commits.length} 个 commits`;
      }
      return JSON.stringify(result).slice(0, 200);
    }
    return String(result).slice(0, 200);
  }

  if (calls.length === 0) {
    return (
      <div className={styles.panel}>
        <div className={styles.panelHeader}>
          <div>
            <h2>Agent 活动</h2>
            <p>Zevel Agent 的工具调用记录将显示在这里</p>
          </div>
          {props.onClose && (
            <button className={styles.secondaryButton} onClick={props.onClose}>关闭</button>
          )}
        </div>
        <div className={styles.empty}>
          暂无工具调用记录。Agent 执行任务时会自动显示在这里。
          <br />
          支持的工具有：GitHub MCP、网络搜索、文件系统、评测工具等。
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <h2>Agent 活动</h2>
          <p>共 {calls.length} 次工具调用</p>
        </div>
        {props.onClose && (
          <button className={styles.secondaryButton} onClick={props.onClose}>关闭</button>
        )}
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {Object.entries(grouped).map(([category, categoryCalls]) => {
          if (categoryCalls.length === 0) return null;

          return (
            <div key={category}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 760,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--bm-ink-3)",
                  marginBottom: 6,
                  padding: "4px 0",
                  borderBottom: "1px solid var(--bm-line-2)",
                }}
              >
                {getToolCategoryLabel(category)} · {categoryCalls.length}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                {categoryCalls.map((call) => (
                  <div
                    key={call.id}
                    style={{
                      padding: 10,
                      borderRadius: 6,
                      border: "1px solid var(--bm-line-2)",
                      background: call.status === "error"
                        ? "rgba(248, 113, 113, 0.05)"
                        : call.status === "running"
                          ? "rgba(124, 58, 237, 0.05)"
                          : "var(--bm-bg-2)",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <span>{getToolIcon(call.toolName)}</span>
                      <strong style={{ color: "var(--bm-ink)" }}>{call.toolName}</strong>
                      <span
                        style={{
                          marginLeft: "auto",
                          fontSize: 10,
                          color: "var(--bm-ink-3)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {call.durationMs}ms · {new Date(call.timestamp).toLocaleTimeString("zh-CN")}
                      </span>
                    </div>

                    <div
                      style={{
                        color: "var(--bm-ink-2)",
                        fontSize: 11,
                        marginBottom: 4,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={formatArgs(call.arguments)}
                    >
                      {formatArgs(call.arguments)}
                    </div>

                    {call.status === "running" && (
                      <span style={{ color: "var(--bm-accent)", fontSize: 11 }}>执行中...</span>
                    )}

                    {call.status === "success" && call.result !== undefined && call.result !== null && (
                      <div
                        style={{
                          color: "var(--bm-ink-2)",
                          fontSize: 11,
                          padding: "6px 8px",
                          background: "var(--bm-bg)",
                          borderRadius: 4,
                          border: "1px solid var(--bm-line-2)",
                        }}
                      >
                        {renderResult(call.result)}
                      </div>
                    )}

                    {call.status === "error" && call.error && (
                      <div
                        style={{
                          color: "#b91c1c",
                          fontSize: 11,
                          padding: "6px 8px",
                          background: "rgba(248, 113, 113, 0.08)",
                          borderRadius: 4,
                          border: "1px solid rgba(248, 113, 113, 0.2)",
                        }}
                      >
                        {call.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
