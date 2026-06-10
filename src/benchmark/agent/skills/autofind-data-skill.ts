/**
 * @fileoverview AutoFind 数据技能 — 轻量工作流：搜索 10 正 + 10 负多轮对话并导出 CSV。
 *
 * 正样本：CPsyCounD（中文情绪陪伴/心理咨询多轮）
 * 负样本：FailedESConv（低满意度情绪支持，模拟流失风险）
 *
 * 降级：若远程下载失败，回退读取 `public/sample-data/` 已有缓存文件。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import https from "node:https";
import path from "node:path";

const CPSYCOND_URL =
  "https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun/resolve/main/CPsyCounD.json";
const FAILED_ESCONV_URL =
  "https://raw.githubusercontent.com/thu-coai/Emotional-Support-Conversation/main/FailedESConv.json";

const CACHE_DIR = path.join(process.cwd(), ".zeval-db", "autofind-cache");
const OUTPUT_DIR = path.join(process.cwd(), "public", "sample-data");

export type AutoFindPhase = "intro" | "planned" | "searched" | "saved";

export type AutoFindRubricContext = {
  requirementText: string;
  rubricDialogue: Array<{ role: "user" | "assistant"; text: string }>;
  rubricTitle?: string;
  rubricDescription?: string;
  rubricMetrics?: string[];
};

export type AutoFindWorkflowState = {
  phase: AutoFindPhase;
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
  warnings: string[];
};

export type RunAutoFindInput = {
  action: "start" | "search" | "save" | "chat";
  requirementText?: string;
  rubricContext?: AutoFindRubricContext;
  message?: string;
  state?: AutoFindWorkflowState | null;
};

export type RunAutoFindResult = {
  reply: string;
  state: AutoFindWorkflowState;
  suggestedActions?: string[];
};

type CpsyItem = {
  history?: Array<[string, string]>;
  instruction?: string;
  output?: string;
};

type EsconvItem = {
  problem_type?: string;
  emotion_type?: string;
  situation?: string;
  survey_score?: {
    seeker?: {
      empathy?: string;
      relevance?: string;
      initial_emotion_intensity?: string;
      final_emotion_intensity?: string;
    };
  };
  dialog?: Array<{ speaker?: string; text?: string; content?: string }>;
};

/**
 * 执行 AutoFind 轻量工作流（规则驱动，无 LLM）。
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
    return searchWorkflow(state);
  }

  if (input.action === "save") {
    return saveWorkflow(state);
  }

  return handleChatWorkflow(state, input.message ?? "");
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
  const state: AutoFindWorkflowState = {
    phase: "planned",
    requirementText: mergedRequirement,
    rubricContext,
    positiveCount: 10,
    negativeCount: 10,
    includeEnglishNegative: true,
    sources: [
      "CPsyCounD @ HuggingFace（中文正样本：情绪压力/陪伴类多轮）",
      "FailedESConv @ GitHub（负样本：低共情/低相关性，模拟流失风险）",
    ],
    warnings: [],
  };

  return {
    reply: [
      "## AutoFind 数据工作流",
      "",
      "目标：为当前评测任务准备 **10 条正样本 + 10 条负样本** 多轮对话，并导出为 Zeval CSV。",
      "",
      mergedRequirement
        ? `**当前需求**：${mergedRequirement}`
        : "**当前需求**：尚未填写，将按情绪陪伴类场景检索。",
      rubricContext?.rubricTitle ? `**评分标准**：${rubricContext.rubricTitle}` : "",
      rubricContext?.rubricDescription ? `**标准说明**：${rubricContext.rubricDescription}` : "",
      rubricContext?.rubricMetrics?.length
        ? `**已确认指标**：${rubricContext.rubricMetrics.join("、")}`
        : "",
      formatRubricDialogueSection(rubricContext),
      "",
      "### 步骤",
      "1. **检索** — 从公开数据集按关键词筛选 session",
      "2. **整理** — 转为 `sessionId,timestamp,role,content`",
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
async function searchWorkflow(state: AutoFindWorkflowState): Promise<RunAutoFindResult> {
  const warnings = [...state.warnings];
  let csvText = "";
  let builtFromCache = false;

  try {
    csvText = await buildAutoFindCsv({
      searchProfile: buildSearchProfile(state),
      positiveCount: state.positiveCount,
      negativeCount: state.negativeCount,
      includeEnglishNegative: state.includeEnglishNegative,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`远程检索失败：${message}`);
    const fallbackPath = path.join(OUTPUT_DIR, "companion-autofind-20sessions.csv");
    if (existsSync(fallbackPath)) {
      csvText = await readFile(fallbackPath, "utf8");
      builtFromCache = true;
      warnings.push("已回退使用本地缓存 `public/sample-data/companion-autofind-20sessions.csv`。");
    } else {
      throw error;
    }
  }

  const parsed = parseCsvSummary(csvText);
  const fileName = buildOutputFileName(state.requirementText);
  const previewSessions = buildPreviewSessions(csvText);

  const nextState: AutoFindWorkflowState = {
    ...state,
    phase: "searched",
    fileName,
    publicPath: `public/sample-data/${fileName}`,
    csvText,
    summary: parsed,
    previewSessions,
    warnings,
  };

  return {
    reply: [
      builtFromCache ? "⚠️ 使用本地缓存完成整理。" : "✅ 检索与整理完成。",
      "",
      `- 正样本：**${parsed.positiveSessions}** sessions（companion_pos_*）`,
      `- 负样本：**${parsed.negativeSessions}** sessions（companion_neg_*）`,
      `- 总消息数：**${parsed.rows}**，平均每 session **${parsed.avgTurnsPerSession}** 轮`,
      "",
      "### 数据来源",
      ...state.sources.map((source) => `- ${source}`),
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
async function saveWorkflow(state: AutoFindWorkflowState): Promise<RunAutoFindResult> {
  if (!state.csvText || !state.fileName) {
    const searched = await searchWorkflow(state);
    return saveWorkflow(searched.state);
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
    return searchWorkflow(state);
  }
  if (/保存|写入|导出|save/i.test(text)) {
    return saveWorkflow(state);
  }
  if (/应用|加载|导入|apply/i.test(text)) {
    if (!state.csvText) {
      const searched = await searchWorkflow(state);
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
        `文件：\`${state.fileName ?? "companion-autofind-20sessions.csv"}\``,
        "（前端将自动调用 ingest 流程）",
      ].join("\n"),
      state: { ...state, phase: "saved" },
      suggestedActions: [],
    };
  }
  if (/只要中文|中文负样本|不要英文/i.test(text)) {
    return {
      reply: "已切换为仅中文正样本检索；负样本将尝试从 CPsyCoun 中筛选「挫败/无效支持」语境（数量不足时仍可能混入英文 FailedESConv）。回复 **开始搜索** 继续。",
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
      "- **开始搜索** — 从 CPsyCounD + FailedESConv 拉取并整理",
      "- **保存** — 写入 `public/sample-data/`",
      "- **应用** — 加载到评测数据区",
      "- **正样本 10 负样本 10** — 调整数量",
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
  return {
    ...state,
    requirementText,
    rubricContext,
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

async function buildAutoFindCsv(input: {
  searchProfile: string;
  positiveCount: number;
  negativeCount: number;
  includeEnglishNegative: boolean;
}): Promise<string> {
  const [cpsyRaw, failedRaw] = await Promise.all([
    downloadCached(CPSYCOND_URL, "CPsyCounD.json"),
    input.includeEnglishNegative
      ? downloadCached(FAILED_ESCONV_URL, "FailedESConv.json")
      : Promise.resolve("[]"),
  ]);

  const cpsyData = JSON.parse(cpsyRaw) as CpsyItem[];
  const failedData = JSON.parse(failedRaw) as EsconvItem[];

  const positiveItems = rankPositiveSessions(cpsyData, input.searchProfile).slice(
    0,
    input.positiveCount,
  );
  const negativeItems = input.includeEnglishNegative
    ? rankFailedEsconvSessions(failedData).slice(0, input.negativeCount)
    : rankChineseNegativeSessions(cpsyData).slice(0, input.negativeCount);

  const rows: string[] = ["sessionId,timestamp,role,content"];
  const base = Date.parse("2026-05-01T20:00:00+08:00");

  positiveItems.forEach((item, index) => {
    appendCpsySession(
      rows,
      `companion_pos_${String(index + 1).padStart(2, "0")}`,
      base + index * 3_600_000,
      item,
    );
  });

  negativeItems.forEach((item, index) => {
    if ("dialog" in item && Array.isArray(item.dialog)) {
      appendEsconvSession(
        rows,
        `companion_neg_${String(index + 1).padStart(2, "0")}`,
        base + (index + 100) * 3_600_000,
        item as EsconvItem,
      );
    } else {
      appendCpsySession(
        rows,
        `companion_neg_${String(index + 1).padStart(2, "0")}`,
        base + (index + 100) * 3_600_000,
        item as CpsyItem,
      );
    }
  });

  return `${rows.join("\n")}\n`;
}

/**
 * @param data CPsyCounD 全量数据。
 * @param requirementText 任务需求。
 * @returns 排序后的正样本 session。
 */
