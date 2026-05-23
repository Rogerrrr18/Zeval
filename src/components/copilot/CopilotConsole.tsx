/**
 * @fileoverview Eval Chat console.
 *
 * Single-pane chat:
 *  - Top: transcript (user / agent / plan / tool / result / final cards)
 *  - Bottom: input + sample-data button + scenario picker
 *  - Streams events from /api/copilot/chat (SSE)
 */

"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { AppShell } from "@/components/shell";
import styles from "./copilotConsole.module.css";

type ChatTurn =
  | { kind: "user"; text: string }
  | { kind: "plan"; plan: string[] }
  | { kind: "tool_call"; tool: string; args: unknown; iteration: number }
  | {
      kind: "tool_result";
      tool: string;
      ok: boolean;
      summary: string;
      data?: unknown;
      iteration: number;
    }
  | {
      kind: "final";
      message: string;
      next_actions?: Array<{ label: string; skill?: string; args?: unknown }>;
    }
  | { kind: "error"; message: string };

type ChatChannel = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
  inputDraft: string;
  scenarioId: string;
  attachedRows: unknown[] | null;
  attachedFileName: string | null;
};

const CHAT_STORAGE_KEY = "zeval.chat.channels.v1";
const CHAT_ACTIVE_STORAGE_KEY = "zeval.chat.activeChannel.v1";
const LEGACY_CHAT_STORAGE_KEY = "zerore.chat.channels.v1";
const LEGACY_CHAT_ACTIVE_STORAGE_KEY = "zerore.chat.activeChannel.v1";
const DEFAULT_CHANNEL_TITLE = "New channel";
const EMPTY_TURNS: ChatTurn[] = [];
const SAMPLE_PROMPT_BUILT_IN =
  "我有一份客服对话日志，请帮我跑评估，告诉我哪里需要优化。";

type MarkdownBlock =
  | { kind: "heading"; level: 2 | 3 | 4; text: string }
  | { kind: "paragraph"; lines: string[] }
  | { kind: "list"; ordered: boolean; items: string[] }
  | { kind: "code"; language: string; content: string }
  | { kind: "quote"; lines: string[] };

/**
 * Render the Eval Chat console.
 *
 * @returns The console element.
 */
