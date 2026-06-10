/**
 * @fileoverview Rubric draft and approval helpers for Benchmark Mode.
 */

import { randomBytes } from "node:crypto";
import {
  BENCHMARK_METRIC_POOL,
  getBenchmarkCapabilityDefinition,
} from "@/benchmark/capabilities";
import type {
  BenchmarkCapabilityDimension,
  BenchmarkDomain,
  BenchmarkEvaluatorConfig,
  BenchmarkMetricReference,
  BenchmarkRubricMetric,
  BenchmarkRubricModule,
  BenchmarkRubricSet,
} from "@/benchmark/types";
import { cloneMetricReferences } from "@/benchmark/reference-catalog";

const EVALUATOR_LABELS_ZH: Record<string, string> = {
  exact_match: "精确匹配",
  regex_match: "格式匹配",
  numeric_tolerance: "数值容差",
  f1_match: "覆盖率匹配",
  code_exec: "代码执行",
  unit_test: "单元测试",
  environment_state_test: "环境状态检测",
  llm_judge: "模型评审",
  human_label: "人工标注",
  hybrid: "混合评估",
};

export type BuildRubricDraftInput = {
  title: string;
  description: string;
  domain: BenchmarkDomain;
  requirementText: string;
  preferredCapabilities?: BenchmarkCapabilityDimension[];
  now?: string;
};

/**
 * Build a deterministic rubric draft from a business requirement.
 *
 * This is the non-LLM fallback for the Copilot rubric builder. An LLM can
 * propose extra metrics later, but all metrics remain `candidate` until the
 * user explicitly approves them.
 */
