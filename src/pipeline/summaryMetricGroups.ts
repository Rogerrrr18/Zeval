/**
 * @fileoverview Summary card grouping registry: categorize SummaryCard items into
 * top-level groups, and attach human-readable tooltips for each metric.
 *
 * This is intentionally separate from `src/pipeline/metricRegistry.ts` (which is
 * about the lower-level eval metric DAG). This file is purely about how the
 * workbench Summary panel should *render* its top-line cards.
 *
 * 一级分组（4 张大卡）：
 *   1. 对话质量    — 用户感受 / 沟通节奏
 *   2. 任务完成度  — 用户初始目标是否被解决
 *   3. 工具调用可用性 — agent 工具链路是否健康
 *   4. 风险信号    — 失败案例 / 投诉 / 高风险信号
 *
 * 不属于任一分组的卡片（如 sessionCount）放入 `"scale"` 杂项分组，作为 hero 数字单独显示。
 */

export type SummaryGroupId =
  | "dialogueQuality"
  | "taskCompletion"
  | "toolAvailability"
  | "riskSignal"
  | "scale";

export type SummaryGroupMeta = {
  id: SummaryGroupId;
  /** Top-level title shown on the big card. */
  title: string;
  /** One-line description shown under title. */
  description: string;
  /** Display order (lower first). */
  order: number;
};

export type SummaryMetricExplain = {
  /** Card key in `SummaryCard.key`. */
  key: string;
  /** Which top-level group this metric belongs to. */
  group: SummaryGroupId;
  /** One-line "what it means" — the body of the tooltip. */
  oneLineExplain: string;
  /** Concise computation formula (plain language, not math). */
  formula: string;
  /** Threshold / warning hint (optional). */
  threshold?: string;
};

export const SUMMARY_GROUPS: SummaryGroupMeta[] = [
  {
    id: "scale",
    title: "评估规模",
    description: "本批数据进入评估的体量",
    order: 0,
  },
  {
    id: "dialogueQuality",
    title: "对话质量",
    description: "用户感受 / 沟通节奏 / 情绪与共情",
    order: 1,
  },
  {
    id: "taskCompletion",
    title: "任务完成度",
    description: "用户初始目标是否被解决",
    order: 2,
  },
  {
    id: "toolAvailability",
    title: "工具调用可用性",
    description: "agent 工具链路是否健康",
    order: 3,
  },
  {
    id: "riskSignal",
    title: "风险信号",
    description: "失败案例 / 投诉 / 高风险项",
    order: 4,
  },
];

const SUMMARY_METRICS: SummaryMetricExplain[] = [
  {
    key: "sessionCount",
    group: "scale",
    oneLineExplain: "本次评估共纳入多少个独立会话（session）。",
    formula: "按 sessionId 唯一计数。",
  },
  {
    key: "emotion",
    group: "dialogueQuality",
    oneLineExplain: "用户在整段对话中的平均情绪分（0-100，越高越正向）。",
    formula: "对每个 segment 跑情绪打分模型，对所有 segment 取均值；降级模式下使用关键词规则近似。",
    threshold: "建议阈值 ≥ 60；< 40 视为情绪偏负，需要关注。",
  },
  {
    key: "empathy",
    group: "dialogueQuality",
    oneLineExplain: "助手在回复中表现出的共情程度（0-5 分）。",
    formula: "由 G-Eval 主观维度给出，结合关键词与 LLM 判定。",
    threshold: "≥ 3 分视为及格；2 分以下需要补共情话术。",
  },
  {
    key: "responseGap",
    group: "dialogueQuality",
    oneLineExplain: "助手回复用户消息的平均时间间隔。",
    formula: "对每个相邻 user→assistant 消息对计算时间差，取均值。",
    threshold: "ToB 客服建议 < 30s；> 60s 标记为长间隔风险。",
  },
  {
    key: "topicSwitch",
    group: "dialogueQuality",
    oneLineExplain: "助手回复中跳出当前用户提问主题的频率（0-1，越低越好）。",
    formula: "对每个 session 计数 segment 切换次数，除以总轮次。",
    threshold: "建议 ≤ 0.3；高于 0.5 表示助手频繁答非所问。",
  },
  {
    key: "goalCompletion",
    group: "taskCompletion",
    oneLineExplain: "用户初始目标被明确达成的比例。",
    formula: "(achieved 数 / 总 session 数) × 100%。状态来自 goal completion judge。",
    threshold: "ToB 客服建议 ≥ 70%；低于 50% 必须做调优。",
  },
  {
    key: "businessKpi",
    group: "taskCompletion",
    oneLineExplain: "当前业务场景下所有 KPI 维度的加权平均分。",
    formula: "对场景模板里每个 KPI 维度（响应时间 / 解决率 / 升级率等）打 0-1 分，加权平均。",
    threshold: "≥ 80% 视为达标。",
  },
  {
    key: "structuredEval",
    group: "toolAvailability",
    oneLineExplain: "本批数据中可被结构化标注追踪的 service call 数量。",
    formula: "统计 transcript 里所有可识别的 service_call 触发次数。",
  },
  {
    key: "serviceGrounding",
    group: "toolAvailability",
    oneLineExplain: "service call 的参数是否能在 dialogue state 中找到来源。",
    formula: "(参数能追溯到 state 的 service call / 总 service call) × 100%。",
    threshold: "≥ 90% 视为参数追溯链路健康。",
  },
  {
    key: "schemaCompliance",
    group: "toolAvailability",
    oneLineExplain: "service call 提供的 slot 是否在 schema 中被定义。",
    formula: "(命中 schema slot 的 service call / 总 service call) × 100%。",
    threshold: "≥ 95% 视为接入质量良好；未知 slot 需要排查。",
  },
  {
    key: "badCaseCount",
    group: "riskSignal",
    oneLineExplain: "已自动识别为失败、可沉淀进案例池的 topic 数量。",
    formula: "由 harvestBadCases 输出，规则信号（关键词 + 客观指标 + 隐式信号）命中即纳入。",
  },
  {
    key: "signals",
    group: "riskSignal",
    oneLineExplain: "隐式信号推断层标记为 high 严重度的信号数量。",
    formula: "subjectiveMetrics.signals 中 severity = 'high' 的项数。",
  },
  {
    key: "recoveryTrace",
    group: "riskSignal",
    oneLineExplain: "成功完成的「失败后恢复」弧线数量。",
    formula: "对每个失败 session 检查后续是否完成 apology→clarify→action 三段式恢复。",
  },
];

const SUMMARY_BY_KEY: Record<string, SummaryMetricExplain> = Object.fromEntries(
  SUMMARY_METRICS.map((entry) => [entry.key, entry]),
);

/**
 * Look up a metric explanation by card key.
 *
 * @param key Card key.
 * @returns Explain entry or undefined.
 */
export function getSummaryMetricExplain(key: string): SummaryMetricExplain | undefined {
  return SUMMARY_BY_KEY[key];
}

/**
 * Resolve which top-level group a metric key belongs to.
 *
 * @param key Card key.
 * @returns Group id; defaults to "scale" if unknown.
 */
export function getSummaryGroupForKey(key: string): SummaryGroupId {
  return SUMMARY_BY_KEY[key]?.group ?? "scale";
}
