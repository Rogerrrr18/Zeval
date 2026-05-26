/**
 * @fileoverview Real product overview dashboard for the quality loop.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import type { DatasetCaseRecord, SampleBatchRecord } from "@/eval-datasets/storage/types";
import type { EvaluateRunIndexRow } from "@/persistence/evaluateResultStore";
import type { RemediationPackageIndexRow } from "@/remediation";
import type { ValidationRunIndexRow } from "@/validation";
import styles from "./overviewDashboard.module.css";

type CasesResponse = { cases?: DatasetCaseRecord[]; error?: string; detail?: string };
type RunsResponse = { runs?: EvaluateRunIndexRow[]; error?: string; detail?: string };
type PackagesResponse = { packages?: RemediationPackageIndexRow[]; error?: string; detail?: string };
type ValidationRunsResponse = { validationRuns?: ValidationRunIndexRow[]; error?: string; detail?: string };
type SampleBatchesResponse = { sampleBatches?: SampleBatchRecord[]; error?: string; detail?: string };

const ACTIVE_CASE_STATUSES = new Set(["human_reviewed", "gold_candidate", "gold", "regression_active"]);

/**
 * Render the project-level dashboard.
 */
export function OverviewDashboard() {
  const [runs, setRuns] = useState<EvaluateRunIndexRow[]>([]);
  const [badcases, setBadcases] = useState<DatasetCaseRecord[]>([]);
  const [goodcases, setGoodcases] = useState<DatasetCaseRecord[]>([]);
  const [packages, setPackages] = useState<RemediationPackageIndexRow[]>([]);
  const [validationRuns, setValidationRuns] = useState<ValidationRunIndexRow[]>([]);
  const [sampleBatches, setSampleBatches] = useState<SampleBatchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [runsRes, badRes, goodRes, packagesRes, validationRes, batchesRes] = await Promise.all([
        fetch("/api/evaluate-runs?limit=8"),
        fetch("/api/eval-datasets/cases?caseSetType=badcase"),
        fetch("/api/eval-datasets/cases?caseSetType=goodcase"),
        fetch("/api/remediation-packages"),
        fetch("/api/validation-runs"),
        fetch("/api/eval-datasets/sample-batches"),
      ]);
      const [runsData, badData, goodData, packagesData, validationData, batchesData] = (await Promise.all([
        runsRes.json(),
        badRes.json(),
        goodRes.json(),
        packagesRes.json(),
        validationRes.json(),
        batchesRes.json(),
      ])) as [RunsResponse, CasesResponse, CasesResponse, PackagesResponse, ValidationRunsResponse, SampleBatchesResponse];

      if (!runsRes.ok) throw new Error(runsData.detail ?? runsData.error ?? "读取评估记录失败");
      if (!badRes.ok) throw new Error(badData.detail ?? badData.error ?? "读取 badcase 失败");
      if (!goodRes.ok) throw new Error(goodData.detail ?? goodData.error ?? "读取 goodcase 失败");
      if (!packagesRes.ok) throw new Error(packagesData.detail ?? packagesData.error ?? "读取调优包失败");
      if (!validationRes.ok) throw new Error(validationData.detail ?? validationData.error ?? "读取验证记录失败");
      if (!batchesRes.ok) throw new Error(batchesData.detail ?? batchesData.error ?? "读取 Benchmark 批次失败");

      setRuns(runsData.runs ?? []);
      setBadcases(badData.cases ?? []);
      setGoodcases(goodData.cases ?? []);
      setPackages(packagesData.packages ?? []);
      setValidationRuns(validationData.validationRuns ?? []);
      setSampleBatches(batchesData.sampleBatches ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取总览失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const pendingCases = useMemo(
    () => badcases.filter((item) => item.source === "auto_fn" || item.source === "auto_uncertainty"),
    [badcases],
  );
  const activeBadcases = useMemo(
    () => badcases.filter((item) => ACTIVE_CASE_STATUSES.has(item.reviewStatus ?? "auto_captured")),
    [badcases],
  );
  const activeGoodcases = useMemo(
    () => goodcases.filter((item) => ACTIVE_CASE_STATUSES.has(item.reviewStatus ?? "auto_captured")),
    [goodcases],
  );
  const latestRun = runs[0];
  const latestPackage = packages[0];
  const latestValidation = validationRuns[0];
  const latestBatch = sampleBatches[0];
  const validationPassed = validationRuns.filter((item) => item.status === "passed").length;
  const readiness = resolveReadiness({
    latestRun,
    pendingCount: pendingCases.length,
    sampleBatchCount: sampleBatches.length,
    packageCount: packages.length,
    latestValidation,
  });

  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Project Overview</span>
            <h1>质量闭环总览</h1>
            <p>从真实对话评估、人工校准、Benchmark 到修复验证的当前项目状态。</p>
          </div>
          <div className={styles.headerActions}>
            <button type="button" className={styles.secondaryButton} disabled={loading} onClick={() => void loadData()}>
              {loading ? "刷新中..." : "刷新"}
            </button>
            <Link href="/workbench" className={styles.primaryButton}>开始评估</Link>
          </div>
        </section>

        {error ? <p className={styles.error}>{error}</p> : null}

        <section className={styles.metricGrid}>
          <Metric label="最新评估" value={latestRun ? latestRun.sessions.toString() : "--"} detail={latestRun ? `${latestRun.messages} messages · ${formatDate(latestRun.generatedAt)}` : "还没有评估记录"} />
          <Metric label="待校准" value={String(pendingCases.length)} detail="FN / Uncertainty 队列" warn={pendingCases.length > 0} />
          <Metric label="Benchmark Pool" value={`${activeBadcases.length}/${activeGoodcases.length}`} detail="badcase / goodcase active" />
          <Metric label="Validation" value={`${validationPassed}/${validationRuns.length}`} detail={latestValidation ? `latest ${latestValidation.status}` : "尚未回归验证"} warn={Boolean(latestValidation && latestValidation.status === "failed")} />
        </section>

        <section className={styles.grid}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Pipeline 状态</h2>
                <p>按真实使用路径组织，而不是工程模块。</p>
              </div>
              <span className={styles.readiness}>{readiness.label}</span>
            </div>
            <div className={styles.timeline}>
              <Step label="评估" href="/workbench" status={latestRun ? "done" : "next"} detail={latestRun ? latestRun.runId : "上传 chatlog 开始"} />
              <Step label="案例校准" href="/datasets" status={pendingCases.length ? "next" : activeBadcases.length ? "done" : "idle"} detail={pendingCases.length ? `${pendingCases.length} 条待确认` : `${activeBadcases.length} 条 active badcase`} />
              <Step label="Benchmark" href="/benchmark" status={latestBatch ? "done" : activeBadcases.length ? "next" : "idle"} detail={latestBatch ? `${latestBatch.caseIds.length} cases` : "生成固定回归集"} />
              <Step label="修复验证" href="/remediation-packages" status={latestValidation ? (latestValidation.status === "passed" ? "done" : "next") : latestPackage ? "next" : "idle"} detail={latestValidation ? latestValidation.status : latestPackage?.title ?? "等待调优包"} />
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>下一步</h2>
                <p>{readiness.detail}</p>
              </div>
            </div>
            <div className={styles.actionStack}>
              {readiness.actions.map((action) => (
                <Link className={styles.actionItem} href={action.href} key={action.href}>
                  <strong>{action.label}</strong>
                  <span>{action.detail}</span>
                </Link>
              ))}
            </div>
          </article>
        </section>

        <section className={styles.grid}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>最近评估</h2>
                <p>评估结果是后续案例池和调优包的源头。</p>
              </div>
              <Link href="/workbench" className={styles.textButton}>进入评估</Link>
            </div>
            <div className={styles.list}>
              {runs.length ? runs.slice(0, 5).map((run) => (
                <div className={styles.listRow} key={run.runId}>
                  <strong>{run.runId}</strong>
                  <span>{run.sessions} sessions · warning {run.warningCount} · {formatDate(run.generatedAt)}</span>
                </div>
              )) : <div className={styles.empty}>暂无评估记录。</div>}
            </div>
          </article>

          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>修复与验证</h2>
                <p>调优包和 validation run 决定能不能发布。</p>
              </div>
              <Link href="/remediation-packages" className={styles.textButton}>修复验证</Link>
            </div>
            <div className={styles.list}>
              {latestPackage ? (
                <div className={styles.listRow}>
                  <strong>{latestPackage.title}</strong>
                  <span>{latestPackage.priority} · {latestPackage.selectedCaseCount} cases · {formatDate(latestPackage.createdAt)}</span>
                </div>
              ) : <div className={styles.empty}>暂无调优包。</div>}
              {latestValidation ? (
                <div className={styles.listRow}>
                  <strong>{latestValidation.validationRunId}</strong>
                  <span>{latestValidation.mode} · {latestValidation.status} · {formatDate(latestValidation.createdAt)}</span>
                </div>
              ) : null}
            </div>
          </article>
        </section>
      </div>
    </AppShell>
  );
}

