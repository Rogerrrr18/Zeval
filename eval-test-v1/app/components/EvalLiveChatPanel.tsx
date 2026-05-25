"use client";

import type { EvalTurnLog, ExtractionRoot, SessionMetrics } from "@/lib/types";
import styles from "@/app/experiment.module.css";

export type EvalStreamPhase = "idle" | "baseline" | "dynamic" | "complete";

type Props = {
  logs: EvalTurnLog[];
  phase: EvalStreamPhase;
  /** 是否正在请求流（含基线阶段）。 */
  running: boolean;
  /** 当前选中的 session，用于导出文件名与文首标识。 */
  sessionId?: string | null;
  /** 评测完成后的会话级动态指标（可选，写入导出文件末尾）。 */
  sessionMetrics?: SessionMetrics | null;
  /** 启动流式动态评测（含基线）。 */
  onRunDynamicEval: () => void;
  /** 禁用「运行动态评测」（未选 session、忙、无意图表等）。 */
  runDynamicEvalDisabled: boolean;
  /** 最近一次评测请求提交的 extraction（与 `/api/eval/stream` body 一致）。 */
  lastEvalExtraction?: ExtractionRoot | null;
  /** 导出时刻由当前表格合成的 extraction（无评测快照时作 fallback）。 */
  tableExtraction?: ExtractionRoot | null;
};

/**
 * 将 session id 规范为文件名安全片段。
 */
function slugSessionIdForFile(id: string | null | undefined): string {
  if (!id?.trim()) return "session";
  const s = id.replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "_").trim();
  return s.slice(0, 120) || "session";
}

/**
 * 组装「动态评测」完整 TXT：元信息、抽取结果（意图指针 + 可回填项）、按轮次对话与 Judge、可选会话级汇总。
 */
function buildEvalSessionExportTxt(
  logs: EvalTurnLog[],
  opts: {
    sessionId: string | null;
    exportedAtIso: string;
    sessionMetrics?: SessionMetrics | null;
    lastEvalExtraction?: ExtractionRoot | null;
    tableExtraction?: ExtractionRoot | null;
  },
): string {
  const ext = opts.lastEvalExtraction ?? opts.tableExtraction ?? null;
  let extractionProvenance = "";
  if (opts.lastEvalExtraction) {
    extractionProvenance =
      "来源：最近一次点击「运行动态评测」时提交 API 的 extraction（与当次动态环注入一致，便于对照漂移）。";
  } else if (opts.tableExtraction) {
    extractionProvenance =
      "来源：导出时刻由当前表格合成；若导出前改过表且未再评测，可能与下方对话记录不完全对应。";
  } else {
    extractionProvenance = "（当前无法从表格合成 extraction：请先完成抽取。）";
  }

  const lines: string[] = [
    "# 意图指针动态评测 — 会话导出",
    `导出时间(ISO): ${opts.exportedAtIso}`,
    `Session ID: ${opts.sessionId ?? "(未选择)"}`,
    `总轮次(动态环内): ${logs.length}`,
    "",
    "========== 抽取结果（意图指针 intent_sequence + 可回填项 refillables） ==========",
    extractionProvenance,
    "",
  ];

  if (ext) {
    lines.push(JSON.stringify(ext, null, 2), "");
  } else {
    lines.push("（无 extraction JSON 正文）", "");
  }

  lines.push("========== 以下为按轮次完整记录（与页面气泡顺序一致） ==========", "");

  for (const log of logs) {
    lines.push(
      `---------- 第 ${log.step} 轮 ----------`,
      `意图序号 intent_index: ${log.intent_index}`,
      `本回合开始时追问计数 c_i: ${log.c_i}`,
      `单意图轮次预算 B_i: ${log.B_i}`,
      "",
      "【SimUser】",
      log.user_message || "（空）",
      "",
      "【被测 Agent】",
      log.assistant_message || "（空）",
      "",
      "【Judge】",
      `标签: ${log.judge}`,
      `理由: ${log.rationale}`,
      `证据摘录: ${log.evidence_quote || "（无）"}`,
      "",
    );
  }

  const m = opts.sessionMetrics;
  if (m) {
    lines.push(
      "========== 动态会话级指标汇总（评测完成后可用） ==========",
      `意图完成率 intent_completion_rate: ${m.intent_completion_rate}`,
      `追问负担相关 followup_efficiency: ${m.followup_efficiency}`,
      `偏离率 deviation_rate: ${m.deviation_rate}`,
      `轮次效率 turn_efficiency: ${m.turn_efficiency}`,
      `T_hist(原始 user 轮): ${m.T_hist}`,
      `T_eval(动态 user 轮): ${m.T_eval}`,
      `满足意图数 satisfied_intents / total_intents: ${m.satisfied_intents} / ${m.total_intents}`,
      `偏离轮次 deviation_rounds / total_rounds: ${m.deviation_rounds} / ${m.total_rounds}`,
      `追问次数 followup_count: ${m.followup_count}`,
      "",
    );
  }

  lines.push("# 文件结束", "");
  return lines.join("\n");
}

