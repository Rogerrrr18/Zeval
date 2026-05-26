/**
 * @fileoverview Benchmark coverage and sample-batch management console.
 */

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import type { DatasetCaseRecord, SampleBatchRecord } from "@/eval-datasets/storage/types";
import styles from "./benchmarkConsole.module.css";

type CasesResponse = {
  cases?: DatasetCaseRecord[];
  error?: string;
  detail?: string;
};

type SampleBatchesResponse = {
  sampleBatches?: SampleBatchRecord[];
  error?: string;
  detail?: string;
};

const ACTIVE_REVIEW_STATUSES = new Set(["human_reviewed", "gold", "gold_candidate", "regression_active"]);

/**
 * Render the benchmark dashboard.
 */
export function BenchmarkConsole() {
  const [badcases, setBadcases] = useState<DatasetCaseRecord[]>([]);
  const [goodcases, setGoodcases] = useState<DatasetCaseRecord[]>([]);
  const [sampleBatches, setSampleBatches] = useState<SampleBatchRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [badRes, goodRes, batchRes] = await Promise.all([
        fetch("/api/eval-datasets/cases?caseSetType=badcase"),
        fetch("/api/eval-datasets/cases?caseSetType=goodcase"),
        fetch("/api/eval-datasets/sample-batches"),
      ]);
      const [badData, goodData, batchData] = (await Promise.all([
        badRes.json(),
        goodRes.json(),
        batchRes.json(),
      ])) as [CasesResponse, CasesResponse, SampleBatchesResponse];

      if (!badRes.ok) throw new Error(badData.detail ?? badData.error ?? "读取 badcase 失败");
      if (!goodRes.ok) throw new Error(goodData.detail ?? goodData.error ?? "读取 goodcase 失败");
      if (!batchRes.ok) throw new Error(batchData.detail ?? batchData.error ?? "读取 sample batch 失败");

      setBadcases(badData.cases ?? []);
      setGoodcases(goodData.cases ?? []);
      setSampleBatches(batchData.sampleBatches ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "读取 Benchmark 数据失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const activeBadcases = useMemo(
    () => badcases.filter((item) => ACTIVE_REVIEW_STATUSES.has(item.reviewStatus ?? "auto_captured")),
    [badcases],
  );
  const activeGoodcases = useMemo(
    () => goodcases.filter((item) => ACTIVE_REVIEW_STATUSES.has(item.reviewStatus ?? "auto_captured")),
    [goodcases],
  );
  const pendingCases = useMemo(
    () => badcases.filter((item) => item.source === "auto_fn" || item.source === "auto_uncertainty"),
    [badcases],
  );
  const dimensionRows = useMemo(() => buildDimensionRows([...activeBadcases, ...activeGoodcases]), [
    activeBadcases,
    activeGoodcases,
  ]);

  async function createSampleBatch() {
    setCreating(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/eval-datasets/sample-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedGoodcaseCount: 8,
          requestedBadcaseCount: 12,
          strategy: "benchmark_dashboard_default",
          seed: `benchmark_${Date.now()}`,
          persist: true,
        }),
      });
      const data = (await response.json()) as { sampleBatch?: SampleBatchRecord; error?: string; detail?: string };
      if (!response.ok || !data.sampleBatch) {
        throw new Error(data.detail ?? data.error ?? "生成 sample batch 失败");
      }
      setNotice(`已生成固定回归集 ${data.sampleBatch.sampleBatchId}。`);
      await loadData();
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "生成 sample batch 失败");
    } finally {
      setCreating(false);
    }
  }

  const latestBatch = sampleBatches[0];
  const coverageScore = dimensionRows.length
    ? Math.round((dimensionRows.filter((row) => row.total >= 3).length / dimensionRows.length) * 100)
    : 0;

  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Benchmark</span>
            <h1>可复用回归集</h1>
            <p>把已经校准的 badcase / goodcase 固化成发布前必须通过的测试集。</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void loadData()}>
              {loading ? "刷新中..." : "刷新"}
            </button>
            <button className={styles.primaryButton} type="button" disabled={creating} onClick={() => void createSampleBatch()}>
              {creating ? "生成中..." : "生成固定回归集"}
            </button>
          </div>
        </section>

        {error ? <p className={styles.error}>{error}</p> : null}
        {notice ? <p className={styles.notice}>{notice}</p> : null}

        <section className={styles.metricGrid}>
          <MetricCard label="Coverage" value={`${coverageScore}%`} detail="维度下至少 3 条 case 视为可回归" />
          <MetricCard label="Badcase Pool" value={String(activeBadcases.length)} detail={`${badcases.length} 条已捕获`} />
          <MetricCard label="Goodcase Pool" value={String(activeGoodcases.length)} detail={`${goodcases.length} 条正例`} />
          <MetricCard label="Pending Review" value={String(pendingCases.length)} detail="FN / Uncertainty 阻塞入池" tone={pendingCases.length ? "warn" : "ok"} />
        </section>

        <section className={styles.layout}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>能力维度覆盖</h2>
                <p>优先补齐 total &lt; 3 的维度；它们不适合做发布门禁。</p>
              </div>
              <Link href="/datasets" className={styles.textButton}>去校准案例</Link>
            </div>
            <div className={styles.table}>
              <div className={styles.tableHead}>
                <span>Dimension</span>
                <span>Bad</span>
                <span>Good</span>
                <span>Status</span>
              </div>
              {dimensionRows.length > 0 ? (
                dimensionRows.slice(0, 12).map((row) => (
                  <div className={styles.tableRow} key={row.dimension}>
                    <strong>{row.dimension}</strong>
                    <span>{row.bad}</span>
                    <span>{row.good}</span>
                    <em className={row.total >= 3 ? styles.statusReady : styles.statusWeak}>
                      {row.total >= 3 ? "ready" : "thin"}
                    </em>
                  </div>
                ))
              ) : (
                <div className={styles.empty}>暂无已校准 case。先在评估页沉淀案例，再到案例校准页确认。</div>
              )}
            </div>
          </article>

          <aside className={styles.sideStack}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>最新回归集</h2>
                  <p>用于在线回放和调优包 gate。</p>
                </div>
              </div>
              {latestBatch ? (
                <div className={styles.batchCard}>
                  <strong>{latestBatch.sampleBatchId}</strong>
                  <span>{latestBatch.caseIds.length} cases · bad {latestBatch.actualBadcaseCount ?? latestBatch.requestedBadcaseCount} / good {latestBatch.actualGoodcaseCount ?? latestBatch.requestedGoodcaseCount}</span>
                  <small>{latestBatch.createdAt}</small>
                  <Link href="/online-eval" className={styles.primaryLink}>跑回放验证</Link>
                </div>
              ) : (
                <div className={styles.empty}>还没有固定回归集。</div>
              )}
            </article>

            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>缺口动作</h2>
                  <p>Benchmark 不够稳定时先补覆盖。</p>
                </div>
              </div>
              <div className={styles.actionList}>
                <Link href="/datasets" className={styles.actionItem}>
                  <strong>处理待确认</strong>
                  <span>{pendingCases.length} 条待人工判断</span>
                </Link>
                <Link href="/synthesize" className={styles.actionItem}>
                  <strong>合成补样本</strong>
                  <span>为薄弱能力维度生成候选 case</span>
                </Link>
                <Link href="/remediation-packages" className={styles.actionItem}>
                  <strong>绑定调优包</strong>
                  <span>把 sample batch 变成发布 gate</span>
                </Link>
              </div>
            </article>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}

function MetricCard(props: { label: string; value: string; detail: string; tone?: "ok" | "warn" }) {
  return (
    <article className={`${styles.metricCard} ${props.tone === "warn" ? styles.metricWarn : ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}

function buildDimensionRows(cases: DatasetCaseRecord[]) {
  const rows = new Map<string, { dimension: string; bad: number; good: number; total: number }>();
  for (const item of cases) {
    const dimension = item.capabilityDimension || item.tags[0] || item.topicLabel || "uncategorized";
    const current = rows.get(dimension) ?? { dimension, bad: 0, good: 0, total: 0 };
    if (item.caseSetType === "badcase") current.bad += 1;
    if (item.caseSetType === "goodcase") current.good += 1;
    current.total += 1;
    rows.set(dimension, current);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}
