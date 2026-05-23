/**
 * @fileoverview Online evaluation page — 3-step guided flow (select baseline → run replay → compare).
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { ChartsPanel } from "@/components/home/ChartsPanel";
import { OnlineCompareCharts } from "@/components/online-eval/OnlineCompareCharts";
import { AppShell, Stepper, type StepperStep } from "@/components/shell";
import {
  TEMP_EVAL_SAMPLE_BADCASE_TARGET,
  TEMP_EVAL_SAMPLE_GOODCASE_TARGET,
} from "@/eval-datasets/sample-defaults";
import type { DatasetCaseRecord, SampleBatchRecord } from "@/eval-datasets/storage/types";
import type { EvaluateResponse } from "@/types/pipeline";
import styles from "./onlineEval.module.css";

const LAST_CUSTOMER_ID_KEY = "zeval:lastCustomerId";
const LEGACY_LAST_CUSTOMER_ID_KEY = "zerore:lastCustomerId";
const MOCK_REPLY_API_BASE_URL = "mock://customer-demo";

type BaselineIndexRow = {
  runId: string;
  createdAt: string;
  label?: string;
  sourceFileName?: string;
  fileName: string;
};

type ReplayApiResponse = {
  runId: string;
  replyEndpoint: string;
  replayedRowCount: number;
  baselineRunId?: string;
  baselineEvaluate?: EvaluateResponse;
  sampleBatch?: SampleBatchRecord;
  sampleCases?: DatasetCaseRecord[];
  sampleBaselineSummary?: {
    caseCount: number;
    badcaseCount: number;
    goodcaseCount: number;
    avgBaselineCaseScore: number;
    avgFailureSeverityScore: number;
  };
  evaluate: EvaluateResponse;
};

type SampleBatchListResponse = {
  sampleBatches: SampleBatchRecord[];
  count: number;
  error?: string;
  detail?: string;
};

const STEPS: StepperStep[] = [
  { key: "baseline", title: "1 · 选基线", hint: "客户 ID + 历史 run" },
  { key: "replay", title: "2 · 跑回放", hint: "新版本回复 API" },
  { key: "compare", title: "3 · 看对比", hint: "多指标 / winRate" },
];

/**
 * Render the online evaluation workspace as a 3-step flow.
 */
