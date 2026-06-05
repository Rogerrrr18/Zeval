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
import { BENCHMARK_CAPABILITIES } from "@/benchmark/capabilities";
import { AppShell } from "@/components/shell";
import { useProject } from "@/components/shell/ProjectContext";
import type { DatasetCaseRecord, DatasetCaseReviewStatus, DatasetCaseSource } from "@/eval-datasets/storage/types";
import { DEFAULT_PROJECT, type Project } from "@/lib/projectStore";
import styles from "./datasetConsole.module.css";

// ── Constants ──────────────────────────────────────────────────────────────

const DATASET_SNAPSHOT_KEY = "zeval.datasets.snapshot.v2";

function datasetSnapshotKey(projectId: string): string {
  return `${DATASET_SNAPSHOT_KEY}:${projectId}`;
}

/** Chinese display labels for each admission source. */
const SOURCE_LABELS: Record<DatasetCaseSource, string> = {
  auto_tp:          "自动识别：坏案例",
  auto_fn:          "漏报识别：坏案例",
  auto_tn:          "抽样：金标正例",
  auto_uncertainty: "边界案例：待确认",
  auto_disagreement:"评估器分歧：待确认",
  manual_gold:      "人工确认：金标",
  manual_fp:        "人工复审：正例",
  synthesized:      "合成样本",
  imported:         "外部导入",
};

const REVIEW_STATUS_LABELS: Record<DatasetCaseReviewStatus, string> = {
  auto_captured: "自动捕获",
  human_reviewed: "人工已审",
  gold_candidate: "金标候选",
  gold: "正式金标",
  regression_active: "回归启用",
};

const CAPABILITY_NAME_ZH: Record<string, string> = Object.fromEntries(
  BENCHMARK_CAPABILITIES.map((item) => [item.capability, item.displayName]),
);

const METRIC_NAME_ZH: Record<string, string> = {
  task_success: "任务完成度",
  decision_accuracy: "筛选决策准确率",
  entity_f1: "关键信息覆盖率",
  output_schema_valid: "输出格式合规性",
  reason_alignment: "理由一致性",
  citation_accuracy: "证据准确性",
  tool_call_success: "工具调用成功率",
  runtime_within_budget: "运行效率达标率",
  policy_safe: "安全与合规性",
  business_acceptance: "业务可接受度",
};

const SEVERITY_LABELS: Record<string, string> = {
  critical: "严重",
  high: "高",
  medium: "中",
  low: "低",
  info: "提示",
};

const SOURCE_COLOR: Record<DatasetCaseSource, string> = {
  auto_tp:          "#ef4444",
  auto_fn:          "#f97316",
  auto_tn:          "#22c55e",
  auto_uncertainty: "#eab308",
  auto_disagreement:"#a855f7",
  manual_gold:      "#10b981",
  manual_fp:        "#3b82f6",
  synthesized:      "#6b7280",
  imported:         "#6b7280",
};

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

type Tab = "pending" | "pool" | "gold";

// ── Response shapes ────────────────────────────────────────────────────────

type CaseListResponse = { cases: DatasetCaseRecord[]; count: number };

type DatasetSnapshot = {
  poolCases: DatasetCaseRecord[];
  pendingCases: DatasetCaseRecord[];
  selectedCapabilityDimension: string;
  notice: string;
};

type ProjectDatasetStats = {
  poolCount: number;
  goldCount: number;
  pendingCount: number;
};

// ── Root component ─────────────────────────────────────────────────────────

/**
 * Render the dataset browsing + calibration console.
 */
