/**
 * @fileoverview Project-level command dashboard for the evaluation loop.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BenchmarkRunHistoryItem, BenchmarkWorkspaceSession } from "@/benchmark/session-store";
import { AppShell } from "@/components/shell";
import { useProject } from "@/components/shell/ProjectContext";
import type { DatasetCaseRecord, SampleBatchRecord } from "@/eval-datasets/storage/types";
import type { RemediationPackageIndexRow } from "@/remediation";
import type { ValidationRunIndexRow } from "@/validation";
import styles from "./overviewDashboard.module.css";

type BenchmarkSessionsResponse = {
  sessions?: BenchmarkWorkspaceSession[];
  activeSessionId?: string | null;
  error?: string;
  detail?: string;
};
type CasesResponse = { cases?: DatasetCaseRecord[]; error?: string; detail?: string };
type PackagesResponse = { packages?: RemediationPackageIndexRow[]; error?: string; detail?: string };
type ValidationRunsResponse = { validationRuns?: ValidationRunIndexRow[]; error?: string; detail?: string };
type SampleBatchesResponse = { sampleBatches?: SampleBatchRecord[]; error?: string; detail?: string };

type StageStatus = "done" | "next" | "idle" | "warn";
type BenchmarkRunRow = BenchmarkRunHistoryItem & { sessionId: string; sessionTitle: string };

const ACTIVE_CASE_STATUSES = new Set(["human_reviewed", "gold_candidate", "gold", "regression_active"]);

/**
 * Render the project-level dashboard.
 */