export function CopilotConsole() {
  const [channels, setChannels] = useState<ChatChannel[]>([]);
  const [activeChannelId, setActiveChannelId] = useState("");
  const [hydrated, setHydrated] = useState(false);
  const [running, setRunning] = useState(false);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeChannel = channels.find((channel) => channel.id === activeChannelId) ?? channels[0] ?? null;
  const turns = activeChannel?.turns ?? EMPTY_TURNS;
  const input = activeChannel?.inputDraft ?? "";
  const scenarioId = activeChannel?.scenarioId ?? "";
  const attachedRows = activeChannel?.attachedRows ?? null;
  const attachedFileName = activeChannel?.attachedFileName ?? null;

  // Load saved channels once on mount.
  useEffect(() => {
    try {
      const storedChannels = readStoredChannels();
      const nextChannels = storedChannels.length > 0 ? storedChannels : [createChatChannel()];
      const storedActiveId =
        safeGetLocalStorageItem(CHAT_ACTIVE_STORAGE_KEY) ??
        safeGetLocalStorageItem(LEGACY_CHAT_ACTIVE_STORAGE_KEY);
      const nextActiveId = nextChannels.some((channel) => channel.id === storedActiveId)
        ? storedActiveId ?? nextChannels[0].id
        : nextChannels[0].id;
      setChannels(nextChannels);
      setActiveChannelId(nextActiveId);
    } catch (error) {
      console.warn("Chat hydration failed, starting with a clean channel:", error);
      const fallbackChannel = createChatChannel();
      setChannels([fallbackChannel]);
      setActiveChannelId(fallbackChannel.id);
    } finally {
      setHydrated(true);
    }
  }, []);

  // Auto-save chat history and active channel.
  useEffect(() => {
    if (!hydrated) return;
    safeSetLocalStorageItem(CHAT_STORAGE_KEY, JSON.stringify(channels));
    safeSetLocalStorageItem(CHAT_ACTIVE_STORAGE_KEY, activeChannelId);
  }, [activeChannelId, channels, hydrated]);

  // Auto-scroll on new turn.
  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns]);

  /**
   * Patch a channel and refresh its updated timestamp.
   * @param channelId Target channel id.
   * @param patcher Channel patch callback.
   */
  const patchChannel = useCallback((channelId: string, patcher: (channel: ChatChannel) => ChatChannel) => {
    setChannels((prev) =>
      prev.map((channel) =>
        channel.id === channelId
          ? { ...patcher(channel), updatedAt: new Date().toISOString() }
          : channel,
      ),
    );
  }, []);

  /**
   * Append one streamed turn to a channel.
   * @param channelId Target channel id.
   * @param turn Turn to append.
   */
  const appendTurn = useCallback(
    (channelId: string, turn: ChatTurn) => {
      patchChannel(channelId, (channel) => ({ ...channel, turns: [...channel.turns, turn] }));
    },
    [patchChannel],
  );

  /**
   * Create and select a new chat channel.
   */
  const createChannel = useCallback(() => {
    const channel = createChatChannel();
    setChannels((prev) => [channel, ...prev]);
    setActiveChannelId(channel.id);
  }, []);

  /**
   * Delete a channel while keeping at least one channel available.
   * @param channelId Channel id to delete.
   */
  const deleteChannel = useCallback(
    (channelId: string) => {
      setChannels((prev) => {
        if (prev.length <= 1) {
          const replacement = createChatChannel();
          setActiveChannelId(replacement.id);
          return [replacement];
        }
        const remaining = prev.filter((channel) => channel.id !== channelId);
        if (channelId === activeChannelId) {
          setActiveChannelId(remaining[0].id);
        }
        return remaining;
      });
    },
    [activeChannelId],
  );

  /**
   * Update the current channel input draft.
   * @param value Input value.
   */
  const updateInput = useCallback(
    (value: string) => {
      if (!activeChannel) return;
      patchChannel(activeChannel.id, (channel) => ({ ...channel, inputDraft: value }));
    },
    [activeChannel, patchChannel],
  );

  /**
   * Submit one user turn to Chat.
   */
  const send = useCallback(
    async (textOverride?: string, presetRows?: unknown[]) => {
      const text = (textOverride ?? input).trim();
      if (!text || running || !activeChannel) return;
      const channelId = activeChannel.id;
      const userTurn: ChatTurn = { kind: "user", text };
      const nextTurns = [...turns, userTurn];
      const rows = presetRows ?? activeChannel.attachedRows ?? undefined;
      patchChannel(channelId, (channel) => ({
        ...channel,
        title: channel.title === DEFAULT_CHANNEL_TITLE ? buildChannelTitle(text) : channel.title,
        turns: nextTurns,
        inputDraft: "",
        attachedRows: rows ?? channel.attachedRows,
      }));
      setRunning(true);

      try {
        const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
        for (const t of nextTurns) {
          if (t.kind === "user") {
            messages.push({ role: "user", content: t.text });
          } else if (t.kind === "final") {
            messages.push({ role: "assistant", content: t.message });
          }
        }

        const res = await fetch("/api/copilot/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            messages,
            attachments: rows
              ? {
                  rawRows: rows,
                  scenarioId: activeChannel.scenarioId,
                  sourceFileName: activeChannel.attachedFileName ?? undefined,
                }
              : { scenarioId: activeChannel.scenarioId },
          }),
        });

        if (!res.ok || !res.body) {
          const err = await res.text().catch(() => "");
          appendTurn(channelId, { kind: "error", message: `请求失败 (${res.status}) ${err.slice(0, 200)}` });
          return;
        }

        // SSE consumer
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const ln of lines) {
            if (!ln.startsWith("data: ")) continue;
            const payload = ln.slice(6);
            if (payload === "[DONE]") break;
            try {
              const event = JSON.parse(payload);
              appendTurn(channelId, mapEventToTurn(event));
            } catch {
              /* ignore malformed line */
            }
          }
        }
      } catch (e) {
        appendTurn(channelId, { kind: "error", message: e instanceof Error ? e.message : String(e) });
      } finally {
        setRunning(false);
      }
    },
    [activeChannel, appendTurn, input, patchChannel, running, turns],
  );

  /**
   * Load the bundled e-commerce sample as attached rows.
   */
  const loadBuiltInSample = useCallback(async (): Promise<unknown[] | null> => {
    try {
      const res = await fetch("/sample-data/ecommerce-angry-escalation.csv");
      if (!res.ok) throw new Error("示例文件未找到");
      const text = await res.text();
      const rows = parseCsvToRawRows(text);
      if (activeChannel) {
        patchChannel(activeChannel.id, (channel) => ({
          ...channel,
          attachedRows: rows,
          attachedFileName: "ecommerce-angry-escalation.csv",
        }));
      }
      return rows;
    } catch (e) {
      if (activeChannel) {
        appendTurn(activeChannel.id, { kind: "error", message: e instanceof Error ? e.message : String(e) });
      }
      return null;
    }
  }, [activeChannel, appendTurn, patchChannel]);

  /**
   * Handle a user file upload (CSV/JSON).
   */
  const onFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const rows = f.name.endsWith(".json") || f.name.endsWith(".jsonl")
        ? parseJsonlToRawRows(text)
        : parseCsvToRawRows(text);
      if (activeChannel) {
        patchChannel(activeChannel.id, (channel) => ({
          ...channel,
          attachedRows: rows,
          attachedFileName: f.name,
        }));
      }
    } catch (err) {
      if (activeChannel) {
        appendTurn(activeChannel.id, {
          kind: "error",
          message: `文件解析失败：${err instanceof Error ? err.message : String(err)}`,
        });
      }
    }
  }, [activeChannel, appendTurn, patchChannel]);

  /**
   * Trigger a one-tap "next action" button from a final turn.
   */
  const triggerNextAction = useCallback(
    (action: { label: string; skill?: string; args?: unknown }) => {
      const text = action.skill
        ? `请执行 ${action.skill}${action.args ? ` (args=${JSON.stringify(action.args)})` : ""}`
        : action.label;
      void send(text);
    },
    [send],
  );

  if (!hydrated || !activeChannel) {
    return (
      <AppShell>
        <div className={styles.loadingShell}>Loading Chat...</div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className={styles.layout}>
        <aside className={styles.channelRail} aria-label="chat channels">
          <div className={styles.channelHeader}>
            <div>
              <p className={styles.channelEyebrow}>Chat</p>
              <h1 className={styles.channelTitle}>Channels</h1>
            </div>
            <button className={styles.newChannelBtn} onClick={createChannel} title="New channel">
              +
            </button>
          </div>
          <div className={styles.channelList}>
            {channels.map((channel) => {
              const active = channel.id === activeChannel.id;
              return (
                <div
                  key={channel.id}
                  role="button"
                  tabIndex={0}
                  className={`${styles.channelItem} ${active ? styles.channelItemActive : ""}`}
                  onClick={() => setActiveChannelId(channel.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setActiveChannelId(channel.id);
                    }
                  }}
                >
                  <span className={styles.channelItemTitle}>{channel.title}</span>
                  <span className={styles.channelItemMeta}>
                    {channel.turns.length} turns · {formatChannelTime(channel.updatedAt)}
                  </span>
                  <button
                    type="button"
                    className={styles.channelDelete}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteChannel(channel.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        deleteChannel(channel.id);
                      }
                    }}
                    aria-label={`Delete ${channel.title}`}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <div className={styles.chatPanel}>
          <header className={styles.header}>
            <div>
              <p className={styles.headerKicker}>Zeval Chat</p>
              <h2 className={styles.title}>{activeChannel.title}</h2>
              <p className={styles.sub}>
                {turns.length} turns · {attachedFileName ? `attached ${attachedRows?.length ?? 0} rows` : "no attachment"}
              </p>
            </div>
          </header>

          <section className={styles.transcript} ref={transcriptRef}>
            {turns.length === 0 ? (
              <div className={styles.welcome}>
                <strong>开始一个 channel</strong>
                <p>问产品、跑评估、沉淀调优包都可以在这里继续。</p>
                <div className={styles.suggest}>
                  <button onClick={() => void send("你好，你能做什么？")}>
                    你好，你能做什么？
                  </button>
                  <button onClick={() => void send("帮我看下这周客服 agent 的表现")}>
                    帮我看下这周客服 agent 的表现
                  </button>
                  <button
                    onClick={() => {
                      void loadBuiltInSample().then((rows) => {
                        if (rows) {
                          void send(SAMPLE_PROMPT_BUILT_IN, rows);
                        }
                      });
                    }}
                  >
                    一键 Demo（加载示例日志并跑评估）
                  </button>
                </div>
              </div>
            ) : null}

            {turns.map((t, i) => (
              <TurnView key={`${activeChannel.id}-${i}`} turn={t} onAction={triggerNextAction} />
            ))}

            {running ? <LoadingDot /> : null}
          </section>

          <footer className={styles.composer}>
            <div className={styles.composerMeta}>
              <label className={styles.scenarioLabel}>
                评估模板：
                <select
                  className={styles.scenarioSelect}
                  value={scenarioId}
                  onChange={(event) => {
                    patchChannel(activeChannel.id, (channel) => ({
                      ...channel,
                      scenarioId: event.target.value,
                    }));
                  }}
                >
                  <option value="">通用</option>
                  <option value="toB-customer-support">ToB 客服</option>
                </select>
              </label>
              <label className={styles.attachLabel}>
                <input
                  type="file"
                  accept=".csv,.json,.jsonl"
                  onChange={onFile}
                  className={styles.attachInput}
                />
                附加日志
              </label>
              {attachedFileName ? (
                <span className={styles.attached}>
                  已附加：{attachedFileName}（{attachedRows?.length ?? 0} 行）
                  <button
                    className={styles.attachedClear}
                    onClick={() => {
                      patchChannel(activeChannel.id, (channel) => ({
                        ...channel,
                        attachedRows: null,
                        attachedFileName: null,
                      }));
                    }}
                  >
                    ×
                  </button>
                </span>
              ) : (
                <button className={styles.sampleBtn} onClick={() => void loadBuiltInSample()}>
                  使用内置示例日志
                </button>
              )}
            </div>
            <div className={styles.composerRow}>
              <textarea
                className={styles.input}
                value={input}
                onChange={(event) => updateInput(event.target.value)}
                placeholder="例如：跑评估并告诉我 top 3 风险"
                rows={2}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void send();
                  }
                }}
                disabled={running}
              />
              <button
                className={styles.sendBtn}
                disabled={!input.trim() || running}
                onClick={() => void send()}
              >
                {running ? "运行中..." : "发送"}
              </button>
            </div>
          </footer>
        </div>
      </div>
    </AppShell>
  );
}

