/**
 * @fileoverview Graph visualization for benchmark rubric.
 *
 * Renders rubric as a node-link diagram with a vertical tree layout:
 *   Rubric (root)
 *     → Modules (capability nodes)
 *       → Metrics (metric nodes)
 *         → Evaluator type (small dot)
 *
 * Auto-centers root, keeps all nodes in viewBox, and supports hover/click.
 */

import { useMemo, useRef, useState, useEffect } from "react";
import type { BenchmarkRubricMetric, BenchmarkRubricModule, BenchmarkRubricSet } from "@/benchmark/types";
import styles from "./benchmarkConsole.module.css";

/* ── Types ──────────────────────────────────────────────────────────── */

type NodeType = "root" | "module" | "metric" | "evaluator";

type GraphNode = {
  id: string;
  type: NodeType;
  label: string;
  sublabel?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  metric?: BenchmarkRubricMetric;
  module?: BenchmarkRubricModule;
  status?: "unreviewed" | "reviewed" | "modified" | "highlighted";
};

type GraphEdge = {
  from: string;
  to: string;
};

type GraphLayout = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  viewBox: string;
  svgWidth: number;
  svgHeight: number;
};

/* ── Colors ─────────────────────────────────────────────────────────── */

const EVAL_COLORS: Record<string, string> = {
  exact_match: "#14b8a6",
  regex_match: "#3b82f6",
  llm_judge: "#f59e0b",
  human_label: "#ef4444",
  numeric_tolerance: "#8b5cf6",
  f1_match: "#ec4899",
  code_exec: "#6366f1",
  unit_test: "#06b6d4",
  environment_state_test: "#84cc16",
  hybrid: "#a855f7",
};

const STATUS = {
  unreviewed: { stroke: "#94a3b8", fill: "#f8fafc", text: "#475569" },
  reviewed: { stroke: "#14b8a6", fill: "#f0fdfa", text: "#0f766e" },
  modified: { stroke: "#f59e0b", fill: "#fffbeb", text: "#92400e" },
  highlighted: { stroke: "#7c3aed", fill: "#f5f3ff", text: "#5b21b6" },
};

const EVALUATOR_NAME_ZH: Record<string, string> = {
  exact_match: "精确匹配",
  regex_match: "格式匹配",
  numeric_tolerance: "数值容差",
  f1_match: "覆盖率匹配",
  code_exec: "代码执行",
  unit_test: "单元测试",
  environment_state_test: "环境检测",
  llm_judge: "模型评审",
  human_label: "人工标注",
  hybrid: "混合评估",
};

const METRIC_NAME_ZH: Record<string, string> = {
  task_success: "任务完成度",
  decision_accuracy: "筛选决策准确率",
  entity_f1: "关键信息覆盖率",
  output_schema_valid: "输出格式合规性",
  reason_alignment: "理由一致性",
  citation_accuracy: "证据准确性",
  tool_call_success: "工具调用成功率",
  runtime_within_budget: "运行效率达标率",
  policy_safe: "安全与合规性",
  business_acceptance: "业务可接受度",
};

const CAPABILITY_NAME_ZH: Record<string, string> = {
  task_completion: "任务完成",
  instruction_following: "指令遵循",
  factual_grounding: "事实依据",
  data_extraction: "信息抽取",
  reasoning_quality: "推理质量",
  tool_use_correctness: "工具使用",
  format_compliance: "格式合规",
  latency_efficiency: "效率表现",
  safety_policy: "安全合规",
  business_judgment: "业务判断",
};

function hasChineseText(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function metricDisplayName(metric: BenchmarkRubricMetric): string {
  if (hasChineseText(metric.displayName)) return metric.displayName;
  return METRIC_NAME_ZH[metric.metricKey] ?? "自定义指标";
}

function capabilityDisplayName(module: BenchmarkRubricModule): string {
  if (hasChineseText(module.displayName)) return module.displayName;
  return CAPABILITY_NAME_ZH[module.capability] ?? "能力维度";
}

function evaluatorDisplayName(evaluatorType: string): string {
  return EVALUATOR_NAME_ZH[evaluatorType] ?? "自定义评估";
}

/* ── Layout constants ───────────────────────────────────────────────── */

const M = 28; // margin between groups
const LAYER_GAP = 52; // vertical gap between layers
const METRIC_W = 138;
const METRIC_H = 50;
const MODULE_W = 154;
const MODULE_H = 40;
const ROOT_W = 192;
const ROOT_H = 46;
const EVAL_R = 5; // evaluator dot radius
const MIN_ZOOM = 0.75;
const MAX_ZOOM = 2;
const ZOOM_STEP = 0.125;

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value));
}

/* ── Layout engine ──────────────────────────────────────────────────── */