function rankPositiveSessions(data: CpsyItem[], searchProfile: string): CpsyItem[] {
  const extra = searchProfile.trim();
  return data
    .map((item) => ({
      item,
      turns: countCpsyTurns(item),
      score: scorePositive(item, extra),
    }))
    .filter((entry) => entry.turns >= 8 && entry.score > 0)
    .sort((a, b) => b.score - a.score || b.turns - a.turns)
    .map((entry) => entry.item);
}

/**
 * @param data FailedESConv 数据。
 * @returns 排序后的负样本 session。
 */
function rankFailedEsconvSessions(data: EsconvItem[]): EsconvItem[] {
  return data
    .map((item) => ({
      item,
      turns: Array.isArray(item.dialog) ? item.dialog.length : 0,
      score: scoreFailedEsconv(item),
    }))
    .filter((entry) => entry.turns >= 6)
    .sort((a, b) => b.score - a.score || b.turns - a.turns)
    .map((entry) => entry.item);
}

/**
 * @param data CPsyCounD 数据。
 * @returns 中文负样本（挫败/无效支持语境）。
 */
function rankChineseNegativeSessions(data: CpsyItem[]): CpsyItem[] {
  return data
    .map((item) => ({
      item,
      turns: countCpsyTurns(item),
      score: scoreChineseNegative(item),
    }))
    .filter((entry) => entry.turns >= 8 && entry.score > 0)
    .sort((a, b) => b.score - a.score || b.turns - a.turns)
    .map((entry) => entry.item);
}

