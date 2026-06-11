/**
 * @fileoverview Normalize LLM rubric trees so each capability module owns 1..N metrics.
 */

import type {
  BenchmarkCapabilityDimension,
  BenchmarkRubricMetric,
  BenchmarkRubricModule,
} from "@/benchmark/types";

const MAX_METRICS_PER_MODULE = 3;
const MAX_MODULES = 5;

const RUBRIC_MODULE_THEMES: Array<{
  displayName: string;
  description: string;
  capabilities: BenchmarkCapabilityDimension[];
  weight: number;
}> = [
  {
    displayName: "任务完成与业务判断",
    description: "核心业务目标是否达成，决策是否符合领域验收标准。",
    capabilities: ["task_completion", "business_judgment", "reasoning_quality"],
    weight: 3,
  },
  {
    displayName: "信息与事实依据",
    description: "结论是否基于可靠来源，关键信息是否抽取准确。",
    capabilities: ["factual_grounding", "data_extraction"],
    weight: 3,
  },
  {
    displayName: "交互、格式与安全",
    description: "是否遵循指令与输出规范，并满足安全合规要求。",
    capabilities: ["instruction_following", "format_compliance", "safety_policy"],
    weight: 2,
  },
  {
    displayName: "工具与效率",
    description: "工具调用是否正确，是否在可接受成本内完成任务。",
    capabilities: ["tool_use_correctness", "latency_efficiency"],
    weight: 2,
  },
];

export type ConsolidateSparseModulesResult = {
  modules: BenchmarkRubricModule[];
  consolidated: boolean;
};

/**
 * Merge sparse 1:1 module/metric trees from LLM drafts into fewer parent modules.
 *
 * @param modules Sanitized rubric modules.
 * @returns Regrouped modules; `consolidated` is true when structure was rewritten.
 */
export function consolidateSparseLlmModules(
  modules: BenchmarkRubricModule[],
): ConsolidateSparseModulesResult {
  if (modules.length === 0) {
    return { modules, consolidated: false };
  }

  const initialTotal = modules.reduce((count, module) => count + module.metrics.length, 0);
  let working = mergeModulesByCapability(modules);

  if (!shouldConsolidateFurther(working, initialTotal)) {
    return {
      modules: capModuleStructure(working),
      consolidated: working.length !== modules.length,
    };
  }

  const themed = regroupModulesByTheme(working);
  working = themed.length > 0 ? themed : working;

  return {
    modules: capModuleStructure(working),
    consolidated: true,
  };
}

/**
 * Average metrics per module for a rubric module list.
 */
export function averageMetricsPerModule(modules: BenchmarkRubricModule[]): number {
  if (modules.length === 0) return 0;
  const total = modules.reduce((count, module) => count + module.metrics.length, 0);
  return total / modules.length;
}

function shouldConsolidateFurther(modules: BenchmarkRubricModule[], totalMetrics: number): boolean {
  if (modules.length < 4 || totalMetrics < 4) return false;
  if (averageMetricsPerModule(modules) >= 1.8) return false;

  const singleMetricModules = modules.filter((module) => module.metrics.length === 1).length;
  return singleMetricModules / modules.length >= 0.6;
}

function mergeModulesByCapability(modules: BenchmarkRubricModule[]): BenchmarkRubricModule[] {
  const merged = new Map<BenchmarkCapabilityDimension, BenchmarkRubricModule>();

  for (const module of modules) {
    const existing = merged.get(module.capability);
    if (!existing) {
      merged.set(module.capability, {
        ...module,
        metrics: [...module.metrics],
      });
      continue;
    }

    existing.metrics.push(...module.metrics);
    existing.weight = Math.max(existing.weight, module.weight);
    if (module.description.trim().length > existing.description.trim().length) {
      existing.description = module.description;
    }
  }

  return [...merged.values()];
}

function regroupModulesByTheme(modules: BenchmarkRubricModule[]): BenchmarkRubricModule[] {
  const themed: BenchmarkRubricModule[] = [];
  const assignedMetricKeys = new Set<string>();

  for (const theme of RUBRIC_MODULE_THEMES) {
    const metrics = collectThemeMetrics(modules, theme.capabilities, assignedMetricKeys);
    if (metrics.length === 0) continue;

    themed.push({
      capability: theme.capabilities[0],
      displayName: theme.displayName,
      description: theme.description,
      weight: theme.weight,
      metrics,
    });
  }

  const orphanMetrics = modules.flatMap((module) =>
    module.metrics.filter((metric) => !assignedMetricKeys.has(metric.metricKey)),
  );
  if (orphanMetrics.length > 0) {
    themed.push({
      capability: orphanMetrics[0].capability,
      displayName: "其他评测维度",
      description: "暂未归入标准能力分组的指标。",
      weight: 2,
      metrics: orphanMetrics,
    });
  }

  return themed;
}

function collectThemeMetrics(
  modules: BenchmarkRubricModule[],
  capabilities: BenchmarkCapabilityDimension[],
  assignedMetricKeys: Set<string>,
): BenchmarkRubricMetric[] {
  const metrics: BenchmarkRubricMetric[] = [];

  for (const module of modules) {
    if (!capabilities.includes(module.capability)) continue;
    for (const metric of module.metrics) {
      if (assignedMetricKeys.has(metric.metricKey)) continue;
      metrics.push(metric);
      assignedMetricKeys.add(metric.metricKey);
    }
  }

  return metrics;
}

function capModuleStructure(modules: BenchmarkRubricModule[]): BenchmarkRubricModule[] {
  return modules
    .map((module) => ({
      ...module,
      metrics: module.metrics.slice(0, MAX_METRICS_PER_MODULE),
    }))
    .filter((module) => module.metrics.length > 0)
    .slice(0, MAX_MODULES);
}
