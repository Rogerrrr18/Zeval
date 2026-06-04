/**
 * @fileoverview 悬浮 Copilot 助手 — 按空格键展开/收起
 *
 * 使用方式：
 * - 按空格键：展开右侧聊天面板
 * - 再按空格键：收起
 * - 当任何输入框获得焦点时，空格键恢复正常输入行为
 * - 悬浮按钮常驻在右下角
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { MarkdownMessage } from "@/components/shared/MarkdownMessage";
import styles from "./benchmarkConsole.module.css";

type ChatTurn =
  | { kind: "user"; text: string }
  | { kind: "ai"; text: string }
  | { kind: "error"; text: string };

export function FloatingCopilot() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([
    { kind: "ai", text: "你好！我是 Zeval 助手。在评测过程中有任何问题都可以问我。" },
  ]);
  const [running, setRunning] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // ── 空格键展开/收起（仅在非输入状态下） ──────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // 忽略组合键
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;

      // 只处理空格键
      if (e.key !== " ") return;

      // 如果当前焦点在输入元素上，不拦截空格
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.getAttribute("contenteditable") === "true"
      ) {
        return;
      }

      // 如果面板内有选中文字，不拦截（允许选择后按空格）
      const selection = window.getSelection()?.toString();
      if (selection && selection.length > 0) return;

      e.preventDefault();
      setOpen((prev) => !prev);
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Escape 键收起面板 ───────────────────────────────────────────────
  useEffect(() => {
    function handleEsc(e: KeyboardEvent) {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener("keydown", handleEsc);
    return () => window.removeEventListener("keydown", handleEsc);
  }, [open]);

  // ── 发送消息 ────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;

    const nextTurns: ChatTurn[] = [...turns, { kind: "user", text }];
    setTurns(nextTurns);
    setInput("");
    setRunning(true);

    try {
      const messages = nextTurns.map((t) => ({
        role: (t.kind === "user" ? "user" : "assistant") as "user" | "assistant",
        content: t.text,
      }));

      const response = await fetch("/api/copilot/simple-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      const data = (await response.json()) as { reply?: string; error?: string };

      if (data.error) {
        setTurns((prev) => [...prev, { kind: "error", text: data.error! }]);
      } else {
        setTurns((prev) => [...prev, { kind: "ai", text: data.reply ?? "收到，请稍候。" }]);
      }
    } catch {
      setTurns((prev) => [...prev, { kind: "error", text: "网络请求失败，请稍后重试。" }]);
    } finally {
      setRunning(false);
    }
  }, [input, running, turns]);

  // ── 渲染 ────────────────────────────────────────────────────────────
  return (
    <>
      {/* 悬浮按钮 */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={styles.floatingCopilotButton}
        title={open ? "按空格键收起" : "按空格键展开助手"}
        aria-label={open ? "收起 Copilot" : "展开 Copilot"}
      >
        <span style={{ fontSize: 20 }}>{open ? "✕" : "●"}</span>
      </button>

      {/* 右侧面板 */}
      <div
        ref={panelRef}
        className={`${styles.floatingCopilotPanel} ${open ? styles.floatingCopilotOpen : ""}`}
      >
        {/* 头部 */}
        <div className={styles.floatingCopilotHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18 }}>◆</span>
            <div>
              <strong style={{ fontSize: 14, color: "var(--bm-ink)" }}>Zeval 助手</strong>
              <p style={{ margin: 0, fontSize: 11, color: "var(--bm-ink-3)" }}>
                空格键展开/收起 · 评测助手
              </p>
            </div>
          </div>
        </div>

        {/* 消息列表 */}
        <div className={styles.floatingCopilotMessages}>
          {turns.map((turn, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: turn.kind === "user" ? "flex-end" : "flex-start",
                gap: 2,
              }}
            >
              <div
                style={{
                  maxWidth: "85%",
                  padding: turn.kind === "user" ? "8px 12px" : "10px 14px",
                  borderRadius: turn.kind === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
                  background:
                    turn.kind === "user"
                      ? "rgba(124, 58, 237, 0.15)"
                      : turn.kind === "error"
                        ? "rgba(248, 113, 113, 0.1)"
                        : "var(--bm-bg-3)",
                  color:
                    turn.kind === "error" ? "#b91c1c" : "var(--bm-ink-2)",
                  wordBreak: "break-word",
                  overflow: "hidden",
                }}
              >
                {turn.kind === "user" ? (
                  turn.text
                ) : (
                  <MarkdownMessage text={turn.text} />
                )}
              </div>
            </div>
          ))}
          {running && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 2 }}>
              <div
                style={{
                  padding: "8px 12px",
                  borderRadius: "12px 12px 12px 2px",
                  background: "var(--bm-bg-3)",
                  fontSize: 12,
                  color: "var(--bm-ink-3)",
                }}
              >
                思考中...
              </div>
            </div>
          )}
        </div>

        {/* 输入区 */}
        <div className={styles.floatingCopilotInputArea}>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="输入问题，回车 发送..."
            rows={1}
            style={{
              width: "100%",
              minHeight: 36,
              maxHeight: 100,
              padding: "8px 12px",
              border: "1px solid var(--bm-line)",
              borderRadius: 6,
              background: "var(--bm-bg-2)",
              color: "var(--bm-ink)",
              fontSize: 12,
              resize: "none",
              outline: "none",
            }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || running}
            className={styles.primaryButton}
            style={{ minHeight: 36, padding: "0 16px", fontSize: 12 }}
          >
            发送
          </button>
        </div>
      </div>

      {/* 遮罩层（移动端或点击外部收起） */}
      {open && (
        <div
          className={styles.floatingCopilotOverlay}
          onClick={() => setOpen(false)}
        />
      )}
    </>
  );
}
