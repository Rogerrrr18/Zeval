/**
 * @fileoverview Predefined chart templates for MVP chart rendering.
 *
 * P1 重构：已移除 emotionCurve（依赖 emotionScore）和 topicSwitchFrequency（依赖 isTopicSwitch）。
 * 当前保留两个纯行为统计图表：dropoffDistribution 和 activeHourDistribution。
 */

import type { ChartKey } from "@/types/pipeline";

/**
 * Template declaration used by backend schema filler.
 */
export type ChartTemplate = {
  chartKey: ChartKey;
  title: string;
  chartType: "line" | "bar";
  schema: {
    xField: string;
    yField: string;
    seriesField?: string;
  };
  params: {
    dataSource: "enriched";
    groupBy: string[];
    aggregations: Array<{
      op: "count" | "avg" | "sum";
      field: string;
      as: string;
    }>;
    filters?: Array<{
      field: string;
      eq?: string | number | boolean;
      gte?: number;
      lte?: number;
    }>;
  };
};

/**
 * MVP default chart templates.
 */
export const CHART_TEMPLATES: ChartTemplate[] = [
  {
    chartKey: "dropoffDistribution",
    title: "流失断点",
    chartType: "bar",
    schema: {
      xField: "turnIndex",
      yField: "dropoffCount",
    },
    params: {
      dataSource: "enriched",
      groupBy: ["turnIndex"],
      aggregations: [{ op: "count", field: "isDropoffTurn", as: "dropoffCount" }],
      filters: [{ field: "isDropoffTurn", eq: true }],
    },
  },
  {
    chartKey: "activeHourDistribution",
    title: "活跃时段",
    chartType: "bar",
    schema: {
      xField: "activeHour",
      yField: "messageCount",
      seriesField: "role",
    },
    params: {
      dataSource: "enriched",
      groupBy: ["activeHour", "role"],
      aggregations: [{ op: "count", field: "content", as: "messageCount" }],
    },
  },
];