function scorePositive(item: CpsyItem, searchProfile: string): number {
  const text = cpsyText(item);
  let score = 0;
  if (/孤独|失望|伤心|焦虑|失眠|婚姻|关系|陪伴|压力|情绪|失落|疲惫|空虚|分手|离婚|老公|丈夫|男朋友|职场|工作|陪伴|倾诉|流失|DAU|硬件|玩具|女性/.test(text)) {
    score += 4;
  }
  if (/女性|女生|成年|30岁|35岁|40岁|职场女性|妈妈|母亲/.test(text)) {
    score += 2;
  }
  if (/六岁|6岁|七岁|7岁|幼儿园|小学|未成年/.test(text)) {
    score -= 5;
  }
  score += scoreKeywordOverlap(text, searchProfile);
  if (countCpsyTurns(item) >= 12) score += 2;
  else if (countCpsyTurns(item) >= 8) score += 1;
  return score;
}

/**
 * @param target 候选 session 文本。
 * @param searchProfile 需求与 rubric 参考文本。
 * @returns 关键词重合加分。
 */
function scoreKeywordOverlap(target: string, searchProfile: string): number {
  const keywords = extractSearchKeywords(searchProfile);
  if (keywords.length === 0) return 0;
  const hitCount = keywords.filter((keyword) => target.includes(keyword)).length;
  return Math.min(4, hitCount);
}

/**
 * @param searchProfile 综合检索文本。
 * @returns 用于打分的短关键词列表。
 */
