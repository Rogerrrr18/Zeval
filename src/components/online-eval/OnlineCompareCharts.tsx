/**
 * @fileoverview Baseline vs online replay multi-chart comparison with
 * delta indicators, win/loss verdicts, and overall win-rate summary.
 */

"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EvaluateResponse } from "@/types/pipeline";
import styles from "./onlineEval.module.css";

type OnlineCompareChartsProps = {
  baseline: EvaluateResponse;
  current: EvaluateResponse;
};

// ── Row types ─────────────────────────────────────────────────────────────────

type CompareRow = {
  name: string;
  baseline: number;
  current: number;
  /** current − baseline (may be negative). */
  delta: number;
  /** True when a lower value indicates improvement (e.g. response gap, error rate). */
  lowerIsBetter: boolean;
};

// ── Verdict helpers ───────────────────────────────────────────────────────────

type WinVerdict = "win" | "loss" | "tie";

/** Classify one row as win / loss / tie. */
function verdictOf(row: CompareRow): WinVerdict {
  const threshold = 0.01;
  if (Math.abs(row.delta) < threshold) return "tie";
  const improved = row.lowerIsBetter ? row.delta < 0 : row.delta > 0;
  return improved ? "win" : "loss";
}

type ComparisonSummary = {
  total: number;
  wins: number;
  losses: number;
  ties: number;
  winRate: number;
};

function buildSummary(rows: CompareRow[]): ComparisonSummary {
  const wins = rows.filter((r) => verdictOf(r) === "win").length;
  const losses = rows.filter((r) => verdictOf(r) === "loss").length;
  const ties = rows.filter((r) => verdictOf(r) === "tie").length;
  const total = rows.length;
  return { total, wins, losses, ties, winRate: total > 0 ? wins / total : 0 };
}

// ── Sub-components ────────────────────────────────────────────────────────────

/** Overall win-rate summary bar shown at the top of the comparison. */
function ComparisonSummaryBar({ summary }: { summary: ComparisonSummary }) {
  const winPct = Math.round(summary.winRate * 100);
  const barColor = winPct >= 60 ? "#16a34a" : winPct >= 40 ? "#ca8a04" : "#dc2626";
  return (
    <div className={styles.compareSummaryBar}>
      <div className={styles.compareSummaryLabel}>
        <span>总览</span>
        <strong style={{ color: barColor }}>{winPct}% 胜率</strong>
      </div>
      <div className={styles.compareSummaryStats}>
        <span className={styles.verdictWin}>↑ 改善 {summary.wins}</span>
        <span className={styles.verdictTie}>→ 持平 {summary.ties}</span>
        <span className={styles.verdictLoss}>↓ 回退 {summary.losses}</span>
        <span className={styles.compareSummaryTotal}>共 {summary.total} 项指标</span>
      </div>
      {/* Progress bar */}
      <div className={styles.winRateTrack}>
        <div
          className={styles.winRateFill}
          style={{ width: `${winPct}%`, background: barColor }}
          aria-label={`Win rate ${winPct}%`}
        />
      </div>
    </div>
  );
}

/** Single verdict badge. */
function VerdictBadge({ row }: { row: CompareRow }) {
  const v = verdictOf(row);
  const sign = row.delta >= 0 ? "+" : "";
  const deltaStr = `${sign}${row.delta.toFixed(2)}`;
  if (v === "win") return <span className={`${styles.verdictPill} ${styles.verdictPillWin}`}>{deltaStr}</span>;
  if (v === "loss") return <span className={`${styles.verdictPill} ${styles.verdictPillLoss}`}>{deltaStr}</span>;
  return <span className={`${styles.verdictPill} ${styles.verdictPillTie}`}>{deltaStr}</span>;
}

type DeltaTableProps = {
  dimensionRows: CompareRow[];
  objectiveRows: CompareRow[];
  signalRows: CompareRow[];
};

