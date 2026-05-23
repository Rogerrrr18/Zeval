/**
 * @fileoverview Unified metric registry projection for objective, subjective and structured signals.
 */

import type {
  EvalMetricDefinition,
  EvalMetricRegistrySnapshot,
  EvalMetricResult,
  EvalRequiredField,
} from "@/types/eval-metric";
import type {
  ObjectiveMetrics,
  SubjectiveMetrics,
} from "@/types/pipeline";
import type { EvalTrace } from "@/types/eval-trace";
import type { EvalCapabilityReport } from "@/types/eval-case";
import type { StructuredTaskMetrics } from "@/types/rich-conversation";
import type { ScenarioEvaluation, ScenarioTemplate } from "@/types/scenario";

type MetricBuildContext = {
  objectiveMetrics: ObjectiveMetrics;
  subjectiveMetrics: SubjectiveMetrics;
  structuredTaskMetrics?: StructuredTaskMetrics;
  trace?: EvalTrace;
  capabilities?: EvalCapabilityReport;
  scenarioEvaluation?: ScenarioEvaluation | null;
  scenarioTemplate?: ScenarioTemplate | null;
};

const BASE_DEFINITIONS: EvalMetricDefinition[] = [
  {
    id: "avgResponseGapSec",
    displayName: "平均响应间隔",
    description: "用户消息到助手回复之间的平均间隔。",
    category: "objective",
    kind: "objective",
    scope: "dataset",
    threshold: 0.78,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "rule",
  },
  {
    id: "agentResolutionSignalRate",
    displayName: "解决态信号",
    description: "助手是否给出明确处理承诺、下一步或解决动作。",
    category: "objective",
    kind: "objective",
    scope: "session",
    threshold: 0.68,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "rule",
  },
  {
    id: "goalCompletion",
    displayName: "目标达成",
    description: "用户初始目标是否在会话结束前被满足。",
    category: "subjective",
    kind: "llm_dag",
    scope: "session",
    threshold: 0.7,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "llm",
  },
  {
    id: "empathy",
    displayName: "共情质量",
    description: "助手是否识别用户情绪并给出合适承接。",
    category: "subjective",
    kind: "llm_geval",
    scope: "session",
    threshold: 0.68,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "llm",
  },
  {
    id: "offTopicRisk",
    displayName: "答非所问控制",
    description: "助手是否避免无视用户问题或偏离当前任务。",
    category: "subjective",
    kind: "llm_geval",
    scope: "session",
    threshold: 0.68,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "llm",
  },
  {
    id: "serviceCallGrounding",
    displayName: "调用参数追溯",
    description: "service_call 参数是否能从此前 dialogue state 中追溯。",
    category: "structured",
    kind: "structured",
    scope: "trace",
    threshold: 0.85,
    direction: "higher-is-better",
    requiredFields: ["state", "service_call"],
    evaluator: "rule",
  },
  {
    id: "serviceResultAvailability",
    displayName: "工具结果覆盖",
    description: "service_call 是否有对应 service_results 或 tool result。",
    category: "structured",
    kind: "structured",
    scope: "trace",
    threshold: 0.95,
    direction: "higher-is-better",
    requiredFields: ["service_call", "service_results"],
    evaluator: "rule",
  },
  {
    id: "schemaSlotCompliance",
    displayName: "Schema Slot 合法率",
    description: "slot/state/call 参数是否属于对应 service schema。",
    category: "structured",
    kind: "structured",
    scope: "dataset",
    threshold: 0.95,
    direction: "higher-is-better",
    requiredFields: ["schema", "slots"],
    evaluator: "rule",
  },
  {
    id: "traceStepEfficiency",
    displayName: "执行步骤效率",
    description: "Agent trace 中是否存在不必要步骤或绕路。",
    category: "trace",
    kind: "trace",
    scope: "trace",
    threshold: 0.72,
    direction: "higher-is-better",
    requiredFields: ["trace"],
    evaluator: "hybrid",
  },
  {
    id: "syntheticCoverage",
    displayName: "合成用例覆盖",
    description: "当前场景是否配置 synthetic case seeds 用于补充边界测试。",
    category: "synthetic",
    kind: "synthetic",
    scope: "dataset",
    threshold: 0.5,
    direction: "higher-is-better",
    requiredFields: [],
    evaluator: "rule",
  },
];

