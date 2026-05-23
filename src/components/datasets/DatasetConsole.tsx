/**
 * @fileoverview Dataset browsing + calibration workspace.
 *
 * Two tabs:
 *   "案例池"   — auto-admitted cases (TP / FN confirmed / TN / manual_fp).
 *               Read-only with a single "标记错判" escape hatch.
 *   "待确认"   — pending_review cases (auto_fn + auto_uncertainty).
 *               Each card offers Confirm / False-positive / Skip actions.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BadCaseCluster } from "@/badcase/types";
import { AppShell } from "@/components/shell";
import type { DatasetCaseRecord, DatasetCaseReviewStatus, DatasetCaseSource } from "@/eval-datasets/storage/types";
import styles from "./datasetConsole.module.css";

// ── Constants ──────────────────────────────────────────────────────────────

const DATASET_SNAPSHOT_KEY = "zeval.datasets.snapshot.v2";

/** Chinese display labels for each admission source. */
const SOURCE_LABELS: Record<DatasetCaseSource, string> = {
  auto_tp:          "自动识别-坏案例",
  auto_fn:          "漏报识别-坏案例",
  auto_tn:          "抽样-金标正例",
  auto_uncertainty: "边界案例-待确认",
  auto_disagreement:"评估器分歧-待确认",
  manual_fp:        "人工复审-正例",
  synthesized:      "合成样本",
  imported:         "外部导入",
};

const SOURCE_COLOR: Record<DatasetCaseSource, string> = {
  auto_tp:          "#ef4444",
  auto_fn:          "#f97316",
  auto_tn:          "#22c55e",
  auto_uncertainty: "#eab308",
  auto_disagreement:"#a855f7",
  manual_fp:        "#3b82f6",
  synthesized:      "#6b7280",
  imported:         "#6b7280",
};

const CASE_REVIEW_STATUS_OPTIONS: DatasetCaseReviewStatus[] = [
  "auto_captured",
  "human_reviewed",
  "gold_candidate",
  "gold",
  "regression_active",
];

/**
 * Statuses that indicate a case has cleared the human-review gate and is
 * eligible to participate in benchmark regression runs.
 * Mirrors the `isPoolActiveCase()` guard in admission/pipeline.ts.
 */
const POOL_ACTIVE_STATUSES: DatasetCaseReviewStatus[] = [
  "human_reviewed",
  "gold_candidate",
  "gold",
  "regression_active",
];

type Tab = "pool" | "pending";

// ── Response shapes ────────────────────────────────────────────────────────

type ClusterResponse  = { clusters: BadCaseCluster[]; totalCases: number; totalClusters: number };
type CaseListResponse = { cases: DatasetCaseRecord[]; count: number };

type DatasetSnapshot = {
  clusters: BadCaseCluster[];
  poolCases: DatasetCaseRecord[];
  pendingCases: DatasetCaseRecord[];
  selectedScenarioId: string;
  notice: string;
};

// ── Root component ─────────────────────────────────────────────────────────

/**
 * Render the dataset browsing + calibration console.
 */
