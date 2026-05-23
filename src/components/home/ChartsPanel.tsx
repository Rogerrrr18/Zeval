/**
 * @fileoverview P0 chart rendering panel using Recharts.
 */

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { ChartPayload } from "@/types/pipeline";
import styles from "./evalConsole.module.css";

const MAX_RENDERED_SERIES = 8;

/**
 * Render chart cards or an empty state.
 * @param props Chart panel props.
 * @returns Chart panel.
 */
export function ChartsPanel(props: { charts: ChartPayload[] }) {
  if (props.charts.length === 0) {
    return <div className={styles.emptyState}>完成评估后展示情绪、断点、活跃时段与话题切换图谱</div>;
  }

  return (
    <div className={styles.chartGrid}>
      {props.charts.map((chart) => (
        <article key={chart.chartKey} className={styles.chartCard}>
          <h3>{chart.title}</h3>
          <p>{chart.description}</p>
          <div className={styles.chartCanvas}>
            <ChartRenderer chart={chart} />
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Render one chart using Recharts.
 * @param props Chart props.
 * @returns Chart component.
 */
function ChartRenderer(props: { chart: ChartPayload }) {
  const { chart } = props;
  const rawSeriesKeys = chart.seriesField ? collectSeriesKeys(chart) : [chart.yField];
  const seriesKeys = rawSeriesKeys.slice(0, MAX_RENDERED_SERIES);
  const hiddenSeriesCount = Math.max(0, rawSeriesKeys.length - seriesKeys.length);
  const data = chart.seriesField ? pivotSeriesData(chart, seriesKeys) : chart.data;
  const isEmotionChart = chart.chartKey.toLowerCase().includes("emotion");
  const containerProps = {
    width: "100%" as const,
    height: 280,
    minWidth: 0,
    minHeight: 280,
  };

  if (chart.chartType === "line") {
    return (
      <div className={styles.chartRenderStack}>
        {hiddenSeriesCount > 0 ? (
          <div className={styles.chartSampleNotice}>
            图表显示前 {seriesKeys.length} 个会话，另有 {hiddenSeriesCount} 个会话已隐藏以避免图例溢出；完整数据仍保留在评估结果 JSON。
          </div>
        ) : null}
      <ResponsiveContainer {...containerProps}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
          <XAxis dataKey={chart.xField} stroke="#8ea0ba" tickLine={false} axisLine={false} />
          <YAxis
            stroke="#8ea0ba"
            tickLine={false}
            axisLine={false}
            domain={isEmotionChart ? [0, 100] : ["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{
              border: "1px solid rgba(148, 163, 184, 0.16)",
              borderRadius: "16px",
              backgroundColor: "rgba(9, 14, 28, 0.96)",
              boxShadow: "0 20px 40px rgba(2, 6, 23, 0.36)",
            }}
            labelStyle={{ color: "#f8fafc" }}
          />
          {chart.seriesField && seriesKeys.length <= 4 ? <Legend wrapperStyle={{ color: "#9fb0c9" }} /> : null}
          {seriesKeys.map((seriesKey, index) => (
            <Line
              key={seriesKey}
              type="monotone"
              dataKey={seriesKey}
              stroke={LINE_COLORS[index % LINE_COLORS.length]}
              strokeWidth={2.5}
              dot={false}
              activeDot={{ r: 4, fill: "#f8fafc", stroke: LINE_COLORS[index % LINE_COLORS.length] }}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
      </div>
    );
  }

  return (
    <div className={styles.chartRenderStack}>
      {hiddenSeriesCount > 0 ? (
        <div className={styles.chartSampleNotice}>
          图表显示前 {seriesKeys.length} 个系列，另有 {hiddenSeriesCount} 个系列已隐藏；完整数据仍保留在评估结果 JSON。
        </div>
      ) : null}
    <ResponsiveContainer {...containerProps}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#243041" vertical={false} />
        <XAxis dataKey={chart.xField} stroke="#8ea0ba" tickLine={false} axisLine={false} />
        <YAxis stroke="#8ea0ba" tickLine={false} axisLine={false} />
        <Tooltip
          contentStyle={{
            border: "1px solid rgba(148, 163, 184, 0.16)",
            borderRadius: "16px",
            backgroundColor: "rgba(9, 14, 28, 0.96)",
            boxShadow: "0 20px 40px rgba(2, 6, 23, 0.36)",
          }}
          labelStyle={{ color: "#f8fafc" }}
        />
        {chart.seriesField && seriesKeys.length <= 4 ? <Legend wrapperStyle={{ color: "#9fb0c9" }} /> : null}
        {seriesKeys.map((seriesKey, index) => (
          <Bar
            key={seriesKey}
            dataKey={seriesKey}
            fill={BAR_COLORS[index % BAR_COLORS.length]}
            radius={[8, 8, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
    </div>
  );
}

/**
 * Pivot series-based chart payload into recharts-friendly rows.
 * @param chart Chart payload.
 * @returns Pivoted chart data.
 */
function pivotSeriesData(
  chart: ChartPayload,
  allowedSeriesKeys?: string[],
): Array<Record<string, string | number | boolean | null>> {
  if (!chart.seriesField) {
    return chart.data;
  }

  const allowedSeries = allowedSeriesKeys ? new Set(allowedSeriesKeys) : null;
  const map = new Map<string, Record<string, string | number | boolean | null>>();
  chart.data.forEach((row) => {
    const xValue = String(row[chart.xField]);
    const seriesValue = String(row[chart.seriesField ?? "series"]);
    if (allowedSeries && !allowedSeries.has(seriesValue)) {
      return;
    }
    if (!map.has(xValue)) {
      map.set(xValue, { [chart.xField]: row[chart.xField] });
    }
    map.get(xValue)![seriesValue] = row[chart.yField];
  });

  return [...map.values()];
}

/**
 * Collect distinct series names from raw chart rows.
 * @param chart Chart payload.
 * @returns Unique series keys.
 */
function collectSeriesKeys(chart: ChartPayload): string[] {
  if (!chart.seriesField) {
    return [chart.yField];
  }
  return [...new Set(chart.data.map((row) => String(row[chart.seriesField!])))];
}

const LINE_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#f97316"];
const BAR_COLORS = ["#2563eb", "#0ea5e9", "#14b8a6", "#8b5cf6"];
