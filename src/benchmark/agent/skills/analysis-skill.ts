/**
 * @fileoverview 分析技能 — 深度分析评测数据
 *
 * 垂直能力：
 * - Rubric 质量分析：覆盖度、权重、标准清晰度
 * - 对比分析：跨框架、跨模型、跨案例
 * - 趋势分析：多次评测的分数变化
 * - 根因分析：badcase 的根因定位
 */

import type {
  BenchmarkCapabilityDimension,
  BenchmarkMetricEvaluationResult,
  BenchmarkRubricSet,
  BenchmarkRunResult,
} from "@/benchmark/types";
import type { AgentSkillResult } from "../types";

export type AnalysisSkillInput = {
  type: "rubric_quality" | "cross_comparison" | "trend" | "root_cause";
  data: unknown;
};

export type RubricQualityInput = {
  rubric: BenchmarkRubricSet;
};

export type CrossComparisonInput = {
  results: BenchmarkRunResult[];
  groupBy: "framework" | "model" | "capability";
};

export type TrendInput = {
  results: BenchmarkRunResult[];
  metricKey?: string;
  capability?: BenchmarkCapabilityDimension;
};

export type RootCauseInput = {
  result: BenchmarkRunResult;
  caseId?: string;
  metricKey?: string;
  frameworkId?: string;
};

/**
 * 运行分析技能
 */
export function runAnalysis(input: AnalysisSkillInput): AgentSkillResult {
  const started = Date.now();

  switch (input.type) {
    case "rubric_quality":
      return analyzeRubricQuality(input.data as RubricQualityInput, started);
    case "cross_comparison":
      return analyzeCrossComparison(input.data as CrossComparisonInput, started);
    case "trend":
      return analyzeTrend(input.data as TrendInput, started);
    case "root_cause":
      return analyzeRootCause(input.data as RootCauseInput, started);
    default:
      return {
        skillType: "rubric_analysis",
        success: false,
        output: {},
        reasoning: `未知的分析类型: ${input.type}`,
        durationMs: Date.now() - started,
      };
  }
}

// ───────────────────────────────────────────────
// Rubric 质量分析
// ───────────────────────────────────────────────

function analyzeRubricQuality(input: RubricQualityInput, started: number): AgentSkillResult {
  const rubric = input.rubric;
  const modules = rubric.modules;
  const allMetrics = modules.flatMap((m) => m.metrics);

  const allCapabilities: BenchmarkCapabilityDimension[] = [
    "task_completion",
    "instruction_following",
    "factual_grounding",
    "data_extraction",
    "reasoning_quality",
    "tool_use_correctness",
    "format_compliance",
    "latency_efficiency",
    "safety_policy",
    "business_judgment",
  ];

  const coveredCaps = new Set(modules.map((m) => m.capability));
  const missingCaps = allCapabilities.filter((c) => !coveredCaps.has(c));

  const totalWeight = modules.reduce((s, m) => s + m.weight, 0);
  const weightBalanced = Math.abs(totalWeight - 1) < 0.1;

  const metricsWithoutCriteria = allMetrics.filter(
    (m) => !m.config?.criteria && m.evaluatorType === "llm_judge",
  );

  const metricsWithZeroWeight = allMetrics.filter((m) => m.weight === 0);

  const suggestions: string[] = [];
  if (missingCaps.length > 0) {
    suggestions.push(`建议增加以下能力维度的指标: ${missingCaps.join(", ")}`);
  }
  if (!weightBalanced) {
    suggestions.push(`模块权重总和不等于 1 (当前: ${totalWeight.toFixed(2)})，建议调整权重`);
  }
  if (metricsWithoutCriteria.length > 0) {
    suggestions.push(`${metricsWithoutCriteria.length} 个 LLM Judge 指标缺少评估准则，建议补充`);
  }
  if (metricsWithZeroWeight.length > 0) {
    suggestions.push(`${metricsWithZeroWeight.length} 个指标权重为 0，将不会影响总分`);
  }

  const qualityScore = Math.max(
    0,
    100
      - missingCaps.length * 10
      - (weightBalanced ? 0 : 15)
      - metricsWithoutCriteria.length * 5
      - metricsWithZeroWeight.length * 3,
  );

  return {
    skillType: "rubric_analysis",
    success: true,
    output: {
      qualityScore,
      totalModules: modules.length,
      totalMetrics: allMetrics.length,
      coveredCapabilities: [...coveredCaps],
      missingCapabilities: missingCaps,
      weightBalanced,
      totalWeight,
      metricsNeedingCriteria: metricsWithoutCriteria.map((m) => m.metricKey),
      zeroWeightMetrics: metricsWithZeroWeight.map((m) => m.metricKey),
      suggestions,
      moduleBreakdown: modules.map((m) => ({
        capability: m.capability,
        weight: m.weight,
        metricCount: m.metrics.length,
        approvedMetrics: m.metrics.filter((mt) => mt.approvalStatus === "approved").length,
      })),
    },
    reasoning: `Rubric 质量评分: ${qualityScore}/100，${suggestions.length} 条改进建议`,
    durationMs: Date.now() - started,
  };
}

