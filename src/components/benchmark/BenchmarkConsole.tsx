/**
 * @fileoverview Benchmark Mode console with real-time progress, submission details,
 * case comparison, human labeling, and retry capabilities.
 */

"use client";

import { useCallback, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import type {
  BenchmarkAgentSubmission,
  BenchmarkCapabilityScore,
  BenchmarkCase,
  BenchmarkLeaderboardRow,
  BenchmarkMetricEvaluationResult,
  BenchmarkRubricMetric,
  BenchmarkRubricModule,
  BenchmarkRubricSet,
  BenchmarkRunResult,
} from "@/benchmark/types";
import type { BenchmarkProgressSnapshot, MatrixProgressRow, SubmissionProgressItem } from "@/benchmark/progress";
import { cloneRubric, updateRubricMetric, toggleMetricApproval } from "@/benchmark/rubric";
import { RubricMetricEditor } from "./RubricMetricEditor";
import { RubricReviewCopilot } from "./RubricReviewCopilot";
import { RubricGraphView } from "./RubricGraphView";
import { KnowledgePanel } from "./KnowledgePanel";
import { AgentActivityPanel } from "./AgentActivityPanel";
import { FloatingCopilot } from "./FloatingCopilot";
import styles from "./benchmarkConsole.module.css";

type RubricDraftResponse = {
  rubric?: BenchmarkRubricSet;
  reviewMarkdown?: string;
  source?: "llm" | "template";
  warnings?: string[];
  error?: string;
};

type StartRunResponse = {
  runId?: string;
  error?: string;
};

const DEFAULT_REQUIREMENT = [
  "我们要评测 HR 简历筛选 Agent。",
  "输入是一段岗位 JD 和候选人简历。",
  "Agent 需要输出 select/reject、理由和证据。",
  "评测要关注筛选准确率、理由是否有证据、是否使用了受保护属性或隐私不当信息。",
].join("\n");

const AVAILABLE_MODELS = [
  "deepseek-v4-flash",
  "gpt-5.4",
  "kimi-k2.5",
] as const;

const DEFAULT_MATRIX = [
  "claude_code",
  "codex",
  "hermes",
  "openclaw",
].flatMap((framework) =>
  AVAILABLE_MODELS.map((model) => ({
    agentFramework: framework,
    model,
    enabled: true,
  }))
);

type ViewMode =
  | "rubric"
  | "progress"
  | "leaderboard"
  | "submissions"
  | "cases"
  | "labeling"
  | "knowledge"
  | "activity";

/**
 * Render Benchmark Mode.
 */
export function BenchmarkConsole() {
  const [title, setTitle] = useState("HR 简历筛选");
  const [description, setDescription] = useState("给真实业务任务生成能力维度评分标准（Rubric），并比较不同 Agent 框架与模型组合。");
  const [requirementText, setRequirementText] = useState(DEFAULT_REQUIREMENT);
  const [useLlm, setUseLlm] = useState(false);

  // Rubric state — draft is immutable; rubric is the editable working copy
  const [rubricDraft, setRubricDraft] = useState<BenchmarkRubricSet | null>(null);
  const [rubric, setRubric] = useState<BenchmarkRubricSet | null>(null);
  const [reviewedMetricKeys, setReviewedMetricKeys] = useState<Set<string>>(new Set());
  const [modifiedMetricKeys, setModifiedMetricKeys] = useState<Set<string>>(new Set());
  const [showCopilotReview, setShowCopilotReview] = useState(false);
  const [highlightedMetricKey, setHighlightedMetricKey] = useState<string | null>(null);
  const [rubricDisplayMode, setRubricDisplayMode] = useState<"list" | "graph">("graph");

  const [drafting, setDrafting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [runResult, setRunResult] = useState<BenchmarkRunResult | null>(null);
  const [progress, setProgress] = useState<BenchmarkProgressSnapshot | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("rubric");

  // Submission detail drawer state
  const [selectedSubmission, setSelectedSubmission] = useState<BenchmarkAgentSubmission | null>(null);
  const [selectedCase, setSelectedCase] = useState<BenchmarkCase | null>(null);
  const [selectedMetricResults, setSelectedMetricResults] = useState<BenchmarkMetricEvaluationResult[]>([]);

  // Case comparison state
  const [compareCaseId, setCompareCaseId] = useState<string | null>(null);

  // Labeling state
  const [labelingResults, setLabelingResults] = useState<BenchmarkMetricEvaluationResult[]>([]);

  const metrics = useMemo(() => rubric?.modules.flatMap((module) => module.metrics) ?? [], [rubric]);
  const selectedMetricKeys = useMemo(
    () => metrics.filter((metric) => metric.approvalStatus === "approved").map((metric) => metric.metricKey),
    [metrics],
  );
  const selectedMetrics = useMemo(
    () => metrics.filter((metric) => metric.approvalStatus === "approved"),
    [metrics],
  );

  const totalProgress = useMemo(() => {
    if (!progress) return 0;
    if (progress.totalSubmissions === 0) return 0;
    if (progress.phase === "evaluating") {
      return Math.round((progress.evaluatedMetrics / Math.max(1, progress.totalMetrics)) * 100);
    }
    return Math.round(((progress.completedSubmissions + progress.failedSubmissions) / progress.totalSubmissions) * 100);
  }, [progress]);

  async function draftRubric() {
    setDrafting(true);
    setError("");
    setNotice("");
    setWarnings([]);
    setRunResult(null);
    try {
      const response = await fetch("/api/benchmarks/rubric", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          description,
          domain: "hr",
          requirementText,
          useLlm,
        }),
      });
      const data = (await response.json()) as RubricDraftResponse;
      if (!response.ok || !data.rubric) {
        throw new Error(data.error ?? "Rubric 生成失败");
      }
      const draft = cloneRubric(data.rubric);
      setRubricDraft(draft);
      setRubric(draft);
      setReviewedMetricKeys(new Set());
      setModifiedMetricKeys(new Set());
      setWarnings(data.warnings ?? []);
      setNotice(`评分标准已就绪 · 来源=${data.source === "llm" ? "AI生成" : "模板"}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Rubric 生成失败");
    } finally {
      setDrafting(false);
    }
  }

  async function runHrDemo() {
    if (selectedMetricKeys.length === 0) {
      setError("至少确认一个指标后才能运行评测。");
      return;
    }
    setRunning(true);
    setError("");
    setNotice("");
    setRunResult(null);
    setProgress(null);
    setViewMode("progress");

    try {
      const response = await fetch("/api/benchmarks/hr-demo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          approvedMetricKeys: selectedMetricKeys,
          matrix: DEFAULT_MATRIX,
          persistCases: false,
        }),
      });
      const data = (await response.json()) as StartRunResponse;
      if (!response.ok || !data.runId) {
        throw new Error(data.error ?? "启动评测失败");
      }

      // Open SSE stream
      const source = new EventSource(`/api/benchmarks/hr-demo-stream?runId=${data.runId}`);
      source.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as BenchmarkProgressSnapshot;
        setProgress(snapshot);
        if (snapshot.phase === "completed" && snapshot.result) {
          setRunResult(snapshot.result);
          setRunning(false);
          setNotice(`评测完成 · ${snapshot.result.summary.submissionCount} 次提交 · ${snapshot.result.summary.metricResultCount} 项指标评分`);
          setLabelingResults(snapshot.result.metricResults.filter((r) => r.needsHumanReview || r.status === "needs_human_review"));
          source.close();
        } else if (snapshot.phase === "failed") {
          setError(snapshot.error ?? "评测失败");
          setRunning(false);
          source.close();
        }
      };
      source.onerror = () => {
        source.close();
        setRunning(false);
      };
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "启动评测失败");
      setRunning(false);
    }
  }

  function toggleMetric(metricKey: string) {
    if (!rubric) return;
    const updated = toggleMetricApproval(rubric, metricKey);
    setRubric(updated);
  }

  function saveMetricEdit(metricKey: string, patch: Parameters<typeof updateRubricMetric>[2]) {
    if (!rubric) return;
    const updated = updateRubricMetric(rubric, metricKey, patch);
    setRubric(updated);
    setModifiedMetricKeys((prev) => new Set(prev).add(metricKey));
    setReviewedMetricKeys((prev) => new Set(prev).add(metricKey));
  }

  function resetRubric() {
    if (!rubricDraft) return;
    setRubric(cloneRubric(rubricDraft));
    setReviewedMetricKeys(new Set());
    setModifiedMetricKeys(new Set());
    setNotice("已重置为 draft");
  }

  function markAllReviewed() {
    if (!rubric) return;
    const keys = rubric.modules.flatMap((m) => m.metrics.map((metric) => metric.metricKey));
    setReviewedMetricKeys(new Set(keys));
    setNotice(`已标记 ${keys.length} 个指标为已校验`);
  }

  // Open submission detail
  const openSubmissionDetail = useCallback((framework: string, model: string) => {
    if (!runResult) return;
    const submission = runResult.submissions.find(
      (s) => s.agentFramework === framework && s.model === model,
    );
    if (!submission) return;
    const taskCase = runResult.cases.find((c) => c.caseId === submission.caseId);
    const metricResults = runResult.metricResults.filter(
      (m) => m.agentFramework === framework && m.model === model,
    );
    setSelectedSubmission(submission);
    setSelectedCase(taskCase ?? null);
    setSelectedMetricResults(metricResults);
    setViewMode("submissions");
  }, [runResult]);

  // Open case comparison
  const openCaseComparison = useCallback((caseId: string) => {
    setCompareCaseId(caseId);
    setViewMode("cases");
  }, []);

  // Retry a failed submission
  async function retrySubmission(framework: string, model: string, caseId: string) {
    setNotice(`重跑 ${framework}/${model} case=${caseId} ...`);
    // Placeholder: would call a dedicated retry API
    await new Promise((r) => setTimeout(r, 1000));
    setNotice(`重跑完成（模拟）`);
  }

  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.header}>
          <div>
            <span className={styles.eyebrow}>评测模式</span>
            <h1>真实业务任务评测</h1>
            <p>按能力维度组织评分标准，横向比较 Agent 框架与模型组合，并沉淀 badcase / goldencase。</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.secondaryButton} type="button" disabled={drafting} onClick={() => void draftRubric()}>
              {drafting ? "生成中..." : "生成评分标准"}
            </button>
            <button className={styles.primaryButton} type="button" disabled={running || !rubric} onClick={() => void runHrDemo()}>
              {running ? "评测中..." : "运行 HR 评测"}
            </button>
          </div>
        </section>

        {error ? <p className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}
        {warnings.length > 0 ? (
          <div className={styles.warningList}>
            {warnings.map((warning) => <span key={warning}>{warning}</span>)}
          </div>
        ) : null}

        {/* Progress Panel */}
        {(running || progress) && (
          <ProgressPanel
            progress={progress}
            totalProgress={totalProgress}
            onViewLeaderboard={() => runResult && setViewMode("leaderboard")}
            onViewLabeling={() => labelingResults.length > 0 && setViewMode("labeling")}
            hasResult={!!runResult}
            hasLabeling={labelingResults.length > 0}
          />
        )}

        {/* View Switcher */}
        <ViewSwitcher
          current={viewMode}
          onChange={setViewMode}
          hasLabeling={labelingResults.length > 0}
        />

        {viewMode === "rubric" && (
          <>
            <section className={styles.metricGrid}>
              <MetricCard label="指标数" value={String(selectedMetrics.length)} detail={`${metrics.length} 个候选指标`} />
              <MetricCard label="能力维度" value={String(rubric?.modules.length ?? 0)} detail="用户确认后进入评测" />
              <MetricCard label="矩阵规模" value="12" detail="4 框架 × 3 模型 = 12 种组合" />
              <MetricCard
                label="平均分"
                value={runResult ? `${runResult.summary.averageScore}` : "—"}
                detail={runResult ? `${runResult.summary.badcaseCandidateCount} 个 badcase 候选` : "等待运行"}
                tone={runResult && runResult.summary.averageScore < 75 ? "warn" : undefined}
              />
            </section>

            <section className={styles.layoutWide}>
              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>Copilot Intake</h2>
                    <p>任务需求会转成可审核的 capability-based rubric。</p>
                  </div>
                  <label className={styles.switchLine}>
                    <input type="checkbox" checked={useLlm} onChange={(event) => setUseLlm(event.target.checked)} />
                    <span>LLM draft</span>
                  </label>
                </div>
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span>Benchmark title</span>
                    <input value={title} onChange={(event) => setTitle(event.target.value)} />
                  </label>
                  <label className={styles.field}>
                    <span>Description</span>
                    <input value={description} onChange={(event) => setDescription(event.target.value)} />
                  </label>
                  <label className={`${styles.field} ${styles.fieldFull}`}>
                    <span>Requirement</span>
                    <textarea value={requirementText} onChange={(event) => setRequirementText(event.target.value)} />
                  </label>
                </div>
              </article>

              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>Rubric Builder</h2>
                    <p>每个指标必须被用户确认。未勾选指标不会进入评测。</p>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    {rubric && (
                      <div style={{ display: "flex", gap: 6 }}>
                        <button
                          className={styles.secondaryButton}
                          style={{ minHeight: 26, padding: "0 8px", fontSize: 11 }}
                          onClick={() => setShowCopilotReview(true)}
                        >
                          Copilot 校验
                        </button>
                        <button
                          className={styles.secondaryButton}
                          style={{ minHeight: 26, padding: "0 8px", fontSize: 11 }}
                          onClick={resetRubric}
                        >
                          重置为 Draft
                        </button>
                        <button
                          className={styles.secondaryButton}
                          style={{ minHeight: 26, padding: "0 8px", fontSize: 11 }}
                          onClick={markAllReviewed}
                        >
                          全部校验通过
                        </button>
                        <div className={styles.viewToggle}>
                          <button
                            className={rubricDisplayMode === "graph" ? styles.viewToggleActive : styles.viewToggleBtn}
                            style={{ minHeight: 26, padding: "0 8px", fontSize: 11 }}
                            onClick={() => setRubricDisplayMode("graph")}
                            title="图视图"
                          >
                            图
                          </button>
                          <button
                            className={rubricDisplayMode === "list" ? styles.viewToggleActive : styles.viewToggleBtn}
                            style={{ minHeight: 26, padding: "0 8px", fontSize: 11 }}
                            onClick={() => setRubricDisplayMode("list")}
                            title="列表视图"
                          >
                            列表
                          </button>
                        </div>
                      </div>
                    )}
                    <span className={styles.counter}>{selectedMetrics.length}/{metrics.length}</span>
                  </div>
                </div>
                {rubric ? (
                  rubricDisplayMode === "graph" ? (
                    <RubricGraphView
                      rubric={rubric}
                      reviewedMetricKeys={reviewedMetricKeys}
                      modifiedMetricKeys={modifiedMetricKeys}
                      highlightedMetricKey={highlightedMetricKey}
                      selectedMetricKeys={selectedMetricKeys}
                      onToggleMetric={toggleMetric}
                      onSelectMetric={(key) => {
                        setHighlightedMetricKey(key);
                        // Optionally expand metric editor for this metric
                        setRubricDisplayMode("list");
                      }}
                    />
                  ) : (
                    <div className={styles.rubricStack}>
                      {rubric.modules.map((module) => (
                        <RubricModuleView
                          key={module.capability}
                          module={module}
                          draftModule={rubricDraft?.modules.find((m) => m.capability === module.capability)}
                          selectedMetricKeys={selectedMetricKeys}
                          reviewedMetricKeys={reviewedMetricKeys}
                          modifiedMetricKeys={modifiedMetricKeys}
                          highlightedMetricKey={highlightedMetricKey}
                          onToggle={toggleMetric}
                          onSaveEdit={saveMetricEdit}
                        />
                      ))}
                    </div>
                  )
                ) : (
                  <div className={styles.empty}>先生成 rubric draft。</div>
                )}
              </article>
            </section>

            {showCopilotReview && rubric && (
              <section className={styles.layoutWide}>
                <RubricReviewCopilot
                  rubric={rubric}
                  requirementText={requirementText}
                  onHighlightMetric={setHighlightedMetricKey}
                  onClose={() => setShowCopilotReview(false)}
                />
              </section>
            )}
          </>
        )}

        {viewMode === "leaderboard" && runResult && (
          <section className={styles.layout}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Leaderboard</h2>
                  <p>点击任意行可查看该 Agent × Model 的所有提交详情。</p>
                </div>
              </div>
              <LeaderboardTable
                rows={runResult.leaderboard}
                onRowClick={(row) => openSubmissionDetail(row.agentFramework, row.model)}
              />
            </article>

            <aside className={styles.sideStack}>
              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>能力维度得分</h2>
                    <p>按第一名 Agent × Model 展示能力分。</p>
                  </div>
                </div>
                {runResult.leaderboard[0] ? (
                  <CapabilityBars scores={runResult.leaderboard[0].capabilityScores} />
                ) : (
                  <div className={styles.empty}>暂无能力分。</div>
                )}
              </article>

              <article className={styles.panel}>
                <div className={styles.panelHeader}>
                  <div>
                    <h2>Run Summary</h2>
                    <p>case 与人工审核压力。</p>
                  </div>
                </div>
                <div className={styles.summaryList}>
                  <span><strong>{runResult.summary.caseCount}</strong> cases</span>
                  <span><strong>{runResult.summary.submissionCount}</strong> submissions</span>
                  <span><strong>{runResult.summary.needsHumanReviewCount}</strong> human-review metrics</span>
                  <span><strong>{runResult.summary.goldencaseCandidateCount}</strong> goldencase candidates</span>
                </div>
              </article>
            </aside>
          </section>
        )}

        {viewMode === "submissions" && runResult && selectedSubmission && (
          <SubmissionDetailPanel
            runResult={runResult}
            selectedSubmission={selectedSubmission}
            selectedCase={selectedCase}
            metricResults={selectedMetricResults}
            onBack={() => setViewMode("leaderboard")}
            onRetry={(fw, model, caseId) => void retrySubmission(fw, model, caseId)}
          />
        )}

        {viewMode === "cases" && runResult && (
          <CaseComparisonPanel
            runResult={runResult}
            compareCaseId={compareCaseId}
            onSelectCase={setCompareCaseId}
            onBack={() => setViewMode("leaderboard")}
          />
        )}

        {viewMode === "labeling" && runResult && (
          <HumanLabelingPanel
            results={labelingResults}
            cases={runResult.cases}
            submissions={runResult.submissions}
            onBack={() => setViewMode("leaderboard")}
          />
        )}

        {viewMode === "knowledge" && (
          <KnowledgePanel />
        )}

        {viewMode === "activity" && (
          <AgentActivityPanel
            calls={[]}
          />
        )}
      </div>

      <FloatingCopilot />
    </AppShell>
  );
}

/* ── Progress Panel ─────────────────────────────────────────────────── */

function ProgressPanel(props: {
  progress: BenchmarkProgressSnapshot | null;
  totalProgress: number;
  onViewLeaderboard: () => void;
  onViewLabeling: () => void;
  hasResult: boolean;
  hasLabeling: boolean;
}) {
  const { progress } = props;
  const phaseText = useMemo(() => {
    if (!progress) return "准备中...";
    switch (progress.phase) {
      case "preparing": return "准备中...";
      case "submitting": return `提交中 ${progress.completedSubmissions + progress.failedSubmissions}/${progress.totalSubmissions}`;
      case "evaluating": return `评测中 ${progress.evaluatedMetrics}/${progress.totalMetrics}`;
      case "completed": return "评测完成";
      case "failed": return "评测失败";
      default: return "运行中...";
    }
  }, [progress]);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <h2>评测进度</h2>
          <p>{phaseText}</p>
        </div>
        {props.hasResult && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className={styles.secondaryButton} onClick={props.onViewLeaderboard}>
              查看排行榜
            </button>
            {props.hasLabeling && (
              <button className={styles.secondaryButton} onClick={props.onViewLabeling}>
                人工标注
              </button>
            )}
          </div>
        )}
      </div>

      {/* Overall progress bar */}
      <div style={{ marginBottom: 16 }}>
        <div style={{
          height: 8,
          borderRadius: 4,
          background: "var(--bm-bg-3)",
          overflow: "hidden",
        }}>
          <div style={{
            width: `${props.totalProgress}%`,
            height: "100%",
            borderRadius: 4,
            background: "linear-gradient(90deg, #14b8a6, #7c3aed)",
            transition: "width 0.3s ease",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, color: "var(--bm-ink-3)" }}>
          <span>{props.totalProgress}%</span>
          <span>{progress ? `${progress.completedSubmissions + progress.failedSubmissions}/${progress.totalSubmissions} 次提交` : ""}</span>
        </div>
      </div>

      {/* Matrix progress rows */}
      {progress && progress.matrixProgress.length > 0 && (
        <div style={{ display: "grid", gap: 8 }}>
          {progress.matrixProgress.map((row) => (
            <MatrixProgressRow key={`${row.agentFramework}:${row.model}`} row={row} />
          ))}
        </div>
      )}

      {/* Recent items */}
      {progress && progress.recentItems.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <h4 style={{ fontSize: 11, color: "var(--bm-ink-3)", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            最近完成
          </h4>
          <div style={{ display: "grid", gap: 4, maxHeight: 200, overflow: "auto" }}>
            {progress.recentItems.map((item, i) => (
              <RecentItemRow key={`${item.agentFramework}:${item.model}:${item.caseId}:${i}`} item={item} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function MatrixProgressRow({ row }: { row: MatrixProgressRow }) {
  const pct = Math.round(((row.completed + row.failed) / Math.max(1, row.total)) * 100);
  return (
    <div style={{ display: "grid", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--bm-ink-2)" }}>
        <span>{row.agentFramework} / {row.model}</span>
        <span>{row.completed + row.failed}/{row.total} {row.failed > 0 && <span style={{ color: "#ef4444" }}>({row.failed} 失败)</span>}</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--bm-bg-3)", overflow: "hidden" }}>
        <div style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: 3,
          background: row.failed > 0 ? "linear-gradient(90deg, #f59e0b, #ef4444)" : "linear-gradient(90deg, #14b8a6, #7c3aed)",
          transition: "width 0.3s ease",
        }} />
      </div>
    </div>
  );
}

function RecentItemRow({ item }: { item: SubmissionProgressItem }) {
  const color = item.status === "completed" ? "#14b8a6" : item.status === "failed" ? "#ef4444" : "#f59e0b";
  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 8,
      padding: "6px 10px",
      borderRadius: 4,
      background: "var(--bm-bg-2)",
      fontSize: 11,
      color: "var(--bm-ink-2)",
    }}>
      <span style={{
        width: 8,
        height: 8,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }} />
      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {item.agentFramework} / {item.model} · {item.caseId}
      </span>
      {item.decision && <span style={{ color: "var(--bm-accent)", fontWeight: 600 }}>{item.decision}</span>}
      {item.durationMs && <span style={{ color: "var(--bm-ink-3)" }}>{item.durationMs}ms</span>}
      {item.error && <span style={{ color: "#ef4444", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{item.error}</span>}
    </div>
  );
}

/* ── View Switcher ──────────────────────────────────────────────────── */

function ViewSwitcher(props: {
  current: ViewMode;
  onChange: (mode: ViewMode) => void;
  hasLabeling: boolean;
}) {
  const tabs: { key: ViewMode; label: string }[] = [
    { key: "rubric", label: "评分标准" },
    { key: "leaderboard", label: "排行榜" },
    { key: "submissions", label: "提交详情" },
    { key: "cases", label: "Case 对比" },
    ...(props.hasLabeling ? [{ key: "labeling" as ViewMode, label: "人工标注" }] : []),
    { key: "knowledge", label: "知识库" },
    { key: "activity", label: "Agent 活动" },
  ];
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={props.current === tab.key ? styles.primaryButton : styles.secondaryButton}
          onClick={() => props.onChange(tab.key)}
          style={{ minHeight: 28, padding: "0 10px", fontSize: 12 }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

/* ── Submission Detail Panel ────────────────────────────────────────── */

function SubmissionDetailPanel(props: {
  runResult: BenchmarkRunResult;
  selectedSubmission: BenchmarkAgentSubmission;
  selectedCase: BenchmarkCase | null;
  metricResults: BenchmarkMetricEvaluationResult[];
  onBack: () => void;
  onRetry: (fw: string, model: string, caseId: string) => void;
}) {
  const { runResult, selectedSubmission, selectedCase, metricResults } = props;
  const framework = selectedSubmission.agentFramework;
  const model = selectedSubmission.model;

  // All submissions for this framework+model
  const allSubs = runResult.submissions.filter((s) => s.agentFramework === framework && s.model === model);
  const [activeCaseId, setActiveCaseId] = useState(selectedSubmission.caseId);

  const activeSub = allSubs.find((s) => s.caseId === activeCaseId) ?? allSubs[0];
  const activeCase = runResult.cases.find((c) => c.caseId === activeCaseId);
  const activeMetrics = runResult.metricResults.filter(
    (m) => m.agentFramework === framework && m.model === model && m.caseId === activeCaseId,
  );

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <h2>提交详情: {framework} / {model}</h2>
          <p>选择 case 查看具体输出和评测结果。</p>
        </div>
        <button className={styles.secondaryButton} onClick={props.onBack}>← 返回</button>
      </div>

      {/* Case selector */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16, maxHeight: 120, overflow: "auto" }}>
        {allSubs.map((sub) => {
          const isFailed = sub.status === "failed";
          const isActive = sub.caseId === activeCaseId;
          return (
            <button
              key={sub.caseId}
              onClick={() => setActiveCaseId(sub.caseId)}
              style={{
                padding: "4px 10px",
                borderRadius: 4,
                border: `1px solid ${isActive ? "var(--bm-accent)" : "var(--bm-line)"}`,
                background: isActive ? "rgba(124, 58, 237, 0.1)" : "var(--bm-bg-2)",
                color: isFailed ? "#ef4444" : "var(--bm-ink-2)",
                fontSize: 11,
                cursor: "pointer",
              }}
            >
              {sub.caseId} {isFailed && "✗"}
            </button>
          );
        })}
      </div>

      {/* Case input */}
      {activeCase && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 6, background: "var(--bm-bg-2)", fontSize: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
            <strong style={{ color: "var(--bm-ink)" }}>用例: {activeCase.caseId}</strong>
            <span style={{ color: "var(--bm-ink-3)" }}>标准答案: {(activeCase.expected?.decision as string) ?? "未知"}</span>
          </div>
          <div style={{ display: "grid", gap: 8, color: "var(--bm-ink-2)", maxHeight: 200, overflow: "auto" }}>
            <div>
              <strong>岗位描述:</strong>
              <pre style={{ margin: "4px 0 0", whiteSpace: "pre-wrap", fontSize: 11, lineHeight: 1.5 }}>
                {String(activeCase.input?.job_description ?? "").slice(0, 300)}...
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Agent output */}
      <div style={{ marginBottom: 16, padding: 12, borderRadius: 6, background: "var(--bm-bg-2)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
          <strong style={{ fontSize: 12, color: "var(--bm-ink)" }}>Agent 输出</strong>
          {activeSub.status === "failed" && (
            <button
              className={styles.secondaryButton}
              style={{ minHeight: 24, padding: "0 8px", fontSize: 11 }}
              onClick={() => props.onRetry(framework, model, activeSub.caseId)}
            >
              重跑
            </button>
          )}
        </div>
        {activeSub.status === "failed" ? (
          <p style={{ color: "#ef4444", fontSize: 12 }}>错误: {activeSub.error}</p>
        ) : (
          <div style={{ fontSize: 12, color: "var(--bm-ink-2)", lineHeight: 1.6 }}>
            <p><strong>决策:</strong> {String(activeSub.parsedOutput?.decision ?? "N/A")}</p>
            <p><strong>理由:</strong> {String(activeSub.parsedOutput?.reason ?? "N/A")}</p>
            <p><strong>证据:</strong></p>
            <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: 0, padding: 8, background: "var(--bm-bg)", borderRadius: 4 }}>
              {typeof activeSub.parsedOutput?.evidence === "string"
                ? activeSub.parsedOutput.evidence
                : JSON.stringify(activeSub.parsedOutput?.evidence ?? null, null, 2)}
            </pre>
            <p style={{ color: "var(--bm-ink-3)", marginTop: 8 }}>耗时: {activeSub.durationMs}ms</p>
          </div>
        )}
      </div>

      {/* Metric results for this case */}
      <div>
        <h4 style={{ fontSize: 12, marginBottom: 8, color: "var(--bm-ink)" }}>指标评测结果</h4>
        <div style={{ display: "grid", gap: 6 }}>
          {activeMetrics.map((metric) => (
            <MetricResultCard key={metric.metricKey} metric={metric} />
          ))}
        </div>
      </div>
    </section>
  );
}

function MetricResultCard({ metric }: { metric: BenchmarkMetricEvaluationResult }) {
  return (
    <div style={{
      padding: 10,
      borderRadius: 6,
      border: `1px solid ${metric.passed ? "rgba(20, 184, 166, 0.3)" : "rgba(239, 68, 68, 0.3)"}`,
      background: metric.passed ? "rgba(20, 184, 166, 0.05)" : "rgba(239, 68, 68, 0.05)",
      fontSize: 12,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <strong style={{ color: "var(--bm-ink)" }}>{metric.metricKey}</strong>
        <span style={{ color: metric.passed ? "#14b8a6" : "#ef4444", fontWeight: 600 }}>
          {metric.score}/{metric.metricWeight * 5}
        </span>
      </div>
      <p style={{ margin: "0 0 4px", color: "var(--bm-ink-2)", fontSize: 11 }}>{metric.reason}</p>
      {metric.needsHumanReview && (
        <span style={{
          display: "inline-block",
          padding: "2px 6px",
          borderRadius: 999,
          background: "rgba(245, 158, 11, 0.1)",
          color: "#92400e",
          fontSize: 10,
        }}>
          需人工审核
        </span>
      )}
    </div>
  );
}

/* ── Case Comparison Panel ──────────────────────────────────────────── */

function CaseComparisonPanel(props: {
  runResult: BenchmarkRunResult;
  compareCaseId: string | null;
  onSelectCase: (caseId: string) => void;
  onBack: () => void;
}) {
  const { runResult, compareCaseId, onSelectCase } = props;
  const cases = runResult.cases;
  const activeCaseId = compareCaseId ?? cases[0]?.caseId ?? "";
  const activeCase = cases.find((c) => c.caseId === activeCaseId);

  // All submissions for this case
  const caseSubs = runResult.submissions.filter((s) => s.caseId === activeCaseId);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <h2>Case 对比视图</h2>
          <p>选择一个 case，横向对比所有 Agent 框架的输出。</p>
        </div>
        <button className={styles.secondaryButton} onClick={props.onBack}>← 返回</button>
      </div>

      {/* Case selector */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {cases.map((c) => (
          <button
            key={c.caseId}
            onClick={() => onSelectCase(c.caseId)}
            style={{
              padding: "4px 10px",
              borderRadius: 4,
              border: `1px solid ${c.caseId === activeCaseId ? "var(--bm-accent)" : "var(--bm-line)"}`,
              background: c.caseId === activeCaseId ? "rgba(124, 58, 237, 0.1)" : "var(--bm-bg-2)",
              color: "var(--bm-ink-2)",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            {c.caseId}
          </button>
        ))}
      </div>

      {/* Case input summary */}
      {activeCase && (
        <div style={{ marginBottom: 16, padding: 12, borderRadius: 6, background: "var(--bm-bg-2)", fontSize: 12 }}>
          <strong style={{ color: "var(--bm-ink)" }}>标准答案: {(activeCase.expected?.decision as string) ?? "未知"}</strong>
        </div>
      )}

      {/* Comparison grid */}
      <div style={{ display: "grid", gap: 12 }}>
        {caseSubs.map((sub) => {
          const metrics = runResult.metricResults.filter(
            (m) => m.caseId === activeCaseId && m.agentFramework === sub.agentFramework && m.model === sub.model,
          );
          const avgScore = metrics.length
            ? Math.round(metrics.reduce((s, m) => s + m.score, 0) / metrics.length)
            : 0;
          return (
            <div key={`${sub.agentFramework}:${sub.model}`} style={{
              padding: 12,
              borderRadius: 6,
              border: "1px solid var(--bm-line-2)",
              background: "var(--bm-bg-2)",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 12 }}>
                <strong style={{ color: "var(--bm-accent)" }}>{sub.agentFramework} / {sub.model}</strong>
                <span style={{ color: avgScore >= 60 ? "#14b8a6" : "#ef4444" }}>得分: {avgScore}</span>
              </div>
              {sub.status === "failed" ? (
                <p style={{ color: "#ef4444", fontSize: 11 }}>{sub.error}</p>
              ) : (
                <div style={{ fontSize: 11, color: "var(--bm-ink-2)", lineHeight: 1.6 }}>
                  <p><strong>决策:</strong> {String(sub.parsedOutput?.decision ?? "N/A")}</p>
                  <p><strong>理由:</strong> {String(sub.parsedOutput?.reason ?? "N/A").slice(0, 120)}...</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ── Human Labeling Panel ───────────────────────────────────────────── */

function HumanLabelingPanel(props: {
  results: BenchmarkMetricEvaluationResult[];
  cases: BenchmarkCase[];
  submissions: BenchmarkAgentSubmission[];
  onBack: () => void;
}) {
  const { results, cases, submissions } = props;
  const [activeIdx, setActiveIdx] = useState(0);
  const active = results[activeIdx];

  const getCase = (caseId: string) => cases.find((c) => c.caseId === caseId);
  const getSubmission = (subId: string) => submissions.find((s) => s.submissionId === subId);

  return (
    <section className={styles.panel}>
      <div className={styles.panelHeader}>
        <div>
          <h2>人工标注工作台</h2>
          <p>对需要人工审核的 metric 进行打分和标注。</p>
        </div>
        <button className={styles.secondaryButton} onClick={props.onBack}>← 返回</button>
      </div>

      {/* Item navigator */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--bm-ink-3)" }}>
          {activeIdx + 1} / {results.length} 待审核
        </span>
        <div style={{ display: "flex", gap: 4 }}>
          <button
            className={styles.secondaryButton}
            style={{ minHeight: 24, padding: "0 8px", fontSize: 11 }}
            disabled={activeIdx <= 0}
            onClick={() => setActiveIdx((i) => Math.max(0, i - 1))}
          >
            ← 上一个
          </button>
          <button
            className={styles.secondaryButton}
            style={{ minHeight: 24, padding: "0 8px", fontSize: 11 }}
            disabled={activeIdx >= results.length - 1}
            onClick={() => setActiveIdx((i) => Math.min(results.length - 1, i + 1))}
          >
            下一个 →
          </button>
        </div>
      </div>

      {active && (
        <div style={{ display: "grid", gap: 12 }}>
          {/* Context */}
          <div style={{ padding: 12, borderRadius: 6, background: "var(--bm-bg-2)", fontSize: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
              <strong>{active.agentFramework} / {active.model}</strong>
              <span style={{ color: "var(--bm-ink-3)" }}>{active.metricKey}</span>
            </div>
            <p style={{ color: "var(--bm-ink-2)", margin: 0 }}>用例: {active.caseId}</p>
            <p style={{ color: "var(--bm-ink-3)", fontSize: 11, margin: "4px 0 0" }}>
              当前分数: {active.score} · {active.passed ? "已通过" : "未通过"}
            </p>
          </div>

          {/* Submission output */}
          {(() => {
            const sub = getSubmission(active.submissionId);
            if (!sub) return <div className={styles.empty}>找不到 submission</div>;
            return (
              <div style={{ padding: 12, borderRadius: 6, background: "var(--bm-bg-2)", fontSize: 12 }}>
                <p><strong>决策:</strong> {String(sub.parsedOutput?.decision ?? "N/A")}</p>
                <p><strong>理由:</strong> {String(sub.parsedOutput?.reason ?? "N/A")}</p>
                <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, margin: "8px 0 0", padding: 8, background: "var(--bm-bg)", borderRadius: 4 }}>
                  {typeof sub.parsedOutput?.evidence === "string"
                    ? sub.parsedOutput.evidence
                    : JSON.stringify(sub.parsedOutput?.evidence ?? null, null, 2)}
                </pre>
              </div>
            );
          })()}

          {/* Labeling form */}
          <LabelingForm
            result={active}
            onSubmit={(label) => {
              // In real implementation, POST to an API
              console.log("Submit label:", label);
              // Auto advance
              if (activeIdx < results.length - 1) setActiveIdx((i) => i + 1);
            }}
          />
        </div>
      )}
    </section>
  );
}

function LabelingForm(props: {
  result: BenchmarkMetricEvaluationResult;
  onSubmit: (label: { score: number; passed: boolean; reason: string }) => void;
}) {
  const [score, setScore] = useState(props.result.score);
  const [passed, setPassed] = useState(props.result.passed);
  const [reason, setReason] = useState("");

  return (
    <div style={{ padding: 12, borderRadius: 6, border: "1px solid var(--bm-line)", background: "var(--bm-bg)" }}>
      <h4 style={{ fontSize: 12, margin: "0 0 12px", color: "var(--bm-ink)" }}>你的审核意见</h4>
      <div style={{ display: "grid", gap: 10 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--bm-ink-2)" }}>
          <span>分数 (0-5):</span>
          <input
            type="number"
            min={0}
            max={5}
            value={score}
            onChange={(e) => setScore(Number(e.target.value))}
            style={{ width: 60, padding: "4px 8px", borderRadius: 4, border: "1px solid var(--bm-line)", background: "var(--bm-bg-2)", color: "var(--bm-ink)" }}
          />
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--bm-ink-2)" }}>
          <input type="checkbox" checked={passed} onChange={(e) => setPassed(e.target.checked)} />
          <span>通过</span>
        </label>
        <label style={{ display: "grid", gap: 4, fontSize: 12, color: "var(--bm-ink-2)" }}>
          <span>审核理由:</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            style={{ padding: 8, borderRadius: 4, border: "1px solid var(--bm-line)", background: "var(--bm-bg-2)", color: "var(--bm-ink)", fontSize: 12 }}
          />
        </label>
        <button
          className={styles.primaryButton}
          style={{ justifySelf: "start", minHeight: 32, padding: "0 16px" }}
          onClick={() => props.onSubmit({ score, passed, reason })}
        >
          提交并下一个
        </button>
      </div>
    </div>
  );
}

/* ── Rubric Module View ─────────────────────────────────────────────── */

function RubricModuleView(props: {
  module: BenchmarkRubricModule;
  draftModule?: BenchmarkRubricModule;
  selectedMetricKeys: string[];
  reviewedMetricKeys: Set<string>;
  modifiedMetricKeys: Set<string>;
  highlightedMetricKey: string | null;
  onToggle: (metricKey: string) => void;
  onSaveEdit: (metricKey: string, patch: Parameters<typeof updateRubricMetric>[2]) => void;
}) {
  return (
    <section className={styles.rubricModule}>
      <div className={styles.rubricModuleHeader}>
        <strong>{props.module.displayName}</strong>
        <span>weight {props.module.weight}</span>
      </div>
      <p>{props.module.description}</p>
      <div className={styles.metricList}>
        {props.module.metrics.map((metric) => (
          <RubricMetricCard
            key={metric.metricKey}
            metric={metric}
            draftMetric={props.draftModule?.metrics.find((m) => m.metricKey === metric.metricKey)}
            checked={props.selectedMetricKeys.includes(metric.metricKey)}
            reviewed={props.reviewedMetricKeys.has(metric.metricKey)}
            modified={props.modifiedMetricKeys.has(metric.metricKey)}
            highlighted={props.highlightedMetricKey === metric.metricKey}
            onToggle={() => props.onToggle(metric.metricKey)}
            onSaveEdit={(patch) => props.onSaveEdit(metric.metricKey, patch)}
          />
        ))}
      </div>
    </section>
  );
}

function RubricMetricCard(props: {
  metric: BenchmarkRubricMetric;
  draftMetric?: BenchmarkRubricMetric;
  checked: boolean;
  reviewed: boolean;
  modified: boolean;
  highlighted: boolean;
  onToggle: () => void;
  onSaveEdit: (patch: Parameters<typeof updateRubricMetric>[2]) => void;
}) {
  const [editing, setEditing] = useState(false);
  const statusClass = props.modified
    ? styles.metricCardModified
    : props.reviewed
      ? styles.metricCardReviewed
      : styles.metricCardUnreviewed;

  return (
    <div className={`${styles.metricCard} ${statusClass} ${props.highlighted ? styles.metricCardHighlighted : ""}`}>
      <div className={styles.metricCardRow}>
        <label className={styles.metricCardToggle}>
          <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
          <span>
            <strong>{props.metric.displayName}</strong>
            <small>
              {props.metric.evaluatorType} · weight {props.metric.weight} · 阈值 {props.metric.scale.passThreshold}
              {" "}·{" "}
              {props.metric.metricKey}
            </small>
          </span>
        </label>
        <div className={styles.metricCardActions}>
          {props.reviewed && !props.modified && <span className={styles.metricCardStatusOk}>已校验</span>}
          {props.modified && <span className={styles.metricCardStatusModified}>已修改</span>}
          {!props.reviewed && !props.modified && <span className={styles.metricCardStatusUnreviewed}>待校验</span>}
          <button
            className={styles.secondaryButton}
            style={{ minHeight: 24, padding: "0 8px", fontSize: 11 }}
            onClick={() => setEditing((v) => !v)}
            title="设置指标"
          >
            {editing ? "收起" : "设置"}
          </button>
        </div>
      </div>

      {/* Collapsible description tooltip */}
      <div className={styles.metricCardDescription}>{props.metric.description}</div>

      {editing && (
        <RubricMetricEditor
          metric={props.metric}
          draftMetric={props.draftMetric}
          onSave={(patch) => {
            props.onSaveEdit(patch);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
          onReset={() => {
            if (props.draftMetric) {
              props.onSaveEdit({
                displayName: props.draftMetric.displayName,
                description: props.draftMetric.description,
                weight: props.draftMetric.weight,
                scale: { ...props.draftMetric.scale },
                evaluatorType: props.draftMetric.evaluatorType,
                evidenceRequired: props.draftMetric.evidenceRequired,
                humanApprovalRequired: props.draftMetric.humanApprovalRequired,
                failureTags: [...props.draftMetric.failureTags],
                config: props.draftMetric.config ? { ...props.draftMetric.config } : undefined,
              });
              setEditing(false);
            }
          }}
        />
      )}
    </div>
  );
}

/* ── Leaderboard Table ──────────────────────────────────────────────── */

function LeaderboardTable(props: { rows: BenchmarkLeaderboardRow[]; onRowClick?: (row: BenchmarkLeaderboardRow) => void }) {
  return (
    <div className={styles.leaderboardTable}>
      <div className={styles.leaderboardHead}>
        <span>排名</span>
        <span>Agent 框架</span>
        <span>模型</span>
        <span>得分</span>
        <span>通过率</span>
      </div>
      {props.rows.map((row, index) => (
        <div
          className={styles.leaderboardRow}
          key={`${row.agentFramework}:${row.model}`}
          onClick={() => props.onRowClick?.(row)}
          style={{ cursor: props.onRowClick ? "pointer" : undefined }}
        >
          <strong>{index + 1}</strong>
          <span>{row.agentFramework}</span>
          <span>{row.model}</span>
          <b>{row.averageScore}</b>
          <em>{Math.round(row.passRate * 100)}%</em>
        </div>
      ))}
    </div>
  );
}

/* ── Capability Bars ────────────────────────────────────────────────── */

function CapabilityBars(props: { scores: BenchmarkCapabilityScore[] }) {
  return (
    <div className={styles.barList}>
      {props.scores.map((score) => (
        <div className={styles.barRow} key={score.capability}>
          <div>
            <span>{score.capability}</span>
            <strong>{score.score}</strong>
          </div>
          <i>
            <span style={{ width: `${Math.max(4, Math.min(100, score.score))}%` }} />
          </i>
        </div>
      ))}
    </div>
  );
}

/* ── Metric Card ────────────────────────────────────────────────────── */

function MetricCard(props: { label: string; value: string; detail: string; tone?: "ok" | "warn" }) {
  return (
    <article className={`${styles.metricCard} ${props.tone === "warn" ? styles.metricWarn : ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}
