/**
 * @fileoverview Eval-Anything alignment helpers for Zeval benchmark mode.
 *
 * The upstream project frames evaluation as an LLM x Target x Harness x
 * Environment matrix with traceable judge decisions. This module keeps that
 * philosophy explicit inside Zeval without copying the Python architecture.
 */

import type {
  BenchmarkCapabilityDimension,
  BenchmarkEvalDesign,
  BenchmarkHarnessKind,
  BenchmarkMatrixCell,
  BenchmarkMetricReference,
  BenchmarkRubricSet,
  BenchmarkTaskType,
} from "@/benchmark/types";
import { cloneMetricReferences } from "@/benchmark/reference-catalog";

export const EVAL_ANYTHING_REPO_URL = "https://github.com/Rogerrrr18/Eval-Anything";

export const EVAL_ANYTHING_ALIGNMENT_PRINCIPLES = [
  "把评测建模为 LLM x Target x Harness x Environment 的矩阵，而不是单次 prompt 打分。",
  "Environment 是任务世界：它应携带输入、可见/隐藏上下文、验收标准、评分逻辑和复核证据。",
  "Target 是被测系统：完整应用/API/RAG/Agent 要作为系统评测，不能被误降级成裸 LLM 输出。",
  "Harness 是可替换的 agent 架构；raw baseline 必须保留，用来判断复杂 harness 是否真的带来增益。",
  "主观指标优先使用跨家族 Judge Panel，并保留每个 judge 的原始裁决、证据、标签和分歧。",
  "dry-run、小样本验证、人工复核队列是评测安全护栏，不能把一次模型判断当作最终事实。",
  "所有 rubric 和 metric 必须有可追溯依据：公开 benchmark、论文、标准、数据集或权威框架。",
] as const;

export function renderEvalAnythingPhilosophyPrompt(): string {
  return [
    "Eval-Anything 对齐原则：",
    ...EVAL_ANYTHING_ALIGNMENT_PRINCIPLES.map((principle) => `- ${principle}`),
    "",
    "生成或修改评测器时，必须显式区分 task world / target / harness / judge / report；不要只生成泛泛的 LLM-as-judge 文案。",
  ].join("\n");
}

export function inferBenchmarkTaskType(input: {
  requirementText: string;
  rubric?: BenchmarkRubricSet | null;
}): BenchmarkTaskType {
  const text = [
    input.requirementText,
    input.rubric?.title,
    input.rubric?.description,
    ...(input.rubric?.modules.flatMap((module) => [
      module.capability,
      module.displayName,
      ...module.metrics.flatMap((metric) => [metric.displayName, metric.description, metric.config?.criteria]),
    ]) ?? []),
  ].filter(Boolean).join("\n").toLowerCase();

  if (/(rag|retriev|检索|知识库|引用|grounded|source|文档问答|文件问答)/.test(text)) return "rag_qa";
  if (/(workspace|artifact|交付物|文件|隐藏测试|repo|代码仓库|产品级|完整应用|app)/.test(text)) return "app_agent";
  if (/(tool|function call|api|browser|调用|工具|参数|执行)/.test(text)) return "tool_use";
  if (/(code|unit test|bug|patch|程序|代码|测试通过)/.test(text)) return "code";
  if (/(dialog|conversation|多轮|客服|对话|会话)/.test(text)) return "dialog_judge";
  if (/(classif|label|分类|选择题|判定|标签)/.test(text)) return "classification";
  if (/(slot|extract|field|字段|抽取|结构化|entity|实体)/.test(text)) return "slot_filling";
  if (/(reason|analysis|推理|逻辑|证明|规划|判断|取舍)/.test(text)) return "reasoning";
  return "custom";
}

export function buildEvalAnythingDesign(input: {
  requirementText: string;
  rubric: BenchmarkRubricSet;
  matrix: BenchmarkMatrixCell[];
  judgeMode?: "single" | "panel";
}): BenchmarkEvalDesign {
  const taskType = inferBenchmarkTaskType(input);
  const harness = selectHarnessPlan(taskType, input.requirementText, input.matrix);
  const references = collectRubricReferences(input.rubric).slice(0, 12);
  const environmentKind = taskType === "rag_qa"
    ? "rag_qa"
    : taskType === "app_agent" || taskType === "code"
      ? "workspace"
      : "generic_dataset";
  const targetKind = /api|http|应用|app|rag|系统/i.test(input.requirementText)
    ? "http_app"
    : "agent_framework";

  return {
    philosophy: "eval_anything_aligned",
    sourceRepo: EVAL_ANYTHING_REPO_URL,
    taskType,
    environment: {
      kind: environmentKind,
      description: buildEnvironmentDescription(taskType),
    },
    target: {
      kind: targetKind,
      description: targetKind === "http_app"
        ? "被测对象应按完整应用/API 处理，评测输入、响应、证据和错误都需要保留。"
        : "被测对象按 Agent framework/model 组合处理，并与 raw baseline 进行可比评估。",
    },
    harness,
    judge: {
      mode: input.judgeMode ?? "single",
      recommendedMode: "panel",
      aggregation: "trimmed_mean",
      requireDiverseFamilies: true,
      disagreementThreshold: 0.3,
      reviewPolicy: "当 panel_disagree、低置信度、失败但接近通过、或引用证据不足时，进入人工复核队列。",
    },
    safetyGates: {
      dryRunRequired: true,
      smallSampleFirst: true,
      humanReviewTriggers: [
        "panel_disagree",
        "confidence_below_0.6",
        "near_threshold",
        "missing_evidence",
        "unsupported_external_evaluator",
      ],
    },
    references,
  };
}