export function DatasetConsole() {
  const { projects, activeProject, activeProjectId, switchProject, createProject, deleteProject } = useProject();
  const snapshotHydratedRef = useRef(false);
  const [poolCases, setPoolCases]             = useState<DatasetCaseRecord[]>([]);
  const [pendingCases, setPendingCases]       = useState<DatasetCaseRecord[]>([]);
  const [loading, setLoading]                 = useState(false);
  const [actionCaseId, setActionCaseId]       = useState("");
  const [error, setError]                     = useState("");
  const [notice, setNotice]                   = useState("");
  const [projectStats, setProjectStats]       = useState<Record<string, ProjectDatasetStats>>({});
  const [projectStatsLoading, setProjectStatsLoading] = useState(false);
  const [selectedCapabilityDimension, setSelectedCapabilityDimension] = useState("");
  const [activeTab, setActiveTab]             = useState<Tab>("gold");
  const [selectedCaseId, setSelectedCaseId]   = useState("");
  // Locally dismissed pending cases (session-only, not persisted).
  const [dismissedIds, setDismissedIds]       = useState<Set<string>>(new Set());
  const projectHeaders = useMemo(
    () => ({ "x-zeval-project-id": activeProjectId }),
    [activeProjectId],
  );

  // ── Snapshot hydration ──────────────────────────────────────────────────
  useEffect(() => {
    snapshotHydratedRef.current = false;
    setPoolCases([]);
    setPendingCases([]);
    setSelectedCapabilityDimension("");
    setSelectedCaseId("");
    setNotice("");
    setDismissedIds(new Set());

    const raw = window.localStorage.getItem(datasetSnapshotKey(activeProjectId));
    if (!raw) { snapshotHydratedRef.current = true; return; }
    try {
      const snap = JSON.parse(raw) as DatasetSnapshot;
      setPoolCases(snap.poolCases ?? []);
      setPendingCases(snap.pendingCases ?? []);
      setSelectedCapabilityDimension(snap.selectedCapabilityDimension ?? "");
      setNotice(snap.notice ?? "");
    } catch {
      window.localStorage.removeItem(datasetSnapshotKey(activeProjectId));
    } finally {
      snapshotHydratedRef.current = true;
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (!snapshotHydratedRef.current) return;
    const snap: DatasetSnapshot = {
      poolCases,
      pendingCases,
      selectedCapabilityDimension,
      notice,
    };
    window.localStorage.setItem(datasetSnapshotKey(activeProjectId), JSON.stringify(snap));
  }, [activeProjectId, poolCases, pendingCases, selectedCapabilityDimension, notice]);

  // ── Data loading ────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [poolRes, fnRes, ucRes] = await Promise.all([
        // Pool: ALL cases (badcase + goodcase).
        // Omitting caseSetType so that auto_tn golden positives (goodcase) are
        // included — previously only badcases were fetched, making the TN channel
        // invisible in the UI even when harvest succeeded.
        fetch("/api/eval-datasets/cases", { headers: projectHeaders }),
        // Pending: FN channel, still in auto_captured / pending
        fetch("/api/eval-datasets/cases?source=auto_fn", { headers: projectHeaders }),
        // Pending: uncertainty channel
        fetch("/api/eval-datasets/cases?source=auto_uncertainty", { headers: projectHeaders }),
      ]);

      const poolData    = (await poolRes.json())        as Partial<CaseListResponse> & { error?: string; detail?: string };
      const fnData      = (await fnRes.json())          as Partial<CaseListResponse> & { error?: string; detail?: string };
      const ucData      = (await ucRes.json())          as Partial<CaseListResponse> & { error?: string; detail?: string };

      if (!poolRes.ok)    throw new Error(poolData.detail    ?? poolData.error    ?? "加载案例池失败");

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

      const goodcasePoolCount = poolFiltered.filter((c) => c.caseSetType === "goodcase").length;
      const badcasePoolCount  = poolFiltered.filter((c) => c.caseSetType === "badcase").length;
      setNotice(
        `${activeProject.name}：已入池 ${poolFiltered.length} 条（坏案例 ${badcasePoolCount}，金标正例 ${goodcasePoolCount}），待确认 ${pendingMap.size} 条。`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载数据失败");
    } finally {
      setLoading(false);
    }
  }, [activeProject.name, projectHeaders]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    let cancelled = false;
    async function loadProjectStats() {
      setProjectStatsLoading(true);
      try {
        const entries = await Promise.all(
          projects.map(async (project) => {
            const headers = { "x-zeval-project-id": project.id };
            const [poolRes, fnRes, ucRes] = await Promise.all([
              fetch("/api/eval-datasets/cases", { headers }),
              fetch("/api/eval-datasets/cases?source=auto_fn", { headers }),
              fetch("/api/eval-datasets/cases?source=auto_uncertainty", { headers }),
            ]);
            const poolData = (await poolRes.json()) as Partial<CaseListResponse>;
            const fnData = (await fnRes.json()) as Partial<CaseListResponse>;
            const ucData = (await ucRes.json()) as Partial<CaseListResponse>;
            const allCases = poolData.cases ?? [];
            const poolActive = allCases.filter((c) =>
              POOL_ACTIVE_STATUSES.includes(c.reviewStatus ?? "auto_captured"),
            );
            const pendingMap = new Map<string, DatasetCaseRecord>();
            [...(fnData.cases ?? []), ...(ucData.cases ?? [])].forEach((c) => {
              if (c.reviewStatus === "auto_captured") pendingMap.set(c.caseId, c);
            });
            allCases.forEach((c) => {
              if (
                c.reviewStatus === "auto_captured" &&
                (c.metadata as Record<string, unknown> | undefined)?.humanReviewRequired === true &&
                !pendingMap.has(c.caseId)
              ) {
                pendingMap.set(c.caseId, c);
              }
            });
            return [
              project.id,
              {
                poolCount: poolActive.length,
                goldCount: poolActive.filter((c) => isGoldCandidateCase(c)).length,
                pendingCount: pendingMap.size,
              },
            ] as const;
          }),
        );
        if (!cancelled) setProjectStats(Object.fromEntries(entries));
      } catch {
        if (!cancelled) setProjectStats({});
      } finally {
        if (!cancelled) setProjectStatsLoading(false);
      }
    }
    void loadProjectStats();
    return () => {
      cancelled = true;
    };
  }, [projects]);

  // ── Derived data ────────────────────────────────────────────────────────
  const capabilityOptions = useMemo(
    () => {
      const options = new Set<string>(BENCHMARK_CAPABILITIES.map((item) => item.capability));
      [...poolCases, ...pendingCases].forEach((c) => {
        if (c.capabilityDimension) options.add(c.capabilityDimension);
      });
      return [...options].sort((a, b) => capabilityDisplayName(a).localeCompare(capabilityDisplayName(b), "zh-Hans-CN"));
    },
    [pendingCases, poolCases],
  );

  const capabilityCounts = useMemo(() => {
    const counts = new Map<string, number>();
    [...poolCases, ...pendingCases].forEach((c) => {
      if (!c.capabilityDimension) return;
      counts.set(c.capabilityDimension, (counts.get(c.capabilityDimension) ?? 0) + 1);
    });
    return counts;
  }, [pendingCases, poolCases]);

  const coveredCapabilityCount = useMemo(
    () => [...capabilityCounts.values()].filter((count) => count > 0).length,
    [capabilityCounts],
  );

  const visiblePending = useMemo(
    () => pendingCases.filter((c) => !dismissedIds.has(c.caseId)),
    [pendingCases, dismissedIds],
  );

  const goldCases = useMemo(
    () => poolCases.filter((c) => isGoldCandidateCase(c)),
    [poolCases],
  );

  useEffect(() => {
    setProjectStats((prev) => ({
      ...prev,
      [activeProjectId]: {
        poolCount: poolCases.length,
        goldCount: goldCases.length,
        pendingCount: pendingCases.length,
      },
    }));
  }, [activeProjectId, goldCases.length, pendingCases.length, poolCases.length]);

  const activeQueueCases = useMemo(() => {
    const sourceCases = activeTab === "pending"
      ? visiblePending
      : activeTab === "gold"
      ? goldCases
      : poolCases;
    return sourceCases.filter((c) => {
      if (selectedCapabilityDimension && c.capabilityDimension !== selectedCapabilityDimension) return false;
      return true;
    });
  }, [activeTab, goldCases, poolCases, selectedCapabilityDimension, visiblePending]);

  const selectedCase = useMemo(
    () => activeQueueCases.find((c) => c.caseId === selectedCaseId) ?? activeQueueCases[0] ?? null,
    [activeQueueCases, selectedCaseId],
  );

  useEffect(() => {
    if (!selectedCase) {
      setSelectedCaseId("");
      return;
    }
    if (selectedCase.caseId !== selectedCaseId) {
      setSelectedCaseId(selectedCase.caseId);
    }
  }, [selectedCase, selectedCaseId]);

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
          headers: {
            "Content-Type": "application/json",
            ...projectHeaders,
          },
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
    [projectHeaders],
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
              <p>按项目隔离案例池、金标候选、人工待处理队列和后续回归样本。</p>
            </div>
          </header>

          {error  ? <p className={styles.error}>{error}</p>   : null}
          {notice ? <p className={styles.notice}>{notice}</p> : null}

          <ProjectBoard
            activeProjectId={activeProjectId}
            creatingDisabled={loading}
            deletingDisabled={loading}
            projectStats={projectStats}
            projectStatsLoading={projectStatsLoading}
            projects={projects}
            onCreateProject={(name, description) => {
              const project = createProject(name, description);
              switchProject(project.id);
            }}
            onDeleteProject={deleteProject}
            onSwitchProject={switchProject}
          />

          <section className={styles.datasetWorkspace}>
            <aside className={styles.queuePane}>
              <div className={styles.queueTabs}>
                <QueueTabButton
                  active={activeTab === "pending"}
                  count={visiblePending.length}
                  label="待处理"
                  onClick={() => setActiveTab("pending")}
                />
                <QueueTabButton
                  active={activeTab === "gold"}
                  count={goldCases.length}
                  label="金标候选"
                  onClick={() => setActiveTab("gold")}
                />
                <QueueTabButton
                  active={activeTab === "pool"}
                  count={poolCases.length}
                  label="全部案例"
                  onClick={() => setActiveTab("pool")}
                />
              </div>

              {capabilityOptions.length > 0 && (
                <label className={styles.filterControl}>
                  <span>能力维度</span>
                  <select
                    className={styles.select}
                    value={selectedCapabilityDimension}
                    onChange={(e) => setSelectedCapabilityDimension(e.target.value)}
                  >
                    <option value="">全部能力维度</option>
                    {capabilityOptions.map((dim) => (
                      <option key={dim} value={dim}>
                        {capabilityDisplayName(dim)}（{capabilityCounts.get(dim) ?? 0}）
                      </option>
                    ))}
                  </select>
                  <small className={styles.filterHint}>
                    当前项目已沉淀 {coveredCapabilityCount} 个维度；括号为该维度案例数。
                  </small>
                </label>
              )}

              <div className={styles.queueMeta}>
                {loading ? "加载中" : `${activeQueueCases.length} 条`}
              </div>

              {activeQueueCases.length === 0 ? (
                <div className={styles.empty}>当前队列没有案例。</div>
              ) : (
                <div className={styles.caseRail}>
                  {activeQueueCases.map((caseRecord) => (
                    <CaseRailButton
                      key={caseRecord.caseId}
                      active={selectedCase?.caseId === caseRecord.caseId}
                      caseRecord={caseRecord}
                      onClick={() => setSelectedCaseId(caseRecord.caseId)}
                    />
                  ))}
                </div>
              )}
            </aside>

            <section className={styles.detailPane}>
              {selectedCase ? (
                activeTab === "pending" ? (
                  <PendingCaseCard
                    caseRecord={selectedCase}
                    actioning={actionCaseId === selectedCase.caseId}
                    onConfirm={(note) => submitVerdict(selectedCase.caseId, "valid_bad_case", note)}
                    onFalsePositive={(note) => submitVerdict(selectedCase.caseId, "false_positive", note)}
                    onSkip={() => skipPending(selectedCase.caseId)}
                  />
                ) : (
                  <PoolCaseCard
                    caseRecord={selectedCase}
                    markingFalsePositive={actionCaseId === selectedCase.caseId}
                    onMarkFalsePositive={markFalsePositive}
                  />
                )
              ) : (
                <div className={styles.empty}>选择一个案例查看详情。</div>
              )}
            </section>
          </section>
        </main>
      </div>
    </AppShell>
  );
}

