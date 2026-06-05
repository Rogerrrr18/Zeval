/**
 * @fileoverview Copilot-assisted rubric drafting for Benchmark Mode.
 */

import { randomBytes } from "node:crypto";
import { parseJsonObjectFromLlmOutput, readZevalEnvValue, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import {
  buildRubricDraftFromRequirement,
  renderRubricReviewMarkdown,
} from "@/benchmark/rubric";
import { getBenchmarkCapabilityDefinition } from "@/benchmark/capabilities";
import { benchmarkReferencesForCapability, cloneMetricReferences } from "@/benchmark/reference-catalog";
import type {
  BenchmarkCapabilityDimension,
  BenchmarkDomain,
  BenchmarkEvaluatorType,
  BenchmarkMetricReference,
  BenchmarkReferenceSourceType,
  BenchmarkRubricMetric,
  BenchmarkRubricModule,
  BenchmarkRubricSet,
} from "@/benchmark/types";

export type DraftBenchmarkRubricInput = {
  title: string;
  description: string;
  domain: BenchmarkDomain;
  requirementText: string;
  preferredCapabilities?: BenchmarkCapabilityDimension[];
  useLlm?: boolean;
  researchBrief?: RubricResearchBrief;
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
  researchSummary?: string;
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
  references?: Array<LlmRubricReferencePayload | string>;
};

type LlmRubricScoreLevelPayload = {
  score?: number;
  label?: string;
  description?: string;
};

type LlmRubricReferencePayload = {
  referenceId?: string;
  title?: string;
  sourceType?: string;
  url?: string;
  authors?: string[] | string;
  publisher?: string;
  year?: number | string;
  benchmarkName?: string;
  relevance?: string;
  confidence?: number;
};

type LlmRubricResearchPayload = {
  summary?: string;
  references?: LlmRubricReferencePayload[];
  suggestedMetricAngles?: Array<{
    capability?: string;
    metricName?: string;
    rationale?: string;
    referenceIds?: string[];
  }>;
};

export type RubricResearchBrief = {
  summary: string;
  references: BenchmarkMetricReference[];
  source: "deepsearch" | "catalog";
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

const ALLOWED_REFERENCE_SOURCE_TYPES: BenchmarkReferenceSourceType[] = [
  "paper",
  "public_benchmark",
  "standard",
  "dataset",
  "framework",
  "documentation",
  "research_report",
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
  let researchBrief = input.researchBrief ?? buildFallbackResearchBrief(input);

  if (input.useLlm && !input.researchBrief) {
    try {
      researchBrief = await researchBenchmarkReferences(input);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`DeepSearch research failed, used built-in benchmark references: ${message}`);
    }
  }

  if (input.useLlm) {
    try {
      const llm = await requestSiliconFlowChatCompletion(
        [
          {
            role: "system",
            content: [
              "你是 Zeval 评测标准生成专家。",
              "请根据用户真实业务任务和 DeepSearch research brief 生成领域化 benchmark rubric，不要套用 HR、客服或通用模板。",
              "所有面向用户展示的 title、description、displayName、criteria 必须使用中文。",
              "metricKey 和枚举字段可以使用英文机器标识，但不能作为展示名称。",
              "每个能力维度生成 1-3 个强相关指标，总指标数控制在 4-10 个。",
              "指标必须贴合该领域的真实验收标准，例如金融风控、采购比价、代码修复、医疗问诊、研究综述等领域应生成完全不同的指标。",
              "必须基于 DeepSearch research brief 中的论文、公开 benchmark、标准或框架设计指标；不要编造不存在的论文、URL 或 benchmark。",
              "每个 metric.references 必须包含 1-3 个来源，且至少一个来源的 sourceType 为 paper、public_benchmark 或 standard。",
              "criteria 和 rubricForm.description 要写清楚可复核的评分规则，并在关键规则后用 [referenceId] 形式标注依据。",
              "Return JSON only.",
              "Allowed capabilities: task_completion, instruction_following, factual_grounding, data_extraction, reasoning_quality, tool_use_correctness, format_compliance, latency_efficiency, safety_policy, business_judgment.",
              "Allowed evaluatorType for generated custom metrics: llm_judge, human_label.",
              "Use llm_judge for most metrics; use human_label only when the metric clearly requires domain expert review.",
              "Allowed domain: hr, finance, procurement, software, healthcare, research, custom.",
              'Allowed sourceType: paper, public_benchmark, standard, dataset, framework, documentation, research_report.',
              'Output schema: {"domain":"custom","title":"中文标题","description":"中文描述","researchSummary":"中文依据摘要","preferredCapabilities":["task_completion"],"modules":[{"capability":"task_completion","displayName":"中文能力维度","description":"中文说明","weight":3,"metrics":[{"metricKey":"machine_key","displayName":"中文指标名","description":"中文指标说明","evaluatorType":"llm_judge","weight":3,"passThreshold":3,"evidenceRequired":true,"humanApprovalRequired":true,"failureTags":["domain_issue"],"criteria":"中文评分准则，包含 [R1] 引用","rubricForm":[{"score":5,"label":"优秀","description":"中文评分说明，包含 [R1] 引用"},{"score":3,"label":"合格","description":"中文评分说明"},{"score":1,"label":"不合格","description":"中文评分说明"}],"references":[{"referenceId":"R1","title":"论文或公开 benchmark 标题","sourceType":"paper","url":"https://...","authors":["作者"],"publisher":"机构","year":2023,"benchmarkName":"benchmark 名称","relevance":"中文说明该来源如何支撑此指标","confidence":0.9}]}]}]}',
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
              "",
              "DeepSearch research brief (必须用于指标设计，优先复用 referenceId):",
              JSON.stringify({
                summary: researchBrief.summary,
                references: researchBrief.references,
              }, null, 2),
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
        researchSummary: researchBrief.summary,
        researchReferences: researchBrief.references,
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
  researchSummary: string;
  researchReferences: BenchmarkMetricReference[];
}): BenchmarkRubricSet | null {
  const modules = sanitizeLlmModules(input.parsed.modules, input.researchReferences);
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
    researchSummary: ensureChineseText(input.parsed.researchSummary, input.researchSummary),
    createdAt: now,
    updatedAt: now,
  };
}

function sanitizeLlmModules(
  value: LlmRubricModulePayload[] | undefined,
  researchReferences: BenchmarkMetricReference[],
): BenchmarkRubricModule[] {
  if (!Array.isArray(value)) return [];

  const usedMetricKeys = new Set<string>();
  return value
    .map((module) => {
      const rawCapability = module.capability;
      if (!rawCapability || !isBenchmarkCapabilityDimension(rawCapability)) return null;
      const capability: BenchmarkCapabilityDimension = rawCapability;

      const definition = getBenchmarkCapabilityDefinition(capability);
      const displayName = ensureChineseText(module.displayName, definition.displayName);
      const metrics = sanitizeLlmMetrics(module.metrics, capability, displayName, usedMetricKeys, researchReferences);
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
  researchReferences: BenchmarkMetricReference[],
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
          references: normalizeMetricReferences(metric.references, capability, researchReferences),
        },
      } satisfies BenchmarkRubricMetric;
    })
    .slice(0, 3);
}

export async function researchBenchmarkReferences(input: DraftBenchmarkRubricInput): Promise<RubricResearchBrief> {
  const fallback = buildFallbackResearchBrief(input);
  const model = readZevalEnvValue(["ZEVAL_RUBRIC_DEEPSEARCH_MODEL", "ZEVAL_DEEPSEARCH_MODEL"]);
  const providerOptions = readJsonEnvObject([
    "ZEVAL_RUBRIC_DEEPSEARCH_EXTRA_BODY",
    "ZEVAL_DEEPSEARCH_EXTRA_BODY",
  ]);

  const llm = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: [
          "你是 Zeval DeepSearch 研究员，请为 benchmark rubric 生成前置研究依据。",
          "如果当前模型或网关支持 DeepSearch / web research / online search，请必须使用该能力检索公开论文、公开 benchmark、行业标准或权威框架。",
          "只返回 JSON，不要输出 Markdown。",
          "不要编造来源。无法确认 URL 时可以省略 url，但必须降低 confidence。",
          "至少返回 6 个来源，其中至少 3 个 sourceType 为 paper 或 public_benchmark；来源要和用户任务领域相关。",
          "summary、relevance 必须使用中文。",
          'Output schema: {"summary":"中文研究摘要","references":[{"referenceId":"R1","title":"标题","sourceType":"paper","url":"https://...","authors":["作者"],"publisher":"机构","year":2023,"benchmarkName":"benchmark","relevance":"中文说明","confidence":0.9}],"suggestedMetricAngles":[{"capability":"task_completion","metricName":"中文指标方向","rationale":"中文理由","referenceIds":["R1"]}]}',
          "Allowed sourceType: paper, public_benchmark, standard, dataset, framework, documentation, research_report.",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          `Title: ${input.title}`,
          `Domain: ${input.domain}`,
          `Description: ${input.description}`,
          "Preferred capabilities:",
          (input.preferredCapabilities ?? []).join(", ") || "auto",
          "Requirement:",
          input.requirementText,
          "",
          "内置候选来源（DeepSearch 可复核、替换或补充）：",
          JSON.stringify(fallback.references, null, 2),
        ].join("\n\n"),
      },
    ],
    {
      stage: "benchmark_rubric_deepsearch",
      model,
      temperature: 0.1,
      seed: 41,
      providerOptions,
    },
  );

  const parsed = parseJsonObjectFromLlmOutput(llm) as LlmRubricResearchPayload;
  const references = dedupeReferences([
    ...normalizeResearchReferences(parsed.references),
    ...fallback.references,
  ]).slice(0, 10);
  if (references.length === 0) {
    throw new Error("DeepSearch 没有返回可用论文、benchmark 或标准来源。");
  }

  return {
    summary: ensureChineseText(
      parsed.summary,
      `DeepSearch 已结合 ${references.slice(0, 5).map((reference) => reference.referenceId ?? reference.title).join("、")} 等公开来源生成指标依据。`,
    ),
    references,
    source: "deepsearch",
  };
}