export function OverviewDashboard() {
  const { activeProject, activeProjectId } = useProject();
  const [sessions, setSessions] = useState<BenchmarkWorkspaceSession[]>([]);
  const [cases, setCases] = useState<DatasetCaseRecord[]>([]);
  const [packages, setPackages] = useState<RemediationPackageIndexRow[]>([]);
  const [validationRuns, setValidationRuns] = useState<ValidationRunIndexRow[]>([]);
  const [sampleBatches, setSampleBatches] = useState<SampleBatchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const projectHeaders = useMemo(
    () => ({ "x-zeval-project-id": activeProjectId }),
    [activeProjectId],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [sessionsRes, casesRes, packagesRes, validationRes, batchesRes] = await Promise.all([
        fetch(`/api/benchmarks/sessions?projectId=${encodeURIComponent(activeProjectId)}`),
        fetch("/api/eval-datasets/cases", { headers: projectHeaders }),
        fetch("/api/remediation-packages", { headers: projectHeaders }),
        fetch("/api/validation-runs", { headers: projectHeaders }),
        fetch("/api/eval-datasets/sample-batches", { headers: projectHeaders }),
      ]);
      const [sessionsData, casesData, packagesData, validationData, batchesData] = (await Promise.all([
        sessionsRes.json(),
        casesRes.json(),
        packagesRes.json(),
        validationRes.json(),
        batchesRes.json(),
      ])) as [BenchmarkSessionsResponse, CasesResponse, PackagesResponse, ValidationRunsResponse, SampleBatchesResponse];

      if (!sessionsRes.ok) throw new Error(sessionsData.detail ?? sessionsData.error ?? "读取评测任务失败");
      if (!casesRes.ok) throw new Error(casesData.detail ?? casesData.error ?? "读取案例池失败");
      if (!packagesRes.ok) throw new Error(packagesData.detail ?? packagesData.error ?? "读取调优包失败");
      if (!validationRes.ok) throw new Error(validationData.detail ?? validationData.error ?? "读取验证记录失败");
      if (!batchesRes.ok) throw new Error(batchesData.detail ?? batchesData.error ?? "读取回归集失败");

      setSessions(sortByUpdatedAt(sessionsData.sessions ?? []));
      setCases(casesData.cases ?? []);
      setPackages(packagesData.packages ?? []);
      setValidationRuns(validationData.validationRuns ?? []);
      setSampleBatches(batchesData.sampleBatches ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取总览失败");
    } finally {
      setLoading(false);
    }
  }, [activeProjectId, projectHeaders]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeCases = useMemo(
    () => cases.filter((item) => ACTIVE_CASE_STATUSES.has(item.reviewStatus ?? "auto_captured")),
    [cases],
  );
  const activeBadcases = useMemo(
    () => activeCases.filter((item) => item.caseSetType === "badcase"),
    [activeCases],
  );
  const goldCases = useMemo(
    () => activeCases.filter(isGoldCase),
    [activeCases],
  );
  const pendingCases = useMemo(
    () => cases.filter(isPendingReviewCase),
    [cases],
  );
  const benchmarkRuns = useMemo(
    () => collectBenchmarkRuns(sessions),
    [sessions],
  );

  const latestRun = benchmarkRuns[0];
  const latestSession = sessions[0];
  const latestValidation = validationRuns[0];
  const rubricCount = sessions.filter((item) => item.rubric).length;
  const datasetCount = sessions.filter((item) => item.dataset).length;
  const validationPassed = validationRuns.filter((item) => item.status === "passed").length;
  const readiness = resolveReadiness({
    sessionCount: sessions.length,
    rubricCount,
    datasetCount,
    latestRun,
    pendingCount: pendingCases.length,
    activeCaseCount: activeCases.length,
    sampleBatchCount: sampleBatches.length,
    packageCount: packages.length,
    latestValidation,
  });

  const stages = [
    {
      label: "准备评分标准",
      href: "/benchmark",
      status: rubricCount > 0 ? "done" : "next",
      detail: rubricCount > 0 ? `${rubricCount} 个任务已有标准` : "先创建任务并确认指标",
    },
    {
      label: "运行评测",
      href: "/benchmark",
      status: latestRun ? "done" : rubricCount > 0 ? "next" : "idle",
      detail: latestRun ? `${latestRun.caseCount} 个案例 · ${formatDate(latestRun.generatedAt)}` : "上传数据并启动评测",
    },
    {
      label: "人工校准",
      href: "/datasets",
      status: pendingCases.length > 0 ? "warn" : activeCases.length > 0 ? "done" : "idle",
      detail: pendingCases.length > 0 ? `${pendingCases.length} 条待处理` : `${activeCases.length} 条已入池`,
    },
    {
      label: "回归验证",
      href: "/remediation-packages",
      status: latestValidation ? (latestValidation.status === "passed" ? "done" : "warn") : sampleBatches.length ? "next" : "idle",
      detail: latestValidation ? validationStatusLabel(latestValidation.status) : `${sampleBatches.length} 个固定回归集`,
    },
  ] satisfies Array<{ label: string; href: string; status: StageStatus; detail: string }>;

  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.commandBar}>
          <div className={styles.commandCopy}>
            <span className={styles.eyebrow}>项目指挥台</span>
            <h1>{readiness.title}</h1>
            <p>{readiness.detail}</p>
            <div className={styles.commandActions}>
              {readiness.actions.map((action, index) => (
                <Link
                  className={index === 0 ? styles.primaryButton : styles.secondaryButton}
                  href={action.href}
                  key={action.href}
                >
                  {action.label}
                </Link>
              ))}
              <button type="button" className={styles.ghostButton} disabled={loading} onClick={() => void loadData()}>
                {loading ? "同步中" : "同步状态"}
              </button>
            </div>
          </div>
          <aside className={styles.projectStatus}>
            <span>当前项目</span>
            <strong>{activeProject.name}</strong>
            <p>{latestSession ? `最近任务：${latestSession.title}` : "还没有评测任务"}</p>
            <b>{readiness.label}</b>
          </aside>
        </section>

        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.metricGrid}>
          <Metric label="评测任务" value={String(sessions.length)} detail={`已运行 ${benchmarkRuns.length} 次 · 数据集 ${datasetCount} 个`} />
          <Metric label="待人工处理" value={String(pendingCases.length)} detail={pendingCases.length > 0 ? "会阻塞金标准可信度" : "暂无人工校准阻塞"} tone={pendingCases.length > 0 ? "warn" : "normal"} />
          <Metric label="案例池资产" value={`${activeBadcases.length}/${goldCases.length}`} detail="坏例 / 金标正例" />
          <Metric label="回归验证" value={`${validationPassed}/${validationRuns.length}`} detail={latestValidation ? validationStatusLabel(latestValidation.status) : "尚未跑验证"} tone={latestValidation?.status === "failed" ? "warn" : "normal"} />
        </section>

        <section className={styles.mainGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>质量闭环</h2>
                <p>从评分标准到入池校准，再到回归验证。</p>
              </div>
            </div>
            <div className={styles.timeline}>
              {stages.map((stage) => (
                <Step
                  detail={stage.detail}
                  href={stage.href}
                  key={stage.label}
                  label={stage.label}
                  status={stage.status}
                />
              ))}
            </div>
          </article>
        </section>

        <section className={styles.assetGrid}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>最近评测任务</h2>
                <p>{latestRun ? `最新均分 ${Math.round(latestRun.averageScore)} · ${latestRun.caseCount} 个案例` : "等待第一次评测运行。"}</p>
              </div>
              <Link href="/benchmark" className={styles.textButton}>打开</Link>
            </div>
            <div className={styles.list}>
              {sessions.length ? sessions.slice(0, 5).map((session) => (
                <div className={styles.listRow} key={session.id}>
                  <strong>{session.title}</strong>
                  <span>
                    {session.rubric ? "已建标准" : "未建标准"} · {session.dataset ? `${session.dataset.ingestMeta.rows} 行数据` : "未上传数据"} · {formatDate(session.updatedAt)}
                  </span>
                </div>
              )) : <div className={styles.empty}>暂无评测任务。</div>}
            </div>
          </article>

        </section>
      </div>
    </AppShell>
  );
}

