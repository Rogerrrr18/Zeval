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
import { inferBenchmarkTaskType, renderEvalAnythingPhilosophyPrompt } from "@/benchmark/eval-anything-philosophy";
import { consolidateSparseLlmModules } from "@/benchmark/rubric-structure";
import type {
  BenchmarkCapabilityDimension,
  BenchmarkDomain,
  BenchmarkEvaluatorConfig,
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
  outputPath?: string;
  expectedPath?: string;
  pattern?: string;
  tolerance?: number;
  predictedItemsPath?: string;
  expectedItemsPath?: string;
  childMetricKeys?: string[];
  config?: LlmEvaluatorConfigPayload;
  rubricForm?: LlmRubricScoreLevelPayload[];
  references?: Array<LlmRubricReferencePayload | string>;
};

type LlmEvaluatorConfigPayload = {
  outputPath?: unknown;
  expectedPath?: unknown;
  pattern?: unknown;
  tolerance?: unknown;
  predictedItemsPath?: unknown;
  expectedItemsPath?: unknown;
  childMetricKeys?: unknown;
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

const GENERATED_RUBRIC_EVALUATORS: BenchmarkEvaluatorType[] = [
  "llm_judge",
  "human_label",
  "exact_match",
  "regex_match",
  "numeric_tolerance",
  "f1_match",
  "code_exec",
  "unit_test",
  "environment_state_test",
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
              renderEvalAnythingPhilosophyPrompt(),
              "请根据用户真实业务任务和 DeepSearch research brief 生成领域化 benchmark rubric，不要套用 HR、客服或通用模板。",
              "必须先判断任务类型，并把指标设计成 task world / target / harness / judge 可以执行和复核的结构。",
              "不要把完整应用、RAG、workspace agent 或工具调用任务误当成裸 LLM 问答；必要时在 criteria 里明确环境状态、工具调用、引用证据或可执行验收逻辑。",
              "保留 raw baseline 的思想：指标应能解释复杂 agent/harness 相比基线的真实增益，而不是只奖励冗长推理。",
              "主观指标要为 Judge Panel 设计：评分档必须可被多个 judge 独立判断，并能暴露 panel_disagree 的边界。",
              "所有面向用户展示的 title、description、displayName、criteria 必须使用中文。",
              "metricKey 和枚举字段可以使用英文机器标识，但不能作为展示名称。",
              "结构要求：生成 3-5 个一级能力维度（modules），每个维度下必须有 2-3 个二级指标（metrics）；禁止把每个指标单独做成一个 module。",
              "每个能力维度生成 2-3 个强相关指标，总指标数控制在 6-12 个；首轮建议至少生成 6 个可区分指标，最低可运行门槛为 3 个。",
              "一级维度应按业务逻辑归并（如「问题承接与解决」「情绪服务」「事实与合规」），其下挂多个可独立评分的二级指标。",
              "每个 metric 的 rubricForm 必须包含至少 3 个离散档位（建议 1/3/5），并为每个档位提供可复核 description；可为档位补充 fewshot 示例片段。",
              "指标必须贴合该领域的真实验收标准，例如金融风控、采购比价、代码修复、医疗问诊、研究综述等领域应生成完全不同的指标。",
              "必须基于 DeepSearch research brief 中的论文、公开 benchmark、标准或框架设计指标；不要编造不存在的论文、URL 或 benchmark。",
              "每个 metric.references 必须包含 1-3 个来源，且至少一个来源的 sourceType 为 paper、public_benchmark 或 standard。",
              "criteria 和 rubricForm.description 要写清楚可复核的评分规则，并在关键规则后用 [referenceId] 形式标注依据。",
              "Return JSON only.",
              "Allowed capabilities: task_completion, instruction_following, factual_grounding, data_extraction, reasoning_quality, tool_use_correctness, format_compliance, latency_efficiency, safety_policy, business_judgment.",
              "Allowed evaluatorType for generated custom metrics: llm_judge, human_label, exact_match, regex_match, numeric_tolerance, f1_match, code_exec, unit_test, environment_state_test.",
              "Evaluator selection rule: use objective evaluators whenever the expected answer can be checked mechanically; use llm_judge only for open-ended semantic quality; use human_label only for high-risk domain expert review.",
              "For exact_match you must provide outputPath and expectedPath, e.g. parsedOutput.decision vs expected.decision.",
              "For regex_match you must provide pattern and preferably outputPath, e.g. JSON/schema/format checks.",
              "For numeric_tolerance you must provide outputPath, expectedPath and tolerance.",
              "For f1_match you must provide predictedItemsPath and expectedItemsPath for entity/list coverage.",
              "For code_exec, unit_test, environment_state_test, only use them when the harness can produce evaluatorResults artifacts.",
              "Allowed domain: hr, finance, procurement, software, healthcare, research, custom.",
              'Allowed sourceType: paper, public_benchmark, standard, dataset, framework, documentation, research_report.',
              'Output schema: {"domain":"custom","title":"中文标题","description":"中文描述","researchSummary":"中文依据摘要","preferredCapabilities":["task_completion","business_judgment"],"modules":[{"capability":"task_completion","displayName":"问题承接与解决","description":"中文说明","weight":3,"metrics":[{"metricKey":"decision_accuracy","displayName":"决策准确率","description":"中文指标说明","evaluatorType":"exact_match","outputPath":"parsedOutput.decision","expectedPath":"expected.decision","weight":3,"passThreshold":3,"evidenceRequired":false,"humanApprovalRequired":false,"failureTags":["wrong_decision"],"criteria":"中文评分准则，包含 [R1] 引用","rubricForm":[{"score":5,"label":"优秀","description":"中文评分说明，包含 [R1] 引用"},{"score":3,"label":"合格","description":"中文评分说明"},{"score":1,"label":"不合格","description":"中文评分说明"}],"references":[{"referenceId":"R1","title":"论文或公开 benchmark 标题","sourceType":"paper","url":"https://...","authors":["作者"],"publisher":"机构","year":2023,"benchmarkName":"benchmark 名称","relevance":"中文说明该来源如何支撑此指标","confidence":0.9}]},{"metricKey":"solution_quality","displayName":"解决方案可执行性","description":"中文指标说明","evaluatorType":"llm_judge","weight":3,"passThreshold":3,"evidenceRequired":true,"humanApprovalRequired":true,"failureTags":["domain_issue"],"criteria":"中文评分准则","rubricForm":[{"score":5,"label":"优秀","description":"中文评分说明"},{"score":3,"label":"合格","description":"中文评分说明"},{"score":1,"label":"不合格","description":"中文评分说明"}],"references":[{"referenceId":"R1","title":"来源标题","sourceType":"paper","url":"https://...","relevance":"中文说明","confidence":0.9}]}]}]}',
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Title: ${input.title}`,
              `Domain: ${input.domain}`,
              `Description: ${input.description}`,
              `Inferred task type: ${inferBenchmarkTaskType({ requirementText: input.requirementText })}`,
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
        {
          stage: "benchmark_rubric_draft",
          temperature: 0.2,
          seed: 42,
          maxTokens: 8192,
          timeoutMs: 120000,
        },
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
      const llmBuild = buildRubricFromLlmPayload({
        parsed,
        fallbackTitle: title,
        fallbackDescription: description,
        fallbackDomain: domain,
        researchSummary: researchBrief.summary,
        researchReferences: researchBrief.references,
      });
      llmRubric = llmBuild.rubric;
      warnings.push(...llmBuild.warnings);
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

  if (input.useLlm && llmRubric) {
    return {
      rubric: llmRubric,
      reviewMarkdown: renderRubricReviewMarkdown(llmRubric),
      source,
      warnings,
    };
  }

  if (input.useLlm && !llmRubric) {
    warnings.push(
      "LLM 评分标准生成失败，已回退到内置能力模板。请检查 API 配置后重试，或继续在助手中增补指标。",
    );
    source = "template";
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
}): { rubric: BenchmarkRubricSet | null; warnings: string[] } {
  const structureWarnings: string[] = [];
  const sanitized = sanitizeLlmModules(input.parsed.modules, input.researchReferences);
  if (sanitized.length === 0) {
    return { rubric: null, warnings: structureWarnings };
  }

  const { modules, consolidated } = consolidateSparseLlmModules(sanitized);
  if (consolidated) {
    structureWarnings.push(
      "模型将每个指标拆成了独立能力维度，已自动归并为「一级维度 → 多个二级指标」结构；可在助手中继续微调。",
    );
  }
  if (modules.length === 0) {
    return { rubric: null, warnings: structureWarnings };
  }

  const now = new Date().toISOString();
  const domain = isBenchmarkDomain(input.parsed.domain) ? input.parsed.domain : input.fallbackDomain;
  return {
    rubric: {
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
    },
    warnings: structureWarnings,
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
      const requestedEvaluatorType: BenchmarkEvaluatorType = rawEvaluatorType && isGeneratedRubricEvaluator(rawEvaluatorType)
        ? rawEvaluatorType
        : inferGeneratedRubricEvaluator(metric, capability, metricKey, displayName);
      const evaluatorConfig = normalizeGeneratedEvaluatorConfig({
        metric,
        evaluatorType: requestedEvaluatorType,
        capability,
        metricKey,
        displayName,
      });
      const evaluatorType = evaluatorConfig.evaluatorType;

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
          ...evaluatorConfig.config,
          rubricForm: normalizeRubricForm(metric.rubricForm, displayName),
          references: normalizeMetricReferences(metric.references, capability, researchReferences),
        },
      } satisfies BenchmarkRubricMetric;
    })
    .slice(0, 3);
}

/**
 * Infer the best generated evaluator when the LLM omits evaluatorType.
 *
 * @param metric Raw LLM metric payload.
 * @param capability Parent capability dimension.
 * @param metricKey Stable metric key after sanitization.
 * @param displayName User-facing metric name.
 * @returns Evaluator type biased toward objective checks when the signal is structured.
 */
function inferGeneratedRubricEvaluator(
  metric: LlmRubricMetricPayload,
  capability: BenchmarkCapabilityDimension,
  metricKey: string,
  displayName: string,
): BenchmarkEvaluatorType {
  const text = `${capability}\n${metricKey}\n${displayName}\n${metric.description ?? ""}\n${metric.criteria ?? ""}`.toLowerCase();
  if (capability === "data_extraction" || /(entity|entities|field|slot|extract|coverage|覆盖|抽取|字段|实体|要点)/i.test(text)) {
    return "f1_match";
  }
  if (capability === "format_compliance" || /(format|schema|json|csv|xml|regex|结构|格式|模板)/i.test(text)) {
    return "regex_match";
  }
  if (capability === "latency_efficiency" || /(latency|duration|runtime|cost|budget|timeout|ms|seconds|时延|耗时|成本|预算|超时)/i.test(text)) {
    return "numeric_tolerance";
  }
  if (capability === "tool_use_correctness" || /(tool|api|browser|file|database|environment|state|工具|调用|文件|数据库|环境状态)/i.test(text)) {
    return "environment_state_test";
  }
  if (capability === "safety_policy" || /(safety|privacy|bias|policy|pii|compliance|安全|隐私|偏见|合规)/i.test(text)) {
    return "human_label";
  }
  if (/(accuracy|decision|classification|label|pass|fail|match|准确率|决策|分类|标签|是否|命中)/i.test(text)) {
    return "exact_match";
  }
  return "llm_judge";
}

/**
 * Build evaluator config for generated custom metrics and downgrade unrunnable
 * objective evaluators to llm_judge when required paths are absent.
 *
 * @param input Raw metric and evaluator context.
 * @returns Runnable evaluator type plus evaluator-specific config.
 */
function normalizeGeneratedEvaluatorConfig(input: {
  metric: LlmRubricMetricPayload;
  evaluatorType: BenchmarkEvaluatorType;
  capability: BenchmarkCapabilityDimension;
  metricKey: string;
  displayName: string;
}): { evaluatorType: BenchmarkEvaluatorType; config: BenchmarkEvaluatorConfig } {
  const rawConfig = isRecord(input.metric.config) ? input.metric.config : {};
  const config: BenchmarkEvaluatorConfig = {};
  const outputPath = stringValue(input.metric.outputPath) ?? stringValue(rawConfig.outputPath);
  const expectedPath = stringValue(input.metric.expectedPath) ?? stringValue(rawConfig.expectedPath);
  const pattern = stringValue(input.metric.pattern) ?? stringValue(rawConfig.pattern);
  const tolerance = numberValue(input.metric.tolerance) ?? numberValue(rawConfig.tolerance);
  const predictedItemsPath = stringValue(input.metric.predictedItemsPath) ?? stringValue(rawConfig.predictedItemsPath);
  const expectedItemsPath = stringValue(input.metric.expectedItemsPath) ?? stringValue(rawConfig.expectedItemsPath);
  const childMetricKeys = normalizeChildMetricKeys(input.metric.childMetricKeys ?? rawConfig.childMetricKeys);

  switch (input.evaluatorType) {
    case "exact_match": {
      const inferred = inferExactMatchPaths(input.metricKey, input.displayName, input.capability);
      const finalOutputPath = outputPath ?? inferred.outputPath;
      const finalExpectedPath = expectedPath ?? inferred.expectedPath;
      if (!finalOutputPath || !finalExpectedPath) return { evaluatorType: "llm_judge", config };
      return {
        evaluatorType: "exact_match",
        config: { ...config, outputPath: finalOutputPath, expectedPath: finalExpectedPath },
      };
    }
    case "regex_match": {
      const finalPattern = pattern ?? inferRegexPattern(input.metricKey, input.displayName, input.capability);
      if (!finalPattern) return { evaluatorType: "llm_judge", config };
      return {
        evaluatorType: "regex_match",
        config: {
          ...config,
          pattern: finalPattern,
          outputPath: outputPath ?? inferFormatOutputPath(input.metricKey, input.displayName),
        },
      };
    }
    case "numeric_tolerance": {
      const inferred = inferNumericTolerancePaths(input.metricKey, input.displayName, input.capability);
      const finalOutputPath = outputPath ?? inferred.outputPath;
      const finalExpectedPath = expectedPath ?? inferred.expectedPath;
      if (!finalOutputPath || !finalExpectedPath) return { evaluatorType: "llm_judge", config };
      return {
        evaluatorType: "numeric_tolerance",
        config: {
          ...config,
          outputPath: finalOutputPath,
          expectedPath: finalExpectedPath,
          tolerance: tolerance ?? inferred.tolerance ?? 0,
        },
      };
    }
    case "f1_match": {
      const inferred = inferF1Paths(input.metricKey, input.displayName, input.capability);
      const finalPredictedPath = predictedItemsPath ?? inferred.predictedItemsPath;
      const finalExpectedItemsPath = expectedItemsPath ?? inferred.expectedItemsPath;
      if (!finalPredictedPath || !finalExpectedItemsPath) return { evaluatorType: "llm_judge", config };
      return {
        evaluatorType: "f1_match",
        config: {
          ...config,
          predictedItemsPath: finalPredictedPath,
          expectedItemsPath: finalExpectedItemsPath,
        },
      };
    }
    case "hybrid":
      return childMetricKeys.length
        ? { evaluatorType: "hybrid", config: { ...config, childMetricKeys } }
        : { evaluatorType: "llm_judge", config };
    default:
      return { evaluatorType: input.evaluatorType, config };
  }
}

/**
 * Infer standard exact-match paths for common classification fields.
 *
 * @param metricKey Stable metric key.
 * @param displayName User-facing metric name.
 * @param capability Parent capability dimension.
 * @returns Output and expected dot paths when a safe convention is available.
 */
function inferExactMatchPaths(
  metricKey: string,
  displayName: string,
  capability: BenchmarkCapabilityDimension,
): Pick<BenchmarkEvaluatorConfig, "outputPath" | "expectedPath"> {
  const text = `${metricKey}\n${displayName}`.toLowerCase();
  if (/(decision|决策|筛选|accept|reject|通过|拒绝)/i.test(text) || capability === "business_judgment") {
    return { outputPath: "parsedOutput.decision", expectedPath: "expected.decision" };
  }
  if (/(label|class|category|分类|标签|类别)/i.test(text)) {
    return { outputPath: "parsedOutput.label", expectedPath: "expected.label" };
  }
  if (/(answer|答案|结果)/i.test(text)) {
    return { outputPath: "parsedOutput.answer", expectedPath: "expected.answer" };
  }
  return {};
}

/**
 * Infer regex patterns for common format-compliance checks.
 *
 * @param metricKey Stable metric key.
 * @param displayName User-facing metric name.
 * @param capability Parent capability dimension.
 * @returns Regex pattern, or undefined when no safe default exists.
 */
function inferRegexPattern(
  metricKey: string,
  displayName: string,
  capability: BenchmarkCapabilityDimension,
): string | undefined {
  const text = `${metricKey}\n${displayName}`.toLowerCase();
  if (capability === "format_compliance" || /json|schema|结构|格式/.test(text)) return "\\{[\\s\\S]*\\}";
  if (/csv/.test(text)) return "^[^\\n,]+(,[^\\n,]+)+";
  return undefined;
}

/**
 * Infer the output path used for format checks.
 *
 * @param metricKey Stable metric key.
 * @param displayName User-facing metric name.
 * @returns Dot path into parsed submission output.
 */
function inferFormatOutputPath(metricKey: string, displayName: string): string | undefined {
  const text = `${metricKey}\n${displayName}`.toLowerCase();
  if (/json|schema|结构|格式/.test(text)) return "parsedOutput";
  return undefined;
}

/**
 * Infer numeric tolerance paths for latency, budget and score metrics.
 *
 * @param metricKey Stable metric key.
 * @param displayName User-facing metric name.
 * @param capability Parent capability dimension.
 * @returns Numeric output path, expected path and default tolerance when safe.
 */
function inferNumericTolerancePaths(
  metricKey: string,
  displayName: string,
  capability: BenchmarkCapabilityDimension,
): Pick<BenchmarkEvaluatorConfig, "outputPath" | "expectedPath" | "tolerance"> {
  const text = `${metricKey}\n${displayName}`.toLowerCase();
  if (capability === "latency_efficiency" || /(latency|duration|runtime|timeout|时延|耗时|超时)/i.test(text)) {
    return { outputPath: "durationMs", expectedPath: "expected.maxDurationMs", tolerance: 0 };
  }
  if (/(cost|budget|token|成本|预算)/i.test(text)) {
    return { outputPath: "cost", expectedPath: "expected.maxCost", tolerance: 0 };
  }
  if (/(score|分数|评分)/i.test(text)) {
    return { outputPath: "parsedOutput.score", expectedPath: "expected.score", tolerance: 0 };
  }
  return {};
}

/**
 * Infer list coverage paths for entity and key-point extraction.
 *
 * @param metricKey Stable metric key.
 * @param displayName User-facing metric name.
 * @param capability Parent capability dimension.
 * @returns Predicted and expected list paths when safe.
 */
function inferF1Paths(
  metricKey: string,
  displayName: string,
  capability: BenchmarkCapabilityDimension,
): Pick<BenchmarkEvaluatorConfig, "predictedItemsPath" | "expectedItemsPath"> {
  const text = `${metricKey}\n${displayName}`.toLowerCase();
  if (capability === "data_extraction" || /(entity|entities|实体|字段|抽取)/i.test(text)) {
    return { predictedItemsPath: "parsedOutput.entities", expectedItemsPath: "expected.entities" };
  }
  if (/(key.?point|要点|coverage|覆盖)/i.test(text)) {
    return { predictedItemsPath: "parsedOutput.keyPoints", expectedItemsPath: "expected.keyPoints" };
  }
  return {};
}

/**
 * Normalize child metric keys for hybrid metric configs.
 *
 * @param value Raw child metric key payload.
 * @returns Non-empty child metric keys.
 */
function normalizeChildMetricKeys(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 8);
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
          renderEvalAnythingPhilosophyPrompt(),
          "如果当前模型或网关支持 DeepSearch / web research / online search，请必须使用该能力检索公开论文、公开 benchmark、行业标准或权威框架。",
          "检索目标要覆盖 task world / environment、target 系统、harness/agent 架构、judge panel 或人类偏好评价方法。",
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
          `Inferred task type: ${inferBenchmarkTaskType({ requirementText: input.requirementText })}`,
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
      maxTokens: 4096,
      timeoutMs: 90000,
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

function isGeneratedRubricEvaluator(value: string): value is BenchmarkEvaluatorType {
  return isBenchmarkEvaluatorType(value) && GENERATED_RUBRIC_EVALUATORS.includes(value);
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
