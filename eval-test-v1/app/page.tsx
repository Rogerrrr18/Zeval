"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CsvImportPanel, type CsvPreview } from "@/app/components/CsvImportPanel";
import { ExtractionEditor, applyExtractionToForm } from "@/app/components/ExtractionEditor";
import { EvalResultPanel } from "@/app/components/EvalResultPanel";
import { EvalLiveChatPanel, type EvalStreamPhase } from "@/app/components/EvalLiveChatPanel";
import { RealUserEvalPanel } from "@/app/components/RealUserEvalPanel";
import { WorkflowGuide } from "@/app/components/WorkflowGuide";
import type { BaselineVector } from "@/lib/baseline";
import { formToExtractionRoot } from "@/lib/extraction-form";
import type { IntentFormRow, RefillFormRow } from "@/lib/extraction-form";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/extraction-constants";
import type { EvalTurnLog, ExtractionRoot, SessionMetrics } from "@/lib/types";
import styles from "@/app/experiment.module.css";

type SessionRow = { session_id: string; turns: number; user_turns: number };

type Radar = {
  intent_completion_rate: number;
  followup_quality: number;
  inverse_deviation: number;
  turn_quality: number;
};

const TURN_STAGGER_MS = 220;
type EvalMode = "auto" | "realuser";