function buildFallbackResearchBrief(input: DraftBenchmarkRubricInput): RubricResearchBrief {
  const capabilities = (input.preferredCapabilities ?? [])
    .filter(isBenchmarkCapabilityDimension);
  const selectedCapabilities = capabilities.length
    ? capabilities
    : [
        "task_completion",
        "instruction_following",
        "factual_grounding",
        "reasoning_quality",
        "business_judgment",
      ] satisfies BenchmarkCapabilityDimension[];
  const references = dedupeReferences(
    selectedCapabilities.flatMap((capability) => benchmarkReferencesForCapability(capability)),
  ).slice(0, 10);
  return {
    summary: "指标体系参考 HELM、BIG-bench、MT-Bench、IFEval、RAGAS、ToolBench、AgentBench、NIST AI RMF 等公开论文、benchmark 与标准，并按当前任务需求选择能力维度。",
    references,
    source: "catalog",
  };
}

function normalizeMetricReferences(
  value: Array<LlmRubricReferencePayload | string> | undefined,
  capability: BenchmarkCapabilityDimension,
  researchReferences: BenchmarkMetricReference[],
): BenchmarkMetricReference[] {
  const candidateReferences = Array.isArray(value)
    ? value
        .map((item) => sanitizeReferencePayload(item, researchReferences))
        .filter((reference): reference is BenchmarkMetricReference => Boolean(reference))
    : [];
  const fallbackReferences = benchmarkReferencesForCapability(capability);
  const references = dedupeReferences(candidateReferences);
  const hasStrongBasis = references.some((reference) =>
    reference.sourceType === "paper" ||
    reference.sourceType === "public_benchmark" ||
    reference.sourceType === "standard",
  );
  const merged = hasStrongBasis
    ? references
    : dedupeReferences([...references, ...fallbackReferences]);
  return cloneMetricReferences(merged.slice(0, 3));
}

