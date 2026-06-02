/**
 * @fileoverview Benchmark Mode console.
 */

"use client";

import { useMemo, useState } from "react";
import { AppShell } from "@/components/shell";
import type {
  BenchmarkCapabilityScore,
  BenchmarkLeaderboardRow,
  BenchmarkRubricMetric,
  BenchmarkRubricModule,
  BenchmarkRubricSet,
  BenchmarkRunResult,
} from "@/benchmark/types";
import styles from "./benchmarkConsole.module.css";

type RubricDraftResponse = {
  rubric?: BenchmarkRubricSet;
  reviewMarkdown?: string;
  source?: "llm" | "template";
  warnings?: string[];
  error?: string;
};

type HrDemoResponse = {
  result?: BenchmarkRunResult;
  caseAdmission?: {
    candidateCount: number;
    createdCaseIds: string[];
    skippedDuplicates: number;
  };
  error?: string;
};

const DEFAULT_REQUIREMENT = [
  "我们要评测 HR 简历筛选 Agent。",
  "输入是一段岗位 JD 和候选人简历。",
  "Agent 需要输出 select/reject、理由和证据。",
  "评测要关注筛选准确率、理由是否有证据、是否使用了受保护属性或隐私不当信息。",
].join("\n");

const DEFAULT_MATRIX = [
  { agentFramework: "claude_code", model: "deepseek-v4-flash", enabled: true },
  { agentFramework: "codex", model: "gpt-5.5", enabled: true },
  { agentFramework: "hermes", model: "gpt-5.4-mini", enabled: true },
  { agentFramework: "openclaw", model: "mimo-v2-flash", enabled: true },
] as const;

/**
 * Render Benchmark Mode.
 */
