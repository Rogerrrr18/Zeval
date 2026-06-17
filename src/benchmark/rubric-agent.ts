/**
 * @fileoverview Interactive rubric agent for Benchmark Workbench.
 *
 * The agent receives the user's current task requirement and rubric, decides
 * which rubric tools to call, applies them, and returns a concise Chinese reply.
 */

import { randomBytes } from "node:crypto";
import {
  draftBenchmarkRubric,
  researchBenchmarkReferences,
  type RubricResearchBrief,
} from "@/benchmark/copilot";
import { getBenchmarkCapabilityDefinition } from "@/benchmark/capabilities";
import { buildRubricMetricCountWarnings } from "@/benchmark/rubric-guards";
import { benchmarkReferencesForCapability, cloneMetricReferences } from "@/benchmark/reference-catalog";
import { inferBenchmarkTaskType, renderEvalAnythingPhilosophyPrompt } from "@/benchmark/eval-anything-philosophy";
import { ZEVAL_AGENT_CAPABILITY_CONTRACT, ZEVAL_AGENT_PERMISSION_SUMMARY } from "@/copilot/agent-contract";
import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import type {
  BenchmarkCapabilityDimension,
  BenchmarkEvaluatorType,
  BenchmarkMetricReference,
  BenchmarkReferenceSourceType,
  BenchmarkRubricApprovalStatus,
  BenchmarkRubricMetric,
  BenchmarkRubricScoreLevel,
  BenchmarkRubricSet,
} from "@/benchmark/types";

type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type RunBenchmarkRubricAgentInput = {
  messages: ChatMessage[];
  requirementText: string;
  rubric?: BenchmarkRubricSet | null;
  knowledgeContext?: string;
  signal?: AbortSignal;
};

export type RunBenchmarkRubricAgentResult = {
  reply: string;
  requirementText: string;
  rubric: BenchmarkRubricSet | null;
  toolCalls: Array<{ name: string; summary: string }>;
  toolTrace: RubricAgentToolTrace[];
  runSummary: RubricAgentRunSummary;
  warnings: string[];
};

export type RubricAgentToolTrace = {
  name: string;
  label: string;
  status: "success" | "warning" | "fallback" | "error";
  summary: string;
  detail?: string;
  durationMs: number;
  stats?: {
    references?: number;
    modules?: number;
    metrics?: number;
  };
};

export type RubricAgentRunSummary = {
  usedFallback: boolean;
  modules: number;
  metrics: number;
  references: number;
  generatedBy?: string;
  changedMetrics: string[];
  warnings: string[];
};

type AgentPayload = {
  reply?: string;
  tools?: AgentToolCallPayload[];
};

type AgentToolCallPayload = {
  name?: string;
  arguments?: Record<string, unknown>;
};

