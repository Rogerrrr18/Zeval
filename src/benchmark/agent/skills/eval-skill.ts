/**
 * @fileoverview 评测技能 — 自动化指标评估
 *
 * 垂直能力：
 * - 单指标评估：对比 Agent 输出与预期，给出结构化评分
 * - 批量评估：对一个 case 的所有指标并行评估
 * - LLM Judge：使用 LLM 进行主观指标评估
 * - 规则评估：基于规则的客观指标评估
 */

import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkMetricEvaluationResult,
  BenchmarkRubricMetric,
  BenchmarkTaskPackage,
} from "@/benchmark/types";
import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import type { AgentSkillResult } from "../types";

export type EvalSkillInput = {
  task: BenchmarkTaskPackage;
  taskCase: BenchmarkCase;
  submission: BenchmarkAgentSubmission;
  metrics: BenchmarkRubricMetric[];
  apiKey: string;
  baseUrl: string;
  model?: string;
};

export type SingleMetricEvalInput = {
  metric: BenchmarkRubricMetric;
  taskCase: BenchmarkCase;
  submission: BenchmarkAgentSubmission;
  apiKey: string;
  baseUrl: string;
  model?: string;
};

/**
 * 批量评估技能：对一个提交的所有指标进行评估
 */
export async function runBatchEvaluation(input: EvalSkillInput): Promise<AgentSkillResult> {
  const started = Date.now();
  const results: BenchmarkMetricEvaluationResult[] = [];

  for (const metric of input.metrics) {
    const evalResult = await evaluateSingleMetric({
      metric,
      taskCase: input.taskCase,
      submission: input.submission,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
    });

    results.push(evalResult);
  }

  return {
    skillType: "metric_evaluation",
    success: true,
    output: { metricResults: results },
    reasoning: `已完成 ${results.length} 个指标的评估，通过率: ${results.filter((r) => r.passed).length}/${results.length}`,
    durationMs: Date.now() - started,
  };
}

/**
 * 单指标评估
 */
export async function evaluateSingleMetric(
  input: SingleMetricEvalInput,
): Promise<BenchmarkMetricEvaluationResult> {
  const { metric, taskCase, submission } = input;

  switch (metric.evaluatorType) {
    case "exact_match":
    case "regex_match":
    case "numeric_tolerance":
    case "f1_match":
      return runRuleBasedEvaluation(metric, taskCase, submission);

    case "llm_judge":
    case "human_label":
      return runLlmJudgeEvaluation(input);

    case "hybrid":
      return runHybridEvaluation(input);

    default:
      return createErrorResult(metric, taskCase, submission, `不支持的评估器类型: ${metric.evaluatorType}`);
  }
}

// ───────────────────────────────────────────────
// 规则评估
// ───────────────────────────────────────────────

