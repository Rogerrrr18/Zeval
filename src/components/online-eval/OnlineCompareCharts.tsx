/**
 * @fileoverview Baseline vs online replay multi-chart comparison (Recharts).
 */

"use client";

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { EvaluateResponse } from "@/types/pipeline";
import styles from "./onlineEval.module.css";

type OnlineCompareChartsProps = {
  baseline: EvaluateResponse;
  current: EvaluateResponse;
};

/**
 * Render comparison charts for baseline vs replayed evaluation.
 * @param props Baseline and current evaluate payloads.
 * @returns Chart grid.
 */
export function OnlineCompareCharts(props: OnlineCompareChartsProps) {
  const { baseline, current } = props;
  const dimensionRows = buildDimensionCompareRows(baseline, current);
  const objectiveRows = buildObjectiveCompareRows(baseline, current);
  const signalRows = buildSignalCompareRows(baseline, current);

  return (
    <div className={styles.compareGrid}>
      <article className={styles.compareCard}>
        <h3>主观维度对比</h3>
        <p>同一套维度下 baseline 与在线回放后的聚合得分。</p>
        <div className={styles.chartCanvas}>
          <ResponsiveContainer width="100%" height={280} minHeight={280}>
            <BarChart data={dimensionRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
              <XAxis dataKey="name" stroke="#8ea0ba" tickLine={false} axisLine={false} interval={0} angle={-18} textAnchor="end" height={70} />
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
              <Bar dataKey="baseline" name="基线" fill="#6366f1" radius={[8, 8, 0, 0]} />
              <Bar dataKey="current" name="在线回放" fill="#38bdf8" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>

      <article className={styles.compareCard}>
        <h3>客观核心对比</h3>
        <p>话题切换率与平均响应间隔（秒）。</p>
        <div className={styles.chartCanvas}>
          <ResponsiveContainer width="100%" height={280} minHeight={280}>
            <BarChart data={objectiveRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
              <XAxis dataKey="name" stroke="#8ea0ba" tickLine={false} axisLine={false} />
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
        <p>三条隐式风险信号得分（0–100）。</p>
        <div className={styles.chartCanvas}>
          <ResponsiveContainer width="100%" height={280} minHeight={280}>
            <BarChart data={signalRows}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
              <XAxis dataKey="name" stroke="#8ea0ba" tickLine={false} axisLine={false} interval={0} angle={-12} textAnchor="end" height={64} />
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
  );
}

/**
 * @param baseline Baseline evaluate response.
 * @param current Current evaluate response.
 * @returns Rows for dimension bar chart.
 */
function buildDimensionCompareRows(
  baseline: EvaluateResponse,
  current: EvaluateResponse,
): Array<{ name: string; baseline: number; current: number }> {
  return baseline.subjectiveMetrics.dimensions.map((dimension) => {
    const matched = current.subjectiveMetrics.dimensions.find((item) => item.dimension === dimension.dimension);
    return {
      name: dimension.dimension,
      baseline: dimension.score,
      current: matched?.score ?? 0,
    };
  });
}

/**
 * @param baseline Baseline evaluate response.
 * @param current Current evaluate response.
 * @returns Rows for objective comparison.
 */
function buildObjectiveCompareRows(
  baseline: EvaluateResponse,
  current: EvaluateResponse,
): Array<{ name: string; baseline: number; current: number }> {
  return [
    {
      name: "平均响应间隔(s)",
      baseline: baseline.objectiveMetrics.avgResponseGapSec,
      current: current.objectiveMetrics.avgResponseGapSec,
    },
  ];
}

/**
 * @param baseline Baseline evaluate response.
 * @param current Current evaluate response.
 * @returns Rows for implicit signal comparison.
 */
function buildSignalCompareRows(
  baseline: EvaluateResponse,
  current: EvaluateResponse,
): Array<{ name: string; baseline: number; current: number }> {
  const keys = new Set<string>();
  baseline.subjectiveMetrics.signals.forEach((signal) => keys.add(signal.signalKey));
  current.subjectiveMetrics.signals.forEach((signal) => keys.add(signal.signalKey));
  return [...keys].map((key) => {
    const baseSignal = baseline.subjectiveMetrics.signals.find((signal) => signal.signalKey === key);
    const curSignal = current.subjectiveMetrics.signals.find((signal) => signal.signalKey === key);
    return {
      name: key,
      baseline: baseSignal?.score ?? 0,
      current: curSignal?.score ?? 0,
    };
  });
}