// ───────────────────────────────────────────────
// 横向对比分析
// ───────────────────────────────────────────────

function analyzeCrossComparison(input: CrossComparisonInput, started: number): AgentSkillResult {
  const { results, groupBy } = input;

  const allMetricResults = results.flatMap((r) => r.metricResults);

  let grouped: Record<string, BenchmarkMetricEvaluationResult[]> = {};

  switch (groupBy) {
    case "framework":
      grouped = groupByKey(allMetricResults, (r) => r.agentFramework);
      break;
    case "model":
      grouped = groupByKey(allMetricResults, (r) => r.model);
      break;
    case "capability":
      grouped = groupByKey(allMetricResults, (r) => r.capability);
      break;
  }

  const comparison = Object.entries(grouped).map(([key, items]) => {
    const avgScore = items.reduce((s, r) => s + r.normalizedScore, 0) / items.length;
    const passRate = items.filter((r) => r.passed).length / items.length;
    const byCapability = groupByKey(items, (r) => r.capability);

    return {
      key,
      totalEvaluations: items.length,
      averageScore: Number(avgScore.toFixed(3)),
      passRate: Number(passRate.toFixed(3)),
      capabilityBreakdown: Object.entries(byCapability).map(([cap, capItems]) => ({
        capability: cap,
        averageScore: Number(
          (capItems.reduce((s, r) => s + r.normalizedScore, 0) / capItems.length).toFixed(3),
        ),
        passRate: Number(
          (capItems.filter((r) => r.passed).length / capItems.length).toFixed(3),
        ),
      })),
    };
  }).sort((a, b) => b.averageScore - a.averageScore);

  const winner = comparison[0];
  const loser = comparison[comparison.length - 1];

  return {
    skillType: "cross_comparison",
    success: true,
    output: {
      groupBy,
      comparison,
      winner: winner ? { key: winner.key, score: winner.averageScore } : null,
      loser: loser ? { key: loser.key, score: loser.averageScore } : null,
      gap: winner && loser ? Number((winner.averageScore - loser.averageScore).toFixed(3)) : 0,
    },
    reasoning: `${groupBy === "framework" ? "框架" : groupBy === "model" ? "模型" : "能力维度"}对比完成，最佳: ${winner?.key ?? "N/A"}，最差: ${loser?.key ?? "N/A"}`,
    durationMs: Date.now() - started,
  };
}

// ───────────────────────────────────────────────
// 趋势分析
// ───────────────────────────────────────────────

function analyzeTrend(input: TrendInput, started: number): AgentSkillResult {
  const { results, metricKey, capability } = input;

  const trends = results.map((result) => {
    let relevantResults = result.metricResults;

    if (metricKey) {
      relevantResults = relevantResults.filter((r) => r.metricKey === metricKey);
    }
    if (capability) {
      relevantResults = relevantResults.filter((r) => r.capability === capability);
    }

    const avgScore =
      relevantResults.length > 0
        ? relevantResults.reduce((s, r) => s + r.normalizedScore, 0) / relevantResults.length
        : 0;

    return {
      runId: result.runId,
      generatedAt: result.generatedAt,
      averageScore: Number(avgScore.toFixed(3)),
      evaluationCount: relevantResults.length,
      passRate:
        relevantResults.length > 0
          ? Number(
              (relevantResults.filter((r) => r.passed).length / relevantResults.length).toFixed(3),
            )
          : 0,
    };
  });

  // 计算趋势方向
  const scores = trends.map((t) => t.averageScore);
  let direction: "up" | "down" | "stable" = "stable";
  if (scores.length >= 2) {
    const firstHalf = scores.slice(0, Math.floor(scores.length / 2));
    const secondHalf = scores.slice(Math.floor(scores.length / 2));
    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;
    if (secondAvg > firstAvg + 0.05) direction = "up";
    else if (secondAvg < firstAvg - 0.05) direction = "down";
  }

  return {
    skillType: "rubric_analysis",
    success: true,
    output: {
      filter: { metricKey, capability },
      trends,
      direction,
      improvement:
        direction === "up"
          ? "评测表现呈上升趋势"
          : direction === "down"
            ? "评测表现呈下降趋势，建议检查 Agent 配置"
            : "评测表现稳定",
    },
    reasoning: `趋势分析完成，方向: ${direction === "up" ? "上升" : direction === "down" ? "下降" : "稳定"}`,
    durationMs: Date.now() - started,
  };
}