export function renderEvalAnythingDesignSummary(design: BenchmarkEvalDesign): string {
  return [
    `任务类型：${design.taskType}`,
    `Environment：${design.environment.kind}，${design.environment.description}`,
    `Target：${design.target.kind}，${design.target.description}`,
    `Harness：${design.harness.selected.join(", ")}；${design.harness.reasoning}`,
    `Judge：当前 ${design.judge.mode}，推荐 ${design.judge.recommendedMode} + ${design.judge.aggregation}；分歧阈值 ${design.judge.disagreementThreshold}`,
    `安全护栏：dry-run=${design.safetyGates.dryRunRequired}，先小样本=${design.safetyGates.smallSampleFirst}`,
  ].join("\n");
}

function selectHarnessPlan(
  taskType: BenchmarkTaskType,
  requirementText: string,
  matrix: BenchmarkMatrixCell[],
): BenchmarkEvalDesign["harness"] {
  const selected = new Set<BenchmarkHarnessKind>(["raw"]);
  const maxStepsByHarness: Partial<Record<BenchmarkHarnessKind, number>> = { raw: 1 };

  if (taskType === "tool_use") {
    selected.add("function_call");
    maxStepsByHarness.function_call = 8;
  }
  if (taskType === "reasoning" || taskType === "code" || taskType === "custom" || taskType === "app_agent") {
    selected.add("react");
    maxStepsByHarness.react = taskType === "code" ? 6 : 8;
  }
  if (/对比\s*harness|agent\s*架构|function call|工具调用/i.test(requirementText)) {
    selected.add("function_call");
    maxStepsByHarness.function_call ??= 8;
  }
  if (/推理链|reasoning trace|chain of thought|多步/i.test(requirementText)) {
    selected.add("react");
    maxStepsByHarness.react ??= 8;
  }

  const localFrameworks = matrix.map((cell) => cell.agentFramework);
  if (localFrameworks.some((framework) => framework === "zeval" || framework === "zeval_advanced")) {
    selected.add("zeval");
  }

  const reasoning = [
    "raw 作为不可省的基线保留。",
    selected.has("react") ? "react 用于观察多步推理/规划是否带来增益。" : "",
    selected.has("function_call") ? "function_call 用于工具/API 调用类任务。" : "",
    selected.has("zeval") ? "zeval 表示当前工作台内置 Agent/模型组合。" : "",
  ].filter(Boolean).join(" ");

  return {
    selected: [...selected],
    baselineRequired: true,
    reasoning,
    maxStepsByHarness,
  };
}

function buildEnvironmentDescription(taskType: BenchmarkTaskType): string {
  if (taskType === "rag_qa") {
    return "RAG/文件问答环境需要保留查询、上下文来源、引用证据和 groundedness 评分。";
  }
  if (taskType === "app_agent" || taskType === "code") {
    return "Workspace-style 环境需要把任务目录、可见文件、隐藏评分资产和可执行验收逻辑视为同一个任务世界。";
  }
  if (taskType === "tool_use") {
    return "工具调用环境需要保留工具选择、参数、调用链和最终交付状态。";
  }
  if (taskType === "dialog_judge") {
    return "对话环境需要按完整会话/turn 序列评分，而不是只截取单轮回复。";
  }
  return "通用数据集环境需要保留输入、期望验收标准、输出、证据和人工复核触发条件。";
}

function collectRubricReferences(rubric: BenchmarkRubricSet): BenchmarkMetricReference[] {
  const references = rubric.modules.flatMap((module) =>
    module.metrics.flatMap((metric) => metric.config?.references ?? []),
  );
  const seen = new Set<string>();
  const deduped = cloneMetricReferences(references).filter((reference) => {
    const key = (reference.referenceId ?? reference.url ?? reference.title).trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped;
}
