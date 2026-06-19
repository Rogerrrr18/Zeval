/**
 * @fileoverview AutoFind 数据技能 — 通过 AutoFind Agent 动态发现、下载并整理 25 正 + 25 负多轮对话 CSV。
 *
 * 编排见 `autofind-agent.ts`；工具发现见 `autofind-discovery.ts`；格式归一化见 `autofind-normalizers.ts`。
 * 降级：LLM 不可用时各阶段回退规则模板，不读取本地硬编码缓存。
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  createDefaultAutoFindAgentLlmDeps,
  runAutoFindAgent,
  type AutoFindAgentLlmDeps,
} from "./autofind-agent";
import type { AutoFindDiscoveryDeps } from "./autofind-discovery";
import type { AutoFindRubricContext, DatasetCandidate } from "./autofind-types";

export type { AutoFindRubricContext } from "./autofind-types";

const OUTPUT_DIR = path.join(process.cwd(), "public", "sample-data");

export type AutoFindPhase = "intro" | "planned" | "searched" | "saved";

export type { AutoFindDatasetProfile } from "./autofind-types";
import type { AutoFindDatasetProfile } from "./autofind-types";

export type AutoFindWorkflowState = {
  phase: AutoFindPhase;
  contextKey: string;
  datasetProfile: AutoFindDatasetProfile;
  requirementText: string;
  rubricContext?: AutoFindRubricContext;
  positiveCount: number;
  negativeCount: number;
  includeEnglishNegative: boolean;
  sources: string[];
  fileName?: string;
  publicPath?: string;
  csvText?: string;
  summary?: {
    sessions: number;
    rows: number;
    positiveSessions: number;
    negativeSessions: number;
    avgTurnsPerSession: number;
  };
  previewSessions?: Array<{
    sessionId: string;
    label: "positive" | "negative";
    turns: number;
    snippet: string;
  }>;
  discoveredCandidates?: DatasetCandidate[];
  selectedDatasetId?: string;
  verifiedDownloadUrl?: string;
  agentTrace?: string[];
  llmAssisted?: boolean;
  warnings: string[];
};

export type RunAutoFindInput = {
  action: "start" | "search" | "save" | "chat";
  requirementText?: string;
  rubricContext?: AutoFindRubricContext;
  message?: string;
  state?: AutoFindWorkflowState | null;
  discoveryDeps?: AutoFindDiscoveryDeps;
  agentLlmDeps?: AutoFindAgentLlmDeps;
  signal?: AbortSignal;
};

export type RunAutoFindResult = {
  reply: string;
  state: AutoFindWorkflowState;
  suggestedActions?: string[];
};

/**
 * 执行 AutoFind 工作流（LLM Agent 编排 + 工具化数据集发现）。
 *
 * @param input 用户动作与当前状态。
 * @returns 助手回复与更新后的工作流状态。
 */
export async function runAutoFindDataSkill(input: RunAutoFindInput): Promise<RunAutoFindResult> {
  const rubricContext = mergeRubricContext(input.rubricContext, input.state?.rubricContext);

  if (input.action === "start") {
    return startWorkflow(input.requirementText ?? "", rubricContext);
  }
  if (!input.state) {
    return startWorkflow(input.requirementText ?? "", rubricContext);
  }

  const state = mergeWorkflowState(input.state, {
    requirementText: input.requirementText,
    rubricContext,
  });

  if (input.action === "search") {
    return searchWorkflow(state, input.discoveryDeps, input.agentLlmDeps, input.signal);
  }

  if (input.action === "save") {
    return saveWorkflow(state, input.signal);
  }

  return handleChatWorkflow(state, input.message ?? "", input.discoveryDeps, input.agentLlmDeps, input.signal);
}

/**
 * @param requirementText 评测任务需求。
 * @param rubricContext 生成评分标准时的参考对话与 rubric 摘要。
 * @returns 初始工作流状态与引导文案。
 */