function normalizeResearchReferences(value: LlmRubricReferencePayload[] | undefined): BenchmarkMetricReference[] {
  if (!Array.isArray(value)) return [];
  return dedupeReferences(
    value
      .map((item) => sanitizeReferencePayload(item, []))
      .filter((reference): reference is BenchmarkMetricReference => Boolean(reference)),
  );
}

function sanitizeReferencePayload(
  value: LlmRubricReferencePayload | string,
  researchReferences: BenchmarkMetricReference[],
): BenchmarkMetricReference | null {
  if (typeof value === "string") {
    const match = findResearchReference(value, researchReferences);
    if (match) return cloneMetricReferences([match])[0] ?? null;
    const title = value.trim();
    if (!title) return null;
    return {
      title,
      sourceType: "research_report",
      relevance: "模型返回了该参考来源，但缺少结构化元数据；建议人工复核后使用。",
      confidence: 0.45,
    };
  }

  if (!isRecord(value)) return null;
  const referenceId = stringValue(value.referenceId);
  const base = referenceId ? findResearchReference(referenceId, researchReferences) : null;
  const title = stringValue(value.title) ?? base?.title;
  if (!title) return null;

  const rawSourceType = stringValue(value.sourceType);
  const sourceType = isBenchmarkReferenceSourceType(rawSourceType)
    ? rawSourceType
    : base?.sourceType ?? "research_report";
  const authors = normalizeAuthors(value.authors) ?? base?.authors;
  const year = normalizeYear(value.year) ?? base?.year;
  const confidence = clamp01(numberValue(value.confidence) ?? base?.confidence ?? 0.65);

  return {
    ...base,
    referenceId: referenceId ?? base?.referenceId,
    title,
    sourceType,
    url: stringValue(value.url) ?? base?.url,
    authors: authors ? [...authors] : undefined,
    publisher: stringValue(value.publisher) ?? base?.publisher,
    year,
    benchmarkName: stringValue(value.benchmarkName) ?? base?.benchmarkName,
    relevance: ensureChineseText(
      stringValue(value.relevance),
      base?.relevance ?? "该来源用于支撑指标定义、评分准则或证据复核方式。",
    ),
    confidence,
  };
}