function runRuleBasedEvaluation(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
): BenchmarkMetricEvaluationResult {
  const config = metric.config ?? {};
  const outputPath = config.outputPath ?? "";
  const expectedPath = config.expectedPath ?? "";

  const actual = getValueByPath(submission.parsedOutput ?? {}, outputPath);
  const expected = getValueByPath(taskCase.expected, expectedPath);

  let score = 0;
  let passed = false;
  const evidence: string[] = [];

  switch (metric.evaluatorType) {
    case "exact_match": {
      passed = String(actual).toLowerCase().trim() === String(expected).toLowerCase().trim();
      score = passed ? metric.scale.max : metric.scale.min;
      evidence.push(`预期值: ${JSON.stringify(expected)}, 实际值: ${JSON.stringify(actual)}`);
      break;
    }

    case "regex_match": {
      const pattern = config.pattern ?? "";
      const regex = new RegExp(pattern, "i");
      passed = regex.test(String(actual));
      score = passed ? metric.scale.max : metric.scale.min;
      evidence.push(`正则模式: ${pattern}, 实际值: ${String(actual).slice(0, 200)}`);
      break;
    }

    case "numeric_tolerance": {
      const tolerance = config.tolerance ?? 0;
      const numActual = Number(actual);
      const numExpected = Number(expected);
      const diff = Math.abs(numActual - numExpected);
      passed = diff <= tolerance;
      score = passed
        ? metric.scale.max
        : Math.max(metric.scale.min, metric.scale.max - (diff / Math.max(Math.abs(numExpected), 1)) * metric.scale.max);
      evidence.push(`预期值: ${numExpected}, 实际值: ${numActual}, 容差: ${tolerance}`);
      break;
    }

    case "f1_match": {
      const predPath = config.predictedItemsPath ?? "";
      const expPath = config.expectedItemsPath ?? "";
      const predicted = getValueByPath(submission.parsedOutput ?? {}, predPath);
      const gold = getValueByPath(taskCase.expected, expPath);

      const predSet = new Set(Array.isArray(predicted) ? predicted.map(String) : []);
      const goldSet = new Set(Array.isArray(gold) ? gold.map(String) : []);

      const intersection = [...predSet].filter((x) => goldSet.has(x));
      const precision = predSet.size > 0 ? intersection.length / predSet.size : 0;
      const recall = goldSet.size > 0 ? intersection.length / goldSet.size : 0;
      const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

      score = f1 * metric.scale.max;
      passed = score >= metric.scale.passThreshold;
      evidence.push(`Precision: ${precision.toFixed(3)}, Recall: ${recall.toFixed(3)}, F1: ${f1.toFixed(3)}`);
      break;
    }
  }

  return {
    runId: submission.runId,
    benchmarkId: submission.benchmarkId,
    taskId: submission.taskId,
    caseId: taskCase.caseId,
    submissionId: submission.submissionId,
    agentFramework: submission.agentFramework,
    model: submission.model,
    metricKey: metric.metricKey,
    metricWeight: metric.weight,
    capability: metric.capability,
    evaluatorType: metric.evaluatorType,
    score,
    normalizedScore: normalizeScore(score, metric.scale.min, metric.scale.max),
    passed,
    status: "scored",
    reason: passed ? `符合 ${metric.displayName} 标准` : `不符合 ${metric.displayName} 标准`,
    evidence,
    confidence: 1.0,
    expected,
    actual,
    needsHumanReview: metric.humanApprovalRequired && !passed,
    failureTags: passed ? [] : [metric.metricKey, metric.capability],
  };
}

// ───────────────────────────────────────────────
// LLM Judge 评估
// ───────────────────────────────────────────────