function startWorkflow(
  requirementText: string,
  rubricContext?: AutoFindRubricContext,
): RunAutoFindResult {
  const mergedRequirement = requirementText.trim() || rubricContext?.requirementText.trim() || "";
  const datasetProfile = detectDatasetProfile(mergedRequirement, rubricContext);
  const state: AutoFindWorkflowState = {
    phase: "planned",
    contextKey: computeContextKey(mergedRequirement, rubricContext),
    datasetProfile,
    requirementText: mergedRequirement,
    rubricContext,
    positiveCount: 25,
    negativeCount: 25,
    includeEnglishNegative: true,
    sources: describeAutoFindSources(datasetProfile),
    warnings: [],
  };

  return {
    reply: [
      "## AutoFind 数据工作流",
      "",
      "目标：为当前评测任务准备 **25 条正样本 + 25 条负样本** 多轮对话，并导出为 Zeval CSV。",
      "",
      mergedRequirement
        ? `**当前需求**：${mergedRequirement}`
        : "**当前需求**：尚未填写，请先补充评测需求。",
      "**数据源**：AutoFind Agent 将调用模型生成检索词、选择候选数据集，并通过 HuggingFace / GitHub / web_search 动态发现。",
      rubricContext?.rubricTitle ? `**评分标准**：${rubricContext.rubricTitle}` : "",
      rubricContext?.rubricDescription ? `**标准说明**：${rubricContext.rubricDescription}` : "",
      rubricContext?.rubricMetrics?.length
        ? `**已确认指标**：${rubricContext.rubricMetrics.join("、")}`
        : "",
      formatRubricDialogueSection(rubricContext),
      "",
      "### 步骤",
      "1. **检索** — 模型生成关键词并从公开源发现数据集",
      "2. **整理** — 模型挑选 25 正 + 25 负 session，转为 Zeval CSV",
      "3. **保存** — 写入 `public/sample-data/`",
      "4. **应用** — 在对话里输入「应用」加载到评测数据区",
      "",
      "你可以直接回复：**开始搜索**、**只要中文负样本**、**保存**、**应用**。",
      "",
      "输入 **开始搜索** 或点击下方建议操作继续。",
    ]
      .filter(Boolean)
      .join("\n"),
    state,
    suggestedActions: ["开始搜索", "只要中文正样本", "保存到 public"],
  };
}

/**
 * @param state 当前工作流状态。
 * @returns 检索结果摘要。
 */