function Metric(props: { label: string; value: string; detail: string; tone?: "normal" | "warn" }) {
  return (
    <article className={`${styles.metricCard} ${props.tone === "warn" ? styles.metricWarn : ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}

function Step(props: { label: string; href: string; status: StageStatus; detail: string }) {
  return (
    <Link className={styles.step} href={props.href}>
      <em className={styles[props.status]} />
      <strong>{props.label}</strong>
      <span>{props.detail}</span>
    </Link>
  );
}

function resolveReadiness(input: {
  sessionCount: number;
  rubricCount: number;
  datasetCount: number;
  latestRun?: BenchmarkRunRow;
  pendingCount: number;
  activeCaseCount: number;
  sampleBatchCount: number;
  packageCount: number;
  latestValidation?: ValidationRunIndexRow;
}) {
  if (input.pendingCount > 0) {
    return {
      label: "需要人工校准",
      title: "先处理待人工确认的案例",
      detail: `当前还有 ${input.pendingCount} 条案例需要人工判断。处理完之后，金标与坏例才适合进入回归闭环。`,
      reason: "人工校准是 gold label 闭环的关键门槛。",
      actions: [{ label: "处理待确认", detail: "进入案例校准面板逐条确认", href: "/datasets" }],
    };
  }
  if (input.latestValidation?.status === "failed") {
    return {
      label: "验证失败",
      title: "先复盘失败的回归验证",
      detail: "当前项目最近一次 validation 没有通过。先定位失败样例，再决定是否回到案例校准或修复流程。",
      reason: "验证失败说明现有修复或基线仍然存在风险。",
      actions: [{ label: "查看验证失败", detail: "进入修复验证定位失败原因", href: "/remediation-packages" }],
    };
  }
  if (input.activeCaseCount > 0 && input.sampleBatchCount === 0) {
    return {
      label: "需要固定回归集",
      title: "把已入池案例变成固定回归集",
      detail: "当前项目已经有案例资产，下一步是生成 sample batch，让后续模型/Agent 改动可以做稳定对比。",
      reason: "固定回归集能避免每次评测抽样不同导致结果不可比。",
      actions: [
        { label: "生成回归集", detail: "进入 Benchmark 生成固定样本批次", href: "/benchmark" },
        { label: "查看案例池", detail: "检查案例覆盖和人工标注", href: "/datasets" },
      ],
    };
  }
  if (input.sessionCount === 0 || input.rubricCount === 0) {
    return {
      label: "需要建立标准",
      title: "先建立可复用的评测任务",
      detail: "首页现在以当前项目为单位组织。第一步是进入评测工作台，确认任务需求、评分标准和数据格式。",
      reason: "没有评分标准时，后面的案例校准和回归验证都没有稳定基准。",
      actions: [{ label: "创建评测任务", detail: "进入评测工作台生成评分标准", href: "/benchmark" }],
    };
  }
  if (input.datasetCount === 0 || !input.latestRun) {
    return {
      label: "等待评测运行",
      title: "把数据跑成第一轮评测结果",
      detail: "已有评分标准，下一步是上传数据并运行 benchmark，产出可解释结果和候选案例。",
      reason: "没有完成评测运行时，案例池不会产生可校准资产。",
      actions: [{ label: "运行评测", detail: "上传数据并启动 benchmark", href: "/benchmark" }],
    };
  }
  if (input.activeCaseCount === 0) {
    return {
      label: "等待案例入池",
      title: "把评测结果沉淀成案例资产",
      detail: "已有评测运行后，需要把候选 badcase / gold case 保存入池，后续才能做校准和回归。",
      reason: "没有入池案例时，回归验证没有稳定输入。",
      actions: [
        { label: "回到评测结果", detail: "从评测结果保存候选案例", href: "/benchmark" },
        { label: "查看案例池", detail: "确认当前项目案例资产", href: "/datasets" },
      ],
    };
  }
  if (input.sampleBatchCount === 0) {
    return {
      label: "需要固定回归集",
      title: "把已入池案例变成固定回归集",
      detail: "案例池已有素材，下一步是生成 sample batch，让后续模型/Agent 改动可以做稳定对比。",
      reason: "固定回归集能避免每次评测抽样不同导致结果不可比。",
      actions: [
        { label: "生成回归集", detail: "进入 Benchmark 生成固定样本批次", href: "/benchmark" },
        { label: "查看案例池", detail: "检查案例覆盖和人工标注", href: "/datasets" },
      ],
    };
  }
  if (input.packageCount === 0) {
    return {
      label: "准备修复",
      title: "可以把失败案例交给修复流程",
      detail: "评测与案例池已经准备好，下一步是形成可执行的调优包，并绑定回归验证。",
      reason: "调优包负责把问题转成工程可执行任务。",
      actions: [{ label: "进入修复验证", detail: "创建或绑定调优包与回归 gate", href: "/remediation-packages" }],
    };
  }
  if (!input.latestValidation) {
    return {
      label: "等待验证",
      title: "跑一次回归验证再决定是否发布",
      detail: "已有调优包，但还需要通过 replay / offline gate 来证明改动没有回退。",
      reason: "没有通过 validation 的修复不应该进入发布判断。",
      actions: [{ label: "运行验证", detail: "进入修复验证执行回归 gate", href: "/remediation-packages" }],
    };
  }
  return {
    label: "闭环健康",
    title: "当前项目已经具备发布前质量闭环",
    detail: "最近一次验证已通过，可以继续接入下一批样例，扩展评分维度覆盖和回归集。",
    reason: "持续沉淀新案例会让回归集越来越接近真实业务风险。",
    actions: [
      { label: "继续评测", detail: "接入下一批真实样例", href: "/benchmark" },
      { label: "查看验证", detail: "复盘最近一次 validation", href: "/remediation-packages" },
    ],
  };
}

function collectBenchmarkRuns(sessions: BenchmarkWorkspaceSession[]): BenchmarkRunRow[] {
  const rows: BenchmarkRunRow[] = [];
  for (const session of sessions) {
    for (const item of session.runHistory ?? []) {
      rows.push({ ...item, sessionId: session.id, sessionTitle: session.title });
    }
    const result = session.runResult;
    if (result && !rows.some((item) => item.runId === result.runId)) {
      rows.push({
        runId: result.runId,
        generatedAt: result.generatedAt,
        averageScore: result.summary.averageScore,
        caseCount: result.summary.caseCount,
        needsHumanReviewCount: result.summary.needsHumanReviewCount,
        result,
        progress: session.progress ?? null,
        sessionId: session.id,
        sessionTitle: session.title,
      });
    }
  }
  return rows.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
}

function isPendingReviewCase(caseRecord: DatasetCaseRecord): boolean {
  if (caseRecord.reviewStatus !== "auto_captured") return false;
  if (caseRecord.source === "auto_fn" || caseRecord.source === "auto_uncertainty") return true;
  return (caseRecord.metadata as Record<string, unknown> | undefined)?.humanReviewRequired === true;
}

function isGoldCase(caseRecord: DatasetCaseRecord): boolean {
  return (
    caseRecord.caseSetType === "goodcase" &&
    (caseRecord.reviewStatus === "gold_candidate" ||
      caseRecord.reviewStatus === "gold" ||
      caseRecord.source === "manual_gold" ||
      caseRecord.source === "auto_tn")
  );
}

function sortByUpdatedAt(sessions: BenchmarkWorkspaceSession[]): BenchmarkWorkspaceSession[] {
  return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function validationStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    passed: "验证通过",
    failed: "验证失败",
    running: "验证中",
    queued: "排队中",
    canceled: "已取消",
  };
  return labels[status] ?? status;
}

function formatDate(value?: string) {
  if (!value) return "暂无时间";
  return value.slice(0, 16).replace("T", " ");
}