function computeLayout(
  rubric: BenchmarkRubricSet,
  reviewed: Set<string>,
  modified: Set<string>,
  highlightedKey: string | null,
): GraphLayout {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  // --- Layer 3 (bottom): Metrics ---
  // Collect all metrics into groups by module
  const moduleGroups = rubric.modules.map((mod) => ({
    module: mod,
    metrics: mod.metrics,
    groupWidth: mod.metrics.length * METRIC_W + Math.max(0, mod.metrics.length - 1) * M,
  }));

  // Lay out metrics horizontally, left-to-right
  let cursorX = 0;
  const metricPositions: Record<string, { x: number; y: number }> = {};

  moduleGroups.forEach((g) => {
    g.metrics.forEach((metric, i) => {
      const x = cursorX + i * (METRIC_W + M);
      const y = 0; // bottom layer baseline (will shift later)
      metricPositions[metric.metricKey] = { x, y };
    });
    cursorX += g.groupWidth + M * 2; // gap between module groups
  });

  const totalMetricsWidth = cursorX - M * 2; // remove trailing gap

  // --- Layer 2: Modules ---
  // Center each module above its metrics group
  const modulePositions: Record<string, { x: number; y: number }> = {};
  let groupCursor = 0;

  moduleGroups.forEach((g) => {
    const groupW = g.groupWidth;
    const modX = groupCursor + groupW / 2 - MODULE_W / 2;
    const modY = -(LAYER_GAP + MODULE_H);
    modulePositions[g.module.capability] = { x: modX, y: modY };
    groupCursor += groupW + M * 2;
  });

  // --- Layer 1: Root ---
  const rootX = totalMetricsWidth / 2 - ROOT_W / 2;
  const rootY = -(LAYER_GAP + MODULE_H) - (LAYER_GAP + ROOT_H);

  // --- Build nodes (top to bottom order for proper z-index feel) ---

  // Root
  nodes.push({
    id: "root",
    type: "root",
    label: hasChineseText(rubric.title) ? rubric.title : "评测任务评分标准",
    sublabel: `${rubric.modules.length} 个能力维度 · ${rubric.modules.reduce((s, m) => s + m.metrics.length, 0)} 项指标`,
    x: rootX,
    y: rootY,
    width: ROOT_W,
    height: ROOT_H,
  });

  // Modules
  rubric.modules.forEach((mod) => {
    const pos = modulePositions[mod.capability];
    nodes.push({
      id: `mod-${mod.capability}`,
      type: "module",
      label: capabilityDisplayName(mod),
      sublabel: `权重 ${mod.weight}`,
      x: pos.x,
      y: pos.y,
      width: MODULE_W,
      height: MODULE_H,
      module: mod,
    });
    edges.push({ from: "root", to: `mod-${mod.capability}` });
  });

  // Metrics + Evaluators
  rubric.modules.forEach((mod) => {
    mod.metrics.forEach((metric) => {
      const pos = metricPositions[metric.metricKey];

      let status: GraphNode["status"] = "unreviewed";
      if (highlightedKey === metric.metricKey) status = "highlighted";
      else if (modified.has(metric.metricKey)) status = "modified";
      else if (reviewed.has(metric.metricKey)) status = "reviewed";

      nodes.push({
        id: `metric-${metric.metricKey}`,
        type: "metric",
        label: metricDisplayName(metric),
        sublabel: `权重 ${metric.weight} · ${evaluatorDisplayName(metric.evaluatorType)}`,
        x: pos.x,
        y: pos.y,
        width: METRIC_W,
        height: METRIC_H,
        metric,
        status,
      });
      edges.push({ from: `mod-${mod.capability}`, to: `metric-${metric.metricKey}` });

      // Evaluator dot below metric
      nodes.push({
        id: `eval-${metric.metricKey}`,
        type: "evaluator",
        label: "",
        x: pos.x + METRIC_W / 2 - EVAL_R,
        y: pos.y + METRIC_H + 10,
        width: EVAL_R * 2,
        height: EVAL_R * 2,
      });
      edges.push({ from: `metric-${metric.metricKey}`, to: `eval-${metric.metricKey}` });
    });
  });

  // --- Normalize coordinates: shift everything into positive space ---
  const allX = nodes.map((n) => n.x);
  const allY = nodes.map((n) => n.y);
  const minX = Math.min(...allX);
  const minY = Math.min(...allY);
  const maxX = Math.max(...allX.map((x, i) => x + nodes[i].width));
  const maxY = Math.max(...allY.map((y, i) => y + nodes[i].height));

  const pad = 24;
  const shiftX = -minX + pad;
  const shiftY = -minY + pad;

  nodes.forEach((n) => {
    n.x += shiftX;
    n.y += shiftY;
  });

  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  return {
    nodes,
    edges,
    viewBox: `0 0 ${vbW} ${vbH}`,
    svgWidth: vbW,
    svgHeight: vbH,
  };
}