async function searchWorkflow(
  state: AutoFindWorkflowState,
  discoveryDeps?: AutoFindDiscoveryDeps,
  agentLlmDeps?: AutoFindAgentLlmDeps,
  signal?: AbortSignal,
): Promise<RunAutoFindResult> {
  const warnings = [...state.warnings];
  const searchProfile = buildSearchProfile(state);

  const discovery = await runAutoFindAgent(
    {
      searchProfile,
      datasetProfile: state.datasetProfile,
      rubricContext: state.rubricContext,
      positiveCount: state.positiveCount,
      negativeCount: state.negativeCount,
    },
    discoveryDeps,
    agentLlmDeps ?? createDefaultAutoFindAgentLlmDeps(signal),
  );
  const csvText = discovery.csvText;
  const discoverySources = discovery.sources;
  const discoveredCandidates = discovery.candidates;
  const selectedDatasetId = discovery.selectedCandidate.id;
  const verifiedDownloadUrl = discovery.verifiedDownloadUrl;
  const agentTrace = discovery.agentTrace;
  const llmAssisted = discovery.llmAssisted;
  warnings.push(...discovery.warnings);

  const parsed = parseCsvSummary(csvText);
  const fileName = buildOutputFileName(state.requirementText);
  const previewSessions = buildPreviewSessions(csvText);
  const sessionPrefixLabel = describeSessionPrefix(parsed);

  const nextState: AutoFindWorkflowState = {
    ...state,
    phase: "searched",
    fileName,
    publicPath: `public/sample-data/${fileName}`,
    csvText,
    summary: parsed,
    previewSessions,
    sources: discoverySources.length > 0 ? discoverySources : state.sources,
    discoveredCandidates,
    selectedDatasetId,
    verifiedDownloadUrl,
    agentTrace,
    llmAssisted,
    warnings,
  };

  return {
    reply: [
      llmAssisted ? "✅ AutoFind Agent 检索与整理完成。" : "✅ 检索与整理完成（部分步骤已规则降级）。",
      "",
      `- 正样本：**${parsed.positiveSessions}** sessions（${sessionPrefixLabel.positive}）`,
      `- 负样本：**${parsed.negativeSessions}** sessions（${sessionPrefixLabel.negative}）`,
      `- 总消息数：**${parsed.rows}**，平均每 session **${parsed.avgTurnsPerSession}** 轮`,
      "",
      "### 数据来源",
      ...(discoverySources.length > 0 ? discoverySources : state.sources).map((source) => `- ${source}`),
      selectedDatasetId ? `- 选中数据集：\`${selectedDatasetId}\`` : "",
      verifiedDownloadUrl ? `- 数据文件：${verifiedDownloadUrl}` : "",
      agentTrace.length ? `- Agent 轨迹：${agentTrace.join("；")}` : "",
      discoveredCandidates.length
        ? `- 候选数据集：${discoveredCandidates
            .slice(0, 3)
            .map((item) => `${item.title} (${item.url})`)
            .join("；")}…`
        : "",
      "",
      previewSessions.length
        ? `**预览**：${previewSessions.slice(0, 3).map((item) => `${item.sessionId}(${item.label})`).join("、")}…`
        : "",
      warnings.length ? `\n**提示**：${warnings.join("；")}` : "",
      "",
      "回复 **保存** 写入 `public/sample-data/`，或 **应用** 直接加载到评测数据。",
    ]
      .filter(Boolean)
      .join("\n"),
    state: nextState,
    suggestedActions: ["保存", "应用", "重新搜索"],
  };
}

/**
 * @param state 已检索完成的状态。
 * @returns 保存结果。
 */
async function saveWorkflow(state: AutoFindWorkflowState, signal?: AbortSignal): Promise<RunAutoFindResult> {
  if (!state.csvText || !state.fileName) {
    const searched = await searchWorkflow(state, undefined, undefined, signal);
    return saveWorkflow(searched.state, signal);
  }

  await mkdir(OUTPUT_DIR, { recursive: true });
  const absolutePath = path.join(OUTPUT_DIR, state.fileName);
  await writeFile(absolutePath, state.csvText.endsWith("\n") ? state.csvText : `${state.csvText}\n`, "utf8");

  const nextState: AutoFindWorkflowState = {
    ...state,
    phase: "saved",
    publicPath: `public/sample-data/${state.fileName}`,
  };

  return {
    reply: [
      "✅ 已保存到测试数据目录。",
      "",
      `- 路径：\`${nextState.publicPath}\``,
      `- 规模：${nextState.summary?.sessions ?? 20} sessions / ${nextState.summary?.rows ?? 0} rows`,
      "",
      "回复 **应用** 可立即加载到当前评测任务；也可在「上传数据」中手动选择该文件。",
    ].join("\n"),
    state: nextState,
    suggestedActions: ["应用", "重新搜索"],
  };
}

/**
 * @param state 当前状态。
 * @param message 用户输入。
 * @returns 对话干预结果。
 */