function findResearchReference(
  key: string,
  references: BenchmarkMetricReference[],
): BenchmarkMetricReference | null {
  const normalized = key.trim().toLowerCase();
  if (!normalized) return null;
  return references.find((reference) =>
    reference.referenceId?.toLowerCase() === normalized ||
    reference.benchmarkName?.toLowerCase() === normalized ||
    reference.title.toLowerCase() === normalized,
  ) ?? null;
}

function dedupeReferences(references: BenchmarkMetricReference[]): BenchmarkMetricReference[] {
  const seen = new Set<string>();
  const result: BenchmarkMetricReference[] = [];
  for (const reference of references) {
    const key = [
      reference.referenceId,
      reference.url,
      reference.title,
    ].find((item) => item?.trim())?.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      ...reference,
      authors: reference.authors ? [...reference.authors] : undefined,
    });
  }
  return result;
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

function readJsonEnvObject(keys: string[]): Record<string, unknown> | undefined {
  const raw = readZevalEnvValue(keys);
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeAuthors(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const authors = value.map((item) => String(item).trim()).filter(Boolean);
    return authors.length ? authors.slice(0, 6) : undefined;
  }
  if (typeof value === "string") {
    const authors = value.split(/[,;；、]/).map((item) => item.trim()).filter(Boolean);
    return authors.length ? authors.slice(0, 6) : undefined;
  }
  return undefined;
}

function normalizeYear(value: unknown): number | undefined {
  const year = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : undefined;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
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

function isBenchmarkReferenceSourceType(value: string | undefined): value is BenchmarkReferenceSourceType {
  return Boolean(value && ALLOWED_REFERENCE_SOURCE_TYPES.includes(value as BenchmarkReferenceSourceType));
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