const ALLOWED_CAPABILITIES: BenchmarkCapabilityDimension[] = [
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

const ALLOWED_EVALUATORS: BenchmarkEvaluatorType[] = [
  "llm_judge",
  "human_label",
  "exact_match",
  "regex_match",
  "numeric_tolerance",
  "f1_match",
  "code_exec",
  "unit_test",
  "environment_state_test",
  "hybrid",
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

export async function runBenchmarkRubricAgent(
  input: RunBenchmarkRubricAgentInput,
): Promise<RunBenchmarkRubricAgentResult> {
  const latestUserText = [...input.messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "";
  const knowledgeContext = input.knowledgeContext?.trim() ?? "";
  const warnings: string[] = [];
  let requirementText = input.requirementText.trim();
  let rubric = input.rubric ?? null;
  let researchBrief: RubricResearchBrief | null = null;
  const toolCalls: Array<{ name: string; summary: string }> = [];
  const toolTrace: RubricAgentToolTrace[] = [];

  let payload: AgentPayload | null = null;
  try {
    const raw = await requestSiliconFlowChatCompletion(
      [
        {
          role: "system",
          content: [
            "你是 Zeval 评测工作台里的 Rubric Agent，也是 Zeval 全能工作台 Agent 的 benchmark 专家模式。",
            ZEVAL_AGENT_CAPABILITY_CONTRACT,
            ZEVAL_AGENT_PERMISSION_SUMMARY,
            renderEvalAnythingPhilosophyPrompt(),
            "你的职责是理解用户提出的评测任务需求、约束和修改意图，并通过工具调整当前评测 rubric。",
            "你的评测哲学必须与 Eval-Anything 对齐：先识别任务世界与被测目标，再设计 harness-aware、judge-panel-ready、证据可追溯的指标。",
            "用户可以在右侧助手中提出任何任务需求：生成评分标准、改领域、增加/删除/合并指标、调整权重、补充评分表单、确认指标、解释当前 rubric。",
            "如果用户要求诊断评测流程，你要指出当前缺少的数据、评分标准、运行结果或人工校验环节；如果超出当前工具能力，要说明需要接入对应工具。",
            "你必须优先判断是否需要调用工具；只有纯解释问题才不调用工具。",
            "当用户要求生成 rubric、重新生成指标、增加指标、重写评分准则、让指标更 solid 或要求参考依据时，必须先调用 research_benchmark_references，再调用 draft_rubric/add_metric/update_metric。",
            "除非用户只是确认、拒绝、删除、改权重或解释当前 rubric，否则不要跳过 benchmark/reference 研究。",
            knowledgeContext
              ? "你已接入用户本地知识库上下文。生成或修改 rubric 时，必须优先从本地知识库提取行业流程、验收标准、风险边界、字段 schema、正负例和术语；不要把它们当成通用参考文案。"
              : "如果缺少本地行业知识库，你要明确指出当前只能依赖任务描述和公开 benchmark/reference。",
            knowledgeContext
              ? "如果某个指标由本地知识库支持，criteria 或 references.relevance 中必须保留 provenance（fileId、chunkId、lines），便于用户追溯来源。"
              : "",
            "所有展示给用户的文本必须使用中文；metricKey 等机器字段可以用英文。",
            "Return JSON only.",
            "可用工具：",
            "- set_requirement: 更新任务需求。参数 {requirementText}",
            "- research_benchmark_references: 主动检索公开 benchmark、论文、标准或评测框架，为 rubric/metric 提供依据。参数 {requirementText?, focus?}",
            "- draft_rubric: 根据任务需求重新生成领域化评分标准。参数 {requirementText?}",
            "- add_metric: 增加指标。参数 {capability, displayName, description, weight, evaluatorType, criteria, rubricForm?, references?}",
            "- update_metric: 修改指标。参数 {metricKey? 或 displayName?, displayName?, description?, weight?, passThreshold?, evaluatorType?, criteria?, approvalStatus?, evidenceRequired?, humanApprovalRequired?, rubricForm?, references?}",
            "- delete_metric: 删除指标。参数 {metricKey? 或 displayName?}",
            "- approve_metric: 确认指标。参数 {metricKey? 或 displayName?}",
            "- approve_all_metrics: 确认全部候选指标。参数 {}",
            "- reject_metric: 拒绝指标。参数 {metricKey? 或 displayName?}",
            "- explain_rubric: 解释当前评分标准。参数 {}",
            "输出格式：",
            '{"reply":"给用户的中文回复","tools":[{"name":"工具名","arguments":{}}]}',
          ].join("\n"),
        },
        {
          role: "user",
          content: [
            "当前任务需求：",
            requirementText || "尚未填写",
            "",
            `推断任务类型：${inferBenchmarkTaskType({ requirementText, rubric })}`,
            "",
            "当前 rubric 摘要：",
            summarizeRubric(rubric),
            "",
            knowledgeContext ? "本地知识库上下文：" : "",
            knowledgeContext,
            knowledgeContext ? "" : "",
            "最近对话：",
            input.messages.slice(-8).map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n"),
            "",
            "请决定要调用哪些工具。",
          ].join("\n"),
        },
      ],
      { stage: "benchmark_rubric_agent", temperature: 0.1, seed: 47, signal: input.signal },
    );
    payload = parseJsonObjectFromLlmOutput(raw) as AgentPayload;
  } catch (error) {
    if (input.signal?.aborted) {
      throw error;
    }
    warnings.push(`Rubric Agent 调用失败，已使用本地规则兜底：${error instanceof Error ? error.message : String(error)}`);
    payload = buildFallbackPayload(latestUserText, requirementText, rubric);
  }
  payload = repairAgentToolPlan(payload, { latestUserText, requirementText, rubric });

  for (const tool of payload?.tools ?? []) {
    const startedAt = Date.now();
    try {
      const beforeRubric = rubric;
      const result = await applyToolCall({ tool, rubric, requirementText, latestUserText, researchBrief, knowledgeContext });
      if (result.requirementText !== undefined) requirementText = result.requirementText;
      if (result.rubric !== undefined) rubric = result.rubric;
      if (result.researchBrief !== undefined) researchBrief = result.researchBrief;
      if (result.warning) warnings.push(result.warning);
      if (result.summary) toolCalls.push({ name: tool.name ?? "unknown", summary: result.summary });
      toolTrace.push(buildToolTrace({
        tool,
        result,
        beforeRubric,
        afterRubric: rubric,
        durationMs: Date.now() - startedAt,
      }));
    } catch (error) {
      if (input.signal?.aborted) {
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${tool.name ?? "unknown"} 执行失败：${message}`);
      toolTrace.push({
        name: tool.name ?? "unknown",
        label: toolLabel(tool.name),
        status: "error",
        summary: "工具执行失败",
        detail: message,
        durationMs: Date.now() - startedAt,
      });
    }
  }

  warnings.push(...buildRubricMetricCountWarnings(rubric));
  const runSummary = buildRunSummary(rubric, toolTrace, warnings);
  const reply = buildReply(payload?.reply, toolCalls, toolTrace, runSummary, rubric, requirementText, latestUserText);
  return {
    reply,
    requirementText,
    rubric: rubric ? localizeRubric(rubric) : null,
    toolCalls,
    toolTrace,
    runSummary,
    warnings,
  };
}

/**
 * Repair incomplete model tool plans so generation/editing requests do not stop after research only.
 *
 * @param payload Model-proposed tool plan.
 * @param context Current user intent and rubric state.
 * @returns Repaired tool plan.
 */
function repairAgentToolPlan(
  payload: AgentPayload | null,
  context: { latestUserText: string; requirementText: string; rubric: BenchmarkRubricSet | null },
): AgentPayload {
  const tools = [...(payload?.tools ?? [])];
  const names = new Set(tools.map((tool) => tool.name).filter(Boolean));
  const requestText = [context.latestUserText, context.requirementText].filter(Boolean).join("\n");
  const shouldGenerate = shouldGenerateOrRewriteRubric(requestText, context.rubric);

  if (shouldGenerate && !names.has("set_requirement")) {
    tools.unshift({
      name: "set_requirement",
      arguments: { requirementText: context.latestUserText || context.requirementText },
    });
    names.add("set_requirement");
  }

  if (shouldGenerate && !names.has("research_benchmark_references")) {
    tools.push({
      name: "research_benchmark_references",
      arguments: { requirementText: context.latestUserText || context.requirementText },
    });
    names.add("research_benchmark_references");
  }

  const hasRubricMutation = tools.some((tool) =>
    tool.name === "draft_rubric" ||
    tool.name === "add_metric" ||
    tool.name === "update_metric" ||
    tool.name === "delete_metric" ||
    tool.name === "approve_metric" ||
    tool.name === "approve_all_metrics" ||
    tool.name === "reject_metric"
  );

  if (shouldGenerate && !hasRubricMutation) {
    tools.push({
      name: "draft_rubric",
      arguments: { requirementText: context.latestUserText || context.requirementText },
    });
  }

  return {
    reply: payload?.reply,
    tools,
  };
}

/**
 * Decide whether the latest user intent requires a concrete rubric mutation.
 *
 * @param text Combined latest user request and current requirement.
 * @param rubric Current rubric.
 * @returns Whether the agent must generate or rewrite rubric content.
 */
function shouldGenerateOrRewriteRubric(text: string, rubric: BenchmarkRubricSet | null): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (!rubric) return !/(解释|说明|为什么|怎么看|确认|通过|删除)/.test(normalized);
  return /(生成|重新|重做|改|调整|优化|完善|补充|更合理|不合理|二级指标|评分标准|rubric|指标体系|指标)/i.test(normalized)
    && !/(解释|说明|为什么|确认全部|全部确认|通过全部)/.test(normalized);
}

async function applyToolCall(input: {
  tool: AgentToolCallPayload;
  rubric: BenchmarkRubricSet | null;
  requirementText: string;
  latestUserText: string;
  researchBrief: RubricResearchBrief | null;
  knowledgeContext: string;
}): Promise<{
  rubric?: BenchmarkRubricSet | null;
  requirementText?: string;
  researchBrief?: RubricResearchBrief | null;
  summary?: string;
  warning?: string;
}> {
  const name = input.tool.name;
  const args = input.tool.arguments ?? {};

  if (name === "set_requirement") {
    const next = stringArg(args.requirementText) || input.latestUserText || input.requirementText;
    return { requirementText: next, summary: "已更新任务需求" };
  }

  if (name === "research_benchmark_references") {
    const requirementText = stringArg(args.requirementText) || input.requirementText || input.latestUserText;
    const researchRequirement = buildKnowledgeAugmentedRequirement(
      buildResearchRequirement(requirementText, stringArg(args.focus)),
      input.knowledgeContext,
    );
    if (!requirementText.trim()) {
      return { warning: "缺少任务需求，无法检索 benchmark 与参考文献。" };
    }
    const research = await safeResearchBenchmarkReferences({
      title: "自定义评测任务",
      description: requirementText,
      domain: "custom",
      requirementText: researchRequirement,
      useLlm: true,
    });
    return {
      requirementText,
      researchBrief: research,
      summary: `已主动检索 ${research.references.length} 个 benchmark/论文/标准来源`,
    };
  }

  if (name === "draft_rubric") {
    const requirementText = stringArg(args.requirementText) || input.requirementText || input.latestUserText;
    const generationRequirement = buildKnowledgeAugmentedRequirement(requirementText, input.knowledgeContext);
    if (!requirementText.trim()) {
      return { warning: "缺少任务需求，无法生成评分标准。" };
    }
    const research = input.researchBrief ?? await safeResearchBenchmarkReferences({
      title: "自定义评测任务",
      description: requirementText,
      domain: "custom",
      requirementText: generationRequirement,
      useLlm: true,
    });
    const result = await draftBenchmarkRubric({
      title: "自定义评测任务",
      description: requirementText,
      domain: "custom",
      requirementText: generationRequirement,
      useLlm: true,
      researchBrief: research,
    });
    return {
      requirementText,
      researchBrief: research,
      rubric: localizeRubric(result.rubric),
      summary: `已基于 ${research.references.length} 个参考来源生成 ${result.rubric.modules.length} 个能力维度的评分标准`,
      warning: result.warnings.join("；") || undefined,
    };
  }

  if (!input.rubric) {
    return { warning: "当前还没有评分标准，请先描述任务并生成 rubric。" };
  }

  if (name === "add_metric") {
    const research = input.researchBrief ?? await ensureResearchForRubricEdit(
      input.requirementText,
      input.latestUserText,
      input.knowledgeContext,
    );
    const result = addMetric(input.rubric, args, research);
    return { rubric: result.rubric, researchBrief: research, summary: result.summary };
  }

  if (name === "update_metric") {
    const needsResearch = modifiesMetricBasis(args);
    const research = needsResearch && !input.researchBrief
      ? await ensureResearchForRubricEdit(input.requirementText, input.latestUserText, input.knowledgeContext)
      : input.researchBrief;
    const result = updateMetric(input.rubric, args, research);
    return result.rubric ? { rubric: result.rubric, researchBrief: research, summary: result.summary } : { warning: result.warning };
  }

  if (name === "delete_metric") {
    const result = deleteMetric(input.rubric, args);
    return result.rubric ? { rubric: result.rubric, summary: result.summary } : { warning: result.warning };
  }

  if (name === "approve_metric" || name === "reject_metric") {
    const status: BenchmarkRubricApprovalStatus = name === "approve_metric" ? "approved" : "rejected";
    const result = updateMetric(input.rubric, { ...args, approvalStatus: status }, input.researchBrief);
    return result.rubric ? { rubric: result.rubric, summary: result.summary } : { warning: result.warning };
  }

  if (name === "approve_all_metrics") {
    return {
      rubric: touchRubric({
        ...input.rubric,
        approvalStatus: "approved",
        modules: input.rubric.modules.map((module) => ({
          ...module,
          metrics: module.metrics.map((metric) => ({ ...metric, approvalStatus: "approved" })),
        })),
      }),
      summary: "已确认全部指标",
    };
  }

  if (name === "explain_rubric") {
    return { summary: "已解释当前评分标准" };
  }

  return { warning: name ? `未知工具：${name}` : "工具名称缺失。" };
}

async function ensureResearchForRubricEdit(
  requirementText: string,
  latestUserText: string,
  knowledgeContext: string,
): Promise<RubricResearchBrief> {
  const requirement = requirementText || latestUserText || "自定义 AI Agent benchmark rubric";
  return safeResearchBenchmarkReferences({
    title: "自定义评测任务",
    description: requirement,
    domain: "custom",
    requirementText: buildKnowledgeAugmentedRequirement(requirement, knowledgeContext),
    useLlm: true,
  });
}

async function safeResearchBenchmarkReferences(
  input: Parameters<typeof researchBenchmarkReferences>[0],
): Promise<RubricResearchBrief> {
  try {
    return await researchBenchmarkReferences(input);
  } catch {
    const fallbackCapabilities: BenchmarkCapabilityDimension[] = [
      "task_completion",
      "instruction_following",
      "factual_grounding",
      "reasoning_quality",
      "business_judgment",
      "tool_use_correctness",
      "safety_policy",
    ];
    return {
      summary: "DeepSearch 暂不可用，已使用内置公开 benchmark / 论文 catalog 作为指标依据兜底。",
      references: cloneMetricReferences(
        fallbackCapabilities.flatMap((capability) => benchmarkReferencesForCapability(capability)),
      ).filter(dedupeReferenceByKey).slice(0, 10),
      source: "catalog",
    };
  }
}

function buildResearchRequirement(requirementText: string, focus: string): string {
  return focus
    ? `${requirementText}\n\nResearch focus: ${focus}`
    : requirementText;
}

/**
 * Attach local knowledge-base excerpts to a generation/research requirement.
 *
 * @param requirementText User-visible task requirement that should remain the source of intent.
 * @param knowledgeContext Local uploaded industry knowledge context.
 * @returns Requirement text augmented with bounded local knowledge guidance.
 */
function buildKnowledgeAugmentedRequirement(requirementText: string, knowledgeContext: string): string {
  if (!knowledgeContext.trim()) return requirementText;
  return [
    requirementText,
    "",
    "Local knowledge-base context for rubric grounding:",
    knowledgeContext,
    "",
    "Use the local knowledge-base context to extract domain terms, workflow steps, acceptance rules, risk boundaries, data fields, and positive/negative examples. Keep the final user-facing requirement text separate from this grounding context.",
    "When a metric is grounded by a local chunk, preserve provenance fields such as fileId, chunkId, and line range in criteria or references.relevance.",
  ].join("\n");
}

function modifiesMetricBasis(args: Record<string, unknown>): boolean {
  return (
    typeof args.displayName === "string" ||
    typeof args.description === "string" ||
    typeof args.criteria === "string" ||
    typeof args.evaluatorType === "string" ||
    Array.isArray(args.rubricForm) ||
    Array.isArray(args.references)
  );
}

function dedupeReferenceByKey(
  reference: BenchmarkMetricReference,
  index: number,
  references: BenchmarkMetricReference[],
): boolean {
  const key = reference.referenceId ?? reference.url ?? reference.title;
  return references.findIndex((item) => (item.referenceId ?? item.url ?? item.title) === key) === index;
}

function addMetric(
  rubric: BenchmarkRubricSet,
  args: Record<string, unknown>,
  researchBrief: RubricResearchBrief | null,
): { rubric: BenchmarkRubricSet; summary: string } {
  const capability = capabilityArg(args.capability) ?? inferCapabilityFromText(stringArg(args.displayName) || stringArg(args.description));
  const displayName = ensureChineseText(stringArg(args.displayName), "自定义指标");
  const metricKey = uniqueMetricKey(slug(stringArg(args.metricKey) || displayName) || `${capability}_metric`, rubric);
  const evaluatorType = evaluatorArg(args.evaluatorType) ?? "llm_judge";
  const weight = normalizeWeight(numberArg(args.weight), 3);
  const criteria = ensureChineseText(stringArg(args.criteria), `按照「${displayName}」的业务要求进行 0 到 5 分评分，并给出证据。`);
  const metric: BenchmarkRubricMetric = {
    metricKey,
    capability,
    displayName,
    description: ensureChineseText(stringArg(args.description), `评估「${displayName}」是否达到业务验收要求。`),
    evaluatorType,
    weight,
    scale: { min: 0, max: 5, passThreshold: normalizePassThreshold(numberArg(args.passThreshold)) },
    approvalStatus: "candidate",
    evidenceRequired: booleanArg(args.evidenceRequired, evaluatorType === "llm_judge" || evaluatorType === "human_label"),
    humanApprovalRequired: booleanArg(args.humanApprovalRequired, evaluatorType === "human_label"),
    failureTags: [`${metricKey}_failed`],
    config: {
      criteria,
      rubricForm: rubricFormArg(args.rubricForm, displayName),
      references: referencesArg(args.references, capability, researchBrief),
    },
  };

  const existingModule = rubric.modules.find((module) => module.capability === capability);
  const modules = existingModule
    ? rubric.modules.map((module) => module.capability === capability ? { ...module, metrics: [...module.metrics, metric] } : module)
    : [
        ...rubric.modules,
        {
          capability,
          displayName: getBenchmarkCapabilityDefinition(capability).displayName,
          description: getBenchmarkCapabilityDefinition(capability).description,
          weight: 3,
          metrics: [metric],
        },
      ];

  return {
    rubric: touchRubric({ ...rubric, modules }),
    summary: `已新增指标「${displayName}」`,
  };
}

function updateMetric(
  rubric: BenchmarkRubricSet,
  args: Record<string, unknown>,
  researchBrief: RubricResearchBrief | null,
): { rubric?: BenchmarkRubricSet; summary?: string; warning?: string } {
  const target = findMetric(rubric, args);
  if (!target) return { warning: "没有找到要修改的指标。" };

  const patch: Partial<BenchmarkRubricMetric> = {};
  if (typeof args.displayName === "string") patch.displayName = ensureChineseText(args.displayName, target.displayName);
  if (typeof args.description === "string") patch.description = ensureChineseText(args.description, target.description);
  if (typeof args.weight === "number") patch.weight = normalizeWeight(args.weight, target.weight);
  if (typeof args.evaluatorType === "string") patch.evaluatorType = evaluatorArg(args.evaluatorType) ?? target.evaluatorType;
  if (typeof args.approvalStatus === "string" && isApprovalStatus(args.approvalStatus)) patch.approvalStatus = args.approvalStatus;
  if (typeof args.evidenceRequired === "boolean") patch.evidenceRequired = args.evidenceRequired;
  if (typeof args.humanApprovalRequired === "boolean") patch.humanApprovalRequired = args.humanApprovalRequired;

  const config = { ...(target.config ?? {}) };
  if (typeof args.criteria === "string") config.criteria = ensureChineseText(args.criteria, config.criteria ?? target.description);
  if (Array.isArray(args.rubricForm)) config.rubricForm = rubricFormArg(args.rubricForm, patch.displayName ?? target.displayName);
  if (Array.isArray(args.references) || modifiesMetricBasis(args)) config.references = referencesArg(args.references, target.capability, researchBrief);
  if (Object.keys(config).length > 0) patch.config = config;

  if (typeof args.passThreshold === "number") {
    patch.scale = { ...target.scale, passThreshold: normalizePassThreshold(args.passThreshold) };
  }

  return {
    rubric: touchRubric({
      ...rubric,
      modules: rubric.modules.map((module) => ({
        ...module,
        metrics: module.metrics.map((metric) => metric.metricKey === target.metricKey ? { ...metric, ...patch } : metric),
      })),
    }),
    summary: `已更新指标「${patch.displayName ?? target.displayName}」`,
  };
}

function deleteMetric(
  rubric: BenchmarkRubricSet,
  args: Record<string, unknown>,
): { rubric?: BenchmarkRubricSet; summary?: string; warning?: string } {
  const target = findMetric(rubric, args);
  if (!target) return { warning: "没有找到要删除的指标。" };
  return {
    rubric: touchRubric({
      ...rubric,
      modules: rubric.modules
        .map((module) => ({
          ...module,
          metrics: module.metrics.filter((metric) => metric.metricKey !== target.metricKey),
        }))
        .filter((module) => module.metrics.length > 0),
    }),
    summary: `已删除指标「${target.displayName}」`,
  };
}

function findMetric(rubric: BenchmarkRubricSet, args: Record<string, unknown>): BenchmarkRubricMetric | null {
  const metricKey = stringArg(args.metricKey);
  const displayName = stringArg(args.displayName);
  const metrics = rubric.modules.flatMap((module) => module.metrics);
  return (
    metrics.find((metric) => metric.metricKey === metricKey) ??
    metrics.find((metric) => metric.displayName === displayName) ??
    metrics.find((metric) => displayName && metric.displayName.includes(displayName)) ??
    null
  );
}

function buildFallbackPayload(
  text: string,
  requirementText: string,
  rubric: BenchmarkRubricSet | null,
): AgentPayload {
  if (!rubric && text.trim()) {
    return {
      reply: "我会先主动检索相关 benchmark 和参考文献，再根据你的任务需求生成评分标准。",
      tools: [
        { name: "set_requirement", arguments: { requirementText: text } },
        { name: "research_benchmark_references", arguments: { requirementText: text } },
        { name: "draft_rubric", arguments: { requirementText: text } },
      ],
    };
  }
  if (/全部.{0,6}(确认|通过|启用)/.test(text)) {
    return { reply: "我会确认全部指标。", tools: [{ name: "approve_all_metrics", arguments: {} }] };
  }
  if (/(重新|重做|生成).{0,8}(评分标准|rubric|指标)/i.test(text)) {
    return {
      reply: "我会按最新任务需求先检索公开 benchmark / 论文依据，再重新生成评分标准。",
      tools: [
        { name: "set_requirement", arguments: { requirementText: text || requirementText } },
        { name: "research_benchmark_references", arguments: { requirementText: text || requirementText } },
        { name: "draft_rubric", arguments: { requirementText: text || requirementText } },
      ],
    };
  }
  return { reply: "我可以根据你的任务需求生成或调整评分标准。请直接说希望评测什么，以及想改哪些指标。", tools: [] };
}

/**
 * Build a user-visible trace row for one Rubric Agent tool execution.
 *
 * @param input Tool call, result and before/after rubric snapshots.
 * @returns Structured tool trace for the UI.
 */
function buildToolTrace(input: {
  tool: AgentToolCallPayload;
  result: Awaited<ReturnType<typeof applyToolCall>>;
  beforeRubric: BenchmarkRubricSet | null;
  afterRubric: BenchmarkRubricSet | null;
  durationMs: number;
}): RubricAgentToolTrace {
  const name = input.tool.name ?? "unknown";
  const stats = buildRubricStats(input.afterRubric);
  const warning = input.result.warning ?? "";
  const summary = input.result.summary ?? (warning || "工具已执行。");
  const usedFallback =
    input.result.researchBrief?.source === "catalog" ||
    /兜底|fallback|DeepSearch|LLM rubric draft failed|模型没有返回/.test(warning);
  return {
    name,
    label: toolLabel(name),
    status: warning ? (usedFallback ? "fallback" : "warning") : usedFallback ? "fallback" : "success",
    summary,
    detail: buildToolTraceDetail({
      name,
      result: input.result,
      beforeRubric: input.beforeRubric,
      afterRubric: input.afterRubric,
    }),
    durationMs: input.durationMs,
    stats: {
      references: stats.references,
      modules: stats.modules,
      metrics: stats.metrics,
    },
  };
}

/**
 * Build the detailed result sentence for one tool trace.
 *
 * @param input Tool result and before/after rubric snapshots.
 * @returns Human-readable detail.
 */
function buildToolTraceDetail(input: {
  name: string;
  result: Awaited<ReturnType<typeof applyToolCall>>;
  beforeRubric: BenchmarkRubricSet | null;
  afterRubric: BenchmarkRubricSet | null;
}): string {
  if (input.result.warning) return input.result.warning;
  if (input.name === "research_benchmark_references" && input.result.researchBrief) {
    return input.result.researchBrief.source === "catalog"
      ? "DeepSearch 不可用时使用内置公开 benchmark / 论文 catalog，后续指标仍会绑定参考来源，但置信度应标记为兜底。"
      : input.result.researchBrief.summary;
  }
  if (input.name === "draft_rubric" && input.afterRubric) {
    const stats = buildRubricStats(input.afterRubric);
    const changed = summarizeChangedMetrics(input.beforeRubric, input.afterRubric);
    return [
      `当前评分标准包含 ${stats.modules} 个能力维度、${stats.metrics} 个二级指标、${stats.references} 个去重参考来源。`,
      changed.length ? `本次生成/更新：${changed.slice(0, 6).join("、")}。` : "",
    ].filter(Boolean).join("");
  }
  if (input.afterRubric && input.beforeRubric !== input.afterRubric) {
    const changed = summarizeChangedMetrics(input.beforeRubric, input.afterRubric);
    return changed.length ? `影响指标：${changed.slice(0, 6).join("、")}。` : "评分标准已更新。";
  }
  return input.result.summary ?? "工具执行完成。";
}

/**
 * Build an aggregate run summary for the final assistant response and UI.
 *
 * @param rubric Current rubric after all tools.
 * @param toolTrace Tool traces.
 * @param warnings Runtime warnings.
 * @returns Aggregate run summary.
 */
function buildRunSummary(
  rubric: BenchmarkRubricSet | null,
  toolTrace: RubricAgentToolTrace[],
  warnings: string[],
): RubricAgentRunSummary {
  const stats = buildRubricStats(rubric);
  return {
    usedFallback: toolTrace.some((trace) => trace.status === "fallback") || warnings.some((warning) => /兜底|fallback|DeepSearch|LLM/.test(warning)),
    modules: stats.modules,
    metrics: stats.metrics,
    references: stats.references,
    generatedBy: rubric?.generatedBy,
    changedMetrics: rubric
      ? rubric.modules.flatMap((module) => module.metrics.map((metric) => metric.displayName)).slice(0, 8)
      : [],
    warnings,
  };
}

/**
 * Count rubric modules, metrics and unique references.
 *
 * @param rubric Optional rubric.
 * @returns Rubric counters.
 */
function buildRubricStats(rubric: BenchmarkRubricSet | null): { modules: number; metrics: number; references: number } {
  if (!rubric) return { modules: 0, metrics: 0, references: 0 };
  const references = new Set(
    rubric.modules.flatMap((module) =>
      module.metrics.flatMap((metric) =>
        (metric.config?.references ?? []).map((reference) => reference.referenceId ?? reference.url ?? reference.title),
      ),
    ),
  );
  return {
    modules: rubric.modules.length,
    metrics: rubric.modules.reduce((sum, module) => sum + module.metrics.length, 0),
    references: references.size,
  };
}

/**
 * Summarize metric names that changed between two rubric snapshots.
 *
 * @param beforeRubric Rubric before tool execution.
 * @param afterRubric Rubric after tool execution.
 * @returns Changed metric display names.
 */
function summarizeChangedMetrics(
  beforeRubric: BenchmarkRubricSet | null,
  afterRubric: BenchmarkRubricSet | null,
): string[] {
  if (!afterRubric) return [];
  const before = new Map(
    (beforeRubric?.modules ?? []).flatMap((module) =>
      module.metrics.map((metric) => [metric.metricKey, `${metric.displayName}|${metric.description}|${metric.weight}|${metric.evaluatorType}|${metric.config?.criteria ?? ""}`]),
    ),
  );
  return afterRubric.modules
    .flatMap((module) => module.metrics)
    .filter((metric) => {
      const signature = `${metric.displayName}|${metric.description}|${metric.weight}|${metric.evaluatorType}|${metric.config?.criteria ?? ""}`;
      return before.get(metric.metricKey) !== signature;
    })
    .map((metric) => metric.displayName);
}

/**
 * Convert internal tool names to user-facing action labels.
 *
 * @param name Tool name.
 * @returns Chinese action label.
 */
function toolLabel(name: string | undefined): string {
  const labels: Record<string, string> = {
    set_requirement: "更新任务需求",
    research_benchmark_references: "检索 benchmark / 论文依据",
    draft_rubric: "生成评分标准",
    add_metric: "新增指标",
    update_metric: "更新指标",
    delete_metric: "删除指标",
    approve_metric: "确认指标",
    approve_all_metrics: "确认全部指标",
    reject_metric: "拒绝指标",
    explain_rubric: "解释评分标准",
  };
  return labels[name ?? ""] ?? "执行工具";
}

function buildReply(
  rawReply: string | undefined,
  toolCalls: Array<{ name: string; summary: string }>,
  toolTrace: RubricAgentToolTrace[],
  runSummary: RubricAgentRunSummary,
  rubric: BenchmarkRubricSet | null,
  requirementText: string,
  latestUserText: string,
): string {
  const parts: string[] = [];
  const reply = ensureChineseText(rawReply, "");
  if (reply) parts.push(reply);
  if (toolCalls.length > 0) {
    parts.push([
      "本次运行结果：",
      `- 工具步骤：${toolTrace.length} 个`,
      `- 当前指标体系：${runSummary.modules} 个能力维度 / ${runSummary.metrics} 个二级指标 / ${runSummary.references} 个参考来源`,
      runSummary.metrics === 0
        ? "- 状态：尚未生成可用指标，请继续补充任务需求或重试生成。"
        : runSummary.usedFallback
        ? "- 注意：本次有部分阶段进入兜底，结果可以继续编辑，但建议补充真实业务资料或稍后重试模型生成。"
        : "- 状态：工具执行完成，评分标准已按结果更新。",
    ].join("\n"));
  }
  if (!rubric && !requirementText && latestUserText) {
    parts.push("你可以直接告诉我完整评测任务，我会生成并调整评分标准。");
  }
  if (parts.length === 0) {
    parts.push(rubric ? "我看过当前评分标准了，可以继续按你的要求调整。" : "请描述你要评测的任务，我会先生成评分标准。");
  }
  return parts.join("\n");
}

function summarizeRubric(rubric: BenchmarkRubricSet | null): string {
  if (!rubric) return "尚未生成";
  const referenceCount = new Set(
    rubric.modules.flatMap((module) =>
      module.metrics.flatMap((metric) =>
        (metric.config?.references ?? []).map((reference) => reference.referenceId ?? reference.url ?? reference.title),
      ),
    ),
  ).size;
  return [
    `标题：${rubric.title}`,
    `描述：${rubric.description}`,
    `Eval-Anything 任务类型：${inferBenchmarkTaskType({ requirementText: rubric.description, rubric })}`,
    rubric.researchSummary ? `依据摘要：${rubric.researchSummary}` : "",
    `参考来源数量：${referenceCount}`,
    ...rubric.modules.map((module) =>
      `能力维度：${module.displayName}；指标：${module.metrics.map((metric) => `${metric.displayName}(${metric.metricKey}, 权重${metric.weight}, 来源${metric.config?.references?.length ?? 0}, ${metric.approvalStatus})`).join("、")}`,
    ),
  ].filter(Boolean).join("\n");
}

function localizeRubric(rubric: BenchmarkRubricSet): BenchmarkRubricSet {
  return {
    ...touchRubric(rubric),
    title: ensureChineseText(rubric.title, "评测任务评分标准"),
    description: ensureChineseText(rubric.description, "根据当前任务需求生成的评分标准。"),
    modules: rubric.modules.map((module) => ({
      ...module,
      displayName: ensureChineseText(module.displayName, getBenchmarkCapabilityDefinition(module.capability).displayName),
      description: ensureChineseText(module.description, getBenchmarkCapabilityDefinition(module.capability).description),
      metrics: module.metrics.map((metric) => ({
        ...metric,
        displayName: ensureChineseText(metric.displayName, "自定义指标"),
        description: ensureChineseText(metric.description, `评估「${metric.displayName}」是否达到业务验收要求。`),
        config: {
          ...metric.config,
          criteria: ensureChineseText(metric.config?.criteria, `按照「${metric.displayName}」的业务要求进行 0 到 5 分评分，并给出证据。`),
          rubricForm: metric.config?.rubricForm?.length ? metric.config.rubricForm : rubricFormArg(undefined, metric.displayName),
          references: metric.config?.references?.length ? cloneMetricReferences(metric.config.references) : referencesArg(undefined, metric.capability),
        },
      })),
    })),
  };
}

function touchRubric(rubric: BenchmarkRubricSet): BenchmarkRubricSet {
  return { ...rubric, updatedAt: new Date().toISOString() };
}

function uniqueMetricKey(base: string, rubric: BenchmarkRubricSet): string {
  const used = new Set(rubric.modules.flatMap((module) => module.metrics.map((metric) => metric.metricKey)));
  let key = base || `metric_${randomBytes(3).toString("hex")}`;
  let index = 2;
  while (used.has(key)) {
    key = `${base}_${index}`;
    index += 1;
  }
  return key;
}

function rubricFormArg(value: unknown, displayName: string): BenchmarkRubricScoreLevel[] {
  const levels = Array.isArray(value)
    ? value
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          return {
            score: normalizePassThreshold(numberArg(record.score)),
            label: ensureChineseText(stringArg(record.label), "评分档"),
            description: ensureChineseText(stringArg(record.description), `该档用于评价「${displayName}」。`),
          };
        })
        .filter((item): item is BenchmarkRubricScoreLevel => Boolean(item))
    : [];

  return levels.length > 0
    ? levels.slice(0, 5)
    : [
        { score: 5, label: "优秀", description: `完全满足「${displayName}」要求，证据充分且无明显缺陷。` },
        { score: 3, label: "合格", description: `基本满足「${displayName}」要求，但存在轻微遗漏或表达不够充分。` },
        { score: 1, label: "不合格", description: `未能满足「${displayName}」核心要求，存在关键错误、缺失或无证据支撑。` },
      ];
}

function referencesArg(
  value: unknown,
  capability: BenchmarkCapabilityDimension,
  researchBrief: RubricResearchBrief | null = null,
): BenchmarkMetricReference[] {
  const references = Array.isArray(value)
    ? value
        .map((item): BenchmarkMetricReference | null => {
          if (!item || typeof item !== "object") return null;
          const record = item as Record<string, unknown>;
          const title = stringArg(record.title);
          if (!title) return null;
          const sourceType = referenceSourceTypeArg(record.sourceType) ?? "research_report";
          return {
            referenceId: stringArg(record.referenceId) || undefined,
            title,
            sourceType,
            url: stringArg(record.url) || undefined,
            authors: Array.isArray(record.authors) ? record.authors.map(String).filter(Boolean).slice(0, 6) : undefined,
            publisher: stringArg(record.publisher) || undefined,
            year: normalizeReferenceYear(record.year),
            benchmarkName: stringArg(record.benchmarkName) || undefined,
            relevance: ensureChineseText(stringArg(record.relevance), "该来源用于支撑指标定义、评分准则或证据复核方式。"),
            confidence: normalizeReferenceConfidence(record.confidence),
          } satisfies BenchmarkMetricReference;
        })
        .filter((item): item is BenchmarkMetricReference => Boolean(item))
    : [];
  const hasStrongBasis = references.some((reference) =>
    reference.sourceType === "paper" ||
    reference.sourceType === "public_benchmark" ||
    reference.sourceType === "standard",
  );
  const researchedReferences = researchBrief?.references ?? [];
  return cloneMetricReferences(
    (hasStrongBasis
      ? references
      : [...references, ...researchedReferences, ...benchmarkReferencesForCapability(capability)]
    ).slice(0, 3),
  );
}

function inferCapabilityFromText(value: string): BenchmarkCapabilityDimension {
  if (/证据|事实|引用|准确/.test(value)) return "factual_grounding";
  if (/字段|抽取|信息|识别/.test(value)) return "data_extraction";
  if (/格式|结构|JSON|表格/.test(value)) return "format_compliance";
  if (/工具|调用|检索|执行/.test(value)) return "tool_use_correctness";
  if (/安全|合规|风险/.test(value)) return "safety_policy";
  if (/推理|逻辑|分析/.test(value)) return "reasoning_quality";
  if (/业务|判断|决策|取舍/.test(value)) return "business_judgment";
  return "task_completion";
}

function capabilityArg(value: unknown): BenchmarkCapabilityDimension | null {
  return typeof value === "string" && ALLOWED_CAPABILITIES.includes(value as BenchmarkCapabilityDimension)
    ? value as BenchmarkCapabilityDimension
    : null;
}

function evaluatorArg(value: unknown): BenchmarkEvaluatorType | null {
  return typeof value === "string" && ALLOWED_EVALUATORS.includes(value as BenchmarkEvaluatorType)
    ? value as BenchmarkEvaluatorType
    : null;
}

function referenceSourceTypeArg(value: unknown): BenchmarkReferenceSourceType | null {
  return typeof value === "string" && ALLOWED_REFERENCE_SOURCE_TYPES.includes(value as BenchmarkReferenceSourceType)
    ? value as BenchmarkReferenceSourceType
    : null;
}

function isApprovalStatus(value: string): value is BenchmarkRubricApprovalStatus {
  return value === "candidate" || value === "approved" || value === "rejected";
}

function normalizeWeight(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function normalizePassThreshold(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(0, Math.min(5, value));
}

function booleanArg(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function numberArg(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function normalizeReferenceYear(value: unknown): number | undefined {
  const year = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(year) && year >= 1900 && year <= 2100 ? year : undefined;
}

function normalizeReferenceConfidence(value: unknown): number | undefined {
  const confidence = numberArg(value);
  return typeof confidence === "number" ? Math.max(0, Math.min(1, confidence)) : undefined;
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function ensureChineseText(value: string | undefined, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (text && /[\u3400-\u9fff]/.test(text)) return text;
  return fallback;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}
