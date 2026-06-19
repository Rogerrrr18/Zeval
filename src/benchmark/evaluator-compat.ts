/**
 * @fileoverview Harness compatibility helpers for benchmark evaluators.
 */

import type {
  BenchmarkEvaluatorType,
  BenchmarkRubricMetric,
  BenchmarkRubricSet,
} from "@/benchmark/types";

export type BenchmarkRubricEvaluatorAdaptation = {
  metricKey: string;
  displayName: string;
  from: BenchmarkEvaluatorType;
  to: BenchmarkEvaluatorType;
  reason: string;
};

const GENERIC_TRANSCRIPT_ADAPTED_EVALUATORS = new Set<BenchmarkEvaluatorType>([
  "exact_match",
  "numeric_tolerance",
  "f1_match",
  "code_exec",
  "unit_test",
  "environment_state_test",
  "hybrid",
]);

/**
 * Adapt an approved rubric to the generic transcript harness before running.
 *
 * The current generic harness provides transcript text, acceptance criteria and
 * submission answer/evidence/notes. It does not provide metric-specific gold
 * fields or external evaluator artifacts, so artifact-bound evaluators are
 * converted to LLM judge metrics with an explicit criteria note.
 *
 * @param rubric Rubric selected for the current generic benchmark run.
 * @returns Adapted rubric plus a list of evaluator changes for observability.
 */
export function adaptRubricForGenericTranscriptHarness(
  rubric: BenchmarkRubricSet,
): { rubric: BenchmarkRubricSet; adaptations: BenchmarkRubricEvaluatorAdaptation[] } {
  const adaptations: BenchmarkRubricEvaluatorAdaptation[] = [];
  const adaptedRubric: BenchmarkRubricSet = {
    ...rubric,
    modules: rubric.modules.map((module) => ({
      ...module,
      metrics: module.metrics.map((metric) => {
        const adapted = adaptMetricForGenericTranscriptHarness(metric);
        if (adapted.adaptation) adaptations.push(adapted.adaptation);
        return adapted.metric;
      }),
    })),
  };
  return { rubric: adaptedRubric, adaptations };
}

/**
 * Adapt one rubric metric to the generic transcript harness.
 *
 * @param metric Candidate metric to inspect.
 * @returns The original metric when runnable, otherwise an LLM-judge metric and adaptation metadata.
 */
export function adaptMetricForGenericTranscriptHarness(
  metric: BenchmarkRubricMetric,
): { metric: BenchmarkRubricMetric; adaptation?: BenchmarkRubricEvaluatorAdaptation } {
  if (!shouldUseLlmJudgeForGenericTranscriptHarness(metric)) {
    return { metric };
  }

  return {
    metric: {
      ...metric,
      evaluatorType: "llm_judge",
      evidenceRequired: true,
      humanApprovalRequired: metric.humanApprovalRequired,
      config: {
        ...(metric.config ?? {}),
        criteria: [
          metric.config?.criteria ?? metric.description,
          buildGenericTranscriptEvaluatorNote(metric),
        ].filter(Boolean).join("\n\n"),
      },
    },
    adaptation: {
      metricKey: metric.metricKey,
      displayName: metric.displayName,
      from: metric.evaluatorType,
      to: "llm_judge",
      reason: genericTranscriptEvaluatorReason(metric.evaluatorType),
    },
  };
}

/**
 * Decide whether a metric needs artifacts unavailable in generic transcript mode.
 *
 * @param metric Rubric metric to inspect.
 * @returns True when the metric should be evaluated semantically by an LLM judge.
 */
export function shouldUseLlmJudgeForGenericTranscriptHarness(metric: BenchmarkRubricMetric): boolean {
  return GENERIC_TRANSCRIPT_ADAPTED_EVALUATORS.has(metric.evaluatorType);
}

/**
 * Build a compact user-facing summary of runtime evaluator adaptations.
 *
 * @param adaptations Adaptation records returned by the generic harness adapter.
 * @returns Chinese summary suitable for progress events and warnings.
 */
export function summarizeGenericTranscriptEvaluatorAdaptations(
  adaptations: BenchmarkRubricEvaluatorAdaptation[],
): string {
  if (adaptations.length === 0) return "";
  const counts = adaptations.reduce<Record<string, number>>((acc, item) => {
    acc[item.from] = (acc[item.from] ?? 0) + 1;
    return acc;
  }, {});
  const countText = Object.entries(counts)
    .map(([type, count]) => `${type} ${count} 个`)
    .join("、");
  const names = adaptations.slice(0, 5).map((item) => `「${item.displayName}」`).join("、");
  const suffix = adaptations.length > 5 ? `等 ${adaptations.length} 个指标` : `${adaptations.length} 个指标`;
  return `已将 ${suffix} 从结构化/外部评估器适配为模型评审，避免 generic transcript 数据缺少 gold 字段或 evaluator artifact 时阻塞：${countText}。涉及 ${names}。`;
}

/**
 * Describe why a metric was adapted for the generic transcript harness.
 *
 * @param metric Original rubric metric.
 * @returns Criteria note visible to the judge.
 */
function buildGenericTranscriptEvaluatorNote(metric: BenchmarkRubricMetric): string {
  const config = metric.config ?? {};
  const artifactHint = [
    config.outputPath ? `outputPath=${config.outputPath}` : "",
    config.expectedPath ? `expectedPath=${config.expectedPath}` : "",
    config.predictedItemsPath ? `predictedItemsPath=${config.predictedItemsPath}` : "",
    config.expectedItemsPath ? `expectedItemsPath=${config.expectedItemsPath}` : "",
    config.pattern ? `pattern=${config.pattern}` : "",
    config.childMetricKeys?.length ? `childMetricKeys=${config.childMetricKeys.join(",")}` : "",
  ].filter(Boolean).join("；");
  return [
    "运行时适配说明：当前 generic transcript harness 只提供 transcript、expected.acceptanceCriteria、被测输出 answer/evidence/notes。",
    `原评估方式 ${metric.evaluatorType} ${genericTranscriptEvaluatorReason(metric.evaluatorType)}，因此改由模型评审按原指标意图进行语义评分。`,
    "请在 evidence 中引用可复核的 transcript、验收标准或被测输出片段；证据不足时降低 score 和 confidence。",
    artifactHint ? `原客观评测配置：${artifactHint}。` : "",
  ].filter(Boolean).join("\n");
}

/**
 * Explain why an evaluator is not directly runnable in generic transcript mode.
 *
 * @param evaluatorType Original evaluator type.
 * @returns Chinese reason fragment.
 */
function genericTranscriptEvaluatorReason(evaluatorType: BenchmarkEvaluatorType): string {
  switch (evaluatorType) {
    case "exact_match":
    case "numeric_tolerance":
    case "f1_match":
      return "依赖 metric-specific expected/output 结构化字段";
    case "code_exec":
    case "unit_test":
    case "environment_state_test":
      return "依赖外部 evaluator artifact";
    case "hybrid":
      return "当前 runner 尚未实现 standalone hybrid 聚合";
    default:
      return "不适配当前 generic transcript harness";
  }
}