async function runLlmJudgeEvaluation(input: SingleMetricEvalInput): Promise<BenchmarkMetricEvaluationResult> {
  const { metric, taskCase, submission } = input;

  const criteria = metric.config?.criteria ?? metric.description;
  const references = metric.config?.references ?? [];

  const prompt = [
    `你是评测专家。请评估以下 Agent 输出是否符合标准。`,
    ``,
    `指标: ${metric.displayName}`,
    `能力维度: ${metric.capability}`,
    `评估标准: ${criteria}`,
    references.length > 0 ? `参考依据: ${JSON.stringify(references, null, 2)}` : "",
    ``,
    `案例输入:`,
    JSON.stringify(taskCase.input, null, 2),
    ``,
    `预期输出:`,
    JSON.stringify(taskCase.expected, null, 2),
    ``,
    `Agent 实际输出:`,
    JSON.stringify(submission.parsedOutput ?? submission.rawOutput.slice(0, 1000), null, 2),
    ``,
    `请按以下 JSON 格式返回评估结果:`,
    `{`,
    `  "score": 0-1 之间的数字,`,
    `  "passed": true/false,`,
    `  "reason": "详细的评估理由",`,
    `  "evidence": ["证据1", "证据2"]`,
    `}`,
  ].join("\n");

  try {
    // 注意：requestSiliconFlowChatCompletion 使用全局环境变量配置
    // 不直接接收 model/apiKey/baseUrl 参数
    const llm = await requestSiliconFlowChatCompletion(
      [
        { role: "system", content: "你是严谨的 AI 评测专家。输出必须是合法的 JSON。" },
        { role: "user", content: prompt },
      ],
      { stage: "benchmark_llm_judge", temperature: 0.1, seed: 42 },
    );

    const parsed = parseJsonObjectFromLlmOutput(llm) as Record<string, unknown>;
    const score = clamp(Number(parsed.score ?? 0), 0, 1) * (metric.scale.max - metric.scale.min) + metric.scale.min;
    const passed = Boolean(parsed.passed) || score >= metric.scale.passThreshold;

    return {
      runId: submission.runId,
      benchmarkId: submission.benchmarkId,
      taskId: submission.taskId,
      caseId: taskCase.caseId,
      submissionId: submission.submissionId,
      agentFramework: submission.agentFramework,
      model: submission.model,
      metricKey: metric.metricKey,
      metricWeight: metric.weight,
      capability: metric.capability,
      evaluatorType: metric.evaluatorType,
      score,
      normalizedScore: normalizeScore(score, metric.scale.min, metric.scale.max),
      passed,
      status: "scored",
      reason: String(parsed.reason ?? "LLM 评估完成"),
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String) : [String(parsed.evidence ?? "")],
      confidence: 0.85,
      expected: taskCase.expected,
      actual: submission.parsedOutput,
      needsHumanReview: metric.humanApprovalRequired && !passed,
      failureTags: passed ? [] : [metric.metricKey, metric.capability],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return createErrorResult(metric, taskCase, submission, `LLM Judge 失败: ${message}`);
  }
}

// ───────────────────────────────────────────────
// 混合评估
// ───────────────────────────────────────────────

async function runHybridEvaluation(input: SingleMetricEvalInput): Promise<BenchmarkMetricEvaluationResult> {
  // 混合评估：先运行规则评估，如果不通过再用 LLM Judge
  const ruleResult = runRuleBasedEvaluation(input.metric, input.taskCase, input.submission);

  if (ruleResult.passed) {
    return ruleResult;
  }

  const llmResult = await runLlmJudgeEvaluation(input);

  // 取两者分数的平均值
  const combinedScore = (ruleResult.score + llmResult.score) / 2;
  const combinedPassed = combinedScore >= input.metric.scale.passThreshold;

  return {
    ...ruleResult,
    score: combinedScore,
    normalizedScore: normalizeScore(combinedScore, input.metric.scale.min, input.metric.scale.max),
    passed: combinedPassed,
    reason: `规则评估: ${ruleResult.reason}; LLM评估: ${llmResult.reason}`,
    evidence: [...ruleResult.evidence, ...llmResult.evidence],
    confidence: 0.75,
  };
}

// ───────────────────────────────────────────────
// 工具函数
// ───────────────────────────────────────────────

function getValueByPath(obj: Record<string, unknown>, path: string): unknown {
  if (!path) return obj;
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function normalizeScore(score: number, min: number, max: number): number {
  if (max === min) return 1;
  return (score - min) / (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function createErrorResult(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
  error: string,
): BenchmarkMetricEvaluationResult {
  return {
    runId: submission.runId,
    benchmarkId: submission.benchmarkId,
    taskId: submission.taskId,
    caseId: taskCase.caseId,
    submissionId: submission.submissionId,
    agentFramework: submission.agentFramework,
    model: submission.model,
    metricKey: metric.metricKey,
    metricWeight: metric.weight,
    capability: metric.capability,
    evaluatorType: metric.evaluatorType,
    score: 0,
    normalizedScore: 0,
    passed: false,
    status: "error",
    reason: error,
    evidence: [error],
    confidence: 0,
    needsHumanReview: true,
    failureTags: ["evaluation_error"],
  };
}