/** Render one metric group inside the delta comparison table. */
function DeltaTableSection({ title, rows }: { title: string; rows: CompareRow[] }) {
  if (rows.length === 0) return null;
  return (
    <>
      <tr className={styles.deltaTableGroupRow}>
        <td colSpan={5}>{title}</td>
      </tr>
      {rows.map((row) => (
        <tr key={row.name}>
          <td className={styles.deltaMetricName}>{row.name}</td>
          <td className={styles.deltaScore}>{row.baseline.toFixed(2)}</td>
          <td className={styles.deltaScore}>{row.current.toFixed(2)}</td>
          <td><VerdictBadge row={row} /></td>
          <td className={styles.deltaVerdict}>{verdictOf(row) === "win" ? "✅ 改善" : verdictOf(row) === "loss" ? "⚠ 回退" : "— 持平"}</td>
        </tr>
      ))}
    </>
  );
}

/** Tabular comparison of baseline vs current with deltas and verdicts. */
function DeltaTable(props: DeltaTableProps) {
  return (
    <div style={{ overflowX: "auto", marginTop: 18 }}>
      <table className={styles.deltaTable}>
        <thead>
          <tr>
            <th>指标</th>
            <th>基线</th>
            <th>在线</th>
            <th>变化</th>
            <th>判断</th>
          </tr>
        </thead>
        <tbody>
          <DeltaTableSection title="主观维度" rows={props.dimensionRows} />
          <DeltaTableSection title="客观指标" rows={props.objectiveRows} />
          <DeltaTableSection title="隐式信号" rows={props.signalRows} />
        </tbody>
      </table>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

/**
 * Render comparison charts + delta table + win-rate summary.
 * @param props Baseline and current evaluate payloads.
 */
export function OnlineCompareCharts(props: OnlineCompareChartsProps) {
  const { baseline, current } = props;

  const dimensionRows = buildDimensionCompareRows(baseline, current);
  const objectiveRows = buildObjectiveCompareRows(baseline, current);
  const signalRows = buildSignalCompareRows(baseline, current);
  const allRows = [...dimensionRows, ...objectiveRows, ...signalRows];
  const summary = buildSummary(allRows);

  return (
    <div>
      <ComparisonSummaryBar summary={summary} />
      <DeltaTable dimensionRows={dimensionRows} objectiveRows={objectiveRows} signalRows={signalRows} />

      <div className={styles.compareGrid} style={{ marginTop: 22 }}>
        <article className={styles.compareCard}>
          <h3>主观维度对比</h3>
          <p>同一套维度下 baseline 与在线回放后的聚合得分。</p>
          <div className={styles.chartCanvas}>
            <ResponsiveContainer width="100%" height={280} minHeight={280}>
              <BarChart data={dimensionRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#8ea0ba"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-18}
                  textAnchor="end"
                  height={70}
                />
                <YAxis stroke="#8ea0ba" tickLine={false} axisLine={false} domain={[0, 5]} />
                <Tooltip
                  contentStyle={{
                    border: "1px solid rgba(148, 163, 184, 0.16)",
                    borderRadius: "16px",
                    backgroundColor: "rgba(9, 14, 28, 0.96)",
                  }}
                  labelStyle={{ color: "#f8fafc" }}
                />
                <Legend wrapperStyle={{ color: "#9fb0c9" }} />
                <Bar dataKey="baseline" name="基线" fill="#6366f1" radius={[8, 8, 0, 0]} />
                <Bar dataKey="current" name="在线回放" fill="#38bdf8" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className={styles.compareCard}>
          <h3>客观核心对比</h3>
          <p>响应间隔(s)、重复提问率、升级关键词命中率、解决信号率。</p>
          <div className={styles.chartCanvas}>
            <ResponsiveContainer width="100%" height={280} minHeight={280}>
              <BarChart data={objectiveRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#8ea0ba"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-12}
                  textAnchor="end"
                  height={64}
                />
                <YAxis stroke="#8ea0ba" tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    border: "1px solid rgba(148, 163, 184, 0.16)",
                    borderRadius: "16px",
                    backgroundColor: "rgba(9, 14, 28, 0.96)",
                  }}
                  labelStyle={{ color: "#f8fafc" }}
                />
                <Legend wrapperStyle={{ color: "#9fb0c9" }} />
                <Bar dataKey="baseline" name="基线" fill="#a78bfa" radius={[8, 8, 0, 0]} />
                <Bar dataKey="current" name="在线回放" fill="#34d399" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>

        <article className={styles.compareCard}>
          <h3>隐式信号对比</h3>
          <p>隐式风险信号得分（分值越低风险越小）。</p>
          <div className={styles.chartCanvas}>
            <ResponsiveContainer width="100%" height={280} minHeight={280}>
              <BarChart data={signalRows}>
                <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
                <XAxis
                  dataKey="name"
                  stroke="#8ea0ba"
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  angle={-12}
                  textAnchor="end"
                  height={64}
                />
                <YAxis domain={[0, 100]} stroke="#8ea0ba" tickLine={false} axisLine={false} />
                <Tooltip
                  contentStyle={{
                    border: "1px solid rgba(148, 163, 184, 0.16)",
                    borderRadius: "16px",
                    backgroundColor: "rgba(9, 14, 28, 0.96)",
                  }}
                  labelStyle={{ color: "#f8fafc" }}
                />
                <Legend wrapperStyle={{ color: "#9fb0c9" }} />
                <Bar dataKey="baseline" name="基线" fill="#f97316" radius={[8, 8, 0, 0]} />
                <Bar dataKey="current" name="在线回放" fill="#fb7185" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </article>
      </div>
    </div>
  );
}

// ── Data builders ─────────────────────────────────────────────────────────────

function buildDimensionCompareRows(baseline: EvaluateResponse, current: EvaluateResponse): CompareRow[] {
  return baseline.subjectiveMetrics.dimensions.map((dimension) => {
    const matched = current.subjectiveMetrics.dimensions.find((item) => item.dimension === dimension.dimension);
    const cur = matched?.score ?? 0;
    return {
      name: dimension.dimension,
      baseline: dimension.score,
      current: cur,
      delta: cur - dimension.score,
      lowerIsBetter: false,
    };
  });
}

function buildObjectiveCompareRows(baseline: EvaluateResponse, current: EvaluateResponse): CompareRow[] {
  const b = baseline.objectiveMetrics;
  const c = current.objectiveMetrics;
  return [
    {
      name: "响应间隔(s)",
      baseline: b.avgResponseGapSec,
      current: c.avgResponseGapSec,
      delta: c.avgResponseGapSec - b.avgResponseGapSec,
      lowerIsBetter: true,
    },
    {
      name: "重复提问率",
      baseline: b.userQuestionRepeatRate,
      current: c.userQuestionRepeatRate,
      delta: c.userQuestionRepeatRate - b.userQuestionRepeatRate,
      lowerIsBetter: true,
    },
    {
      name: "升级词命中率",
      baseline: b.escalationKeywordHitRate,
      current: c.escalationKeywordHitRate,
      delta: c.escalationKeywordHitRate - b.escalationKeywordHitRate,
      lowerIsBetter: true,
    },
    {
      name: "解决信号率",
      baseline: b.agentResolutionSignalRate,
      current: c.agentResolutionSignalRate,
      delta: c.agentResolutionSignalRate - b.agentResolutionSignalRate,
      lowerIsBetter: false,
    },
  ];
}

function buildSignalCompareRows(baseline: EvaluateResponse, current: EvaluateResponse): CompareRow[] {
  const keys = new Set<string>();
  baseline.subjectiveMetrics.signals.forEach((signal) => keys.add(signal.signalKey));
  current.subjectiveMetrics.signals.forEach((signal) => keys.add(signal.signalKey));
  return [...keys].map((key) => {
    const baseSignal = baseline.subjectiveMetrics.signals.find((signal) => signal.signalKey === key);
    const curSignal = current.subjectiveMetrics.signals.find((signal) => signal.signalKey === key);
    const bVal = baseSignal?.score ?? 0;
    const cVal = curSignal?.score ?? 0;
    return {
      name: key,
      baseline: bVal,
      current: cVal,
      delta: cVal - bVal,
      lowerIsBetter: true, // risk signals: lower = better
    };
  });
}