export function BenchmarkConsole() {
  const [title, setTitle] = useState("HR Resume Screening");
  const [description, setDescription] = useState("给真实业务任务生成 capability-based rubric，并比较不同 Agent 框架与模型组合。");
  const [requirementText, setRequirementText] = useState(DEFAULT_REQUIREMENT);
  const [useLlm, setUseLlm] = useState(false);
  const [rubric, setRubric] = useState<BenchmarkRubricSet | null>(null);
  const [selectedMetricKeys, setSelectedMetricKeys] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);
  const [runResult, setRunResult] = useState<BenchmarkRunResult | null>(null);

  const metrics = useMemo(() => rubric?.modules.flatMap((module) => module.metrics) ?? [], [rubric]);
  const selectedMetrics = useMemo(
    () => metrics.filter((metric) => selectedMetricKeys.includes(metric.metricKey)),
    [metrics, selectedMetricKeys],
  );

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
      setRubric(data.rubric);
      setSelectedMetricKeys(data.rubric.modules.flatMap((module) => module.metrics.map((metric) => metric.metricKey)));
      setWarnings(data.warnings ?? []);
      setNotice(`Rubric draft ready · source=${data.source ?? "template"}`);
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
      const data = (await response.json()) as HrDemoResponse;
      if (!response.ok || !data.result) {
        throw new Error(data.error ?? "HR demo 运行失败");
      }
      setRunResult(data.result);
      setNotice(`Run complete · ${data.result.summary.submissionCount} submissions · ${data.result.summary.metricResultCount} metric results`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "HR demo 运行失败");
    } finally {
      setRunning(false);
    }
  }

  function toggleMetric(metricKey: string) {
    setSelectedMetricKeys((current) =>
      current.includes(metricKey)
        ? current.filter((key) => key !== metricKey)
        : [...current, metricKey],
    );
  }

  return (
    <AppShell>
      <div className={styles.page}>
        <section className={styles.header}>
          <div>
            <span className={styles.eyebrow}>Benchmark Mode</span>
            <h1>真实业务任务评测</h1>
            <p>按 capability 组织 rubric，横向比较 Agent 框架与模型组合，并沉淀 badcase / goldencase。</p>
          </div>
          <div className={styles.actions}>
            <button className={styles.secondaryButton} type="button" disabled={drafting} onClick={() => void draftRubric()}>
              {drafting ? "生成中..." : "生成 Rubric"}
            </button>
            <button className={styles.primaryButton} type="button" disabled={running || !rubric} onClick={() => void runHrDemo()}>
              {running ? "评测中..." : "运行 HR Demo"}
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

        <section className={styles.metricGrid}>
          <MetricCard label="Metrics" value={String(selectedMetrics.length)} detail={`${metrics.length} candidate metrics`} />
          <MetricCard label="Capabilities" value={String(rubric?.modules.length ?? 0)} detail="用户确认后进入评测" />
          <MetricCard label="Matrix" value="4" detail="agent/model pairings for smoke" />
          <MetricCard
            label="Avg Score"
            value={runResult ? `${runResult.summary.averageScore}` : "—"}
            detail={runResult ? `${runResult.summary.badcaseCandidateCount} badcase candidates` : "等待运行"}
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
              <span className={styles.counter}>{selectedMetrics.length}/{metrics.length}</span>
            </div>
            {rubric ? (
              <div className={styles.rubricStack}>
                {rubric.modules.map((module) => (
                  <RubricModuleView
                    key={module.capability}
                    module={module}
                    selectedMetricKeys={selectedMetricKeys}
                    onToggle={toggleMetric}
                  />
                ))}
              </div>
            ) : (
              <div className={styles.empty}>先生成 rubric draft。</div>
            )}
          </article>
        </section>

        <section className={styles.layout}>
          <article className={styles.panel}>
            <div className={styles.panelHeader}>
              <div>
                <h2>Leaderboard</h2>
                <p>HR demo 目前使用确定性模拟提交，验证评测链路和排行榜聚合。</p>
              </div>
            </div>
            {runResult ? <LeaderboardTable rows={runResult.leaderboard} /> : <div className={styles.empty}>运行 HR demo 后展示结果。</div>}
          </article>

          <aside className={styles.sideStack}>
            <article className={styles.panel}>
              <div className={styles.panelHeader}>
                <div>
                  <h2>Capability Scores</h2>
                  <p>按第一名 Agent × Model 展示能力分。</p>
                </div>
              </div>
              {runResult?.leaderboard[0] ? (
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
              {runResult ? (
                <div className={styles.summaryList}>
                  <span><strong>{runResult.summary.caseCount}</strong> cases</span>
                  <span><strong>{runResult.summary.submissionCount}</strong> submissions</span>
                  <span><strong>{runResult.summary.needsHumanReviewCount}</strong> human-review metrics</span>
                  <span><strong>{runResult.summary.goldencaseCandidateCount}</strong> goldencase candidates</span>
                </div>
              ) : (
                <div className={styles.empty}>等待运行。</div>
              )}
            </article>
          </aside>
        </section>
      </div>
    </AppShell>
  );
}

function RubricModuleView(props: {
  module: BenchmarkRubricModule;
  selectedMetricKeys: string[];
  onToggle: (metricKey: string) => void;
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
          <MetricToggle
            key={metric.metricKey}
            metric={metric}
            checked={props.selectedMetricKeys.includes(metric.metricKey)}
            onToggle={() => props.onToggle(metric.metricKey)}
          />
        ))}
      </div>
    </section>
  );
}

function MetricToggle(props: { metric: BenchmarkRubricMetric; checked: boolean; onToggle: () => void }) {
  return (
    <label className={styles.metricToggle}>
      <input type="checkbox" checked={props.checked} onChange={props.onToggle} />
      <span>
        <strong>{props.metric.displayName}</strong>
        <small>{props.metric.evaluatorType} · weight {props.metric.weight} · {props.metric.metricKey}</small>
      </span>
      <em>{props.metric.humanApprovalRequired ? "human" : "auto"}</em>
    </label>
  );
}

function LeaderboardTable(props: { rows: BenchmarkLeaderboardRow[] }) {
  return (
    <div className={styles.leaderboardTable}>
      <div className={styles.leaderboardHead}>
        <span>Rank</span>
        <span>Agent</span>
        <span>Model</span>
        <span>Score</span>
        <span>Pass</span>
      </div>
      {props.rows.map((row, index) => (
        <div className={styles.leaderboardRow} key={`${row.agentFramework}:${row.model}`}>
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

function MetricCard(props: { label: string; value: string; detail: string; tone?: "ok" | "warn" }) {
  return (
    <article className={`${styles.metricCard} ${props.tone === "warn" ? styles.metricWarn : ""}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
      <small>{props.detail}</small>
    </article>
  );
}
