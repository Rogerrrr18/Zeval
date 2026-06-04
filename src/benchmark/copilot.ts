/**
 * @fileoverview Copilot-assisted rubric drafting for Benchmark Mode.
 */

import { randomBytes } from "node:crypto";
import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import {
  buildRubricDraftFromRequirement,
  renderRubricReviewMarkdown,
} from "@/benchmark/rubric";
import { getBenchmarkCapabilityDefinition } from "@/benchmark/capabilities";
import type {
  BenchmarkCapabilityDimension,
  BenchmarkDomain,
  BenchmarkEvaluatorType,
  BenchmarkRubricMetric,
  BenchmarkRubricModule,
  BenchmarkRubricSet,
} from "@/benchmark/types";

type DraftBenchmarkRubricInput = {
  title: string;
  description: string;
  domain: BenchmarkDomain;
  requirementText: string;
  preferredCapabilities?: BenchmarkCapabilityDimension[];
  useLlm?: boolean;
};

type DraftBenchmarkRubricResult = {
  rubric: BenchmarkRubricSet;
  reviewMarkdown: string;
  source: "llm" | "template";
  warnings: string[];
};

type LlmRubricPayload = {
  preferredCapabilities?: string[];
  title?: string;
  description?: string;
  domain?: string;
  modules?: LlmRubricModulePayload[];
};

type LlmRubricModulePayload = {
  capability?: string;
  displayName?: string;
  description?: string;
  weight?: number;
  metrics?: LlmRubricMetricPayload[];
};

type LlmRubricMetricPayload = {
  metricKey?: string;
  displayName?: string;
  description?: string;
  evaluatorType?: string;
  weight?: number;
  passThreshold?: number;
  evidenceRequired?: boolean;
  humanApprovalRequired?: boolean;
  failureTags?: string[];
  criteria?: string;
  rubricForm?: LlmRubricScoreLevelPayload[];
};

type LlmRubricScoreLevelPayload = {
  score?: number;
  label?: string;
  description?: string;
};

const ALLOWED_EVALUATORS: BenchmarkEvaluatorType[] = [
  "exact_match",
  "regex_match",
  "numeric_tolerance",
  "f1_match",
  "code_exec",
  "unit_test",
  "environment_state_test",
  "llm_judge",
  "human_label",
  "hybrid",
];

const CUSTOM_RUBRIC_EVALUATORS: BenchmarkEvaluatorType[] = [
  "llm_judge",
  "human_label",
];

const ALLOWED_DOMAINS: BenchmarkDomain[] = [
  "hr",
  "finance",
  "procurement",
  "software",
  "healthcare",
  "research",
  "custom",
];

/**
 * Draft a rubric using LLM-assisted capability selection when available, with a
 * deterministic template fallback. Returned metrics are still candidates until
 * the user approves them.
 */