function ProjectBoard(props: {
  activeProjectId: string;
  creatingDisabled: boolean;
  deletingDisabled: boolean;
  projectStats: Record<string, ProjectDatasetStats>;
  projectStatsLoading: boolean;
  projects: Project[];
  onCreateProject: (name: string, description?: string) => void;
  onDeleteProject: (id: string) => void;
  onSwitchProject: (id: string) => void;
}) {
  const {
    activeProjectId,
    creatingDisabled,
    deletingDisabled,
    projectStats,
    projectStatsLoading,
    projects,
    onCreateProject,
    onDeleteProject,
    onSwitchProject,
  } = props;
  const [creating, setCreating] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState("");

  function submitProject() {
    const name = projectName.trim();
    if (!name) return;
    onCreateProject(name, projectDescription.trim() || undefined);
    setProjectName("");
    setProjectDescription("");
    setCreating(false);
    setConfirmDeleteId("");
  }

  return (
    <section className={styles.projectBoard}>
      <div className={styles.projectBoardHeader}>
        <div>
          <h2>项目管理</h2>
          <p>每个项目拥有独立数据池；切换项目后，下方案例队列会同步切换。</p>
        </div>
        <button
          className={styles.secondaryButton}
          type="button"
          disabled={creatingDisabled}
          onClick={() => {
            setCreating((value) => !value);
            setConfirmDeleteId("");
          }}
        >
          {creating ? "收起新建" : "新建项目"}
        </button>
      </div>

      {creating ? (
        <div className={styles.projectCreateInline}>
          <input
            className={styles.input}
            placeholder="项目名称，例如：HR 简历筛选 Agent"
            value={projectName}
            maxLength={48}
            onChange={(event) => setProjectName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitProject();
              if (event.key === "Escape") {
                setCreating(false);
                setProjectName("");
                setProjectDescription("");
              }
            }}
          />
          <input
            className={styles.input}
            placeholder="项目描述（可选）"
            value={projectDescription}
            maxLength={120}
            onChange={(event) => setProjectDescription(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submitProject();
              if (event.key === "Escape") {
                setCreating(false);
                setProjectName("");
                setProjectDescription("");
              }
            }}
          />
          <button
            className={styles.primaryButton}
            type="button"
            disabled={!projectName.trim()}
            onClick={submitProject}
          >
            创建并切换
          </button>
        </div>
      ) : null}

      <div className={styles.projectList}>
        {projects.map((project) => {
          const active = project.id === activeProjectId;
          const stats = projectStats[project.id];
          const confirming = confirmDeleteId === project.id;
          return (
            <article className={active ? styles.projectCardActive : styles.projectCard} key={project.id}>
              <button
                className={styles.projectMainButton}
                type="button"
                onClick={() => {
                  onSwitchProject(project.id);
                  setConfirmDeleteId("");
                }}
              >
                <span className={styles.projectNameRow}>
                  <strong>{project.name}</strong>
                  {active ? <span>当前项目</span> : null}
                </span>
                <small>{project.description || "暂无描述"}</small>
                <span className={styles.projectStatsRow}>
                  {projectStatsLoading && !stats ? (
                    <b>统计中</b>
                  ) : (
                    <>
                      <b>已入池 {stats?.poolCount ?? 0}</b>
                      <b>金标 {stats?.goldCount ?? 0}</b>
                      <b>待处理 {stats?.pendingCount ?? 0}</b>
                    </>
                  )}
                </span>
              </button>

              {project.id !== DEFAULT_PROJECT.id ? (
                <button
                  className={confirming ? styles.projectDeleteConfirm : styles.projectDeleteButton}
                  type="button"
                  disabled={deletingDisabled}
                  onClick={() => {
                    if (confirming) {
                      onDeleteProject(project.id);
                      setConfirmDeleteId("");
                      return;
                    }
                    setConfirmDeleteId(project.id);
                  }}
                >
                  {confirming ? "确认删除" : "删除"}
                </button>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

function QueueTabButton(props: {
  active: boolean;
  count: number;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={props.active ? styles.queueTabActive : styles.queueTab}
      type="button"
      onClick={props.onClick}
    >
      <span>{props.label}</span>
      <strong>{props.count}</strong>
    </button>
  );
}

function CaseRailButton(props: {
  active: boolean;
  caseRecord: DatasetCaseRecord;
  onClick: () => void;
}) {
  const { active, caseRecord, onClick } = props;
  const source = caseRecord.source as DatasetCaseSource | undefined;
  return (
    <button
      className={active ? styles.caseRailItemActive : styles.caseRailItem}
      type="button"
      onClick={onClick}
    >
      <span className={styles.caseRailTitle}>{caseTitle(caseRecord)}</span>
      <span className={styles.caseRailMeta}>
        {capabilityDisplayName(caseRecord.capabilityDimension)} · {reviewStatusLabel(caseRecord.reviewStatus)}
      </span>
      <span className={styles.caseRailFooter}>
        {sourceLabel(source, caseRecord.caseSetType)}
      </span>
    </button>
  );
}

function isGoldCandidateCase(caseRecord: DatasetCaseRecord): boolean {
  return (
    caseRecord.reviewStatus === "gold_candidate" ||
    caseRecord.reviewStatus === "gold" ||
    caseRecord.source === "manual_gold" ||
    caseRecord.source === "auto_tn"
  );
}

// ── Pool: PoolCaseCard ─────────────────────────────────────────────────────

function PoolCaseCard(props: {
  caseRecord: DatasetCaseRecord;
  markingFalsePositive: boolean;
  onMarkFalsePositive: (caseId: string, note?: string) => Promise<void>;
}) {
  const { caseRecord, markingFalsePositive, onMarkFalsePositive } = props;
  const [expanded, setExpanded] = useState(false);
  const [showNote, setShowNote] = useState(false);
  const [note, setNote] = useState("");
  const source = caseRecord.source as DatasetCaseSource | undefined;
  const metadata = (caseRecord.metadata ?? {}) as Record<string, unknown>;
  const runId = typeof caseRecord.sourceRunId === "string"
    ? caseRecord.sourceRunId
    : typeof metadata.runId === "string"
    ? metadata.runId
    : "";
  const benchmarkCaseId = typeof metadata.benchmarkCaseId === "string" ? metadata.benchmarkCaseId : "";
  const overrides = caseRecord.manualOverrides ?? [];
  const alreadyMarked = overrides.some((o) => o.type === "false_positive");

  return (
    <article className={styles.caseCard}>
      <div className={styles.caseHeader}>
        <div>
          <h3>{caseTitle(caseRecord)}</h3>
          <p>{caseRecord.caseId} · 会话：{caseRecord.sessionId}</p>
        </div>
        <div className={styles.badgeGroup}>
          {source && (
            <span
              className={styles.sourceBadge}
              style={{ backgroundColor: SOURCE_COLOR[source] ?? "#6b7280" }}
            >
              {sourceLabel(source, caseRecord.caseSetType)}
            </span>
          )}
          <span className={styles.statusPill}>{reviewStatusLabel(caseRecord.reviewStatus)}</span>
        </div>
      </div>

      <div className={styles.caseMetaGrid}>
        <span>类型：{caseSetTypeLabel(caseRecord.caseSetType)}</span>
        <span>能力：{capabilityDisplayName(caseRecord.capabilityDimension)}</span>
        <span>指标：{metricDisplayName(caseRecord.topicLabel)}</span>
        {runId ? <span>评测运行：{runId}</span> : null}
        {benchmarkCaseId ? <span>评测案例：{benchmarkCaseId}</span> : null}
      </div>

      {caseRecord.topicSummary ? <p className={styles.actionText}>{caseRecord.topicSummary}</p> : null}

      <div className={styles.metaRow}>
        {caseRecord.tags.slice(0, 10).map((tag) => (
          <span className={styles.tagPill} key={`${caseRecord.caseId}_${tag}`}>{tag}</span>
        ))}
        {caseRecord.tags.length > 10 ? <span className={styles.tagPill}>+{caseRecord.tags.length - 10}</span> : null}
      </div>

      {caseRecord.transcript && (
        <div className={styles.transcriptBlock}>
          <button
            type="button"
            className={styles.transcriptToggle}
            onClick={() => setExpanded((value) => !value)}
          >
            {expanded ? "收起详情 ▲" : "展开期望 / 实际 / 证据 ▼"}
          </button>
          {expanded && <pre className={styles.transcript}>{caseRecord.transcript}</pre>}
        </div>
      )}

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
              onClick={async () => {
                await onMarkFalsePositive(caseRecord.caseId, note);
                setShowNote(false);
                setNote("");
              }}
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
            <span className={styles.statusPill}>{reviewStatusLabel(caseRecord.reviewStatus)}</span>
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
          <h3>{caseTitle(caseRecord)}</h3>
          <p className={styles.channelDesc}>{channelDesc}</p>
          <p>
            {caseRecord.caseId} · 会话：{caseRecord.sessionId}
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
                <code>{r.ruleKey ?? "未知规则"}</code>
                {r.severity && <span className={styles.severityTag}> · {severityLabel(r.severity)}</span>}
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

function hasChineseText(value?: string): boolean {
  return Boolean(value && /[\u4e00-\u9fff]/.test(value));
}

function capabilityDisplayName(capability?: string): string {
  if (!capability) return "未分维度";
  if (hasChineseText(capability)) return capability;
  return CAPABILITY_NAME_ZH[capability] ?? humanizeKeyZh(capability);
}

function metricDisplayName(metric?: string): string {
  if (!metric) return "未标注指标";
  if (hasChineseText(metric)) return metric;
  return METRIC_NAME_ZH[metric] ?? humanizeKeyZh(metric);
}

function reviewStatusLabel(status?: DatasetCaseReviewStatus): string {
  return REVIEW_STATUS_LABELS[status ?? "auto_captured"] ?? "未知状态";
}

function sourceLabel(source?: DatasetCaseSource, caseSetType?: DatasetCaseRecord["caseSetType"]): string {
  if (source) return SOURCE_LABELS[source] ?? "未知来源";
  return caseSetTypeLabel(caseSetType);
}

function caseSetTypeLabel(caseSetType?: DatasetCaseRecord["caseSetType"]): string {
  if (caseSetType === "goodcase") return "正例 / 金标候选";
  if (caseSetType === "badcase") return "坏例 / 回归案例";
  return "未分类案例";
}

function caseTitle(caseRecord: DatasetCaseRecord): string {
  const capability = capabilityDisplayName(caseRecord.capabilityDimension);
  const metric = metricDisplayName(caseRecord.topicLabel);
  if (caseRecord.capabilityDimension || caseRecord.topicLabel) return `${capability} / ${metric}`;
  if (caseRecord.title && hasChineseText(caseRecord.title)) return caseRecord.title;
  return caseRecord.caseId;
}

function severityLabel(severity: string): string {
  return SEVERITY_LABELS[severity.toLowerCase()] ?? severity;
}

function humanizeKeyZh(value: string): string {
  return value
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((part) => {
      const known = CAPABILITY_NAME_ZH[part] ?? METRIC_NAME_ZH[part] ?? SEVERITY_LABELS[part.toLowerCase()];
      return known ?? part;
    })
    .join(" / ");
}