/**
 * Build a unified metric registry snapshot from existing pipeline outputs.
 * @param context Objective, subjective, structured and scenario outputs.
 * @returns Registry snapshot with pass/fail gate summary.
 */
export function buildMetricRegistrySnapshot(context: MetricBuildContext): EvalMetricRegistrySnapshot {
  const definitions = [...BASE_DEFINITIONS, ...buildScenarioDefinitions(context.scenarioEvaluation)];
  definitions.push(...buildScenarioSkillDefinitions(context.scenarioTemplate));
  const results = definitions.map((definition) => buildMetricResult(definition, context));
  const measurable = results.filter((item) => item.success !== null);
  const passRate = measurable.length
    ? Number((measurable.filter((item) => item.success).length / measurable.length).toFixed(4))
    : 0;
  const gateReasons = buildGateReasons(results, passRate);
  return {
    generatedAt: new Date().toISOString(),
    definitions,
    results,
    passRate,
    readyCount: results.filter((item) => item.status === "ready").length,
    degradedCount: results.filter((item) => item.status === "degraded").length,
    skippedCount: results.filter((item) => item.status === "skipped").length,
    errorCount: results.filter((item) => item.status === "error").length,
    gateStatus: gateReasons.some((item) => item.startsWith("FAILED"))
      ? "failed"
      : gateReasons.length > 0
        ? "warning"
        : "passed",
    gateReasons,
  };
}

/**
 * Build scenario KPI definitions so business metrics share the same UI and gate model.
 * @param scenarioEvaluation Scenario KPI output.
 * @returns Metric definitions.
 */
function buildScenarioDefinitions(scenarioEvaluation?: ScenarioEvaluation | null): EvalMetricDefinition[] {
  return (scenarioEvaluation?.kpis ?? []).map((kpi) => ({
    id: `business.${kpi.id}`,
    displayName: kpi.displayName,
    description: kpi.description,
    category: "business",
    kind: "gate",
    scope: "dataset",
    threshold: kpi.successThreshold,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "hybrid",
  }));
}

/**
 * Build metric definitions declared by scenario skill templates.
 * @param scenarioTemplate Scenario template.
 * @returns Metric definitions.
 */
function buildScenarioSkillDefinitions(scenarioTemplate?: ScenarioTemplate | null): EvalMetricDefinition[] {
  const scenarioId = scenarioTemplate?.scenarioId;
  if (!scenarioTemplate || !scenarioId) {
    return [];
  }
  return (scenarioTemplate?.evaluationMetrics ?? []).map((metric) => ({
    id: `scenario.${scenarioId}.${metric.id}`,
    displayName: metric.displayName,
    description: metric.description,
    category:
      metric.kind === "structured"
        ? "structured"
        : metric.kind === "trace"
          ? "trace"
          : metric.kind === "synthetic"
            ? "synthetic"
            : "subjective",
    kind: metric.kind,
    scope: metric.scope,
    threshold: metric.threshold,
    direction: metric.direction,
    requiredFields: metric.requiredFields,
    evaluator: metric.kind === "rule" ? "rule" : metric.kind === "structured" ? "hybrid" : "llm",
    proxyMetricId: metric.mapsToMetricId,
  }));
}

/**
 * Build one metric result from a definition and pipeline context.
 * @param definition Metric definition.
 * @param context Pipeline metric context.
 * @returns Normalized metric result.
 */
function buildMetricResult(definition: EvalMetricDefinition, context: MetricBuildContext): EvalMetricResult {
  const missingFields = resolveMissingFields(definition.requiredFields, context);
  if (missingFields.length > 0) {
    return result(definition, {
      score: null,
      status: "skipped",
      success: null,
      reason: `缺少字段：${missingFields.join(", ")}。`,
      evidence: [],
      missingFields,
      confidence: 1,
    });
  }

  const resolved = resolveScore(definition, context);
  return result(definition, {
    ...resolved,
    missingFields,
    success: resolved.score === null ? null : resolved.score >= definition.threshold,
  });
}

/**
 * Resolve missing fields according to data capabilities.
 * @param requiredFields Required field identifiers.
 * @param context Pipeline metric context.
 * @returns Missing field identifiers.
 */