/* ── Helper: edge intersection with rectangle ───────────────────────── */

function edgePoints(
  from: GraphNode,
  to: GraphNode,
): { x1: number; y1: number; x2: number; y2: number } {
  const fromCx = from.x + from.width / 2;
  const fromCy = from.y + from.height / 2;
  const toCx = to.x + to.width / 2;
  const toCy = to.y + to.height / 2;

  // Determine which side of `from` to exit from
  // and which side of `to` to enter
  const dx = toCx - fromCx;
  const dy = toCy - fromCy;

  // From node: bottom edge (since layout is top-down)
  const x1 = fromCx + (dx * (from.height / 2)) / Math.abs(dy || 1);
  const y1 = from.y + from.height;
  // Clamp to within node width
  const x1Clamped = Math.max(from.x + 4, Math.min(from.x + from.width - 4, x1));

  // To node: top edge
  const x2 = toCx - (dx * (to.height / 2)) / Math.abs(dy || 1);
  const y2 = to.y;
  const x2Clamped = Math.max(to.x + 4, Math.min(to.x + to.width - 4, x2));

  return { x1: x1Clamped, y1, x2: x2Clamped, y2 };
}

/* ── Component ──────────────────────────────────────────────────────── */

export function RubricGraphView(props: {
  rubric: BenchmarkRubricSet;
  reviewedMetricKeys: Set<string>;
  modifiedMetricKeys: Set<string>;
  highlightedMetricKey: string | null;
  selectedMetricKeys: string[];
  onToggleMetric: (metricKey: string) => void;
  onSelectMetric: (metricKey: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  const layout = useMemo(
    () =>
      computeLayout(
        props.rubric,
        props.reviewedMetricKeys,
        props.modifiedMetricKeys,
        props.highlightedMetricKey,
      ),
    [props.rubric, props.reviewedMetricKeys, props.modifiedMetricKeys, props.highlightedMetricKey],
  );
  const { nodes, edges, viewBox, svgWidth, svgHeight } = layout;
  const renderedWidth = Math.max(svgWidth * zoom, 720);
  const renderedHeight = svgHeight * zoom;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      const direction = event.deltaY > 0 ? -1 : 1;
      setZoom((prev) => clampZoom(prev + direction * ZOOM_STEP));
    }

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);

  // Auto-scroll to highlighted metric
  useEffect(() => {
    if (props.highlightedMetricKey && svgRef.current) {
      const node = nodes.find((n) => n.metric?.metricKey === props.highlightedMetricKey);
      if (node) {
        const container = svgRef.current.parentElement;
        if (container) {
          const scrollLeft = node.x - container.clientWidth / 2 + node.width / 2;
          container.scrollTo({ left: Math.max(0, scrollLeft), behavior: "smooth" });
        }
      }
    }
  }, [props.highlightedMetricKey, nodes]);

  function strokeFor(node: GraphNode) {
    if (node.status && node.type === "metric") return STATUS[node.status].stroke;
    if (node.type === "root") return "#7c3aed";
    if (node.type === "module") return "#475569";
    if (node.type === "evaluator") {
      const mk = node.id.replace("eval-", "");
      const m = nodes.find((n) => n.metric?.metricKey === mk)?.metric;
      return m ? EVAL_COLORS[m.evaluatorType] ?? "#94a3b8" : "#94a3b8";
    }
    return "#94a3b8";
  }

  function fillFor(node: GraphNode) {
    if (node.status && node.type === "metric") return STATUS[node.status].fill;
    if (node.type === "root") return "#f5f3ff";
    if (node.type === "module") return "#f8fafc";
    return "#ffffff";
  }

  function textColor(node: GraphNode) {
    if (node.status && node.type === "metric") return STATUS[node.status].text;
    return "#0f172a";
  }

  function isApproved(node: GraphNode) {
    return node.metric ? props.selectedMetricKeys.includes(node.metric.metricKey) : false;
  }

  return (
    <div ref={containerRef} className={styles.rubricGraphContainer}>
      <svg
        ref={svgRef}
        width={renderedWidth}
        height={renderedHeight}
        viewBox={viewBox}
        preserveAspectRatio="xMidYMid meet"
        className={styles.rubricGraphSvg}
        style={{ minWidth: "100%" }}
      >
        <defs>
          <marker id="ah" markerWidth="6" markerHeight="4" refX="5" refY="2" orient="auto">
            <polygon points="0 0, 6 2, 0 4" fill="#cbd5e1" />
          </marker>
          <filter id="sd">
            <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#000" floodOpacity="0.05" />
          </filter>
        </defs>

        {/* Edges (rendered before nodes so they appear behind) */}
        {edges.map((edge, i) => {
          const fromNode = nodes.find((n) => n.id === edge.from)!;
          const toNode = nodes.find((n) => n.id === edge.to)!;
          const { x1, y1, x2, y2 } = edgePoints(fromNode, toNode);
          const isHl = hovered === edge.from || hovered === edge.to;

          return (
            <line
              key={`e-${i}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={isHl ? "#7c3aed" : "#cbd5e1"}
              strokeWidth={isHl ? 2 : 1.2}
              opacity={isHl ? 0.9 : 0.6}
              markerEnd={toNode.type === "evaluator" ? undefined : "url(#ah)"}
            />
          );
        })}

        {/* Nodes */}
        {nodes.map((node) => {
          const isHover = hovered === node.id;
          const s = strokeFor(node);
          const f = fillFor(node);
          const tc = textColor(node);
          const approved = isApproved(node);

          // Evaluator dot
          if (node.type === "evaluator") {
            return (
              <circle
                key={node.id}
                cx={node.x + node.width / 2}
                cy={node.y + node.height / 2}
                r={EVAL_R}
                fill={s}
                opacity={0.85}
              />
            );
          }

          const rx = node.type === "root" ? 10 : 7;
          const labelTrunc =
            node.type !== "root" && node.label.length > 16
              ? node.label.slice(0, 15) + "…"
              : node.label;

          return (
            <g
              key={node.id}
              onMouseEnter={() => setHovered(node.id)}
              onMouseLeave={() => setHovered(null)}
              onClick={() => {
                if (node.type === "metric" && node.metric) {
                  props.onSelectMetric(node.metric.metricKey);
                }
              }}
              style={{ cursor: node.type === "metric" ? "pointer" : "default" }}
            >
              {/* Shadow + fill */}
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={rx}
                ry={rx}
                fill={f}
                stroke={isHover ? "#7c3aed" : s}
                strokeWidth={isHover ? 2.5 : node.status === "highlighted" ? 2 : 1.5}
                filter={isHover ? "url(#sd)" : undefined}
              />

              {/* Checkbox (metrics only) */}
              {node.type === "metric" && node.metric && (
                <g
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onToggleMetric(node.metric!.metricKey);
                  }}
                >
                  <rect
                    x={node.x + 8}
                    y={node.y + 8}
                    width={13}
                    height={13}
                    rx={3}
                    fill={approved ? "#14b8a6" : "transparent"}
                    stroke={approved ? "#14b8a6" : "#cbd5e1"}
                    strokeWidth={1.5}
                    style={{ cursor: "pointer" }}
                  />
                  {approved && (
                    <text
                      x={node.x + 11}
                      y={node.y + 19}
                      fontSize="9"
                      fill="white"
                      fontWeight="bold"
                      style={{ pointerEvents: "none" }}
                    >
                      ✓
                    </text>
                  )}
                </g>
              )}

              {/* Main label */}
              <text
                x={node.x + (node.type === "metric" ? 26 : node.width / 2)}
                y={node.y + (node.type === "root" ? 20 : node.type === "module" ? 19 : 17)}
                textAnchor={node.type === "metric" ? "start" : "middle"}
                fontSize={node.type === "root" ? 12 : node.type === "module" ? 11 : 10}
                fontWeight={node.type === "root" ? 700 : 600}
                fill={tc}
                style={{ fontFamily: "inherit", pointerEvents: "none" }}
              >
                {labelTrunc}
              </text>

              {/* Sublabel */}
              {node.sublabel && (
                <text
                  x={node.x + (node.type === "metric" ? 26 : node.width / 2)}
                  y={node.y + (node.type === "root" ? 35 : node.type === "module" ? 32 : 30)}
                  textAnchor={node.type === "metric" ? "start" : "middle"}
                  fontSize={9}
                  fill="#94a3b8"
                  style={{ fontFamily: "inherit", pointerEvents: "none" }}
                >
                  {node.sublabel}
                </text>
              )}

              {/* Status dot (top-right of metric) */}
              {node.type === "metric" && node.status && (
                <circle
                  cx={node.x + node.width - 7}
                  cy={node.y + 7}
                  r={3.5}
                  fill={STATUS[node.status].stroke}
                  style={{ pointerEvents: "none" }}
                />
              )}
            </g>
          );
        })}
      </svg>

      {/* Legend */}
      <div className={styles.rubricGraphLegend}>
        <span>图例：</span>
        <span className={styles.legendItem}><i style={{ background: "#7c3aed" }} /> 评分标准</span>
        <span className={styles.legendItem}><i style={{ background: "#475569" }} /> 能力维度</span>
        <span className={styles.legendItem}><i style={{ background: "#14b8a6" }} /> 已校验</span>
        <span className={styles.legendItem}><i style={{ background: "#f59e0b" }} /> 已修改</span>
        <span className={styles.legendItem}><i style={{ background: "#94a3b8" }} /> 待校验</span>
      </div>
    </div>
  );
}
