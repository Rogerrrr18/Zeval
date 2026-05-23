/**
 * @fileoverview Business-KPI scoring from scenario templates.
 */

import type {
  EnrichedChatlogRow,
  ObjectiveMetrics,
  SubjectiveDimensionResult,
  SubjectiveMetrics,
} from "@/types/pipeline";
import type {
  ScenarioEvaluation,
  ScenarioKpiResult,
  ScenarioMetricContribution,
  ScenarioMetricReference,
  ScenarioTemplate,
} from "@/types/scenario";

type ResolvedMetric = {
  metricId: string;
  source: ScenarioMetricReference["source"];
  rawValue: number;
  evidence: string;
};

/**
 * Evaluate one business scenario on top of the generic pipeline outputs.
 *
 * @param scenario Scenario template.
 * @param context Enriched rows and aggregated metrics.
 * @returns Business-KPI evaluation payload.
 */
export function evaluateScenarioTemplate(
  scenario: ScenarioTemplate,
  context: {
    rows: EnrichedChatlogRow[];
    objectiveMetrics: ObjectiveMetrics;
    subjectiveMetrics: SubjectiveMetrics;
  },
): ScenarioEvaluation {
  const kpis = scenario.businessKpis.map((kpi) =>
    evaluateScenarioKpi(kpi, context.rows, context.objectiveMetrics, context.subjectiveMetrics),
  );
  const averageScore = kpis.length
    ? roundScore(kpis.reduce((sum, item) => sum + item.score, 0) / kpis.length)
    : 0;

  return {
    scenarioId: scenario.scenarioId,
    displayName: scenario.displayName,
    averageScore,
    generatedAt: new Date().toISOString(),
    kpis,
  };
}

/**
 * Evaluate one KPI definition against generic metrics.
 *
 * @param kpi KPI definition.
 * @param rows Enriched rows.
 * @param objectiveMetrics Objective metrics.
 * @param subjectiveMetrics Subjective metrics.
 * @returns One scored KPI result.
 */
function evaluateScenarioKpi(
  kpi: ScenarioTemplate["businessKpis"][number],
  rows: EnrichedChatlogRow[],
  objectiveMetrics: ObjectiveMetrics,
  subjectiveMetrics: SubjectiveMetrics,
): ScenarioKpiResult {
  const references = [...kpi.mappedTo.primary, ...kpi.mappedTo.secondary];
  const contributions = references.map((reference) => {
    const metric = resolveScenarioMetric(reference, rows, objectiveMetrics, subjectiveMetrics);
    const alignedScore = reference.weight >= 0 ? metric.rawValue : 1 - metric.rawValue;
    return {
      source: reference.source,
      metricId: reference.metricId,
      weight: reference.weight,
      rawValue: roundScore(metric.rawValue),
      alignedScore: roundScore(alignedScore),
      evidence: metric.evidence,
    } satisfies ScenarioMetricContribution;
  });

  const totalWeight = contributions.reduce((sum, item) => sum + Math.abs(item.weight), 0);
  const score =
    totalWeight > 0
      ? roundScore(
          contributions.reduce((sum, item) => sum + item.alignedScore * Math.abs(item.weight), 0) / totalWeight,
        )
      : 0;

  return {
    id: kpi.id,
    displayName: kpi.displayName,
    description: kpi.description,
    score,
    status: resolveKpiStatus(score, kpi.successThreshold, kpi.degradedThreshold),
    successThreshold: kpi.successThreshold,
    degradedThreshold: kpi.degradedThreshold,
    topEvidence: contributions
      .slice()
      .sort((left, right) => left.alignedScore - right.alignedScore)
      .slice(0, 2)
      .map((item) => item.evidence),
    contributions,
  };
}

/**
 * Resolve one scenario metric reference into a normalized raw value.
 *
 * @param reference Metric reference.
 * @param rows Enriched rows.
 * @param objectiveMetrics Objective metrics.
 * @param subjectiveMetrics Subjective metrics.
 * @returns Resolved metric value plus human-readable evidence.
 */
function resolveScenarioMetric(
  reference: ScenarioMetricReference,
  rows: EnrichedChatlogRow[],
  objectiveMetrics: ObjectiveMetrics,
  subjectiveMetrics: SubjectiveMetrics,
): ResolvedMetric {
  if (reference.source === "objective") {
    return resolveObjectiveMetric(reference.metricId, rows, objectiveMetrics);
  }
  if (reference.source === "subjective") {
    return resolveSubjectiveMetric(reference.metricId, subjectiveMetrics);
  }
  return resolveSignalMetric(reference.metricId, subjectiveMetrics);
}

/**
 * Resolve one objective metric into a normalized raw value.
 *
 * @param metricId Objective metric id.
 * @param rows Enriched rows.
 * @param objectiveMetrics Objective metrics.
 * @returns Normalized metric and evidence.
 */
