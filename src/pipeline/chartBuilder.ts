/**
 * @fileoverview Build chart payloads from enriched rows.
 *
 * P1 重构：已移除 emotionCurve 和 topicSwitchFrequency 图表。
 * 当前保留两个纯行为统计图：dropoffDistribution 和 activeHourDistribution。
 */

import { CHART_TEMPLATES } from "@/config/chartTemplates";
import type { ChartPayload, EnrichedChatlogRow } from "@/types/pipeline";

/**
 * Build chart payloads from enriched rows.
 * @param rows Enriched rows.
 * @returns Chart payload array for frontend rendering.
 */
export function buildChartPayloads(rows: EnrichedChatlogRow[]): ChartPayload[] {
  return CHART_TEMPLATES.map((template) => {
    if (template.chartKey === "dropoffDistribution") {
      const distribution = rows
        .filter((row) => row.isDropoffTurn)
        .reduce<Record<string, number>>((acc, row) => {
          const key = String(row.turnIndex);
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
      return {
        chartKey: template.chartKey,
        title: template.title,
        description: "识别用户流失出现在哪些轮次，用于定位关键断点。",
        chartType: template.chartType,
        xField: template.schema.xField,
        yField: template.schema.yField,
        data: Object.entries(distribution).map(([turnIndex, dropoffCount]) => ({
          turnIndex: Number(turnIndex),
          dropoffCount,
        })),
      };
    }

    if (template.chartKey === "activeHourDistribution") {
      const distribution = rows.reduce<Record<string, number>>((acc, row) => {
        const key = `${row.activeHour ?? "unknown"}_${row.role}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      return {
        chartKey: template.chartKey,
        title: template.title,
        description: "展示用户活跃时段分布，区分 user/assistant 角色消息量。",
        chartType: template.chartType,
        xField: template.schema.xField,
        yField: template.schema.yField,
        seriesField: template.schema.seriesField,
        data: Object.entries(distribution).map(([key, messageCount]) => {
          const [activeHour, role] = key.split("_");
          return { activeHour: activeHour === "unknown" ? null : Number(activeHour), role, messageCount };
        }),
      };
    }

    // Fallback for any unrecognized template
    return {
      chartKey: template.chartKey,
      title: template.title,
      description: "",
      chartType: template.chartType,
      xField: template.schema.xField,
      yField: template.schema.yField,
      data: [],
    };
  });
}