async function handleChatWorkflow(
  state: AutoFindWorkflowState,
  message: string,
  discoveryDeps?: AutoFindDiscoveryDeps,
  agentLlmDeps?: AutoFindAgentLlmDeps,
  signal?: AbortSignal,
): Promise<RunAutoFindResult> {
  const text = message.trim();
  if (!text) {
    return {
      reply: "请告诉我下一步，例如：开始搜索、保存、应用、或调整正负样本数量。",
      state,
      suggestedActions: ["开始搜索", "保存", "应用"],
    };
  }

  if (/开始|搜索|检索|查找|find|search/i.test(text)) {
    return searchWorkflow(state, discoveryDeps, agentLlmDeps, signal);
  }
  if (/保存|写入|导出|save/i.test(text)) {
    return saveWorkflow(state, signal);
  }
  if (/应用|加载|导入|apply/i.test(text)) {
    if (!state.csvText) {
      const searched = await searchWorkflow(state, discoveryDeps, agentLlmDeps, signal);
      return {
        reply: `${searched.reply}\n\n已准备好数据，请再次回复 **应用** 或点击建议操作。`,
        state: searched.state,
        suggestedActions: ["应用", "保存"],
      };
    }
    return {
      reply: [
        "好的，正在应用数据集到当前评测任务。",
        "",
        `文件：\`${state.fileName ?? "companion-autofind-50sessions.csv"}\``,
        "（前端将自动调用 ingest 流程）",
      ].join("\n"),
      state: { ...state, phase: "saved" },
      suggestedActions: [],
    };
  }
  if (/只要中文|中文负样本|不要英文/i.test(text)) {
    return {
      reply: "已切换为仅中文正样本检索；负样本将优先从公开数据集中筛选「挫败/无效支持」语境。回复 **开始搜索** 继续。",
      state: {
        ...state,
        includeEnglishNegative: false,
        warnings: [...state.warnings, "用户要求优先中文负样本。"],
      },
      suggestedActions: ["开始搜索"],
    };
  }
  if (/正样本|负样本/.test(text)) {
    const positiveMatch = text.match(/正样本\s*(\d+)/);
    const negativeMatch = text.match(/负样本\s*(\d+)/);
    const positiveCount = positiveMatch ? Number(positiveMatch[1]) : state.positiveCount;
    const negativeCount = negativeMatch ? Number(negativeMatch[1]) : state.negativeCount;
    return {
      reply: `已更新目标：正样本 ${positiveCount} 条，负样本 ${negativeCount} 条。回复 **开始搜索** 重新检索。`,
      state: {
        ...state,
        positiveCount: clampCount(positiveCount, state.positiveCount),
        negativeCount: clampCount(negativeCount, state.negativeCount),
      },
      suggestedActions: ["开始搜索"],
    };
  }

  return {
    reply: [
      "我可以帮你：",
      "- **开始搜索** — 从 HuggingFace / GitHub / 网页检索并整理公开数据集",
      "- **保存** — 写入 `public/sample-data/`",
      "- **应用** — 加载到评测数据区",
      "- **正样本 25 负样本 25** — 调整数量",
      "",
      `你刚才说：「${text}」`,
      "如果这是补充检索条件，我会在下次搜索时一并考虑。",
    ].join("\n"),
    state: {
      ...state,
      requirementText: state.requirementText
        ? `${state.requirementText}\n补充：${text}`
        : text,
    },
    suggestedActions: ["开始搜索", "保存", "应用"],
  };
}

/**
 * @param input 检索参数。
 * @returns Zeval CSV 文本。
 */
/**
 * @param state 工作流状态。
 * @returns 用于检索打分的综合文本。
 */
function buildSearchProfile(state: AutoFindWorkflowState): string {
  const parts = [state.requirementText];
  const context = state.rubricContext;
  if (!context) return parts.filter(Boolean).join("\n");

  parts.push(context.rubricTitle ?? "", context.rubricDescription ?? "");
  parts.push(...(context.rubricMetrics ?? []));
  parts.push(...context.rubricDialogue.map((turn) => turn.text));
  return parts.map((part) => part.trim()).filter(Boolean).join("\n");
}