// ---- Helpers ----

/**
 * Create a new empty chat channel.
 * @returns New channel state.
 */
function createChatChannel(): ChatChannel {
  const now = new Date().toISOString();
  return {
    id: `channel_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
    title: DEFAULT_CHANNEL_TITLE,
    createdAt: now,
    updatedAt: now,
    turns: [],
    inputDraft: "",
    scenarioId: "",
    attachedRows: null,
    attachedFileName: null,
  };
}

/**
 * Read one localStorage value without letting browser storage failures block chat hydration.
 * @param key Storage key.
 * @returns Stored value, or null when unavailable.
 */
function safeGetLocalStorageItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    console.warn(`Chat localStorage read failed: ${key}`, error);
    return null;
  }
}

/**
 * Write one localStorage value without breaking the visible chat UI.
 * @param key Storage key.
 * @param value Serialized storage value.
 */
function safeSetLocalStorageItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    console.warn(`Chat localStorage write failed: ${key}`, error);
  }
}

/**
 * Read saved chat channels from localStorage.
 * @returns Valid stored channels.
 */
function readStoredChannels(): ChatChannel[] {
  try {
    const raw =
      safeGetLocalStorageItem(CHAT_STORAGE_KEY) ??
      safeGetLocalStorageItem(LEGACY_CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      const channel = item as Partial<ChatChannel>;
      if (typeof channel.id !== "string" || !Array.isArray(channel.turns)) {
        return [];
      }
      return [
        {
          id: channel.id,
          title: typeof channel.title === "string" && channel.title.trim() ? channel.title : DEFAULT_CHANNEL_TITLE,
          createdAt: typeof channel.createdAt === "string" ? channel.createdAt : new Date().toISOString(),
          updatedAt: typeof channel.updatedAt === "string" ? channel.updatedAt : new Date().toISOString(),
          turns: channel.turns,
          inputDraft: typeof channel.inputDraft === "string" ? channel.inputDraft : "",
          scenarioId: typeof channel.scenarioId === "string" ? channel.scenarioId : "",
          attachedRows: Array.isArray(channel.attachedRows) ? channel.attachedRows : null,
          attachedFileName: typeof channel.attachedFileName === "string" ? channel.attachedFileName : null,
        },
      ];
    });
  } catch {
    return [];
  }
}

/**
 * Build a compact channel title from the first user message.
 * @param text User message.
 * @returns Channel title.
 */
function buildChannelTitle(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > 20 ? `${normalized.slice(0, 20)}...` : normalized || DEFAULT_CHANNEL_TITLE;
}

/**
 * Format a channel updated timestamp for compact display.
 * @param value ISO timestamp.
 * @returns Display time.
 */
function formatChannelTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * Convert one server-sent event into a chat turn (1:1 mapping).
 *
 * @param event Server event.
 * @returns Chat turn.
 */
function mapEventToTurn(event: { type: string } & Record<string, unknown>): ChatTurn {
  switch (event.type) {
    case "plan":
      return { kind: "plan", plan: (event.plan as string[]) ?? [] };
    case "tool_call":
      return {
        kind: "tool_call",
        tool: String(event.tool ?? ""),
        args: event.args,
        iteration: Number(event.iteration ?? 0),
      };
    case "tool_result":
      return {
        kind: "tool_result",
        tool: String(event.tool ?? ""),
        ok: Boolean(event.ok),
        summary: String(event.summary ?? ""),
        data: event.data,
        iteration: Number(event.iteration ?? 0),
      };
    case "final":
      return {
        kind: "final",
        message: String(event.message ?? ""),
        next_actions: Array.isArray(event.next_actions)
          ? (event.next_actions as Array<{ label: string; skill?: string; args?: unknown }>)
          : undefined,
      };
    case "error":
    default:
      return { kind: "error", message: String(event.message ?? "未知错误") };
  }
}

/**
 * Render a single chat turn.
 *
 * @param props Turn props.
 * @returns The turn element.
 */
function TurnView(props: {
  turn: ChatTurn;
  onAction: (a: { label: string; skill?: string; args?: unknown }) => void;
}) {
  const { turn, onAction } = props;
  switch (turn.kind) {
    case "user":
      return (
        <div className={`${styles.bubble} ${styles.bubbleUser}`}>
          <div className={styles.bubbleRole}>你</div>
          <div className={styles.bubbleBody}>{renderMarkdownMessage(turn.text)}</div>
        </div>
      );
    case "plan":
      return (
        <div className={`${styles.bubble} ${styles.bubbleAgent}`}>
          <div className={styles.bubbleRole}>Chat · 计划</div>
          <ol className={styles.planList}>
            {turn.plan.map((p, i) => (
              <li key={i}>{p}</li>
            ))}
          </ol>
        </div>
      );
    case "tool_call":
      return (
        <div className={styles.toolCall}>
          <span className={styles.toolBadge}>调用</span>
          <code>{turn.tool}</code>
          <span className={styles.toolIter}>iter {turn.iteration}</span>
        </div>
      );
    case "tool_result":
      return (
        <div className={`${styles.toolResult} ${turn.ok ? styles.toolOk : styles.toolFail}`}>
          <span className={styles.toolBadge}>{turn.ok ? "✓" : "✗"}</span>
          <code>{turn.tool}</code>
          <span className={styles.toolSummary}>{turn.summary}</span>
        </div>
      );
    case "final":
      return (
        <div className={`${styles.bubble} ${styles.bubbleAgent}`}>
          <div className={styles.bubbleRole}>Chat</div>
          <div className={styles.bubbleBody}>{renderMarkdownMessage(turn.message)}</div>
          {turn.next_actions && turn.next_actions.length > 0 ? (
            <div className={styles.nextActions}>
              {turn.next_actions.map((a, i) => (
                <button key={i} onClick={() => onAction(a)}>
                  {a.label} →
                </button>
              ))}
            </div>
          ) : null}
        </div>
      );
    case "error":
      return <div className={styles.errorRow}>⚠ {turn.message}</div>;
  }
}

/**
 * Render a safe, lightweight Markdown subset for chat messages.
 * @param text Raw assistant or user message.
 * @returns React nodes for readable Markdown blocks.
 */
function renderMarkdownMessage(text: string): ReactNode {
  const blocks = parseMarkdownBlocks(text);
  return (
    <div className={styles.markdown}>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const HeadingTag = block.level === 2 ? "h2" : block.level === 3 ? "h3" : "h4";
          return <HeadingTag key={index}>{renderInlineMarkdown(block.text)}</HeadingTag>;
        }
        if (block.kind === "list") {
          const ListTag = block.ordered ? "ol" : "ul";
          return (
            <ListTag key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>{renderInlineMarkdown(item)}</li>
              ))}
            </ListTag>
          );
        }
        if (block.kind === "code") {
          return (
            <pre key={index} className={styles.markdownCode}>
              {block.language ? <span>{block.language}</span> : null}
              <code>{block.content}</code>
            </pre>
          );
        }
        if (block.kind === "quote") {
          return <blockquote key={index}>{renderMarkdownLines(block.lines, `quote-${index}`)}</blockquote>;
        }
        return <p key={index}>{renderMarkdownLines(block.lines, `paragraph-${index}`)}</p>;
      })}
    </div>
  );
}

/**
 * Parse a compact Markdown subset into display blocks.
 * @param text Raw message text.
 * @returns Parsed Markdown blocks.
 */
function parseMarkdownBlocks(text: string): MarkdownBlock[] {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^```([\w-]*)\s*$/);
    if (fence) {
      const codeLines: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ kind: "code", language: fence[1] ?? "", content: codeLines.join("\n") });
      continue;
    }

    const heading = line.match(/^(#{2,4})\s+(.+)$/);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length as 2 | 3 | 4, text: heading[2].trim() });
      index += 1;
      continue;
    }

    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      const quoteLines: string[] = [];
      while (index < lines.length) {
        const quoteLine = lines[index].match(/^>\s?(.*)$/);
        if (!quoteLine) break;
        quoteLines.push(quoteLine[1]);
        index += 1;
      }
      blocks.push({ kind: "quote", lines: quoteLines });
      continue;
    }

    const list = parseListLine(line);
    if (list) {
      const items: string[] = [];
      const ordered = list.ordered;
      while (index < lines.length) {
        const parsed = parseListLine(lines[index]);
        if (!parsed || parsed.ordered !== ordered) break;
        items.push(parsed.text);
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length && lines[index].trim()) {
      if (/^```/.test(lines[index]) || /^(#{2,4})\s+/.test(lines[index]) || /^>\s?/.test(lines[index]) || parseListLine(lines[index])) {
        break;
      }
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", lines: paragraphLines });
  }

  return blocks.length > 0 ? blocks : [{ kind: "paragraph", lines: [text] }];
}

/**
 * Parse one Markdown list line.
 * @param line Raw line.
 * @returns List metadata, or null when the line is not a list item.
 */
function parseListLine(line: string): { ordered: boolean; text: string } | null {
  const unordered = line.match(/^\s*[-*]\s+(.+)$/);
  if (unordered) {
    return { ordered: false, text: unordered[1].trim() };
  }
  const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
  if (ordered) {
    return { ordered: true, text: ordered[1].trim() };
  }
  return null;
}

/**
 * Render inline code and bold markers without using unsafe HTML.
 * @param text Raw inline Markdown.
 * @returns Inline React nodes.
 */
function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      nodes.push(text.slice(cursor, match.index));
    }
    const token = match[0];
    if (token.startsWith("`")) {
      nodes.push(<code key={`${match.index}-code`}>{token.slice(1, -1)}</code>);
    } else {
      nodes.push(<strong key={`${match.index}-strong`}>{token.slice(2, -2)}</strong>);
    }
    cursor = match.index + token.length;
  }
  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

/**
 * Render multiple inline Markdown lines separated by explicit breaks.
 * @param lines Raw text lines.
 * @param keyPrefix Stable key prefix for the block.
 * @returns Inline nodes with line breaks.
 */
function renderMarkdownLines(lines: string[], keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  lines.forEach((line, lineIndex) => {
    if (lineIndex > 0) {
      nodes.push(<br key={`${keyPrefix}-br-${lineIndex}`} />);
    }
    renderInlineMarkdown(line).forEach((node, nodeIndex) => {
      nodes.push(<span key={`${keyPrefix}-${lineIndex}-${nodeIndex}`}>{node}</span>);
    });
  });
  return nodes;
}

/**
 * Animated three-dot loader.
 *
 * @returns Loader element.
 */
function LoadingDot() {
  return (
    <div className={styles.loader} aria-label="思考中">
      <span /> <span /> <span />
    </div>
  );
}

/**
 * Naive CSV → rawRows parser. Expects header row with sessionId/timestamp/role/content.
 *
 * @param text CSV text.
 * @returns RawRow array.
 */
function parseCsvToRawRows(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((s) => s.trim());
  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = parseCsvLine(lines[i]);
    const row: Record<string, string> = {};
    headers.forEach((h, j) => {
      row[h] = cols[j] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

/**
 * Split a CSV line, supporting quoted fields with commas inside.
 *
 * @param line One CSV line.
 * @returns Field array.
 */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        inQ = !inQ;
      }
    } else if (c === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  out.push(cur);
  return out;
}

/**
 * Parse JSON or JSONL into raw rows.
 *
 * @param text JSON / JSONL text.
 * @returns Array of objects.
 */
function parseJsonlToRawRows(text: string): unknown[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray((parsed as { rawRows?: unknown[] }).rawRows)) {
      return (parsed as { rawRows: unknown[] }).rawRows;
    }
    return [];
  }
  return trimmed
    .split(/\r?\n/)
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));
}