function resolveObjectiveMetric(
  metricId: string,
  rows: EnrichedChatlogRow[],
  objectiveMetrics: ObjectiveMetrics,
): ResolvedMetric {
  const sessionCount = new Set(rows.map((row) => row.sessionId)).size || 1;

  if (metricId === "userQuestionRepeatRate") {
    return {
      metricId,
      source: "objective",
      rawValue: clamp01(objectiveMetrics.userQuestionRepeatRate),
      evidence: `重复提问率 ${Math.round(objectiveMetrics.userQuestionRepeatRate * 100)}%，来自 ${sessionCount} 个 session 的用户问题去重统计。`,
    };
  }

  if (metricId === "agentResolutionSignalRate") {
    return {
      metricId,
      source: "objective",
      rawValue: clamp01(objectiveMetrics.agentResolutionSignalRate),
      evidence: `解决态信号覆盖 ${Math.round(objectiveMetrics.agentResolutionSignalRate * 100)}%，表示末轮 assistant 是否给出明确处理承诺。`,
    };
  }

  if (metricId === "escalationKeywordHitRate") {
    return {
      metricId,
      source: "objective",
      rawValue: clamp01(objectiveMetrics.escalationKeywordHitRate),
      evidence: `升级关键词命中率 ${Math.round(objectiveMetrics.escalationKeywordHitRate * 100)}%，命中“转人工 / 投诉 / 主管”等表达。`,
    };
  }

  if (metricId === "avgResponseGapSec") {
    return {
      metricId,
      source: "objective",
      rawValue: clamp01(objectiveMetrics.avgResponseGapSec / 120),
      evidence: `平均响应间隔 ${objectiveMetrics.avgResponseGapSec.toFixed(2)}s，按 120s 尺度归一化。`,
    };
  }

  return {
    metricId,
    source: "objective",
    rawValue: 0.5,
    evidence: `未识别的 objective metric：${metricId}，暂按中性值处理。`,
  };
}

/**
 * Resolve one subjective metric or derived judge output into a normalized raw value.
 *
 * @param metricId Subjective metric id.
 * @param subjectiveMetrics Subjective metrics.
 * @returns Normalized metric and evidence.
 */
function resolveSubjectiveMetric(
  metricId: string,
  subjectiveMetrics: SubjectiveMetrics,
): ResolvedMetric {
  if (metricId === "goalCompletion") {
    const averageGoalScore = average(subjectiveMetrics.goalCompletions.map((item) => item.score / 5));
    const evidenceSource =
      subjectiveMetrics.goalCompletions.find((item) => item.achievementEvidence.length > 0)?.achievementEvidence[0] ??
      subjectiveMetrics.goalCompletions.find((item) => item.failureReasons.length > 0)?.failureReasons[0] ??
      "当前未提取到明确的 goal completion 证据。";
    return {
      metricId,
      source: "subjective",
      rawValue: clamp01(averageGoalScore),
      evidence: `goal completion 均值 ${roundScore(averageGoalScore)}。证据：${evidenceSource}`,
    };
  }

  const dimension = resolveDimension(metricId, subjectiveMetrics.dimensions);
  if (dimension) {
    return {
      metricId,
      source: "subjective",
      rawValue: clamp01(dimension.score / 5),
      evidence: `${dimension.dimension}=${dimension.score}/5。证据：${dimension.evidence}`,
    };
  }

  return {
    metricId,
    source: "subjective",
    rawValue: 0.5,
    evidence: `未识别的 subjective metric：${metricId}，暂按中性值处理。`,
  };
}

/**
 * Resolve one implicit signal into a normalized raw value.
 *
 * @param metricId Signal id.
 * @param subjectiveMetrics Subjective metrics.
 * @returns Normalized metric and evidence.
 */
function resolveSignalMetric(
  metricId: string,
  subjectiveMetrics: SubjectiveMetrics,
): ResolvedMetric {
  const signal = subjectiveMetrics.signals.find((item) => item.signalKey === metricId);
  if (!signal) {
    return {
      metricId,
      source: "signal",
      rawValue: 0.5,
      evidence: `未识别的 signal：${metricId}，暂按中性值处理。`,
    };
  }

  return {
    metricId,
    source: "signal",
    rawValue: clamp01(signal.score),
    evidence: `${signal.signalKey}=${signal.score.toFixed(2)}。证据：${signal.evidence}`,
  };
}

/**
 * Resolve one subjective dimension alias used by scenario templates.
 *
 * @param metricId Scenario-level metric id.
 * @param dimensions Aggregated subjective dimensions.
 * @returns Matched subjective dimension.
 */
function resolveDimension(
  metricId: string,
  dimensions: SubjectiveDimensionResult[],
): SubjectiveDimensionResult | undefined {
  if (metricId === "empathy") {
    return dimensions.find((item) => item.dimension === "共情程度");
  }
  if (metricId === "offTopicRisk") {
    return dimensions.find((item) => item.dimension === "答非所问/无视风险");
  }
  if (metricId === "preachiness") {
    return dimensions.find((item) => item.dimension === "说教感/压迫感");
  }
  if (metricId === "emotionRecovery") {
    return dimensions.find((item) => item.dimension === "情绪恢复能力");
  }
  return undefined;
}

/**
 * Resolve one KPI status from score thresholds.
 *
 * @param score Final KPI score.
 * @param successThreshold Healthy threshold.
 * @param degradedThreshold Degraded threshold.
 * @returns KPI status.
 */
function resolveKpiStatus(
  score: number,
  successThreshold: number,
  degradedThreshold: number,
): ScenarioKpiResult["status"] {
  if (score >= successThreshold) {
    return "healthy";
  }
  if (score >= degradedThreshold) {
    return "degraded";
  }
  return "at_risk";
}

/**
 * Clamp one normalized score into the 0-1 range.
 *
 * @param value Raw score.
 * @returns Safe score.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

/**
 * Compute one arithmetic mean.
 *
 * @param values Numeric values.
 * @returns Mean value.
 */
function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}

/**
 * Round one score for presentation and stable API output.
 *
 * @param value Raw numeric score.
 * @returns Rounded score.
 */
function roundScore(value: number): number {
  return Number(value.toFixed(4));
}