/**
 * @param incoming 本次请求携带的 rubric 上下文。
 * @param existing 状态中已有的 rubric 上下文。
 * @returns 合并后的 rubric 上下文。
 */
function mergeRubricContext(
  incoming?: AutoFindRubricContext,
  existing?: AutoFindRubricContext,
): AutoFindRubricContext | undefined {
  if (!incoming && !existing) return undefined;
  return {
    requirementText: incoming?.requirementText?.trim() || existing?.requirementText?.trim() || "",
    rubricDialogue: incoming?.rubricDialogue?.length
      ? incoming.rubricDialogue
      : existing?.rubricDialogue ?? [],
    rubricTitle: incoming?.rubricTitle ?? existing?.rubricTitle,
    rubricDescription: incoming?.rubricDescription ?? existing?.rubricDescription,
    rubricMetrics: incoming?.rubricMetrics?.length
      ? incoming.rubricMetrics
      : existing?.rubricMetrics,
  };
}

/**
 * @param state 当前状态。
 * @param patch 请求中的增量字段。
 * @returns 合并后的工作流状态。
 */
function mergeWorkflowState(
  state: AutoFindWorkflowState,
  patch: { requirementText?: string; rubricContext?: AutoFindRubricContext },
): AutoFindWorkflowState {
  const rubricContext = mergeRubricContext(patch.rubricContext, state.rubricContext);
  const requirementText =
    patch.requirementText?.trim() ||
    rubricContext?.requirementText?.trim() ||
    state.requirementText;
  const contextKey = computeContextKey(requirementText, rubricContext);
  const datasetProfile = detectDatasetProfile(requirementText, rubricContext);

  if (contextKey !== state.contextKey) {
    return {
      phase: "planned",
      contextKey,
      datasetProfile,
      requirementText,
      rubricContext,
      positiveCount: state.positiveCount,
      negativeCount: state.negativeCount,
      includeEnglishNegative: state.includeEnglishNegative,
      sources: describeAutoFindSources(datasetProfile),
      warnings: [...state.warnings, "评测任务上下文已变化，请重新搜索。"],
    };
  }

  return {
    ...state,
    requirementText,
    rubricContext,
    datasetProfile,
    sources: describeAutoFindSources(datasetProfile),
  };
}

/**
 * Build a stable key for the current benchmark task context.
 *
 * @param requirementText Task requirement.
 * @param rubricContext Rubric summary used by AutoFind.
 * @returns Context fingerprint for session isolation.
 */
export function computeContextKey(
  requirementText: string,
  rubricContext?: AutoFindRubricContext,
): string {
  return [
    requirementText.trim(),
    rubricContext?.rubricTitle?.trim() ?? "",
    rubricContext?.rubricDescription?.trim() ?? "",
    (rubricContext?.rubricMetrics ?? []).join("|"),
  ]
    .join("::")
    .slice(0, 500);
}

/**
 * Detect whether the current task can use the companion AutoFind datasets.
 *
 * @param requirementText Task requirement.
 * @param rubricContext Rubric summary.
 * @returns Dataset profile for routing and fallback rules.
 */
export function detectDatasetProfile(
  requirementText: string,
  rubricContext?: AutoFindRubricContext,
): AutoFindDatasetProfile {
  const text = [
    requirementText,
    rubricContext?.rubricTitle ?? "",
    rubricContext?.rubricDescription ?? "",
    ...(rubricContext?.rubricMetrics ?? []),
    ...((rubricContext?.rubricDialogue ?? []).map((turn) => turn.text)),
  ]
    .join("\n")
    .toLowerCase();

  const companionHints =
    /情绪|陪伴|硬件|心理|共情|倾诉|安慰|咨询|疗愈|孤独|失眠|companion|esconv|cpsy|心理咨询|情感支持/;
  const unsupportedHints =
    /客服|shopify|外贸|订单|物流|转人工|电商|customer\s*service|ecommerce|退款|发货|sku|工单|回复准确率|接住用户/;

  if (unsupportedHints.test(text)) return "customer_service";
  if (companionHints.test(text)) return "companion";
  return "general";
}