export function DatasetConsole() {
  const snapshotHydratedRef = useRef(false);
  const [clusters, setClusters]               = useState<BadCaseCluster[]>([]);
  const [poolCases, setPoolCases]             = useState<DatasetCaseRecord[]>([]);
  const [pendingCases, setPendingCases]       = useState<DatasetCaseRecord[]>([]);
  const [loading, setLoading]                 = useState(false);
  const [actionCaseId, setActionCaseId]       = useState("");
  const [error, setError]                     = useState("");
  const [notice, setNotice]                   = useState("");
  const [selectedScenarioId, setSelectedScenarioId] = useState("");
  const [activeTab, setActiveTab]             = useState<Tab>("pool");
  // Locally dismissed pending cases (session-only, not persisted).
  const [dismissedIds, setDismissedIds]       = useState<Set<string>>(new Set());

  // ── Snapshot hydration ──────────────────────────────────────────────────
  useEffect(() => {
    const raw = window.localStorage.getItem(DATASET_SNAPSHOT_KEY);
    if (!raw) { snapshotHydratedRef.current = true; return; }
    try {
      const snap = JSON.parse(raw) as DatasetSnapshot;
      setClusters(snap.clusters ?? []);
      setPoolCases(snap.poolCases ?? []);
      setPendingCases(snap.pendingCases ?? []);
      setSelectedScenarioId(snap.selectedScenarioId ?? "");
      setNotice(snap.notice ?? "");
    } catch {
      window.localStorage.removeItem(DATASET_SNAPSHOT_KEY);
    } finally {
      snapshotHydratedRef.current = true;
    }
  }, []);

  useEffect(() => {
    if (!snapshotHydratedRef.current) return;
    const snap: DatasetSnapshot = { clusters, poolCases, pendingCases, selectedScenarioId, notice };
    window.localStorage.setItem(DATASET_SNAPSHOT_KEY, JSON.stringify(snap));
  }, [clusters, poolCases, pendingCases, selectedScenarioId, notice]);

  // ── Data loading ────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [clusterRes, poolRes, fnRes, ucRes] = await Promise.all([
        fetch("/api/eval-datasets/clusters"),
        // Pool: all cases that are NOT pending_review (auto_tp + confirmed FN + TN + manual_fp)
        fetch("/api/eval-datasets/cases?caseSetType=badcase"),
        // Pending: FN channel, still in auto_captured / pending
        fetch("/api/eval-datasets/cases?source=auto_fn"),
        // Pending: uncertainty channel
        fetch("/api/eval-datasets/cases?source=auto_uncertainty"),
      ]);

      const clusterData = (await clusterRes.json())    as Partial<ClusterResponse>  & { error?: string; detail?: string };
      const poolData    = (await poolRes.json())        as Partial<CaseListResponse> & { error?: string; detail?: string };
      const fnData      = (await fnRes.json())          as Partial<CaseListResponse> & { error?: string; detail?: string };
      const ucData      = (await ucRes.json())          as Partial<CaseListResponse> & { error?: string; detail?: string };

      if (!clusterRes.ok) throw new Error(clusterData.detail ?? clusterData.error ?? "加载 cluster 失败");
      if (!poolRes.ok)    throw new Error(poolData.detail    ?? poolData.error    ?? "加载案例池失败");

      setClusters(clusterData.clusters ?? []);
      const allPool = poolData.cases ?? [];

      // Pool: only cases that have passed the human-review gate.
      // Mirrors isPoolActiveCase() in admission/pipeline.ts — do NOT show
      // auto_captured cases here even for auto_tp; they belong in the pending
      // queue until a reviewer promotes them.
      const poolFiltered = allPool.filter((c) =>
        POOL_ACTIVE_STATUSES.includes(c.reviewStatus ?? "auto_captured"),
      );
      setPoolCases(poolFiltered);

      // Pending queue: three sources merged, deduplicated by caseId.
      //   1. auto_fn  — always require review (weak signal, system judged OK)
      //   2. auto_uncertainty — always require review (Judge confidence low)
      //   3. humanReviewRequired TP/TN — sampled by humanSamplingRate at harvest time
      const pendingMap = new Map<string, DatasetCaseRecord>();
      [...(fnData.cases ?? []), ...(ucData.cases ?? [])].forEach((c) => {
        if (c.reviewStatus === "auto_captured") pendingMap.set(c.caseId, c);
      });
      allPool.forEach((c) => {
        if (
          c.reviewStatus === "auto_captured" &&
          (c.metadata as Record<string, unknown> | undefined)?.humanReviewRequired === true &&
          !pendingMap.has(c.caseId)
        ) {
          pendingMap.set(c.caseId, c);
        }
      });
      setPendingCases([...pendingMap.values()]);

      setNotice(
        `已入池 ${poolFiltered.length} 条（已审核），待确认 ${pendingMap.size} 条。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // ── Derived data ────────────────────────────────────────────────────────
  const scenarioOptions = useMemo(
    () =>
      [...new Set(poolCases.map((c) => c.scenarioId).filter((v): v is string => Boolean(v)))]
        .sort()
        .map((s) => ({ scenarioId: s })),
    [poolCases],
  );

  const filteredClusters = useMemo(
    () => (selectedScenarioId ? clusters.filter((c) => c.scenarioId === selectedScenarioId) : clusters),
    [clusters, selectedScenarioId],
  );

  const poolCaseById = useMemo(() => new Map(poolCases.map((c) => [c.caseId, c])), [poolCases]);

  const reviewStats = useMemo(() => {
    const stats = new Map<DatasetCaseReviewStatus, number>();
    poolCases.forEach((c) => {
      const s = c.reviewStatus ?? "auto_captured";
      stats.set(s, (stats.get(s) ?? 0) + 1);
    });
    return stats;
  }, [poolCases]);

  const visiblePending = useMemo(
    () => pendingCases.filter((c) => !dismissedIds.has(c.caseId)),
    [pendingCases, dismissedIds],
  );

  // ── Actions ─────────────────────────────────────────────────────────────

  /**
   * PATCH one case with a human verdict.
   * - false_positive → backend flips to goodcase + manual_fp + metadata.false_positive=true
   * - valid_bad_case → marks as human_reviewed + regression_active
   */
  const submitVerdict = useCallback(
    async (
      caseId: string,
      verdict: "valid_bad_case" | "false_positive",
      note?: string,
    ) => {
      setActionCaseId(caseId);
      setError("");
      try {
        const body: Record<string, unknown> = {
          humanVerdict: verdict,
          reviewStatus: verdict === "valid_bad_case" ? "regression_active" : "human_reviewed",
        };
        if (note?.trim()) body.reviewNotes = note.trim();

        const res  = await fetch(`/api/eval-datasets/cases/${encodeURIComponent(caseId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as { case?: DatasetCaseRecord; error?: string; detail?: string };
        if (!res.ok || !data.case) throw new Error(data.detail ?? data.error ?? "操作失败");

        // Remove from pending list.
        setPendingCases((prev) => prev.filter((c) => c.caseId !== caseId));

        if (verdict === "valid_bad_case") {
          // Promote to pool.
          setPoolCases((prev) => {
            const exists = prev.some((c) => c.caseId === caseId);
            return exists
              ? prev.map((c) => (c.caseId === caseId ? (data.case as DatasetCaseRecord) : c))
              : [...prev, data.case as DatasetCaseRecord];
          });
          setNotice(`✓ ${caseId} 已确认为坏案例并加入回归集。`);
        } else {
          setNotice(`✗ ${caseId} 已标记为误判，转为正例对照组。`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "操作失败");
      } finally {
        setActionCaseId("");
      }
    },
    [],
  );

  /** Legacy "mark false positive" from pool view (only adds manualOverrides). */
  const markFalsePositive = useCallback(
    async (caseId: string, note?: string) => {
      await submitVerdict(caseId, "false_positive", note);
      // Also update poolCases locally since this comes from the pool tab.
      setPoolCases((prev) => prev.filter((c) => c.caseId !== caseId));
    },
    [submitVerdict],
  );

  const skipPending = useCallback((caseId: string) => {
    setDismissedIds((prev) => new Set([...prev, caseId]));
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <AppShell>
      <div className={styles.page}>
        <main className={styles.main}>
          <header className={styles.topBar}>
            <div className={styles.titleBlock}>
              <h1>评测集管理</h1>
              <p>案例池 · 待确认队列 · 人工校准</p>
            </div>
            <button
              className={styles.secondaryButton}
              type="button"
              disabled={loading}
              onClick={() => void loadData()}
            >
              {loading ? "刷新中…" : "刷新"}
            </button>
          </header>

          {/* ── Hero stats ── */}
          <section className={styles.heroGrid}>
            <article className={styles.heroCard}>
              <span>已入池案例</span>
              <strong>{poolCases.length}</strong>
              <small>参与回归验证</small>
            </article>
            <article className={styles.heroCard} style={{ cursor: "pointer" }} onClick={() => setActiveTab("pending")}>
              <span>待确认</span>
              <strong style={{ color: visiblePending.length > 0 ? "#f97316" : undefined }}>
                {visiblePending.length}
              </strong>
              <small>FN + 边界案例，点击跳转</small>
            </article>
            <article className={styles.heroCard}>
              <span>回归集</span>
              <strong>{reviewStats.get("regression_active") ?? 0}</strong>
              <small>regression_active</small>
            </article>
            <article className={styles.heroCard}>
              <span>误判转正例</span>
              <strong>{poolCases.filter((c) => c.source === "manual_fp").length}</strong>
              <small>manual_fp 正例对照</small>
            </article>
          </section>

          {error  ? <p className={styles.error}>{error}</p>   : null}
          {notice ? <p className={styles.notice}>{notice}</p> : null}

          {/* ── Tabs ── */}
          <div className={styles.tabBar}>
            <button
              className={activeTab === "pool" ? styles.tabActive : styles.tab}
              type="button"
              onClick={() => setActiveTab("pool")}
            >
              案例池
              <span className={styles.tabCount}>{poolCases.length}</span>
            </button>
            <button
              className={activeTab === "pending" ? styles.tabActive : styles.tab}
              type="button"
              onClick={() => setActiveTab("pending")}
            >
              待确认
              {visiblePending.length > 0 && (
                <span className={styles.tabBadge}>{visiblePending.length}</span>
              )}
            </button>
          </div>

          {/* ── Pool tab ── */}
          {activeTab === "pool" && (
            <>
              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>筛选</h2>
                  </div>
                  <div className={styles.formRow}>
                    <label className={styles.label}>
                      场景
                      <select
                        className={styles.select}
                        value={selectedScenarioId}
                        onChange={(e) => setSelectedScenarioId(e.target.value)}
                      >
                        <option value="">全部场景</option>
                        {scenarioOptions.map((o) => (
                          <option key={o.scenarioId} value={o.scenarioId}>{o.scenarioId}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                </div>
                <div className={styles.tagStrip}>
                  {CASE_REVIEW_STATUS_OPTIONS.map((s) => (
                    <span className={styles.statusPill} key={s}>
                      {s}: {reviewStats.get(s) ?? 0}
                    </span>
                  ))}
                </div>
              </section>

              <section className={styles.panel}>
                <div className={styles.panelHeader}>
                  <h2>Clusters</h2>
                  <span className={styles.meta}>{filteredClusters.length} 个</span>
                </div>
                <div className={styles.clusterList}>
                  {filteredClusters.length > 0 ? (
                    filteredClusters.map((cluster) => (
                      <details className={styles.clusterCard} key={cluster.clusterId}>
                        <summary className={styles.clusterSummary}>
                          <div>
                            <strong>{cluster.label}</strong>
                            <p>
                              rep={cluster.representativeCaseId} · size={cluster.size} ·
                              avgSeverity={cluster.averageSeverityScore.toFixed(2)}
                            </p>
                          </div>
                          <div className={styles.metaRow}>
                            {cluster.dominantTags.map((tag) => (
                              <span className={styles.tagPill} key={`${cluster.clusterId}_${tag}`}>{tag}</span>
                            ))}
                          </div>
                        </summary>
                        <div className={styles.clusterItems}>
                          {cluster.items.map((item) => (
                            <ReadOnlyCaseCard
                              key={item.caseId}
                              item={item}
                              caseRecord={poolCaseById.get(item.caseId)}
                              markingFalsePositive={actionCaseId === item.caseId}
                              onMarkFalsePositive={markFalsePositive}
                            />
                          ))}
                        </div>
                      </details>
                    ))
                  ) : (
                    <div className={styles.empty}>当前没有可展示的 cluster。</div>
                  )}
                </div>
              </section>
            </>
          )}

          {/* ── Pending tab ── */}
          {activeTab === "pending" && (
            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>待确认队列</h2>
                  <p>
                    这些案例由系统自动发现但置信度不足，需要人工确认后才会进入回归集。
                    <br />
                    <strong>漏报（FN）</strong>：系统判 OK，但用户行为信号显示实际有问题。
                    &nbsp;|&nbsp;
                    <strong>边界案例</strong>：Judge 置信度 ∈ [0.4, 0.6]，判断不确定。
                  </p>
                </div>
                {dismissedIds.size > 0 && (
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    onClick={() => setDismissedIds(new Set())}
                  >
                    恢复已跳过 ({dismissedIds.size})
                  </button>
                )}
              </div>

              {visiblePending.length === 0 ? (
                <div className={styles.empty}>
                  {pendingCases.length === 0
                    ? "暂无待确认案例。运行一次评估后自动生成。"
                    : `已处理全部 ${pendingCases.length} 条（含 ${dismissedIds.size} 条已跳过）。`}
                </div>
              ) : (
                <div className={styles.pendingList}>
                  {visiblePending.map((c) => (
                    <PendingCaseCard
                      key={c.caseId}
                      caseRecord={c}
                      actioning={actionCaseId === c.caseId}
                      onConfirm={(note) => submitVerdict(c.caseId, "valid_bad_case", note)}
                      onFalsePositive={(note) => submitVerdict(c.caseId, "false_positive", note)}
                      onSkip={() => skipPending(c.caseId)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}
        </main>
      </div>
    </AppShell>
  );
}

// ── Pool: ReadOnlyCaseCard ─────────────────────────────────────────────────

function ReadOnlyCaseCard(props: {
  item: BadCaseCluster["items"][number];
  caseRecord?: DatasetCaseRecord;
  markingFalsePositive: boolean;
  onMarkFalsePositive: (caseId: string, note?: string) => Promise<void>;
}) {
  const { item, caseRecord, markingFalsePositive, onMarkFalsePositive } = props;
  const [showNote, setShowNote] = useState(false);
  const [note, setNote]         = useState("");
  const overrides    = caseRecord?.manualOverrides ?? [];
  const alreadyMarked = overrides.some((o) => o.type === "false_positive");
  const signals      = caseRecord?.autoSignals ?? [];
  const source       = caseRecord?.source;

  return (
    <article className={styles.caseCard}>
      <div className={styles.caseHeader}>
        <div>
          <h3>{item.title}</h3>
          <p>{item.caseId} · session={item.sessionId} · severity={item.failureSeverityScore.toFixed(2)}</p>
        </div>
        <div className={styles.badgeGroup}>
          {source && (
            <span
              className={styles.sourceBadge}
              style={{ backgroundColor: SOURCE_COLOR[source] ?? "#6b7280" }}
            >
              {SOURCE_LABELS[source] ?? source}
            </span>
          )}
          <span className={styles.severityBadge}>{Math.round(item.failureSeverityScore * 100)}%</span>
        </div>
      </div>

      <div className={styles.metaRow}>
        {item.tags.map((tag) => (
          <span className={styles.tagPill} key={`${item.caseId}_${tag}`}>{tag}</span>
        ))}
      </div>

      {signals.length > 0 && (
        <div className={styles.signalBox}>
          <strong>命中信号</strong>
          <ul>{signals.map((s, i) => <li key={i}>{describeSignal(s)}</li>)}</ul>
        </div>
      )}

      {item.suggestedAction && <p className={styles.actionText}>{item.suggestedAction}</p>}
      {item.transcript && <pre className={styles.transcript}>{item.transcript}</pre>}

      <div className={styles.overrideRow}>
        {alreadyMarked ? (
          <span className={styles.overrideBadge}>已标记为错判（{overrides.length}）</span>
        ) : showNote ? (
          <div className={styles.overrideForm}>
            <input
              className={styles.input}
              placeholder="可选：为什么这是错判？"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              disabled={markingFalsePositive}
            />
            <button
              className={styles.primaryButton}
              type="button"
              disabled={markingFalsePositive}
              onClick={async () => { await onMarkFalsePositive(item.caseId, note); setShowNote(false); setNote(""); }}
            >
              {markingFalsePositive ? "提交中…" : "确认错判"}
            </button>
            <button className={styles.secondaryButton} type="button" onClick={() => { setShowNote(false); setNote(""); }}>
              取消
            </button>
          </div>
        ) : (
          <button className={styles.secondaryButton} type="button" onClick={() => setShowNote(true)}>
            标记错判
          </button>
        )}
      </div>
    </article>
  );
}

// ── Pending: PendingCaseCard ───────────────────────────────────────────────

function PendingCaseCard(props: {
  caseRecord: DatasetCaseRecord;
  actioning: boolean;
  onConfirm: (note?: string) => Promise<void>;
  onFalsePositive: (note?: string) => Promise<void>;
  onSkip: () => void;
}) {
  const { caseRecord, actioning, onConfirm, onFalsePositive, onSkip } = props;
  const [expandTranscript, setExpandTranscript] = useState(false);
  const [noteVisible, setNoteVisible]           = useState(false);
  const [note, setNote]                         = useState("");

  const source  = caseRecord.source as DatasetCaseSource | undefined;
  const rules   = (caseRecord.autoSignals ?? []) as Array<{ ruleKey?: string; severity?: string }>;
  const humanReviewRequired = (caseRecord.metadata as Record<string, unknown> | undefined)?.humanReviewRequired === true;

  const channelDesc = source === "auto_fn"
    ? "漏报识别 — 系统判定 OK，但行为信号异常"
    : source === "auto_uncertainty"
    ? "边界案例 — Judge 置信度低，判断不确定"
    : humanReviewRequired
    ? "抽样审核 — 命中人工抽样比例，需确认后方可入池"
    : SOURCE_LABELS[source ?? "auto_tp"] ?? source;

  return (
    <article className={styles.pendingCard}>
      {/* Header */}
      <div className={styles.caseHeader}>
        <div>
          <div className={styles.metaRow} style={{ marginBottom: 4 }}>
            <span
              className={styles.sourceBadge}
              style={{ backgroundColor: SOURCE_COLOR[source ?? "auto_fn"] }}
            >
              {SOURCE_LABELS[source ?? "auto_fn"] ?? source}
            </span>
            <span className={styles.statusPill}>{caseRecord.reviewStatus ?? "auto_captured"}</span>
            {humanReviewRequired && (
              <span
                className={styles.statusPill}
                style={{ backgroundColor: "#7c3aed", color: "#fff", fontWeight: 600 }}
                title="该案例命中人工抽样比例，必须经人工审核后才可进入 benchmark 池"
              >
                抽样审核
              </span>
            )}
          </div>
          <h3>{caseRecord.title ?? caseRecord.caseId}</h3>
          <p className={styles.channelDesc}>{channelDesc}</p>
          <p>
            {caseRecord.caseId} · session={caseRecord.sessionId}
          </p>
        </div>
      </div>

      {/* Triggered rules */}
      {rules.length > 0 && (
        <div className={styles.signalBox}>
          <strong>触发规则</strong>
          <ul>
            {rules.map((r, i) => (
              <li key={i}>
                <code>{r.ruleKey ?? "unknown"}</code>
                {r.severity && <span className={styles.severityTag}> · {r.severity}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Transcript (collapsible) */}
      {caseRecord.transcript && (
        <div className={styles.transcriptBlock}>
          <button
            type="button"
            className={styles.transcriptToggle}
            onClick={() => setExpandTranscript((v) => !v)}
          >
            {expandTranscript ? "收起对话 ▲" : "展开对话 ▼"}
          </button>
          {expandTranscript && <pre className={styles.transcript}>{caseRecord.transcript}</pre>}
        </div>
      )}

      {/* Note input (optional) */}
      {noteVisible && (
        <div className={styles.noteRow}>
          <input
            className={styles.input}
            placeholder="可选：填写判断依据（会存入 reviewNotes）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={actioning}
          />
        </div>
      )}

      {/* Action bar */}
      <div className={styles.pendingActions}>
        <button
          className={styles.confirmButton}
          type="button"
          disabled={actioning}
          onClick={() => onConfirm(note)}
          title="确认这是一个真实坏案例，加入回归集"
        >
          {actioning ? "提交中…" : "✓ 确认为坏案例"}
        </button>
        <button
          className={styles.rejectButton}
          type="button"
          disabled={actioning}
          onClick={() => onFalsePositive(note)}
          title="系统判断有误，这次对话其实正常，转为正例对照组"
        >
          ✗ 误判 / 转正例
        </button>
        <button
          className={styles.noteToggle}
          type="button"
          onClick={() => setNoteVisible((v) => !v)}
          title="添加判断备注"
        >
          {noteVisible ? "隐藏备注" : "添加备注"}
        </button>
        <button
          className={styles.skipButton}
          type="button"
          onClick={onSkip}
          title="本次跳过，下次刷新仍会出现"
        >
          ↷ 暂跳过
        </button>
      </div>
    </article>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function describeSignal(signal: Record<string, unknown>): string {
  const kind = String(signal.kind ?? signal.ruleKey ?? "");
  if (kind === "negative_keyword") return `负面关键词「${String(signal.keyword ?? "")}」(turn ${signal.turnIndex})`;
  if (kind === "metric")           return `客观指标 ${String(signal.metric ?? "")} = ${signal.value}`;
  if (kind === "implicit_signal")  return `隐式信号：${String(signal.signalId ?? "")}`;
  if (signal.ruleKey)              return `规则：${String(signal.ruleKey)}（${String(signal.severity ?? "")}）`;
  return JSON.stringify(signal);
}