export async function draftBenchmarkRubric(
  input: DraftBenchmarkRubricInput,
): Promise<DraftBenchmarkRubricResult> {
  const warnings: string[] = [];
  let preferredCapabilities = input.preferredCapabilities;
  let source: "llm" | "template" = "template";
  let title = input.title;
  let description = input.description;
  let domain = input.domain;
  let llmRubric: BenchmarkRubricSet | null = null;

  if (input.useLlm) {
    try {
      const llm = await requestSiliconFlowChatCompletion(
        [
          {
            role: "system",
            content: [
              "你是 Zeval 评测标准生成专家。",
              "请根据用户真实业务任务生成领域化 benchmark rubric，不要套用 HR、客服或通用模板。",
              "所有面向用户展示的 title、description、displayName、criteria 必须使用中文。",
              "metricKey 和枚举字段可以使用英文机器标识，但不能作为展示名称。",
              "每个能力维度生成 1-3 个强相关指标，总指标数控制在 4-10 个。",
              "指标必须贴合该领域的真实验收标准，例如金融风控、采购比价、代码修复、医疗问诊、研究综述等领域应生成完全不同的指标。",
              "Return JSON only.",
              "Allowed capabilities: task_completion, instruction_following, factual_grounding, data_extraction, reasoning_quality, tool_use_correctness, format_compliance, latency_efficiency, safety_policy, business_judgment.",
              "Allowed evaluatorType for generated custom metrics: llm_judge, human_label.",
              "Use llm_judge for most metrics; use human_label only when the metric clearly requires domain expert review.",
              "Allowed domain: hr, finance, procurement, software, healthcare, research, custom.",
              'Output schema: {"domain":"custom","title":"中文标题","description":"中文描述","preferredCapabilities":["task_completion"],"modules":[{"capability":"task_completion","displayName":"中文能力维度","description":"中文说明","weight":3,"metrics":[{"metricKey":"machine_key","displayName":"中文指标名","description":"中文指标说明","evaluatorType":"llm_judge","weight":3,"passThreshold":3,"evidenceRequired":true,"humanApprovalRequired":true,"failureTags":["domain_issue"],"criteria":"中文评分准则","rubricForm":[{"score":5,"label":"优秀","description":"中文评分说明"},{"score":3,"label":"合格","description":"中文评分说明"},{"score":1,"label":"不合格","description":"中文评分说明"}]}]}]}',
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Title: ${input.title}`,
              `Domain: ${input.domain}`,
              `Description: ${input.description}`,
              "Requirement:",
              input.requirementText,
            ].join("\n\n"),
          },
        ],
        { stage: "benchmark_rubric_draft", temperature: 0.2, seed: 42 },
      );
      const parsed = parseJsonObjectFromLlmOutput(llm) as LlmRubricPayload;
      const capabilities = (parsed.preferredCapabilities ?? [])
        .filter(isBenchmarkCapabilityDimension);
      if (capabilities.length > 0) {
        preferredCapabilities = capabilities;
        source = "llm";
      }
      if (isBenchmarkDomain(parsed.domain)) {
        domain = parsed.domain;
      }
      if (typeof parsed.title === "string" && parsed.title.trim()) {
        title = parsed.title.trim();
      }
      if (typeof parsed.description === "string" && parsed.description.trim()) {
        description = parsed.description.trim();
      }
      llmRubric = buildRubricFromLlmPayload({
        parsed,
        fallbackTitle: title,
        fallbackDescription: description,
        fallbackDomain: domain,
      });
      if (llmRubric) {
        source = "llm";
      } else if (source === "llm") {
        warnings.push("模型没有返回可用的领域化指标，已使用能力维度模板兜底。");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`LLM rubric draft failed, used template fallback: ${message}`);
    }
  }

  if (llmRubric) {
    return {
      rubric: llmRubric,
      reviewMarkdown: renderRubricReviewMarkdown(llmRubric),
      source,
      warnings,
    };
  }

  const rubric = buildRubricDraftFromRequirement({
    title,
    description,
    domain,
    requirementText: input.requirementText,
    preferredCapabilities,
  });

  return {
    rubric: {
      ...rubric,
      generatedBy: source === "llm" ? "copilot" : rubric.generatedBy,
    },
    reviewMarkdown: renderRubricReviewMarkdown(rubric),
    source,
    warnings,
  };
}

function buildRubricFromLlmPayload(input: {
  parsed: LlmRubricPayload;
  fallbackTitle: string;
  fallbackDescription: string;
  fallbackDomain: BenchmarkDomain;
}): BenchmarkRubricSet | null {
  const modules = sanitizeLlmModules(input.parsed.modules);
  if (modules.length === 0) return null;

  const now = new Date().toISOString();
  const domain = isBenchmarkDomain(input.parsed.domain) ? input.parsed.domain : input.fallbackDomain;
  return {
    rubricId: `rubric_${domain}_${randomBytes(3).toString("hex")}`,
    version: "0.1.0",
    title: ensureChineseText(input.parsed.title, input.fallbackTitle),
    description: ensureChineseText(input.parsed.description, input.fallbackDescription),
    domain,
    modules,
    generatedBy: "copilot",
    approvalStatus: "candidate",
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizeLlmModules(value: LlmRubricModulePayload[] | undefined): BenchmarkRubricModule[] {
  if (!Array.isArray(value)) return [];

  const usedMetricKeys = new Set<string>();
  return value
    .map((module) => {
      const rawCapability = module.capability;
      if (!rawCapability || !isBenchmarkCapabilityDimension(rawCapability)) return null;
      const capability: BenchmarkCapabilityDimension = rawCapability;

      const definition = getBenchmarkCapabilityDefinition(capability);
      const displayName = ensureChineseText(module.displayName, definition.displayName);
      const metrics = sanitizeLlmMetrics(module.metrics, capability, displayName, usedMetricKeys);
      if (metrics.length === 0) return null;

      return {
        capability,
        displayName,
        description: ensureChineseText(module.description, definition.description),
        weight: normalizeWeight(module.weight, definition.defaultWeight),
        metrics,
      } satisfies BenchmarkRubricModule;
    })
    .filter((module): module is BenchmarkRubricModule => Boolean(module))
    .slice(0, 6);
}

function sanitizeLlmMetrics(
  value: LlmRubricMetricPayload[] | undefined,
  capability: BenchmarkCapabilityDimension,
  moduleDisplayName: string,
  usedMetricKeys: Set<string>,
): BenchmarkRubricMetric[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((metric, metricIndex) => {
      const displayName = ensureChineseText(metric.displayName, `${moduleDisplayName}指标${metricIndex + 1}`);
      const metricKey = buildUniqueMetricKey(metric.metricKey ?? displayName, capability, usedMetricKeys);
      const rawEvaluatorType = metric.evaluatorType;
      const evaluatorType: BenchmarkEvaluatorType = rawEvaluatorType && isCustomRubricEvaluator(rawEvaluatorType)
        ? rawEvaluatorType
        : "llm_judge";

      return {
        metricKey,
        capability,
        displayName,
        description: ensureChineseText(metric.description, `评估${displayName}是否达到业务验收要求。`),
        evaluatorType,
        weight: normalizeWeight(metric.weight, 2),
        scale: {
          min: 0,
          max: 5,
          passThreshold: normalizePassThreshold(metric.passThreshold),
        },
        approvalStatus: "candidate",
        evidenceRequired: metric.evidenceRequired ?? (evaluatorType === "llm_judge" || evaluatorType === "human_label"),
        humanApprovalRequired: metric.humanApprovalRequired ?? evaluatorType === "human_label",
        failureTags: normalizeFailureTags(metric.failureTags, metricKey),
        config: {
          criteria: ensureChineseText(metric.criteria, `按照「${displayName}」的业务要求进行 0 到 5 分评分，并说明证据。`),
          rubricForm: normalizeRubricForm(metric.rubricForm, displayName),
        },
      } satisfies BenchmarkRubricMetric;
    })
    .slice(0, 3);
}

function normalizeRubricForm(value: LlmRubricScoreLevelPayload[] | undefined, displayName: string) {
  const levels = Array.isArray(value)
    ? value
        .map((item) => ({
          score: normalizePassThreshold(item.score),
          label: ensureChineseText(item.label, scoreLabel(item.score)),
          description: ensureChineseText(item.description, defaultScoreDescription(displayName, item.score)),
        }))
        .filter((item) => item.description.trim())
    : [];

  return levels.length > 0
    ? levels.slice(0, 5)
    : [
        { score: 5, label: "优秀", description: `完全满足「${displayName}」要求，证据充分且无明显缺陷。` },
        { score: 3, label: "合格", description: `基本满足「${displayName}」要求，但存在轻微遗漏或表达不够充分。` },
        { score: 1, label: "不合格", description: `未能满足「${displayName}」核心要求，存在关键错误、缺失或无证据支撑。` },
      ];
}

function scoreLabel(score: number | undefined): string {
  if (typeof score === "number" && score >= 5) return "优秀";
  if (typeof score === "number" && score >= 3) return "合格";
  return "不合格";
}

function defaultScoreDescription(displayName: string, score: number | undefined): string {
  if (typeof score === "number" && score >= 5) {
    return `完全满足「${displayName}」要求，证据充分且可复核。`;
  }
  if (typeof score === "number" && score >= 3) {
    return `基本满足「${displayName}」要求，但仍有轻微不足。`;
  }
  return `未能满足「${displayName}」核心要求。`;
}

function buildUniqueMetricKey(value: string, capability: BenchmarkCapabilityDimension, used: Set<string>): string {
  const base = slug(value) || `${capability}_metric`;
  let key = base;
  let suffix = 2;
  while (used.has(key)) {
    key = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(key);
  return key;
}

function normalizeWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(5, Math.max(1, Math.round(value)));
}

function normalizePassThreshold(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.min(5, Math.max(0, value));
}

function normalizeFailureTags(value: string[] | undefined, fallback: string): string[] {
  const tags = Array.isArray(value)
    ? value.map((tag) => slug(tag)).filter(Boolean)
    : [];
  return tags.length > 0 ? tags.slice(0, 4) : [`${fallback}_failed`];
}

function ensureChineseText(value: string | undefined, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text && /[\u3400-\u9fff]/.test(text)) return text;
  return fallback;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

function isBenchmarkDomain(value: string | undefined): value is BenchmarkDomain {
  return Boolean(value && ALLOWED_DOMAINS.includes(value as BenchmarkDomain));
}

function isBenchmarkEvaluatorType(value: string): value is BenchmarkEvaluatorType {
  return ALLOWED_EVALUATORS.includes(value as BenchmarkEvaluatorType);
}

function isCustomRubricEvaluator(value: string): value is BenchmarkEvaluatorType {
  return isBenchmarkEvaluatorType(value) && CUSTOM_RUBRIC_EVALUATORS.includes(value);
}

function isBenchmarkCapabilityDimension(value: string): value is BenchmarkCapabilityDimension {
  return (
    value === "task_completion" ||
    value === "instruction_following" ||
    value === "factual_grounding" ||
    value === "data_extraction" ||
    value === "reasoning_quality" ||
    value === "tool_use_correctness" ||
    value === "format_compliance" ||
    value === "latency_efficiency" ||
    value === "safety_policy" ||
    value === "business_judgment"
  );
}