export function buildRubricDraftFromRequirement(input: BuildRubricDraftInput): BenchmarkRubricSet {
  const now = input.now ?? new Date().toISOString();
  const capabilities = selectCapabilities(input);
  const metrics = BENCHMARK_METRIC_POOL.filter((metric) => capabilities.includes(metric.capability))
    .map(cloneMetric);
  const modules = buildRubricModules(capabilities, metrics);

  return {
    rubricId: `rubric_${slug(input.domain)}_${randomBytes(3).toString("hex")}`,
    version: "0.1.0",
    title: input.title,
    description: input.description,
    domain: input.domain,
    modules,
    generatedBy: "template",
    approvalStatus: "candidate",
    researchSummary: "指标体系参考 HELM、BIG-bench、MT-Bench、IFEval、RAGAS、ToolBench、AgentBench、NIST AI RMF 等公开论文、benchmark 与标准，并按当前任务需求选择能力维度。",
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Return only approved metrics in stable module order.
 */
export function getApprovedRubricMetrics(rubric: BenchmarkRubricSet): BenchmarkRubricMetric[] {
  return rubric.modules.flatMap((module) =>
    module.metrics.filter((metric) => metric.approvalStatus === "approved"),
  );
}

/**
 * Mark selected metrics as approved and all other candidates as rejected.
 */
export function approveRubricMetrics(
  rubric: BenchmarkRubricSet,
  approvedMetricKeys: string[],
  now = new Date().toISOString(),
): BenchmarkRubricSet {
  const approved = new Set(approvedMetricKeys);
  return {
    ...rubric,
    approvalStatus: "approved",
    updatedAt: now,
    modules: rubric.modules.map((module) => ({
      ...module,
      metrics: module.metrics.map((metric) => ({
        ...metric,
        approvalStatus: approved.has(metric.metricKey) ? "approved" : "rejected",
      })),
    })),
  };
}

/**
 * Validate that a rubric can be used for benchmark scoring.
 */
export function validateApprovedRubric(rubric: BenchmarkRubricSet): string[] {
  const errors: string[] = [];
  const approved = getApprovedRubricMetrics(rubric);
  if (rubric.approvalStatus !== "approved") {
    errors.push("评分标准必须先由用户确认，才能运行评测。");
  }
  if (approved.length === 0) {
    errors.push("评分标准中没有已确认指标。");
  }

  const seen = new Set<string>();
  for (const metric of approved) {
    if (seen.has(metric.metricKey)) {
      errors.push(`指标标识重复：${metric.metricKey}`);
    }
    seen.add(metric.metricKey);
    if (metric.weight <= 0) {
      errors.push(`指标「${metric.displayName}」的权重必须大于 0。`);
    }
    if (metric.scale.max <= metric.scale.min) {
      errors.push(`指标「${metric.displayName}」的分值范围不合法。`);
    }
    if (metric.scale.passThreshold < metric.scale.min || metric.scale.passThreshold > metric.scale.max) {
      errors.push(`指标「${metric.displayName}」的通过阈值超出分值范围。`);
    }
  }

  return errors;
}

function selectCapabilities(input: BuildRubricDraftInput): BenchmarkCapabilityDimension[] {
  if (input.preferredCapabilities?.length) {
    return dedupe(input.preferredCapabilities);
  }

  const text = `${input.domain}\n${input.title}\n${input.description}\n${input.requirementText}`.toLowerCase();
  const selected = new Set<BenchmarkCapabilityDimension>([
    "task_completion",
    "instruction_following",
    "format_compliance",
  ]);

  if (/(pdf|csv|excel|table|field|extract|resume|jd|candidate|entity|slot)/.test(text)) {
    selected.add("data_extraction");
  }
  if (/(ground|citation|source|knowledge|document|fact|hallucination|reference)/.test(text)) {
    selected.add("factual_grounding");
  }
  if (/(reason|explain|why|analysis|judgment|screen|rank|select|reject)/.test(text)) {
    selected.add("reasoning_quality");
    selected.add("business_judgment");
  }
  if (/(tool|api|browser|code|execute|unit test|environment|state)/.test(text)) {
    selected.add("tool_use_correctness");
  }
  if (/(safe|privacy|bias|policy|pii|personal)/.test(text)) {
    selected.add("safety_policy");
  }
  if (/(latency|cost|time|timeout|turn|budget)/.test(text)) {
    selected.add("latency_efficiency");
  }

  return [...selected];
}

function buildRubricModules(
  capabilities: BenchmarkCapabilityDimension[],
  metrics: BenchmarkRubricMetric[],
): BenchmarkRubricModule[] {
  return capabilities.map((capability) => {
    const definition = getBenchmarkCapabilityDefinition(capability);
    return {
      capability,
      displayName: definition.displayName,
      description: definition.description,
      weight: definition.defaultWeight,
      metrics: metrics.filter((metric) => metric.capability === capability),
    };
  }).filter((module) => module.metrics.length > 0);
}

function cloneMetric(metric: BenchmarkRubricMetric): BenchmarkRubricMetric {
  return {
    ...metric,
    scale: { ...metric.scale },
    config: cloneEvaluatorConfig(metric.config),
    failureTags: [...metric.failureTags],
  };
}

function dedupe<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "custom";
}

/**
 * Deep clone a rubric so edits don’t mutate the original draft.
 */
export function cloneRubric(rubric: BenchmarkRubricSet): BenchmarkRubricSet {
  return {
    ...rubric,
    modules: rubric.modules.map((module) => ({
      ...module,
      metrics: module.metrics.map((metric) => ({
        ...metric,
        scale: { ...metric.scale },
        config: cloneEvaluatorConfig(metric.config),
        failureTags: [...metric.failureTags],
      })),
    })),
  };
}

/**
 * Update a single metric in a rubric and return a new rubric instance.
 */
export function updateRubricMetric(
  rubric: BenchmarkRubricSet,
  metricKey: string,
  patch: Partial<Omit<BenchmarkRubricMetric, "metricKey">>,
  now = new Date().toISOString(),
): BenchmarkRubricSet {
  return {
    ...rubric,
    updatedAt: now,
    modules: rubric.modules.map((module) => ({
      ...module,
      metrics: module.metrics.map((metric) =>
        metric.metricKey === metricKey ? { ...metric, ...patch } : metric,
      ),
    })),
  };
}

/**
 * Toggle a metric’s approval status between candidate/approved.
 */
export function toggleMetricApproval(
  rubric: BenchmarkRubricSet,
  metricKey: string,
  now = new Date().toISOString(),
): BenchmarkRubricSet {
  return {
    ...rubric,
    updatedAt: now,
    modules: rubric.modules.map((module) => ({
      ...module,
      metrics: module.metrics.map((metric) =>
        metric.metricKey === metricKey
          ? { ...metric, approvalStatus: metric.approvalStatus === "approved" ? "candidate" : "approved" as const }
          : metric,
      ),
    })),
  };
}

/**
 * Render a compact human-readable rubric outline for review screens.
 */
export function renderRubricReviewMarkdown(rubric: BenchmarkRubricSet): string {
  const lines = [
    `# ${rubric.title}`,
    "",
    rubric.description,
    "",
  ];
  if (rubric.researchSummary) {
    lines.push(`依据摘要：${rubric.researchSummary}`, "");
  }
  lines.push(
    `状态：${rubric.approvalStatus === "approved" ? "已确认" : rubric.approvalStatus === "rejected" ? "已拒绝" : "待确认"}`,
    "",
  );

  for (const rubricModule of rubric.modules) {
    lines.push(`## ${rubricModule.displayName}`);
    lines.push(rubricModule.description);
    lines.push("");
    for (const metric of rubricModule.metrics) {
      const status = metric.approvalStatus === "approved" ? "已确认" : metric.approvalStatus === "rejected" ? "已拒绝" : "待确认";
      lines.push(`- ${metric.displayName} [${status}]`);
      lines.push(`  - 评估方式：${EVALUATOR_LABELS_ZH[metric.evaluatorType] ?? metric.evaluatorType}`);
      lines.push(`  - 权重：${metric.weight}`);
      lines.push(`  - 说明：${metric.description}`);
      const referenceLine = formatMetricReferences(metric.config?.references);
      if (referenceLine) lines.push(`  - 参考依据：${referenceLine}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function cloneEvaluatorConfig(config: BenchmarkEvaluatorConfig | undefined): BenchmarkEvaluatorConfig | undefined {
  if (!config) return undefined;
  return {
    ...config,
    rubricForm: config.rubricForm ? config.rubricForm.map((level) => ({ ...level })) : undefined,
    references: cloneMetricReferences(config.references),
    childMetricKeys: config.childMetricKeys ? [...config.childMetricKeys] : undefined,
  };
}

function formatMetricReferences(references: BenchmarkMetricReference[] | undefined): string {
  if (!references?.length) return "";
  return references
    .slice(0, 3)
    .map((reference) => {
      const label = reference.referenceId ?? reference.benchmarkName ?? reference.title;
      const year = reference.year ? `, ${reference.year}` : "";
      return `${label}${year}`;
    })
    .join("；");
}
