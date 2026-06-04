/**
 * @fileoverview Interactive rubric agent for Benchmark Workbench.
 *
 * The agent receives the user's current task requirement and rubric, decides
 * which rubric tools to call, applies them, and returns a concise Chinese reply.
 */

import { randomBytes } from "node:crypto";
import { draftBenchmarkRubric } from "@/benchmark/copilot";
import { getBenchmarkCapabilityDefinition } from "@/benchmark/capabilities";
import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import type {
  BenchmarkCapabilityDimension,
  BenchmarkEvaluatorType,
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
};

export type RunBenchmarkRubricAgentResult = {
  reply: string;
  requirementText: string;
  rubric: BenchmarkRubricSet | null;
  toolCalls: Array<{ name: string; summary: string }>;
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

export async function runBenchmarkRubricAgent(
  input: RunBenchmarkRubricAgentInput,
): Promise<RunBenchmarkRubricAgentResult> {
  const latestUserText = [...input.messages].reverse().find((message) => message.role === "user")?.content.trim() ?? "";
  const warnings: string[] = [];
  let requirementText = input.requirementText.trim();
  let rubric = input.rubric ?? null;
  const toolCalls: Array<{ name: string; summary: string }> = [];

  let payload: AgentPayload | null = null;
  try {
    const raw = await requestSiliconFlowChatCompletion(
      [
        {
          role: "system",
          content: [
            "你是 Zeval 评测工作台里的 Rubric Agent，不是普通聊天助手，也不是单纯添加指标的按钮。",
            "你的职责是理解用户提出的评测任务需求、约束和修改意图，并通过工具调整当前评测 rubric。",
            "用户可以在右侧助手中提出任何任务需求：生成评分标准、改领域、增加/删除/合并指标、调整权重、补充评分表单、确认指标、解释当前 rubric。",
            "你必须优先判断是否需要调用工具；只有纯解释问题才不调用工具。",
            "所有展示给用户的文本必须使用中文；metricKey 等机器字段可以用英文。",
            "Return JSON only.",
            "可用工具：",
            "- set_requirement: 更新任务需求。参数 {requirementText}",
            "- draft_rubric: 根据任务需求重新生成领域化评分标准。参数 {requirementText?}",
            "- add_metric: 增加指标。参数 {capability, displayName, description, weight, evaluatorType, criteria, rubricForm?}",
            "- update_metric: 修改指标。参数 {metricKey? 或 displayName?, displayName?, description?, weight?, passThreshold?, evaluatorType?, criteria?, approvalStatus?, evidenceRequired?, humanApprovalRequired?, rubricForm?}",
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
            "当前 rubric 摘要：",
            summarizeRubric(rubric),
            "",
            "最近对话：",
            input.messages.slice(-8).map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n"),
            "",
            "请决定要调用哪些工具。",
          ].join("\n"),
        },
      ],
      { stage: "benchmark_rubric_agent", temperature: 0.1, seed: 47 },
    );
    payload = parseJsonObjectFromLlmOutput(raw) as AgentPayload;
  } catch (error) {
    warnings.push(`Rubric Agent 调用失败，已使用本地规则兜底：${error instanceof Error ? error.message : String(error)}`);
    payload = buildFallbackPayload(latestUserText, requirementText, rubric);
  }

  for (const tool of payload?.tools ?? []) {
    const result = await applyToolCall({ tool, rubric, requirementText, latestUserText });
    if (result.requirementText !== undefined) requirementText = result.requirementText;
    if (result.rubric !== undefined) rubric = result.rubric;
    if (result.warning) warnings.push(result.warning);
    if (result.summary) toolCalls.push({ name: tool.name ?? "unknown", summary: result.summary });
  }

  const reply = buildReply(payload?.reply, toolCalls, rubric, requirementText, latestUserText);
  return {
    reply,
    requirementText,
    rubric: rubric ? localizeRubric(rubric) : null,
    toolCalls,
    warnings,
  };
}

async function applyToolCall(input: {
  tool: AgentToolCallPayload;
  rubric: BenchmarkRubricSet | null;
  requirementText: string;
  latestUserText: string;
}): Promise<{
  rubric?: BenchmarkRubricSet | null;
  requirementText?: string;
  summary?: string;
  warning?: string;
}> {
  const name = input.tool.name;
  const args = input.tool.arguments ?? {};

  if (name === "set_requirement") {
    const next = stringArg(args.requirementText) || input.latestUserText || input.requirementText;
    return { requirementText: next, summary: "已更新任务需求" };
  }

  if (name === "draft_rubric") {
    const requirementText = stringArg(args.requirementText) || input.requirementText || input.latestUserText;
    if (!requirementText.trim()) {
      return { warning: "缺少任务需求，无法生成评分标准。" };
    }
    const result = await draftBenchmarkRubric({
      title: "自定义评测任务",
      description: requirementText,
      domain: "custom",
      requirementText,
      useLlm: true,
    });
    return {
      requirementText,
      rubric: localizeRubric(result.rubric),
      summary: `已生成 ${result.rubric.modules.length} 个能力维度的评分标准`,
      warning: result.warnings.join("；") || undefined,
    };
  }

  if (!input.rubric) {
    return { warning: "当前还没有评分标准，请先描述任务并生成 rubric。" };
  }

  if (name === "add_metric") {
    const result = addMetric(input.rubric, args);
    return { rubric: result.rubric, summary: result.summary };
  }

  if (name === "update_metric") {
    const result = updateMetric(input.rubric, args);
    return result.rubric ? { rubric: result.rubric, summary: result.summary } : { warning: result.warning };
  }

  if (name === "delete_metric") {
    const result = deleteMetric(input.rubric, args);
    return result.rubric ? { rubric: result.rubric, summary: result.summary } : { warning: result.warning };
  }

  if (name === "approve_metric" || name === "reject_metric") {
    const status: BenchmarkRubricApprovalStatus = name === "approve_metric" ? "approved" : "rejected";
    const result = updateMetric(input.rubric, { ...args, approvalStatus: status });
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

function addMetric(rubric: BenchmarkRubricSet, args: Record<string, unknown>): { rubric: BenchmarkRubricSet; summary: string } {
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
    return { reply: "我会先根据你的任务需求生成评分标准。", tools: [{ name: "set_requirement", arguments: { requirementText: text } }, { name: "draft_rubric", arguments: { requirementText: text } }] };
  }
  if (/全部.{0,6}(确认|通过|启用)/.test(text)) {
    return { reply: "我会确认全部指标。", tools: [{ name: "approve_all_metrics", arguments: {} }] };
  }
  if (/(重新|重做|生成).{0,8}(评分标准|rubric|指标)/i.test(text)) {
    return { reply: "我会按最新任务需求重新生成评分标准。", tools: [{ name: "set_requirement", arguments: { requirementText: text || requirementText } }, { name: "draft_rubric", arguments: { requirementText: text || requirementText } }] };
  }
  return { reply: "我可以根据你的任务需求生成或调整评分标准。请直接说希望评测什么，以及想改哪些指标。", tools: [] };
}

function buildReply(
  rawReply: string | undefined,
  toolCalls: Array<{ name: string; summary: string }>,
  rubric: BenchmarkRubricSet | null,
  requirementText: string,
  latestUserText: string,
): string {
  const parts: string[] = [];
  const reply = ensureChineseText(rawReply, "");
  if (reply) parts.push(reply);
  if (toolCalls.length > 0) {
    parts.push(`已调用工具：${toolCalls.map((call) => call.summary).join("、")}。`);
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
  return [
    `标题：${rubric.title}`,
    `描述：${rubric.description}`,
    ...rubric.modules.map((module) =>
      `能力维度：${module.displayName}；指标：${module.metrics.map((metric) => `${metric.displayName}(${metric.metricKey}, 权重${metric.weight}, ${metric.approvalStatus})`).join("、")}`,
    ),
  ].join("\n");
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