function resolveMissingFields(requiredFields: EvalRequiredField[], context: MetricBuildContext): EvalRequiredField[] {
  if (context.capabilities) {
    return requiredFields.filter((field) => !context.capabilities?.availableFields[field]);
  }
  return requiredFields.filter((field) => {
    if (field === "turns") return false;
    if (field === "state") return !context.structuredTaskMetrics?.dialogueStateCount;
    if (field === "slots") return !context.structuredTaskMetrics?.slotMentionCount;
    if (field === "service_call") return !context.structuredTaskMetrics?.serviceCallCount;
    if (field === "service_results") return !context.structuredTaskMetrics?.serviceResultCount;
    if (field === "schema") return !context.structuredTaskMetrics?.schemaServiceCount;
    if (field === "trace") return !context.trace?.spans.length;
    return true;
  });
}

/**
 * Resolve metric score from existing outputs.
 * @param definition Metric definition.
 * @param context Pipeline metric context.
 * @returns Score payload.
 */
function resolveScore(
  definition: EvalMetricDefinition,
  context: MetricBuildContext,
): Pick<EvalMetricResult, "score" | "rawValue" | "status" | "reason" | "evidence" | "confidence"> {
  if (definition.proxyMetricId) {
    const proxied = resolveScore({ ...definition, id: definition.proxyMetricId, proxyMetricId: undefined }, context);
    return {
      ...proxied,
      reason: `${definition.kind} 模板当前复用 ${definition.proxyMetricId} 结果：${proxied.reason}`,
      evidence: [`Scenario skill：${definition.description}`, ...proxied.evidence],
    };
  }
  const objective = context.objectiveMetrics;
  const subjective = context.subjectiveMetrics;
  const structured = context.structuredTaskMetrics;
  if (definition.id === "avgResponseGapSec") {
    const score = clamp01(1 - objective.avgResponseGapSec / 120);
    return ready(score, `${Math.round(objective.avgResponseGapSec)}s`, `平均响应间隔 ${Math.round(objective.avgResponseGapSec)} 秒。`);
  }
  if (definition.id === "agentResolutionSignalRate") {
    return ready(objective.agentResolutionSignalRate, `${Math.round(objective.agentResolutionSignalRate * 100)}%`, "末轮助手解决态信号覆盖率。");
  }
  if (definition.id === "goalCompletion") {
    const rows = subjective.goalCompletions;
    const score = rows.length ? average(rows.map((item) => item.score / 5)) : null;
    return metricMaybeDegraded(score, subjective.status, "按 session 判断用户初始目标是否达成。");
  }
  if (definition.id === "empathy") {
    const score = (subjective.dimensions.find((item) => item.dimension === "共情程度")?.score ?? 0) / 5;
    return metricMaybeDegraded(score, subjective.status, "共情程度维度归一化得分。");
  }
  if (definition.id === "offTopicRisk") {
    const dimensionScore = (subjective.dimensions.find((item) => item.dimension === "答非所问/无视风险")?.score ?? 0) / 5;
    return metricMaybeDegraded(dimensionScore, subjective.status, "答非所问/无视风险控制得分。");
  }
  if (definition.id === "serviceCallGrounding") {
    return ready(structured?.serviceCallGroundingRate ?? 0, `${Math.round((structured?.serviceCallGroundingRate ?? 0) * 100)}%`, "service_call 参数可追溯到 dialogue state 的比例。");
  }
  if (definition.id === "serviceResultAvailability") {
    return ready(structured?.serviceResultAvailabilityRate ?? 0, `${Math.round((structured?.serviceResultAvailabilityRate ?? 0) * 100)}%`, "service_call 有对应 service_results 的比例。");
  }
  if (definition.id === "schemaSlotCompliance") {
    return ready(structured?.schemaSlotCoverageRate ?? 0, `${Math.round((structured?.schemaSlotCoverageRate ?? 0) * 100)}%`, `未知 slot 引用 ${structured?.unknownSlotReferenceCount ?? 0} 个。`);
  }
  if (definition.id === "traceStepEfficiency") {
    const trace = context.trace;
    if (!trace?.spans.length) {
      return skipped("等待接入真实 Agent trace/span 后启用。");
    }
    const completedSpans = trace.spans.filter((span) => span.status === "success" || span.status === "warning");
    const warningPenalty = trace.spans.filter((span) => span.status === "warning").length * 0.08;
    const score = clamp01(completedSpans.length / trace.spans.length - warningPenalty);
    return ready(score, `${completedSpans.length}/${trace.spans.length}`, `Trace ${trace.traceId} 中 ${completedSpans.length}/${trace.spans.length} 个 span 完成，error span ${trace.spans.filter((span) => span.status === "error").length} 个。`);
  }
  if (definition.id === "syntheticCoverage") {
    const seedCount = context.scenarioTemplate?.syntheticCaseSeeds?.length ?? 0;
    if (seedCount === 0) {
      return skipped("等待 scenario skill 配置 synthetic case seeds 后启用。");
    }
    const score = clamp01(seedCount / 5);
    return ready(score, seedCount, `当前场景已配置 ${seedCount} 个 synthetic case seed，可用于补充边界测试。`);
  }
  if (definition.id.startsWith("business.")) {
    const kpi = context.scenarioEvaluation?.kpis.find((item) => `business.${item.id}` === definition.id);
    if (!kpi) return skipped("未选择业务场景或 KPI 不存在。");
    return ready(kpi.score, `${Math.round(kpi.score * 100)}%`, kpi.topEvidence[0] ?? kpi.description);
  }
  return skipped("该指标尚未接入 runner。");
}