/**
 * 在浏览器中触发 UTF-8（含 BOM）纯文本下载。
 */
function downloadTextFile(filename: string, content: string): void {
  const bom = "\uFEFF";
  const blob = new Blob([bom + content], { type: "text/plain;charset=utf-8" });
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
 * Judge 条样式类名。
 */
function judgeClass(j: EvalTurnLog["judge"]): string {
  if (j === "SATISFIED") return styles.judgeSat;
  if (j === "DEVIATION") return styles.judgeDev;
  return styles.judgeNot;
}

/**
 * 常驻动态评测对话区：评测前为空态；流式评测时逐条追加 SimUser / Agent 气泡。
 */
export function EvalLiveChatPanel(props: Props) {
  const {
    logs,
    phase,
    running,
    sessionId = null,
    sessionMetrics = null,
    onRunDynamicEval,
    runDynamicEvalDisabled,
    lastEvalExtraction = null,
    tableExtraction = null,
  } = props;

  let status = "等待评测：请先完成抽取，再于本卡片右上角点击「运行动态评测」。";
  if (running && phase === "baseline") {
    status = "正在计算基线 B（原始对白一次打分）…";
  } else if (running && phase === "dynamic") {
    status = "动态评测进行中：每轮先 SimUser，再被测 Agent（与后端串行一致）…";
  } else if (!running && phase === "complete" && logs.length === 0) {
    status = "本轮无对话轮次输出。";
  } else if (!running && logs.length > 0) {
    status = `共 ${logs.length} 轮对话。下方为本次评测记录。`;
  }

  /**
   * 导出当前已展示的完整轮次与 Judge 为 TXT（便于离线分析）。
   */
  const handleExportTxt = () => {
    if (logs.length === 0) return;
    const body = buildEvalSessionExportTxt(logs, {
      sessionId,
      exportedAtIso: new Date().toISOString(),
      sessionMetrics: sessionMetrics ?? undefined,
      lastEvalExtraction: lastEvalExtraction ?? undefined,
      tableExtraction: tableExtraction ?? undefined,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fname = `eval-dynamic-${slugSessionIdForFile(sessionId)}-${stamp}.txt`;
    downloadTextFile(fname, body);
  };

  return (
    <div className="card">
      <div className={styles.chatCardHeader}>
        <h2 className={styles.sectionTitle}>动态评测对话（实时）</h2>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            disabled={runDynamicEvalDisabled}
            title="以当前表格为抽取结果流式评测（含基线）；需已选 session 且有意图表。"
            onClick={onRunDynamicEval}
          >
            运行动态评测（含基线）
          </button>
          <button
            type="button"
            className="secondary"
            disabled={logs.length === 0}
            title="导出当前列表中的全部轮次与 Judge 判定为 UTF-8 TXT"
            onClick={handleExportTxt}
          >
            导出会话 TXT
          </button>
        </div>
      </div>
      <p className="muted" style={{ marginTop: 0 }}>
        {status}
      </p>
      <p className="muted" style={{ margin: "0 0 10px", fontSize: 12 }}>
        导出除对话外还包含<strong>抽取结果</strong>（意图序列 + 可回填项）；优先附带最近一次评测提交的 JSON。若评测仍在逐条刷入，请等结束后再导出以拿到完整轮次。
      </p>
      <div className={styles.chatShell}>
        {logs.length === 0 && !running ? (
          <p className="muted" style={{ margin: "24px 0", textAlign: "center" }}>
            尚无对话。完成抽取后在本卡片上方点击「运行动态评测」，对话将按轮次依次出现在此处。
          </p>
        ) : null}
        {logs.map((log, idx) => (
          <div key={`${log.step}-${idx}`} className={styles.chatRound}>
            <div className={styles.chatRoundMeta}>
              第 <strong>{log.step}</strong> 步 · 意图序号 <strong>{log.intent_index}</strong> · 本回合开始时 c=
              <strong>{log.c_i}</strong> / 预算 <strong>B={log.B_i}</strong>
            </div>
            <div className={styles.chatGrid}>
              <div className={styles.chatColLeft}>
                <span className={styles.chatRole}>SimUser</span>
                <div className={styles.bubbleUser}>{log.user_message || "（空）"}</div>
              </div>
              <div className={styles.chatColRight}>
                <span className={styles.chatRole}>被测 Agent</span>
                <div className={styles.bubbleAgent}>{log.assistant_message || "（空）"}</div>
              </div>
            </div>
            <div className={`${styles.judgeStrip} ${judgeClass(log.judge)}`}>
              <strong>Judge：</strong>
              <span className={styles.judgeLabel}>{log.judge}</span>
              <span className={styles.judgeRationale}>{log.rationale}</span>
              {log.evidence_quote ? (
                <blockquote className={styles.judgeQuote}>「{log.evidence_quote}」</blockquote>
              ) : null}
            </div>
          </div>
        ))}
        {running ? (
          <div className={styles.chatTypingRow}>
            <span className={styles.chatTypingDot} />
            <span className={styles.chatTypingDot} />
            <span className={styles.chatTypingDot} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
