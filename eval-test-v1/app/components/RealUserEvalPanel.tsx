"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExtractionRoot, IntentItem, JudgeLabel, RefillItem } from "@/lib/types";
import styles from "@/app/experiment.module.css";

type HumanScores = {
  smoothness: number;
  trust: number;
  willingness: number;
};

type RealUserTurnLog = {
  step: number;
  intent_index: number;
  user_message: string;
  assistant_message: string;
  judge: JudgeLabel;
  rationale: string;
  human_scores: HumanScores;
  injected_refills: RefillItem[];
};

type PendingTurn = {
  user_message: string;
  assistant_message: string;
  injected_refills: RefillItem[];
};

type Props = {
  sessionId: string | null;
  extraction: ExtractionRoot | null;
};

const JUDGE_LABELS: Record<JudgeLabel, string> = {
  SATISFIED: "满足",
  NOT_SATISFIED: "未满足",
  DEVIATION: "偏离",
};

/**
 * 将 session id 规范为下载文件名片段。
 */
function slugSessionIdForFile(id: string | null): string {
  const raw = id?.trim() || "session";
  return raw.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").slice(0, 120);
}

/**
 * 按当前意图的 historical_span 过滤可回填项，仅用于界面折叠摘要。
 */
function selectRefillsForIntent(intent: IntentItem | null, refills: RefillItem[]): RefillItem[] {
  const span = intent?.historical_span;
  if (!span) return [];
  return refills.filter((item) => {
    if (typeof item.source_turn_index !== "number") return false;
    return item.source_turn_index >= span.start_turn_index && item.source_turn_index <= span.end_turn_index;
  });
}

/**
 * 真人动态评测导出文本，包含抽取结果、真人回合、三态 Judge 与体感分。
 */
function buildExportText(opts: {
  sessionId: string | null;
  extraction: ExtractionRoot | null;
  logs: RealUserTurnLog[];
}): string {
  const lines: string[] = [
    "# RealUser 动态评测 — 会话导出",
    `导出时间(ISO): ${new Date().toISOString()}`,
    `Session ID: ${opts.sessionId ?? "(未选择)"}`,
    `总轮次: ${opts.logs.length}`,
    "",
    "========== 抽取结果（意图指针 + 可回填项） ==========",
    opts.extraction ? JSON.stringify(opts.extraction, null, 2) : "（无 extraction）",
    "",
    "========== 真人动态评测记录 ==========",
    "",
  ];

  for (const log of opts.logs) {
    lines.push(
      `---------- 第 ${log.step} 轮 ----------`,
      `意图序号: ${log.intent_index}`,
      "",
      "【真人 User】",
      log.user_message || "（空）",
      "",
      "【被测 Agent】",
      log.assistant_message || "（空）",
      "",
      "【人工 Judge】",
      `标签: ${log.judge}（${JUDGE_LABELS[log.judge]}）`,
      `备注: ${log.rationale || "（无）"}`,
      `体感分: 顺畅度=${log.human_scores.smoothness}; 可信度=${log.human_scores.trust}; 愿继续=${log.human_scores.willingness}`,
      `本轮注入可回填项: ${log.injected_refills.length}`,
      "",
    );
  }

  lines.push("# 文件结束", "");
  return lines.join("\n");
}

/**
 * 触发 UTF-8 TXT 下载。
 */