/**
 * Construct a successful score payload.
 * @param score Normalized score.
 * @param rawValue Raw display value.
 * @param evidence Evidence text.
 * @returns Score payload.
 */
function ready(
  score: number,
  rawValue: string | number,
  evidence: string,
): Pick<EvalMetricResult, "score" | "rawValue" | "status" | "reason" | "evidence" | "confidence"> {
  return {
    score: clamp01(score),
    rawValue,
    status: "ready",
    reason: evidence,
    evidence: [evidence],
    confidence: 0.9,
  };
}

/**
 * Construct a subjective metric payload with degraded mode support.
 * @param score Normalized score.
 * @param subjectiveStatus Subjective metric status.
 * @param evidence Evidence text.
 * @returns Score payload.
 */
function metricMaybeDegraded(
  score: number | null,
  subjectiveStatus: SubjectiveMetrics["status"],
  evidence: string,
): Pick<EvalMetricResult, "score" | "rawValue" | "status" | "reason" | "evidence" | "confidence"> {
  if (score === null) {
    return skipped("缺少主观评估结果。");
  }
  return {
    score: clamp01(score),
    rawValue: `${Math.round(clamp01(score) * 100)}%`,
    status: subjectiveStatus === "ready" ? "ready" : "degraded",
    reason: subjectiveStatus === "ready" ? evidence : `${evidence} 当前为降级模式。`,
    evidence: [evidence],
    confidence: subjectiveStatus === "ready" ? 0.82 : 0.55,
  };
}

/**
 * Construct a skipped metric payload.
 * @param reason Skip reason.
 * @returns Score payload.
 */
function skipped(
  reason: string,
): Pick<EvalMetricResult, "score" | "rawValue" | "status" | "reason" | "evidence" | "confidence"> {
  return {
    score: null,
    status: "skipped",
    reason,
    evidence: [],
    confidence: 1,
  };
}

/**
 * Merge a metric definition with score fields.
 * @param definition Metric definition.
 * @param payload Result payload.
 * @returns Metric result.
 */
function result(
  definition: EvalMetricDefinition,
  payload: Omit<EvalMetricResult, keyof EvalMetricDefinition>,
): EvalMetricResult {
  return {
    ...definition,
    ...payload,
    cacheHit: false,
  };
}

/**
 * Build high-signal gate reasons for the run.
 * @param results Metric results.
 * @param passRate Aggregate pass rate.
 * @returns Gate reason strings.
 */
function buildGateReasons(results: EvalMetricResult[], passRate: number): string[] {
  const reasons: string[] = [];
  if (passRate < 0.6) {
    reasons.push(`FAILED：可评分指标通过率 ${Math.round(passRate * 100)}%，低于 60%。`);
  }
  const failedCore = results.filter((item) => item.success === false && item.category !== "synthetic").slice(0, 3);
  failedCore.forEach((item) => {
    reasons.push(`WARNING：${item.displayName} 未达阈值，score=${item.score?.toFixed(2) ?? "--"}。`);
  });
  const skippedTrace = results.find((item) => item.id === "traceStepEfficiency" && item.status === "skipped");
  if (skippedTrace) {
    reasons.push("INFO：尚未接入真实 trace/span，Agent 执行效率类指标暂不可评。");
  }
  return reasons;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