export function OnlineEvalConsole() {
  const [customerId, setCustomerId] = useState("default");
  const [baselines, setBaselines] = useState<BaselineIndexRow[]>([]);
  const [sampleBatches, setSampleBatches] = useState<SampleBatchRecord[]>([]);
  const [selectedRunId, setSelectedRunId] = useState("");
  const [selectedSampleBatchId, setSelectedSampleBatchId] = useState("");
  const [sourceMode, setSourceMode] = useState<"baseline" | "sampleBatch">("baseline");
  const [replyApiBaseUrl, setReplyApiBaseUrl] = useState(MOCK_REPLY_API_BASE_URL);
  const [loading, setLoading] = useState(false);
  const [loadingList, setLoadingList] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [replayResult, setReplayResult] = useState<ReplayApiResponse | null>(null);
  const [sampleBatchJson, setSampleBatchJson] = useState("");
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const stored =
      window.localStorage.getItem(LAST_CUSTOMER_ID_KEY) ??
      window.localStorage.getItem(LEGACY_LAST_CUSTOMER_ID_KEY);
    if (stored) {
      setCustomerId(stored);
    }
  }, []);

  const loadBaselines = useCallback(async () => {
    setLoadingList(true);
    setError("");
    try {
      const response = await fetch(`/api/workbench-baselines/${encodeURIComponent(customerId)}`);
      const data = (await response.json()) as { baselines?: BaselineIndexRow[]; error?: string };
      if (!response.ok) {
        throw new Error(data.error ?? "加载基线列表失败");
      }
      setBaselines(data.baselines ?? []);
      window.localStorage.setItem(LAST_CUSTOMER_ID_KEY, customerId);
      setNotice(`已加载 ${data.baselines?.length ?? 0} 条基线索引。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载失败");
    } finally {
      setLoadingList(false);
    }
  }, [customerId]);

  const loadSampleBatches = useCallback(async () => {
    setLoadingList(true);
    setError("");
    try {
      const response = await fetch("/api/eval-datasets/sample-batches");
      const data = (await response.json()) as SampleBatchListResponse;
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "加载 sample batch 失败");
      }
      setSampleBatches(data.sampleBatches ?? []);
      setNotice(`已加载 ${data.count ?? 0} 个 sample batch。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 sample batch 失败");
    } finally {
      setLoadingList(false);
    }
  }, []);

  async function handleReplay() {
    if (sourceMode === "baseline" && !selectedRunId) {
      setError("请先选择一条基线快照（含 rawRows）。");
      return;
    }
    if (sourceMode === "sampleBatch" && !selectedSampleBatchId) {
      setError("请先选择一个 sample batch。");
      return;
    }
    setLoading(true);
    setError("");
    setNotice("");
    setReplayResult(null);
    try {
      const response = await fetch("/api/online-eval/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baselineRef: sourceMode === "baseline" ? { customerId, runId: selectedRunId } : undefined,
          sampleBatchId: sourceMode === "sampleBatch" ? selectedSampleBatchId : undefined,
          replyApiBaseUrl: replyApiBaseUrl.trim() || undefined,
          useLlm: true,
        }),
      });
      const data = (await response.json()) as Partial<ReplayApiResponse> & { error?: string; detail?: string };
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "回放评估失败");
      }
      setReplayResult(data as ReplayApiResponse);
      setNotice(
        `回放完成：已用回复端点 ${data.replyEndpoint} 重写 assistant，共 ${data.replayedRowCount} 行参与评估。`,
      );
      setCurrentStep(2);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "回放失败");
    } finally {
      setLoading(false);
    }
  }

  async function handleSampleBatch() {
    setLoading(true);
    setError("");
    setSampleBatchJson("");
    try {
      const response = await fetch("/api/eval-datasets/sample-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedGoodcaseCount: TEMP_EVAL_SAMPLE_GOODCASE_TARGET,
          requestedBadcaseCount: TEMP_EVAL_SAMPLE_BADCASE_TARGET,
          seed: `online_${customerId}`,
          strategy: "stratified_random_v1_temp_eval",
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "创建 sample batch 失败");
      }
      setSampleBatchJson(JSON.stringify(data, null, 2));
      if (data.sampleBatch?.sampleBatchId) {
        setSampleBatches((current) => [data.sampleBatch, ...current.filter((item) => item.sampleBatchId !== data.sampleBatch.sampleBatchId)]);
        setSelectedSampleBatchId(data.sampleBatch.sampleBatchId);
        setSourceMode("sampleBatch");
      }
      setNotice("已生成临时评测集（不足 20 条亦会落盘并附 warnings）。");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "抽样失败");
    } finally {
      setLoading(false);
    }
  }

  const completedStep = (() => {
    if (replayResult) return 2;
    if ((sourceMode === "baseline" && selectedRunId) || (sourceMode === "sampleBatch" && selectedSampleBatchId)) return 1;
    return 0;
  })();

  function goToStep(index: number) {
    if (index < 0 || index >= STEPS.length) return;
    if (index > completedStep + 1) return;
    setCurrentStep(index);
  }

  return (
    <AppShell
      subheader={<Stepper steps={STEPS} current={currentStep} completed={completedStep} onSelect={goToStep} />}
    >
      <div className={styles.page}>
        <main className={styles.main}>
          <header className={styles.topBar}>
            <div className={styles.titleBlock}>
              <h1>在线评测</h1>
              <p>选基线 → 跑新版本回放 → 看多指标对比。任何指标回退都不会通过门禁。</p>
            </div>
          </header>

          {error ? <p className={styles.error}>{error}</p> : null}
          {notice ? <p className={styles.notice}>{notice}</p> : null}

          {currentStep === 0 ? (
            <>
              <section className={styles.stepIntro}>
                <h2>选择回放样本来源</h2>
                <p>可以选工作台保存的 baseline，也可以选案例池固定 sample batch。baseline 适合整批对比，sample batch 适合发布前回归。</p>
                <div className={styles.howTo}>
                  <span className={styles.howToTitle}>怎么用</span>
                  <span>① 选 baseline：输入 customerId 后刷新基线列表。</span>
                  <span>② 选 sample batch：刷新评测集批次，或直接生成临时评测集。</span>
                </div>
              </section>

              <section className={styles.panel}>
                <h2>样本来源</h2>
                <p>选择 baseline 或 sample batch；如还没保存基线，可在工作台「修复交付」里的结果归档区保存。</p>
                <div className={styles.modeSwitch}>
                  <button
                    type="button"
                    className={`${styles.modeButton} ${sourceMode === "baseline" ? styles.modeButtonActive : ""}`}
                    onClick={() => setSourceMode("baseline")}
                  >
                    Baseline Replay
                  </button>
                  <button
                    type="button"
                    className={`${styles.modeButton} ${sourceMode === "sampleBatch" ? styles.modeButtonActive : ""}`}
                    onClick={() => setSourceMode("sampleBatch")}
                  >
                    Sample Batch Replay
                  </button>
                </div>
                <div className={styles.formGrid}>
                  {sourceMode === "baseline" ? (
                    <>
                      <label className={styles.label}>
                        客户 ID（customerId）
                        <input
                          className={styles.input}
                          value={customerId}
                          onChange={(event) => setCustomerId(event.target.value)}
                          placeholder="如 default、tenant_a"
                        />
                      </label>
                      <label className={styles.label}>
                        选择基线（runId）
                        <select
                          className={styles.select}
                          value={selectedRunId}
                          onChange={(event) => setSelectedRunId(event.target.value)}
                          disabled={!baselines.length}
                        >
                          <option value="">— 请先加载列表 —</option>
                          {baselines.map((row) => (
                            <option key={row.fileName} value={row.runId}>
                              {row.runId} · {row.createdAt}
                              {row.label ? ` · ${row.label}` : ""}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : (
                    <label className={styles.label}>
                      选择 Sample Batch
                      <select
                        className={styles.select}
                        value={selectedSampleBatchId}
                        onChange={(event) => setSelectedSampleBatchId(event.target.value)}
                        disabled={!sampleBatches.length}
                      >
                        <option value="">— 请先加载 sample batch —</option>
                        {sampleBatches.map((batch) => (
                          <option key={batch.sampleBatchId} value={batch.sampleBatchId}>
                            {batch.sampleBatchId} · cases={batch.caseIds.length} · {batch.createdAt}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                <div className={styles.rowActions} style={{ marginTop: 14 }}>
                  {sourceMode === "baseline" ? (
                    <button
                      type="button"
                      className={styles.secondaryButton}
                      disabled={loadingList}
                      onClick={() => void loadBaselines()}
                    >
                      {loadingList ? "加载中…" : "刷新基线列表"}
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={loadingList}
                        onClick={() => void loadSampleBatches()}
                      >
                        {loadingList ? "加载中…" : "刷新 Sample Batch"}
                      </button>
                      <button
                        type="button"
                        className={styles.secondaryButton}
                        disabled={loading}
                        onClick={() => void handleSampleBatch()}
                      >
                        生成临时评测集（约 20 条）
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={sourceMode === "baseline" ? !selectedRunId : !selectedSampleBatchId}
                    onClick={() => goToStep(1)}
                  >
                    下一步：配置回放 →
                  </button>
                </div>
              </section>
            </>
          ) : null}

          {currentStep === 1 ? (
            <>
              <section className={styles.stepIntro}>
                <h2>配置新版本回复通道，跑回放</h2>
                <p>
                  填一个新版本的 Reply API 基址（留空走默认 mock 客户 API），系统会用基线对话作为输入逐条 ping 这个端点，重写
                  assistant 后再做一次完整评估。
                </p>
                <div className={styles.howTo}>
                  <span className={styles.howToTitle}>怎么用</span>
                  <span>① 填新版本回复 API 基址（POST /reply）；内置 mock 默认不依赖本地端口。</span>
                  <span>② 点「执行回放评估」，跑完会自动跳到「看对比」。</span>
                </div>
              </section>

              <section className={styles.panel}>
                <h2>回复通道 · 回放执行</h2>
                <p>
                  当前基线：
                  <strong>
                    {sourceMode === "baseline"
                      ? selectedRunId || "未选择"
                      : selectedSampleBatchId || "未选择"}
                  </strong>
                </p>
                <div className={styles.formGrid}>
                  <label className={styles.label}>
                    客户回复 API 基址
                    <input
                      className={styles.input}
                      value={replyApiBaseUrl}
                      onChange={(event) => setReplyApiBaseUrl(event.target.value)}
                      placeholder={MOCK_REPLY_API_BASE_URL}
                    />
                  </label>
                </div>
                <div className={styles.rowActions} style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className={styles.secondaryButton}
                    onClick={() => goToStep(0)}
                  >
                    ← 返回选基线
                  </button>
                  <button
                    type="button"
                    className={styles.primaryButton}
                    disabled={loading || (sourceMode === "baseline" ? !selectedRunId : !selectedSampleBatchId)}
                    onClick={() => void handleReplay()}
                  >
                    {loading ? "执行中…" : "执行回放评估"}
                  </button>
                </div>
                <ul className={styles.metaList} style={{ marginTop: 14 }}>
                  <li>系统会按选中样本的 user 轮逐条调用 Reply API，把 assistant 替换为新版本输出。</li>
                  <li>Sample batch 模式会从案例池 transcript 还原 rawRows，适合固定回归集。</li>
                </ul>
              </section>

              {sampleBatchJson ? (
                <section className={styles.panel}>
                  <h2>临时评测集</h2>
                  <p>
                    默认 good {TEMP_EVAL_SAMPLE_GOODCASE_TARGET} + bad {TEMP_EVAL_SAMPLE_BADCASE_TARGET}；池子不足时仍返回部分 case。
                  </p>
                  <pre className={styles.rawPreview}>{sampleBatchJson}</pre>
                </section>
              ) : null}
            </>
          ) : null}

          {currentStep === 2 ? (
            <>
              <section className={styles.stepIntro}>
                <h2>对比结果</h2>
                <p>基线或 sample batch vs 新版本的多指标对比、winRate 与图表。任何关键指标回退都应触发 fail。</p>
              </section>

              {replayResult?.sampleBaselineSummary ? (
                <section className={styles.panel}>
                  <h2>Sample Batch 基线摘要</h2>
                  <div className={styles.summaryGrid}>
                    <div>
                      <span>Cases</span>
                      <strong>{replayResult.sampleBaselineSummary.caseCount}</strong>
                    </div>
                    <div>
                      <span>Bad / Good</span>
                      <strong>
                        {replayResult.sampleBaselineSummary.badcaseCount}/
                        {replayResult.sampleBaselineSummary.goodcaseCount}
                      </strong>
                    </div>
                    <div>
                      <span>Avg Baseline</span>
                      <strong>{formatPercent(replayResult.sampleBaselineSummary.avgBaselineCaseScore)}</strong>
                    </div>
                    <div>
                      <span>Avg Severity</span>
                      <strong>{formatPercent(replayResult.sampleBaselineSummary.avgFailureSeverityScore)}</strong>
                    </div>
                  </div>
                </section>
              ) : null}

              {replayResult?.baselineEvaluate ? (
                <section className={styles.panel}>
                  <h2>多指标对比（基线 vs 在线回放）</h2>
                  <p>
                    基线 run：<strong>{replayResult.baselineEvaluate.runId}</strong> · 在线 run：
                    <strong>{replayResult.evaluate.runId}</strong>
                  </p>
                  <OnlineCompareCharts baseline={replayResult.baselineEvaluate} current={replayResult.evaluate} />
                </section>
              ) : null}

              {replayResult?.evaluate ? (
                <section className={styles.panel}>
                  <h2>在线回放 · 全量图表</h2>
                  <p>与工作台同款图表载荷，便于细节核对。</p>
                  <ChartsPanel charts={replayResult.evaluate.charts} />
                </section>
              ) : (
                <section className={styles.panel}>
                  <p>还没有回放结果。回到第 2 步执行一次回放。</p>
                  <div className={styles.rowActions} style={{ marginTop: 12 }}>
                    <button type="button" className={styles.secondaryButton} onClick={() => goToStep(1)}>
                      ← 回到第 2 步
                    </button>
                  </div>
                </section>
              )}

              <div className={styles.rowActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => goToStep(1)}>
                  ← 重新跑一次
                </button>
              </div>
            </>
          ) : null}
        </main>
      </div>
    </AppShell>
  );
}

/**
 * Format a normalized score as whole percent.
 * @param value Normalized score.
 * @returns Percent label.
 */
function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
