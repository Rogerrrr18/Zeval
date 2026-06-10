/**
 * @fileoverview Copilot-assisted rubric review for Benchmark Mode.
 *
 * Flow:
 * 1. suggest_first — LLM analyzes rubric against requirement and proposes adjustments
 * 2. walkthrough  — LLM reviews each metric one-by-one with the user
 */

import { requestSiliconFlowChatCompletion, parseJsonObjectFromLlmOutput } from "@/lib/siliconflow";
import type { BenchmarkRubricSet, BenchmarkRubricMetric } from "@/benchmark/types";

export type ReviewPhase = "suggest_first" | "walkthrough";

export type RubricReviewEvent =
  | { type: "review_started"; message: string }
  | { type: "suggestion"; message: string; metricKey?: string; field?: string; oldValue?: unknown; newValue?: unknown }
  | { type: "metric_review"; metricKey: string; message: string; metric: BenchmarkRubricMetric }
  | { type: "awaiting_input"; message: string }
  | { type: "review_complete"; message: string; finalRubric?: BenchmarkRubricSet }
  | { type: "error"; message: string };

export type StartRubricReviewInput = {
  rubric: BenchmarkRubricSet;
  requirementText: string;
  reviewMode: ReviewPhase;
};

/**
 * Generate the suggest_first phase messages.
 */
export async function* reviewRubricSuggestFirst(
  input: StartRubricReviewInput,
): AsyncGenerator<RubricReviewEvent> {
  yield { type: "review_started", message: "正在分析 rubric 与业务需求的匹配度..." };

  const allMetrics = input.rubric.modules.flatMap((m) => m.metrics);
  const rubricSummary = allMetrics
    .map(
      (m) =>
        `- ${m.metricKey}: ${m.displayName} (capability=${m.capability}, weight=${m.weight}, eval=${m.evaluatorType}, threshold=${m.scale.passThreshold})`,
    )
    .join("\n");

  const messages = [
    {
      role: "system" as const,
      content: [
        "你是 Zeval Rubric Review Copilot。你的任务是根据业务需求审核 benchmark rubric。",
        "请分析 rubric 中的每个指标是否与业务需求匹配，并提出具体的调整建议。",
        "返回 JSON 格式: { suggestions: [{ metricKey, field, oldValue, newValue, reason }] }",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        `业务需求: ${input.requirementText}`,
        "",
        "当前 Rubric 指标:",
        rubricSummary,
      ].join("\n"),
    },
  ];

  try {
    const llm = await requestSiliconFlowChatCompletion(messages, {
      stage: "benchmark_rubric_review_suggest",
      temperature: 0.3,
      seed: 42,
    });

    const parsed = parseJsonObjectFromLlmOutput(llm) as {
      suggestions?: Array<{
        metricKey: string;
        field: string;
        oldValue: unknown;
        newValue: unknown;
        reason: string;
      }>;
    };

    const suggestions = parsed.suggestions ?? [];
    for (const s of suggestions) {
      yield {
        type: "suggestion",
        message: `建议调整 ${s.metricKey} 的 ${s.field}: ${String(s.oldValue)} → ${String(s.newValue)}。${s.reason}`,
        metricKey: s.metricKey,
        field: s.field,
        oldValue: s.oldValue,
        newValue: s.newValue,
      };
    }

    if (suggestions.length === 0) {
      yield { type: "suggestion", message: "分析完成，当前 rubric 与业务需求匹配度良好，暂无调整建议。" };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    yield { type: "error", message: `建议分析失败: ${message}` };
  }
}

/**
 * Generate the walkthrough phase messages for a single metric.
 */
export async function* reviewRubricWalkthrough(
  input: StartRubricReviewInput,
): AsyncGenerator<RubricReviewEvent> {
  const allMetrics = input.rubric.modules.flatMap((m) => m.metrics);

  yield {
    type: "review_started",
    message: `开始逐个校验 ${allMetrics.length} 个指标...`,
  };

  for (const metric of allMetrics) {
    yield {
      type: "metric_review",
      metricKey: metric.metricKey,
      message: `正在审核指标: ${metric.displayName}`,
      metric,
    };

    const messages = [
      {
        role: "system" as const,
        content: [
          "你是 Zeval Rubric Review Copilot。请根据业务需求，逐条审核 benchmark 指标。",
          "请简要分析该指标是否合理，并询问用户是否确认。用 2-3 句话概括。",
        ].join("\n"),
      },
      {
        role: "user" as const,
        content: [
          `业务需求: ${input.requirementText}`,
          "",
          `审核指标: ${metric.displayName} (${metric.metricKey})`,
          `- 能力维度: ${metric.capability}`,
          `- 权重: ${metric.weight}`,
          `- 评估器: ${metric.evaluatorType}`,
          `- 分值范围: ${metric.scale.min}-${metric.scale.max}，通过阈值: ${metric.scale.passThreshold}`,
          `- 说明: ${metric.description}`,
          metric.config?.criteria ? `- 评估标准: ${metric.config.criteria}` : "",
          metric.config?.references?.length ? `- 参考依据: ${JSON.stringify(metric.config.references)}` : "",
        ].join("\n"),
      },
    ];

    try {
      const llm = await requestSiliconFlowChatCompletion(messages, {
        stage: "benchmark_rubric_review_walkthrough",
        temperature: 0.3,
        seed: 42,
      });

      yield {
        type: "awaiting_input",
        message: llm.trim() || `请确认指标 "${metric.displayName}" 是否合理，权重 ${metric.weight} 是否合适？`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      yield {
        type: "awaiting_input",
        message: `指标 "${metric.displayName}" 审核遇到问题: ${message}。请手动确认此指标。`,
      };
    }
  }

  yield { type: "review_complete", message: "所有指标校验完成。请确认最终 rubric 后运行评测。" };
}
