/**
 * @fileoverview Rubric draft and approval helpers for Benchmark Mode.
 */

import { randomBytes } from "node:crypto";
import {
  BENCHMARK_CAPABILITIES,
  BENCHMARK_METRIC_POOL,
  getBenchmarkCapabilityDefinition,
} from "@/benchmark/capabilities";
import type {
  BenchmarkCapabilityDimension,
  BenchmarkDomain,
  BenchmarkRubricMetric,
  BenchmarkRubricModule,
  BenchmarkRubricSet,
} from "@/benchmark/types";

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
    errors.push("Rubric must be approved by the user before running benchmark evaluation.");
  }
  if (approved.length === 0) {
    errors.push("Rubric has no approved metrics.");
  }

  const seen = new Set<string>();
  for (const metric of approved) {
    if (seen.has(metric.metricKey)) {
      errors.push(`Duplicate metric key: ${metric.metricKey}`);
    }
    seen.add(metric.metricKey);
    if (metric.weight <= 0) {
      errors.push(`Metric ${metric.metricKey} must have positive weight.`);
    }
    if (metric.scale.max <= metric.scale.min) {
      errors.push(`Metric ${metric.metricKey} has invalid scoring scale.`);
    }
    if (metric.scale.passThreshold < metric.scale.min || metric.scale.passThreshold > metric.scale.max) {
      errors.push(`Metric ${metric.metricKey} pass threshold is outside the scoring scale.`);
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
    config: metric.config ? { ...metric.config } : undefined,
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
 * Render a compact human-readable rubric outline for review screens.
 */
export function renderRubricReviewMarkdown(rubric: BenchmarkRubricSet): string {
  const lines = [
    `# ${rubric.title}`,
    "",
    rubric.description,
    "",
    `Status: ${rubric.approvalStatus}`,
    "",
  ];

  for (const module of rubric.modules) {
    lines.push(`## ${module.displayName}`);
    lines.push(module.description);
    lines.push("");
    for (const metric of module.metrics) {
      lines.push(`- ${metric.metricKey} [${metric.approvalStatus}]`);
      lines.push(`  - evaluator: ${metric.evaluatorType}`);
      lines.push(`  - weight: ${metric.weight}`);
      lines.push(`  - description: ${metric.description}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
