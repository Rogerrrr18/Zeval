/**
 * @fileoverview Compact baseline trend panel for recent saved evaluate runs.
 */

"use client";

import { useEffect, useState } from "react";
import type { EvaluateRunTrendPoint } from "@/persistence/evaluateRunStore";
import styles from "./baselineTrendPanel.module.css";

type TrendResponse = {
  points?: EvaluateRunTrendPoint[];
  error?: string;
  detail?: string;
};

const TREND_METRICS: Array<{
  key: keyof Pick<EvaluateRunTrendPoint, "emotionScore" | "goalCompletionRate" | "badCaseCount" | "businessKpiScore">;
  label: string;
  suffix: string;
  invert?: boolean;
}> = [
  { key: "emotionScore", label: "情绪分", suffix: "" },
  { key: "goalCompletionRate", label: "目标达成率", suffix: "%" },
  { key: "badCaseCount", label: "Bad Case", suffix: "", invert: true },
  { key: "businessKpiScore", label: "业务 KPI", suffix: "%" },
];

/**
 * Render recent baseline trends for the active customer id.
 *
 * @param props Customer id props.
 * @returns Trend panel.
 */
export function BaselineTrendPanel(props: { customerId: string }) {
  const [points, setPoints] = useState<EvaluateRunTrendPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function loadTrend() {
      if (!props.customerId.trim()) {
        setPoints([]);
        return;
      }
      setLoading(true);
      setError("");
      try {
        const response = await fetch(
          `/api/workbench-baselines/${encodeURIComponent(props.customerId.trim())}/trend?limit=8`,
        );
        const data = (await response.json()) as TrendResponse;
        if (!response.ok) {
          throw new Error(data.detail ?? data.error ?? "读取趋势失败");
        }
        if (!cancelled) {
          setPoints(data.points ?? []);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : "读取趋势失败");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadTrend();
    return () => {
      cancelled = true;
    };
  }, [props.customerId]);

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <div>
          <strong>基线趋势</strong>
          <span>{props.customerId || "default"} · 最近 {points.length} 次已保存评估</span>
        </div>
        <span className={styles.status}>{loading ? "同步中" : points.length >= 2 ? "可对比" : "样本不足"}</span>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
      {points.length < 2 ? (
        <p className={styles.empty}>保存至少 2 次工作台基线后，这里会显示情绪、目标达成、bad case 与业务 KPI 的走势。</p>
      ) : (
        <div className={styles.grid}>
          {TREND_METRICS.map((metric) => (
            <TrendMetric key={metric.key} metric={metric} points={points} />
          ))}
        </div>
      )}
    </div>
  );
}

function TrendMetric(props: {
  metric: (typeof TREND_METRICS)[number];
  points: EvaluateRunTrendPoint[];
}) {
  const values = props.points
    .map((point) => point[props.metric.key])
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  const latest = values.at(-1);
  const previous = values.at(-2);
  const delta = latest !== undefined && previous !== undefined ? latest - previous : 0;
  const goodDelta = props.metric.invert ? delta <= 0 : delta >= 0;
  return (
    <article className={styles.metric}>
      <div className={styles.metricTop}>
        <span>{props.metric.label}</span>
        <strong>{latest === undefined ? "--" : `${formatValue(latest)}${props.metric.suffix}`}</strong>
      </div>
      <Sparkline values={values} invert={props.metric.invert} />
      <small className={goodDelta ? styles.deltaGood : styles.deltaBad}>
        {previous === undefined ? "等待更多基线" : `${delta >= 0 ? "+" : ""}${formatValue(delta)}${props.metric.suffix}`}
      </small>
    </article>
  );
}

function Sparkline(props: { values: number[]; invert?: boolean }) {
  const points = buildSparklinePoints(props.values);
  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ");
  return (
    <svg className={styles.sparkline} viewBox="0 0 120 34" role="img" aria-label="趋势线">
      <path className={props.invert ? styles.sparklineInvert : styles.sparklinePath} d={path || "M 0 17 L 120 17"} />
    </svg>
  );
}

function buildSparklinePoints(values: number[]): Array<{ x: number; y: number }> {
  if (values.length === 0) {
    return [];
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values.map((value, index) => ({
    x: values.length === 1 ? 60 : (index / (values.length - 1)) * 120,
    y: 30 - ((value - min) / span) * 24,
  }));
}

function formatValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