function extractSearchKeywords(searchProfile: string): string[] {
  const chunks = searchProfile
    .split(/[\s,，。！？；;、\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 12);
  return [...new Set(chunks)].slice(0, 24);
}

function scoreChineseNegative(item: CpsyItem): number {
  const text = cpsyText(item);
  let score = 0;
  if (/没用|失望|更难受|不想说|算了|敷衍|不理解|冷漠|还是这样|更焦虑|更孤独/.test(text)) score += 4;
  if (/孤独|失眠|婚姻|分手|压力|情绪/.test(text)) score += 2;
  if (/六岁|6岁|七岁|7岁|幼儿园|小学|未成年/.test(text)) score -= 5;
  return score;
}

function scoreFailedEsconv(item: EsconvItem): number {
  const seeker = item.survey_score?.seeker;
  const empathy = Number(seeker?.empathy ?? 5);
  const relevance = Number(seeker?.relevance ?? 5);
  const initial = Number(seeker?.initial_emotion_intensity ?? 3);
  const final = Number(seeker?.final_emotion_intensity ?? 3);
  let score = 0;
  if (empathy <= 2) score += 3;
  if (relevance <= 2) score += 3;
  if (final >= initial) score += 2;
  if (/anxiety|depression|lonely|relationship|stress|sad/.test(`${item.emotion_type ?? ""} ${item.problem_type ?? ""}`)) {
    score += 2;
  }
  return score;
}

function countCpsyTurns(item: CpsyItem): number {
  const history = Array.isArray(item.history) ? item.history : [];
  let turns = history.length * 2;
  if (String(item.instruction ?? "").trim()) turns += 1;
  if (String(item.output ?? "").trim()) turns += 1;
  return turns;
}

function cpsyText(item: CpsyItem): string {
  const history = Array.isArray(item.history) ? item.history : [];
  return [
    ...history.flatMap((pair) => pair.map(String)),
    String(item.instruction ?? ""),
    String(item.output ?? ""),
  ].join(" ");
}

function appendCpsySession(
  rows: string[],
  sessionId: string,
  startTimestamp: number,
  item: CpsyItem,
): void {
  let timestamp = startTimestamp;
  const history = Array.isArray(item.history) ? item.history : [];
  for (const pair of history) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    timestamp = pushCsvRow(rows, sessionId, timestamp, "user", String(pair[0] ?? ""));
    timestamp = pushCsvRow(rows, sessionId, timestamp, "assistant", String(pair[1] ?? ""));
  }
  const instruction = String(item.instruction ?? "").trim();
  if (instruction) {
    timestamp = pushCsvRow(rows, sessionId, timestamp, "user", instruction);
  }
  const output = String(item.output ?? "").trim();
  if (output) {
    pushCsvRow(rows, sessionId, timestamp, "assistant", output);
  }
}

function appendEsconvSession(
  rows: string[],
  sessionId: string,
  startTimestamp: number,
  item: EsconvItem,
): void {
  let timestamp = startTimestamp;
  const dialog = Array.isArray(item.dialog) ? item.dialog : [];
  for (const turn of dialog) {
    const speaker = String(turn.speaker ?? "").toLowerCase();
    const role =
      speaker === "sys" || speaker === "listener" || speaker === "assistant" || speaker === "counselor"
        ? "assistant"
        : "user";
    timestamp = pushCsvRow(
      rows,
      sessionId,
      timestamp,
      role,
      String(turn.content ?? turn.text ?? ""),
    );
  }
}

function pushCsvRow(
  rows: string[],
  sessionId: string,
  timestamp: number,
  role: string,
  content: string,
): number {
  const normalized = content.replace(/\r?\n/g, " ").trim();
  if (!normalized) return timestamp;
  rows.push(
    [sessionId, new Date(timestamp).toISOString(), role, `"${normalized.replace(/"/g, '""')}"`].join(","),
  );
  return timestamp + 15_000 + Math.floor(Math.random() * 25_000);
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

function buildOutputFileName(_requirementText: string): string {
  return "companion-autofind-20sessions.csv";
}

function clampCount(value: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(30, Math.round(value)));
}

/**
 * @param url 远程地址。
 * @param cacheName 本地缓存文件名。
 * @returns 文件文本内容。
 */
async function downloadCached(url: string, cacheName: string): Promise<string> {
  await mkdir(CACHE_DIR, { recursive: true });
  const cachePath = path.join(CACHE_DIR, cacheName);
  if (existsSync(cachePath)) {
    return readFile(cachePath, "utf8");
  }
  const buffer = await downloadUrl(url);
  await writeFile(cachePath, buffer);
  return buffer.toString("utf8");
}

/**
 * @param url 远程地址。
 * @returns 响应体 Buffer。
 */
function downloadUrl(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          downloadUrl(new URL(response.headers.location, url).toString()).then(resolve).catch(reject);
          return;
        }
        if ((response.statusCode ?? 500) >= 400) {
          reject(new Error(`下载失败 ${response.statusCode}: ${url}`));
          return;
        }
        const chunks: Buffer[] = [];
        response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      })
      .on("error", reject);
  });
}