export default function HomePage() {
  const [settings, setSettings] = useState({
    ZEVAL_JUDGE_BASE_URL: "https://api.siliconflow.cn/v1",
    ZEVAL_JUDGE_MODEL: "Qwen/Qwen3.5-27B",
    ZEVAL_INTENT_EXPERIMENT_API_KEY: "",
    ZEVAL_JUDGE_ENABLE_THINKING: "false",
  });
  const [hasKey, setHasKey] = useState(false);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [intentRows, setIntentRows] = useState<IntentFormRow[]>([]);
  const [refillRows, setRefillRows] = useState<RefillFormRow[]>([]);
  const [editorLocked, setEditorLocked] = useState(false);
  const [showJsonDebug, setShowJsonDebug] = useState(false);
  const [evalMode, setEvalMode] = useState<EvalMode>("auto");
  const [busy, setBusy] = useState(false);
  const [progressHint, setProgressHint] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [evalResult, setEvalResult] = useState<{
    baseline: BaselineVector;
    baseline_radar: Radar;
    dynamic_radar: Radar;
    dynamic_raw: SessionMetrics;
  } | null>(null);
  /** 动态评测对话气泡（流式逐条刷入）。 */
  const [liveLogs, setLiveLogs] = useState<EvalTurnLog[]>([]);
  /** 待刷入 UI 的轮次队列长度（用 ref 存队列，避免在 setState  updater 内嵌套 setState 导致 Strict Mode 下重复追加）。 */
  const staggerQueueRef = useRef<EvalTurnLog[]>([]);
  const staggerTimerRef = useRef<number | null>(null);
  const [pendingStaggerLen, setPendingStaggerLen] = useState(0);
  const [streamPhase, setStreamPhase] = useState<EvalStreamPhase>("idle");
  /** HTTP 流读取已结束，但 UI 可能仍在消费 stagger 队列。 */
  const [evalDrainNeeded, setEvalDrainNeeded] = useState(false);
  /** HTTP 流读取进行中（含等待首包）。 */
  const [evalHttpBusy, setEvalHttpBusy] = useState(false);
  /** 当前选中 session 是否已有服务端锁版（写入成功或读取锁版成功）。 */
  const [serverLockReady, setServerLockReady] = useState(false);
  /** 最近一次「运行动态评测」请求体中的 extraction（与 API 一致，供导出对照漂移）。 */
  const [lastEvalExtraction, setLastEvalExtraction] = useState<ExtractionRoot | null>(null);

  /** 导出时刻由当前表格合成的 extraction（作 fallback；优先使用 lastEvalExtraction）。 */
  const tableExtraction = useMemo(() => {
    if (!selected || intentRows.length === 0) return null;
    try {
      return formToExtractionRoot(EXTRACTION_SCHEMA_VERSION, selected, intentRows, refillRows);
    } catch {
      return null;
    }
  }, [selected, intentRows, refillRows]);

  /** 清空 stagger 队列与定时器（切换 session、重置评测等时调用）。 */
  const clearStaggerQueue = useCallback(() => {
    if (staggerTimerRef.current != null) {
      clearTimeout(staggerTimerRef.current);
      staggerTimerRef.current = null;
    }
    staggerQueueRef.current = [];
    setPendingStaggerLen(0);
  }, []);

  /**
   * 从队列弹出一轮并写入 liveLogs；若仍有积压则继续定时弹出（不在其它 setState 的 updater 内调用 setLiveLogs）。
   */
  const drainOneStaggered = useCallback(() => {
    staggerTimerRef.current = null;
    const next = staggerQueueRef.current.shift();
    if (next) {
      setLiveLogs((prev) => (prev.some((x) => x.step === next.step) ? prev : [...prev, next]));
    }
    const len = staggerQueueRef.current.length;
    setPendingStaggerLen(len);
    if (len > 0) {
      staggerTimerRef.current = window.setTimeout(drainOneStaggered, TURN_STAGGER_MS);
    }
  }, []);

  /**
   * 将流式返回的一轮加入队列；若当前无定时器则启动首段延迟，避免与 React Strict Mode 双调 updater 冲突。
   */
  const enqueueStaggeredTurn = useCallback(
    (log: EvalTurnLog) => {
      if (staggerQueueRef.current.some((x) => x.step === log.step)) return;
      staggerQueueRef.current.push(log);
      setPendingStaggerLen(staggerQueueRef.current.length);
      if (staggerTimerRef.current == null) {
        staggerTimerRef.current = window.setTimeout(drainOneStaggered, TURN_STAGGER_MS);
      }
    },
    [drainOneStaggered],
  );

  const refreshSessions = useCallback(async () => {
    const r = await fetch("/api/sessions?includeRows=1");
    const j = (await r.json()) as {
      sessions: SessionRow[];
      preview: CsvPreview | null;
    };
    setSessions(j.sessions ?? []);
    if (j.preview?.columns?.length) {
      setCsvPreview(j.preview);
    } else {
      setCsvPreview(null);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    const r = await fetch("/api/settings");
    const j = await r.json();
    setHasKey(Boolean(j.hasApiKey));
    if (j.baseUrl) {
      setSettings((s) => ({ ...s, ZEVAL_JUDGE_BASE_URL: j.baseUrl, ZEVAL_JUDGE_MODEL: j.model }));
    }
  }, []);

  useEffect(() => {
    void refreshSettings();
    void refreshSessions();
  }, [refreshSessions, refreshSettings]);

  /** 切换 session 时清空抽取表与评测区，避免误用其它会话的数据。 */
  useEffect(() => {
    setIntentRows([]);
    setRefillRows([]);
    setEditorLocked(false);
    setServerLockReady(false);
    setEvalResult(null);
    setLiveLogs([]);
    clearStaggerQueue();
    setStreamPhase("idle");
    setEvalDrainNeeded(false);
    setEvalHttpBusy(false);
    setLastEvalExtraction(null);
  }, [selected, clearStaggerQueue]);

  /** 流读取结束后，待 stagger 队列清空再解除 busy（避免评测动画中途触发其它请求）。 */
  useEffect(() => {
    if (!evalDrainNeeded || pendingStaggerLen > 0) return;
    setBusy(false);
    setEvalDrainNeeded(false);
  }, [evalDrainNeeded, pendingStaggerLen]);

  const saveSettings = async () => {
    setErr(null);
    setBusy(true);
    try {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "保存失败");
      await refreshSettings();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const parseCsv = async (csvText: string) => {
    setErr(null);
    if (!csvText.trim()) {
      setErr("CSV 内容为空");
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/csv/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "解析失败");
      setCsvPreview(j.preview ?? null);
      await refreshSessions();
      if (j.session_ids?.length) {
        setSelected(j.session_ids[0]);
      }
      setIntentRows([]);
      setRefillRows([]);
      setEditorLocked(false);
      setServerLockReady(false);
      setEvalResult(null);
      setLiveLogs([]);
      clearStaggerQueue();
      setStreamPhase("idle");
      setEvalDrainNeeded(false);
      setLastEvalExtraction(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runExtract = async (force = false) => {
    if (!selected) return;
    setErr(null);
    setEvalResult(null);
    setLastEvalExtraction(null);
    setLiveLogs([]);
    clearStaggerQueue();
    setStreamPhase("idle");
    setEvalDrainNeeded(false);
    setBusy(true);
    setProgressHint(
      force
        ? "正在重新抽取… 新结果只会填入表格，不会覆盖已绑定结果；确认后请点击「保存绑定结果」。"
        : "正在抽取/读取绑定结果… 首次抽取会自动绑定，已有绑定则直接复用。",
    );
    try {
      const r = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: selected, force }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "抽取失败");
      applyExtractionToForm(setIntentRows, setRefillRows, j.extraction);
      setEditorLocked(false);
      setServerLockReady(Boolean(j.bound));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setProgressHint(null);
      setBusy(false);
    }
  };

  const runLock = async () => {
    if (!selected) return;
    setErr(null);
    setBusy(true);
    try {
      const root = formToExtractionRoot(EXTRACTION_SCHEMA_VERSION, selected, intentRows, refillRows);
      const jsonText = JSON.stringify(root);
      const r = await fetch("/api/lock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: selected, jsonText }),
      });
      const j = await r.json();
      if (!r.ok) {
        const msg =
          j.error == null
            ? "锁版失败"
            : typeof j.error === "string"
              ? j.error
              : JSON.stringify(j.error);
        throw new Error(msg);
      }
      setEditorLocked(true);
      setServerLockReady(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const loadLocked = async () => {
    if (!selected) return;
    setErr(null);
    setBusy(true);
    setLiveLogs([]);
    clearStaggerQueue();
    setStreamPhase("idle");
    setEvalDrainNeeded(false);
    setEvalResult(null);
    setLastEvalExtraction(null);
    try {
      const r = await fetch(`/api/lock/${encodeURIComponent(selected)}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "无锁版");
      applyExtractionToForm(setIntentRows, setRefillRows, j);
      setEditorLocked(true);
      setServerLockReady(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const runEval = async () => {
    if (!selected) return;
    let extraction: ReturnType<typeof formToExtractionRoot>;
    try {
      extraction = formToExtractionRoot(EXTRACTION_SCHEMA_VERSION, selected, intentRows, refillRows);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      return;
    }

    setLastEvalExtraction(extraction);

    setErr(null);
    setBusy(true);
    setEvalHttpBusy(true);
    setEvalDrainNeeded(false);
    setEvalResult(null);
    setLiveLogs([]);
    clearStaggerQueue();
    setStreamPhase("baseline");

    const baselineHold: { b?: BaselineVector; br?: Radar } = {};

    /**
     * 处理 NDJSON 单行事件。
     */
    const applyNdJsonLine = (raw: Record<string, unknown>) => {
      const typ = String(raw.type ?? "");
      if (typ === "error") throw new Error(String(raw.message ?? "流式评测失败"));
      if (typ === "phase") {
        const ph = String(raw.phase ?? "");
        if (ph === "baseline") setStreamPhase("baseline");
        if (ph === "dynamic") setStreamPhase("dynamic");
      }
      if (typ === "baseline") {
        baselineHold.b = raw.baseline as BaselineVector;
        baselineHold.br = raw.baseline_radar as Radar;
      }
      if (typ === "turn") {
        const log = raw.log as EvalTurnLog;
        enqueueStaggeredTurn(log);
      }
      if (typ === "metrics") {
        const b = baselineHold.b;
        const br = baselineHold.br;
        if (b == null || br == null) throw new Error("流式响应缺少 baseline");
        const serverLogs = raw.logs as EvalTurnLog[] | undefined;
        if (Array.isArray(serverLogs) && serverLogs.length > 0) {
          clearStaggerQueue();
          setLiveLogs(serverLogs);
        }
        setEvalResult({
          baseline: b,
          baseline_radar: br,
          dynamic_radar: raw.dynamic_radar as Radar,
          dynamic_raw: raw.dynamic_raw as SessionMetrics,
        });
      }
      if (typ === "done") setStreamPhase("complete");
    };

    try {
      const r = await fetch("/api/eval/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: selected, extraction }),
      });
      if (!r.ok) {
        let msg = `HTTP ${r.status}`;
        try {
          const j = (await r.json()) as { error?: unknown };
          if (typeof j.error === "string") msg = j.error;
        } catch {
          /* 非 JSON 错误体 */
        }
        throw new Error(msg);
      }
      const reader = r.body?.getReader();
      if (!reader) throw new Error("响应无 body");

      const decoder = new TextDecoder();
      let buf = "";

      const consumeBuffer = () => {
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          applyNdJsonLine(JSON.parse(t) as Record<string, unknown>);
        }
      };

      while (true) {
        const { done, value } = await reader.read();
        if (value) buf += decoder.decode(value, { stream: true });
        consumeBuffer();
        if (done) break;
      }
      buf += decoder.decode();
      const tail = buf.trim();
      if (tail) {
        for (const line of tail.split("\n")) {
          const t = line.trim();
          if (!t) continue;
          applyNdJsonLine(JSON.parse(t) as Record<string, unknown>);
        }
      }

      setEvalHttpBusy(false);
      setEvalDrainNeeded(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setStreamPhase("idle");
      setLiveLogs([]);
      clearStaggerQueue();
      setEvalHttpBusy(false);
      setBusy(false);
    }
  };

  return (
    <main>
      <h1>意图指针动态评测 · eval-test-v1</h1>
      <p className="muted">npm run dev 默认端口 3100 · 方案见 /方案文档/基于意图指针的动态评测效果实验方案.md</p>

      <div className="card">
        <h2 className={styles.sectionTitle}>实验设置（SiliconFlow）</h2>
        <p className="muted">保存后写入 <code>data/local.settings.json</code>，勿提交仓库。</p>
        <div className="row">
          <label style={{ width: 140 }}>BASE_URL</label>
          <input
            value={settings.ZEVAL_JUDGE_BASE_URL}
            onChange={(e) => setSettings({ ...settings, ZEVAL_JUDGE_BASE_URL: e.target.value })}
          />
        </div>
        <div className="row">
          <label style={{ width: 140 }}>MODEL</label>
          <input value={settings.ZEVAL_JUDGE_MODEL} onChange={(e) => setSettings({ ...settings, ZEVAL_JUDGE_MODEL: e.target.value })} />
        </div>
        <div className="row">
          <label style={{ width: 140 }}>API_KEY</label>
          <input
            type="password"
            placeholder={hasKey ? "已配置（可覆盖）" : "必填"}
            value={settings.ZEVAL_INTENT_EXPERIMENT_API_KEY}
            onChange={(e) => setSettings({ ...settings, ZEVAL_INTENT_EXPERIMENT_API_KEY: e.target.value })}
          />
        </div>
        <div className="row">
          <button type="button" disabled={busy} onClick={() => void saveSettings()}>
            保存设置
          </button>
          <span className="muted">{hasKey ? "已检测到密钥（文件或环境变量）" : "未检测到密钥"}</span>
        </div>
      </div>

      <div className="card">
        <h2 className={styles.sectionTitle}>1. CSV 导入（v1.0-csv-multiwoz）</h2>
        <CsvImportPanel busy={busy} onParse={(text) => parseCsv(text)} preview={csvPreview} selectedSessionId={selected} />
      </div>

      <div className="card">
        <h2 className={styles.sectionTitle}>2. Session 选择</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          下拉框决定<strong>唯一作用域</strong>：运行抽取、锁版、动态评测都只针对这里选中的 id。切换选项会清空下方抽取表与对话区；对新 session 请重新抽取或读取其锁版。
        </p>
        <div className="row">
          <label>当前 session：</label>
          <select value={selected ?? ""} onChange={(e) => setSelected(e.target.value || null)} style={{ minWidth: 280 }}>
            <option value="">-- 选择 --</option>
            {sessions.map((s) => (
              <option key={s.session_id} value={s.session_id}>
                {s.session_id}（{s.user_turns} user 轮 · {s.turns} 行）
              </option>
            ))}
          </select>
        </div>
      </div>

      <WorkflowGuide
        selectedId={selected}
        sessionCount={sessions.length}
        intentRowCount={intentRows.length}
        serverLockReady={serverLockReady}
        hasEvalPanel={evalResult !== null}
      />

      <div className="card">
        <h2 className={styles.sectionTitle}>3. 抽取 / 锁版（表格编辑）</h2>
        <ExtractionEditor
          selected={selected}
          busy={busy}
          serverLockReady={serverLockReady}
          editorLocked={editorLocked}
          onToggleEditorLock={() => setEditorLocked((x) => !x)}
          intentRows={intentRows}
          refillRows={refillRows}
          setIntentRows={setIntentRows}
          setRefillRows={setRefillRows}
          onRunExtract={() => runExtract(false)}
          onRunReExtract={() => runExtract(true)}
          onLoadLocked={loadLocked}
          onRunLock={runLock}
          showJsonDebug={showJsonDebug}
          onToggleJsonDebug={() => setShowJsonDebug((x) => !x)}
          extracting={Boolean(progressHint)}
        />
      </div>

      {progressHint ? <div className="progressHint">{progressHint}</div> : null}

      {err ? <div className="err">{err}</div> : null}

      <div className="card">
        <h2 className={styles.sectionTitle}>4. 动态评测模式</h2>
        <p className="muted" style={{ marginTop: 0 }}>
          自动模式由 SimUser + LLM Judge 驱动；真人模式由操作员负责发问、Judge 与意图推进，仅被测 Agent 调用模型。
        </p>
        <div className={styles.toolbar}>
          <button type="button" className={evalMode === "auto" ? "" : "secondary"} disabled={busy} onClick={() => setEvalMode("auto")}>
            全自动动态评测
          </button>
          <button type="button" className={evalMode === "realuser" ? "" : "secondary"} disabled={busy} onClick={() => setEvalMode("realuser")}>
            真人用户动态评测
          </button>
        </div>
      </div>

      {evalMode === "auto" ? (
        <EvalLiveChatPanel
          logs={liveLogs}
          phase={streamPhase}
          running={evalHttpBusy || pendingStaggerLen > 0}
          sessionId={selected}
          sessionMetrics={evalResult?.dynamic_raw ?? null}
          onRunDynamicEval={() => void runEval()}
          runDynamicEvalDisabled={!selected || busy || intentRows.length === 0}
          lastEvalExtraction={lastEvalExtraction}
          tableExtraction={tableExtraction}
        />
      ) : (
        <RealUserEvalPanel sessionId={selected} extraction={tableExtraction} />
      )}

      {evalResult ? (
        <EvalResultPanel
          baseline={evalResult.baseline}
          dynamicRaw={evalResult.dynamic_raw}
          baselineRadar={evalResult.baseline_radar}
          dynamicRadar={evalResult.dynamic_radar}
        />
      ) : null}
    </main>
  );
}