function Metric(props: { label: string; value: string; detail: string; warn?: boolean }) {
  return (
    <article className={`${styles.metricCard} ${props.warn ? styles.metricWarn : ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}

function Step(props: { label: string; href: string; status: "done" | "next" | "idle"; detail: string }) {
  return (
    <Link className={styles.step} href={props.href}>
      <em className={styles[props.status]} />
      <strong>{props.label}</strong>
      <span>{props.detail}</span>
    </Link>
  );
}

function resolveReadiness(input: {
  latestRun?: EvaluateRunIndexRow;
  pendingCount: number;
  sampleBatchCount: number;
  packageCount: number;
  latestValidation?: ValidationRunIndexRow;
}) {
  if (!input.latestRun) {
    return {
      label: "NEEDS EVALUATION",
      detail: "先上传真实对话日志，建立第一条质量基线。",
      actions: [{ label: "开始评估", detail: "上传 chatlog 并运行质量诊断", href: "/workbench" }],
    };
  }
  if (input.pendingCount > 0) {
    return {
      label: "REVIEW BLOCKED",
      detail: "有待确认 case 阻塞 Benchmark 可信度，先处理人工校准。",
      actions: [{ label: "处理待确认", detail: `${input.pendingCount} 条 FN / Uncertainty`, href: "/datasets" }],
    };
  }
  if (input.sampleBatchCount === 0) {
    return {
      label: "BUILD BENCHMARK",
      detail: "案例池已有素材，下一步生成固定回归集。",
      actions: [
        { label: "生成 Benchmark", detail: "创建 sample batch 作为发布门禁输入", href: "/benchmark" },
        { label: "合成补样本", detail: "覆盖薄弱维度", href: "/synthesize" },
      ],
    };
  }
  if (input.packageCount === 0) {
    return {
      label: "READY FOR FIX",
      detail: "Benchmark 已准备好，可以生成修复包。",
      actions: [{ label: "生成调优包", detail: "把 badcase 转成修复任务", href: "/workbench" }],
    };
  }
  if (!input.latestValidation || input.latestValidation.status === "failed") {
    return {
      label: "VALIDATION REQUIRED",
      detail: "需要跑回归验证或修复失败的 validation。",
      actions: [{ label: "进入修复验证", detail: "跑 replay / offline gate", href: "/remediation-packages" }],
    };
  }
  return {
    label: "RELEASE READY",
    detail: "最近一次 validation 已通过，可以继续监控下一批真实对话。",
    actions: [{ label: "继续观测", detail: "接入下一批真实数据", href: "/workbench" }],
  };
}

function formatDate(value: string) {
  return value.slice(0, 16).replace("T", " ");
}