// ───────────────────────────────────────────────
// 根因分析
// ───────────────────────────────────────────────

function analyzeRootCause(input: RootCauseInput, started: number): AgentSkillResult {
  const { result, caseId, metricKey, frameworkId } = input;

  let filtered = result.metricResults.filter((r) => !r.passed);

  if (caseId) {
    filtered = filtered.filter((r) => r.caseId === caseId);
  }
  if (metricKey) {
    filtered = filtered.filter((r) => r.metricKey === metricKey);
  }
  if (frameworkId) {
    filtered = filtered.filter((r) => r.agentFramework === frameworkId);
  }

  // 按能力维度聚合
  const byCapability = groupByKey(filtered, (r) => r.capability);
  const byFramework = groupByKey(filtered, (r) => r.agentFramework);
  const byMetric = groupByKey(filtered, (r) => r.metricKey);

  const topIssues = [...new Set(filtered.map((r) => r.reason))].slice(0, 5);

  const rootCauses = filtered.map((r) => ({
    caseId: r.caseId,
    framework: r.agentFramework,
    model: r.model,
    metric: r.metricKey,
    capability: r.capability,
    score: r.normalizedScore,
    reason: r.reason,
    evidence: r.evidence,
    suggestedFix: generateFixSuggestion(r),
  }));

  return {
    skillType: "badcase_mining",
    success: true,
    output: {
      filter: { caseId, metricKey, frameworkId },
      totalFailures: filtered.length,
      byCapability: Object.entries(byCapability).map(([cap, items]) => ({
        capability: cap,
        count: items.length,
        frameworks: [...new Set(items.map((i) => i.agentFramework))],
      })),
      byFramework: Object.entries(byFramework).map(([fw, items]) => ({
        framework: fw,
        count: items.length,
        topCapabilities: [...new Set(items.map((i) => i.capability))].slice(0, 3),
      })),
      byMetric: Object.entries(byMetric).map(([m, items]) => ({
        metric: m,
        count: items.length,
      })),
      topIssues,
      rootCauses,
    },
    reasoning: `根因分析完成，发现 ${filtered.length} 个失败项，主要问题: ${topIssues[0] ?? "N/A"}`,
    durationMs: Date.now() - started,
  };
}

// ───────────────────────────────────────────────
// 辅助函数
// ───────────────────────────────────────────────

function groupByKey<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

function generateFixSuggestion(result: BenchmarkMetricEvaluationResult): string {
  const { capability, metricKey, agentFramework } = result;

  const suggestions: Record<string, string> = {
    task_completion: "检查 Agent 是否正确理解了任务要求，可能需要优化 prompt 中的指令描述",
    instruction_following: "Agent 可能忽略了部分指令约束，建议在 system prompt 中强调格式要求",
    factual_grounding: "Agent 产生了幻觉或错误信息，建议增加事实核查步骤或 RAG 检索",
    data_extraction: "数据提取不完整或不准确，建议明确指定需要提取的字段和格式",
    reasoning_quality: "推理链不够清晰或有逻辑漏洞，建议要求 Agent 输出思考过程",
    tool_use_correctness: "工具调用参数错误，建议提供更详细的工具使用说明",
    format_compliance: "输出格式不符合要求，建议在 prompt 中提供示例输出",
    business_judgment: "业务判断有误，建议提供业务规则文档或 few-shot 示例",
    safety_policy: "输出可能违反安全策略，建议增加安全过滤层",
  };

  return (
    suggestions[capability] ??
    `建议检查 ${agentFramework} 对 ${metricKey} 的处理逻辑，可能需要调整 prompt 或增加示例`
  );
}