function describeAutoFindSources(_profile: AutoFindDatasetProfile): string[] {
  return [
    "AutoFind Agent（LLM 检索词 / 选集 / 整理）",
    "HuggingFace Datasets API",
    "GitHub Search API (github_search_repos)",
    "web_search",
  ];
}

function describeSessionPrefix(summary: NonNullable<AutoFindWorkflowState["summary"]>): {
  positive: string;
  negative: string;
} {
  return {
    positive: summary.positiveSessions > 0 ? "*_pos_*" : "无",
    negative: summary.negativeSessions > 0 ? "*_neg_*" : "无",
  };
}

function resetSearchArtifacts(state: AutoFindWorkflowState): AutoFindWorkflowState {
  return {
    ...state,
    fileName: undefined,
    publicPath: undefined,
    csvText: undefined,
    summary: undefined,
    previewSessions: undefined,
  };
}

/**
 * @param rubricContext rubric 参考上下文。
 * @returns 展示在 AutoFind 对话中的参考对话摘要。
 */
function formatRubricDialogueSection(rubricContext?: AutoFindRubricContext): string {
  const dialogue = rubricContext?.rubricDialogue ?? [];
  if (dialogue.length === 0) return "";

  const lines = dialogue
    .slice(-6)
    .map((turn) => `- ${turn.role === "user" ? "用户" : "助手"}：${turn.text.trim()}`);
  return ["", "### 评分标准生成参考对话", ...lines].join("\n");
}

function parseCsvSummary(csvText: string): NonNullable<AutoFindWorkflowState["summary"]> {
  const lines = csvText.trim().split(/\r?\n/).slice(1);
  const sessionIds = new Set<string>();
  let positiveSessions = 0;
  let negativeSessions = 0;
  for (const line of lines) {
    const sessionId = line.split(",")[0]?.replace(/^"/, "").replace(/"$/, "") ?? "";
    if (!sessionId || sessionIds.has(sessionId)) continue;
    sessionIds.add(sessionId);
    if (sessionId.includes("_pos_")) positiveSessions += 1;
    if (sessionId.includes("_neg_")) negativeSessions += 1;
  }
  const sessions = sessionIds.size;
  return {
    sessions,
    rows: lines.length,
    positiveSessions,
    negativeSessions,
    avgTurnsPerSession: sessions > 0 ? Math.round(lines.length / sessions) : 0,
  };
}

function buildPreviewSessions(csvText: string): NonNullable<AutoFindWorkflowState["previewSessions"]> {
  const lines = csvText.trim().split(/\r?\n/).slice(1);
  const buckets = new Map<string, string[]>();
  for (const line of lines) {
    const match = line.match(/^([^,]+),/);
    const sessionId = match?.[1] ?? "";
    if (!sessionId) continue;
    const contentMatch = line.match(/,(?:"([^"]*(?:""[^"]*)*)"|([^",]*))$/);
    const content = (contentMatch?.[1] ?? contentMatch?.[2] ?? "").replace(/""/g, '"');
    const list = buckets.get(sessionId) ?? [];
    list.push(content);
    buckets.set(sessionId, list);
  }
  return [...buckets.entries()].slice(0, 6).map(([sessionId, messages]) => ({
    sessionId,
    label: sessionId.includes("_neg_") ? "negative" : "positive",
    turns: messages.length,
    snippet: messages[0]?.slice(0, 48) ?? "",
  }));
}

function buildOutputFileName(requirementText: string): string {
  const slug = requirementText
    .toLowerCase()
    .replace(/[^a-z0-9\u3400-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug ? `${slug}-autofind-50sessions.csv` : "companion-autofind-50sessions.csv";
}

function clampCount(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(30, Math.round(value)));
}