function downloadText(filename: string, text: string): void {
  const blob = new Blob(["\uFEFF" + text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * 真人用户动态评测面板：真人输入、Agent 回复、人工 Judge 与指针推进。
 */
export function RealUserEvalPanel(props: Props) {
  const { sessionId, extraction } = props;
  const intents = useMemo(() => {
    return [...(extraction?.intent_sequence ?? [])].sort((a, b) => a.intent_index - b.intent_index);
  }, [extraction]);

  const [intentPos, setIntentPos] = useState(0);
  const [input, setInput] = useState("");
  const [logs, setLogs] = useState<RealUserTurnLog[]>([]);
  const [pending, setPending] = useState<PendingTurn | null>(null);
  const [judge, setJudge] = useState<JudgeLabel>("NOT_SATISFIED");
  const [note, setNote] = useState("");
  const [scores, setScores] = useState<HumanScores>({ smoothness: 3, trust: 3, willingness: 3 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const autoStartedRef = useRef(false);

  const currentIntent = intents[intentPos] ?? null;
  const currentRefills = useMemo(() => {
    return selectRefillsForIntent(currentIntent, extraction?.refillables ?? []);
  }, [currentIntent, extraction]);

  useEffect(() => {
    setIntentPos(0);
    setInput("");
    setLogs([]);
    setPending(null);
    setJudge("NOT_SATISFIED");
    setNote("");
    setScores({ smoothness: 3, trust: 3, willingness: 3 });
    setErr(null);
    autoStartedRef.current = false;
  }, [sessionId, extraction]);

  /**
   * 使用当前意图首条示例话填充输入框。
   */
  const fillExampleQuery = () => {
    if (!currentIntent) return;
    setInput((currentIntent.example_user_queries[0] ?? currentIntent.intent_text).trim());
  };

  /**
   * 调用被测 Agent，只生成 assistant 回复；Judge 留给真人确认。
   */
  const sendUserMessageToAgent = useCallback(async (message: string) => {
    const userMessage = message.trim();
    if (!sessionId || !extraction || !currentIntent || !userMessage || pending) return;
    setBusy(true);
    setErr(null);
    try {
      const history = logs.flatMap((log) => [
        { role: "user" as const, content: log.user_message },
        { role: "assistant" as const, content: log.assistant_message },
      ]);
      const r = await fetch("/api/eval/realuser/reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          extraction,
          intentIndex: currentIntent.intent_index,
          history,
          userMessage,
        }),
      });
      const j = (await r.json()) as { assistantMessage?: string; injectedRefills?: RefillItem[]; error?: string };
      if (!r.ok) throw new Error(j.error ?? "被测 Agent 回复失败");
      setPending({
        user_message: userMessage,
        assistant_message: j.assistantMessage ?? "",
        injected_refills: j.injectedRefills ?? [],
      });
      setInput("");
      setJudge("NOT_SATISFIED");
      setNote("");
      setScores({ smoothness: 3, trust: 3, willingness: 3 });
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [currentIntent, extraction, logs, pending, sessionId]);

  const sendToAgent = async () => {
    await sendUserMessageToAgent(input);
  };

  /**
   * 进入真人模式后自动发送首轮固定 user query，并等待被测 Agent 回复。
   */
  useEffect(() => {
    if (autoStartedRef.current || !currentIntent || logs.length > 0 || pending || busy) return;
    const firstQuery = (currentIntent.example_user_queries[0] ?? currentIntent.intent_text).trim();
    if (!firstQuery) return;
    autoStartedRef.current = true;
    void sendUserMessageToAgent(firstQuery);
  }, [busy, currentIntent, logs.length, pending, sendUserMessageToAgent]);

  /**
   * 确认本轮人工 Judge；若满足则自动进入下一意图。
   */
  const confirmTurn = () => {
    if (!pending || !currentIntent) return;
    const log: RealUserTurnLog = {
      step: logs.length + 1,
      intent_index: currentIntent.intent_index,
      user_message: pending.user_message,
      assistant_message: pending.assistant_message,
      judge,
      rationale: note.trim(),
      human_scores: scores,
      injected_refills: pending.injected_refills,
    };
    setLogs((prev) => [...prev, log]);
    setPending(null);
    if (judge === "SATISFIED") {
      setIntentPos((pos) => Math.min(pos + 1, Math.max(intents.length - 1, 0)));
    }
  };

  /**
   * 导出真人评测日志。
   */
  const exportTxt = () => {
    const text = buildExportText({ sessionId, extraction, logs });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    downloadText(`realuser-dynamic-${slugSessionIdForFile(sessionId)}-${stamp}.txt`, text);
  };

  const completed = logs.filter((log) => log.judge === "SATISFIED").length;
  const deviation = logs.filter((log) => log.judge === "DEVIATION").length;

  return (
    <div className="card">
      <div className={styles.chatCardHeader}>
        <h2 className={styles.sectionTitle}>真人用户动态评测（RealUser）</h2>
        <div className={styles.realUserTopActions}>
          <button type="button" className="secondary" disabled={logs.length === 0} onClick={exportTxt}>
            导出真人评测 TXT
          </button>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 0 }}>
        真人负责输入、Judge 和指针切换；点「满足」确认后自动进入下一意图。被测 Agent 仍复用当前 SiliconFlow 设置。
      </p>

      {!sessionId || !extraction || intents.length === 0 ? (
        <p className="muted">请先选择 session 并完成抽取，才能进入真人动态评测。</p>
      ) : (
        <>
          <div className={styles.realUserLayout}>
            <aside className={styles.realUserIntentPane}>
              <div className={styles.realUserPaneTitle}>完整意图指针</div>
              {intents.map((intent, idx) => (
                <button
                  type="button"
                  key={intent.intent_index}
                  className={`${styles.realUserIntentItem} ${idx === intentPos ? styles.realUserIntentActive : ""}`}
                  onClick={() => setIntentPos(idx)}
                >
                  <strong>#{intent.intent_index}</strong>
                  <span>{intent.intent_text}</span>
                </button>
              ))}
              <div className={styles.realUserPointerActions}>
                <button type="button" className="secondary" disabled={intentPos <= 0} onClick={() => setIntentPos((x) => Math.max(0, x - 1))}>
                  上一意图
                </button>
                <button
                  type="button"
                  className="secondary"
                  disabled={intentPos >= intents.length - 1}
                  onClick={() => setIntentPos((x) => Math.min(intents.length - 1, x + 1))}
                >
                  下一意图
                </button>
              </div>
            </aside>

            <section className={styles.realUserMainPane}>
              <div className={styles.realUserIntentDetail}>
                <strong>当前意图：</strong>
                {currentIntent?.intent_text}
                <br />
                <strong>达成标准：</strong>
                {currentIntent?.success_criteria}
                <br />
                <strong>示例话：</strong>
                {(currentIntent?.example_user_queries ?? []).join(" / ") || "无"}
              </div>

              <details className={styles.realUserRefillBox}>
                <summary>当前意图相关可回填项（{currentRefills.length}）</summary>
                {currentRefills.length === 0 ? (
                  <p className="muted">无按历史 span 命中的可回填项。</p>
                ) : (
                  <ul>
                    {currentRefills.map((item) => (
                      <li key={item.refill_index}>
                        <strong>{item.key ?? item.refill_reference}</strong>：{item.injection_text ?? item.refill_reference}
                      </li>
                    ))}
                  </ul>
                )}
              </details>

              <div className={styles.chatShell}>
                {logs.length === 0 && !pending ? <p className="muted">尚无真人评测回合。</p> : null}
                {logs.map((log) => (
                  <div key={log.step} className={styles.chatRound}>
                    <div className={styles.chatRoundMeta}>
                      第 <strong>{log.step}</strong> 轮 · 意图 <strong>{log.intent_index}</strong> · 人工 Judge：
                      <strong>{JUDGE_LABELS[log.judge]}</strong>
                    </div>
                    <div className={styles.chatGrid}>
                      <div className={styles.chatColLeft}>
                        <span className={styles.chatRole}>真人 User</span>
                        <div className={styles.bubbleUser}>{log.user_message}</div>
                      </div>
                      <div className={styles.chatColRight}>
                        <span className={styles.chatRole}>被测 Agent</span>
                        <div className={styles.bubbleAgent}>{log.assistant_message}</div>
                      </div>
                    </div>
                    <div className={`${styles.judgeStrip} ${log.judge === "SATISFIED" ? styles.judgeSat : log.judge === "DEVIATION" ? styles.judgeDev : styles.judgeNot}`}>
                      <strong>体感：</strong>顺畅 {log.human_scores.smoothness} / 可信 {log.human_scores.trust} / 愿继续 {log.human_scores.willingness}
                      {log.rationale ? <span className={styles.judgeRationale}>{log.rationale}</span> : null}
                    </div>
                  </div>
                ))}
                {pending ? (
                  <div className={styles.chatRound}>
                    <div className={styles.chatRoundMeta}>待确认回合 · 意图 {currentIntent?.intent_index}</div>
                    <div className={styles.chatGrid}>
                      <div className={styles.chatColLeft}>
                        <span className={styles.chatRole}>真人 User</span>
                        <div className={styles.bubbleUser}>{pending.user_message}</div>
                      </div>
                      <div className={styles.chatColRight}>
                        <span className={styles.chatRole}>被测 Agent</span>
                        <div className={styles.bubbleAgent}>{pending.assistant_message}</div>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className={styles.realUserInputRow}>
                <textarea
                  className={styles.realUserInput}
                  disabled={busy || Boolean(pending)}
                  value={input}
                  placeholder="真人用户在这里输入本轮问题..."
                  onChange={(e) => setInput(e.target.value)}
                />
                <div className={styles.realUserInputActions}>
                  <button type="button" className="secondary" disabled={!currentIntent || busy || Boolean(pending)} onClick={fillExampleQuery}>
                    填入示例话
                  </button>
                  <button type="button" disabled={!input.trim() || busy || Boolean(pending)} onClick={() => void sendToAgent()}>
                    {busy ? "Agent 回复中…" : "发送给 Agent"}
                  </button>
                </div>
              </div>

              {err ? <div className="err">{err}</div> : null}
            </section>

            <aside className={styles.realUserJudgePane}>
              <div className={styles.realUserPaneTitle}>人工 Judge</div>
              <div className={styles.realUserJudgeButtons}>
                {(["SATISFIED", "NOT_SATISFIED", "DEVIATION"] as JudgeLabel[]).map((label) => (
                  <button
                    type="button"
                    key={label}
                    className={judge === label ? "" : "secondary"}
                    disabled={!pending}
                    onClick={() => setJudge(label)}
                  >
                    {JUDGE_LABELS[label]}
                  </button>
                ))}
              </div>
              <label className={styles.realUserSmallLabel}>备注</label>
              <textarea
                className={styles.realUserNote}
                disabled={!pending}
                value={note}
                placeholder="可选：为什么满足/未满足/偏离"
                onChange={(e) => setNote(e.target.value)}
              />
              <label className={styles.realUserSmallLabel}>体感分（1-5）</label>
              {[
                ["smoothness", "顺畅度"],
                ["trust", "可信度"],
                ["willingness", "愿继续"],
              ].map(([key, label]) => (
                <div key={key} className={styles.realUserScoreRow}>
                  <span>{label}</span>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    disabled={!pending}
                    value={scores[key as keyof HumanScores]}
                    onChange={(e) => setScores((prev) => ({ ...prev, [key]: Number(e.target.value) }))}
                  />
                  <strong>{scores[key as keyof HumanScores]}</strong>
                </div>
              ))}
              <button type="button" disabled={!pending} onClick={confirmTurn}>
                确认本轮回合
              </button>
              <div className={styles.realUserSummary}>
                <p>已确认轮次：{logs.length}</p>
                <p>满足意图：{completed}</p>
                <p>偏离轮次：{deviation}</p>
              </div>
            </aside>
          </div>
        </>
      )}
    </div>
  );
}
