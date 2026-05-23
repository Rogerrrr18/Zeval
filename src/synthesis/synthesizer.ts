/**
 * @fileoverview Synthetic dataset generator (DeepEval `Synthesizer` 等价物).
 *
 * 给定一个场景 + 失败模式描述 + 数量，让 LLM 合成 N 条对话样本。
 * 适用场景：
 *   - 还没有真实生产数据，但需要先建一个回归集
 *   - 想要专门覆盖某个失败模式的样本不够
 *   - 给 calibration gold-set 起草 candidate 内容
 */

import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import { normalizeTranscriptForHash } from "@/eval-datasets/case-transcript-hash";

const EVOLUTION_OPERATORS = [
  "信息缺失",
  "用户改口",
  "情绪升级",
  "多约束冲突",
  "工具参数歧义",
  "跨轮引用",
  "噪声表达",
  "边界政策请求",
] as const;

const PERSONA_POOL = [
  "耐心但信息不完整的新手用户",
  "时间紧迫且语气强硬的业务负责人",
  "懂术语但需求频繁变化的高级用户",
  "表达碎片化、夹杂口语的普通用户",
  "对系统结果不信任、持续追问的用户",
] as const;

/**
 * 一次合成请求的输入。
 */
export type SynthesizeRequest = {
  /** 场景描述（中文），例如 "ToB 客服 Agent，处理订单退款" */
  scenarioDescription: string;
  /** 期望覆盖的失败模式（可多个），例如 ["升级触发", "目标未达成"] */
  targetFailureModes?: string[];
  /** 期望生成的对话条数 */
  count: number;
  /** 生成策略：balanced 兼顾正负样本，long_tail 强化稀有失败，regression 面向回归集。 */
  strategy?: "balanced" | "long_tail" | "regression";
  /** 每条对话的轮次范围 */
  turnRange?: { min: number; max: number };
  /** 风格补充说明 */
  styleHint?: string;
  /** 真实 bad case 或人工样本片段，用作长尾扩增 anchor。 */
  anchorCases?: string[];
  /** 是否过滤低质量、重复或未命中计划的样本。 */
  qualityGate?: boolean;
  runId?: string;
};

/**
 * One planned coverage cell before LLM generation.
 */
export type SynthesisPlanCell = {
  planCellId: string;
  failureMode: string | null;
  persona: string;
  difficultyHint: "easy" | "medium" | "hard";
  targetCount: number;
  evolutionOperators: string[];
  rarityScore: number;
  expectedBehaviorFocus: string;
};

/**
 * Coverage plan used to steer generation and explain long-tail intent.
 */
export type SynthesisPlan = {
  strategy: "balanced" | "long_tail" | "regression";
  totalTargetCount: number;
  cells: SynthesisPlanCell[];
  notes: string[];
};

/**
 * 一条合成对话样本。
 */
export type SyntheticConversation = {
  caseId: string;
  scenarioTag: string;
  failureMode: string | null;
  planCellId?: string;
  evolutionOperators?: string[];
  rarityScore?: number;
  rawRows: Array<{
    sessionId: string;
    timestamp: string;
    role: "user" | "assistant" | "system";
    content: string;
  }>;
  expectedBehavior: string;
  difficultyHint: "easy" | "medium" | "hard";
  qualityScore?: number;
  qualityNotes?: string[];
};

/**
 * Quality filter diagnostics for one generated item.
 */
export type SynthesisQualityDiagnostic = {
  caseId: string;
  accepted: boolean;
  score: number;
  reasons: string[];
  planCellId?: string;
};

/**
 * 一次合成请求的产出。
 */
export type SynthesizeResult = {
  conversations: SyntheticConversation[];
  plan: SynthesisPlan;
  qualityReport: {
    accepted: number;
    rejected: number;
    diagnostics: SynthesisQualityDiagnostic[];
  };
  warnings: string[];
};

const SYSTEM_PROMPT = `你是一个高质量评测样本生成器，目标是为 Zeval 评估系统合成中文对话样本，让评估指标能跑出可解释的结果。

约束：
1. 每条对话以 sessionId 唯一标识
2. 时间戳从 2026-04-18T10:00:00+08:00 开始递增（每条消息间隔 30~120 秒）
3. role 限定为 user/assistant
4. 必须明确指定 failureMode（可为 null 表示正面样本）
5. expectedBehavior 用一句话描述"在这种场景下 assistant 应该怎么做"
6. 必须按用户给定的 coveragePlan 生成，每条样本绑定一个 planCellId
7. evolutionOperators 必须体现到对话内容里，不要只写标签
8. 输出必须是合法 JSON 对象

输出格式：
{
  "conversations": [
    {
      "caseId": "synth_<short_uuid>",
      "scenarioTag": "<场景 tag>",
      "failureMode": "<失败模式或 null>",
      "planCellId": "<coveragePlan.cells[].planCellId>",
      "evolutionOperators": ["信息缺失", "用户改口"],
      "rarityScore": 0.8,
      "rawRows": [{"sessionId":"...","timestamp":"...","role":"user|assistant","content":"..."}],
      "expectedBehavior": "<一句话>",
      "difficultyHint": "easy|medium|hard",
      "qualityNotes": ["说明为什么这条样本覆盖了指定长尾场景"]
    }
  ]
}
不要返回 markdown，只返回 JSON。`;

/**
 * Generate synthetic conversations for evaluation.
 *
 * @param request Synthesis request.
 * @returns Synthesis result with conversations + warnings.
 */
export async function synthesizeConversations(request: SynthesizeRequest): Promise<SynthesizeResult> {
  const turnMin = request.turnRange?.min ?? 4;
  const turnMax = request.turnRange?.max ?? 10;
  const plan = buildSynthesisPlan(request);
  const failureModesText = request.targetFailureModes?.length
    ? `失败模式覆盖：${request.targetFailureModes.join("、")}（严格按 coveragePlan 分布）`
    : "失败模式：自由选择，但必须包含至少 30% 的负面样本";
  const anchorsText = request.anchorCases?.length
    ? `\n真实 anchor case（只能借鉴结构和失败模式，不要照抄原文）：\n${request.anchorCases
        .slice(0, 6)
        .map((item, index) => `${index + 1}. ${item.slice(0, 800)}`)
        .join("\n")}`
    : "";

  const userPrompt = `请为以下场景合成 ${request.count} 条对话样本：

场景描述：${request.scenarioDescription}
${failureModesText}
每条对话轮次：${turnMin}~${turnMax} 轮
生成策略：${plan.strategy}
coveragePlan：
${JSON.stringify(plan.cells, null, 2)}
${request.styleHint ? `风格提示：${request.styleHint}` : ""}
${anchorsText}

记得每条对话的 sessionId 必须唯一，timestamp 必须递增，role 仅使用 user 和 assistant。优先覆盖 rarityScore 高、difficultyHint 为 hard 的长尾样本，但要保留可评测性。`;

  const warnings: string[] = [];
  let raw: string;
  try {
    raw = await requestSiliconFlowChatCompletion(
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt },
      ],
      { stage: "synthesize", runId: request.runId },
    );
  } catch (error) {
    throw new Error(`synthesizer LLM 调用失败：${(error as Error).message}`);
  }

  const parsed = parseJsonObjectFromLlmOutput(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`synthesizer 返回非 JSON: ${raw.slice(0, 240)}`);
  }

  const conversations = (parsed as { conversations?: unknown }).conversations;
  if (!Array.isArray(conversations)) {
    throw new Error("synthesizer 返回缺少 conversations 数组");
  }

  const result: SyntheticConversation[] = [];
  const diagnostics: SynthesisQualityDiagnostic[] = [];
  const seenNormalizedTranscripts = new Set<string>();
  for (const item of conversations) {
    const validated = validateAndNormalize(item, warnings);
    if (!validated) {
      continue;
    }
    const diagnostic = scoreConversationQuality(validated, {
      plan,
      turnMin,
      turnMax,
      seenNormalizedTranscripts,
    });
    diagnostics.push(diagnostic);
    validated.qualityScore = diagnostic.score;
    validated.qualityNotes = [...(validated.qualityNotes ?? []), ...diagnostic.reasons];
    if (diagnostic.accepted || request.qualityGate === false) {
      result.push(validated);
    }
  }
  const acceptedDiagnosticCount = diagnostics.filter((item) => item.accepted).length;
  const rejectedDiagnosticCount = diagnostics.length - acceptedDiagnosticCount;

  if (result.length === 0) {
    warnings.push("synthesizer 返回结果不可用，结果为空");
  } else if (result.length < request.count) {
    warnings.push(`期望 ${request.count} 条，实际生成 ${result.length} 条`);
  }

  return {
    conversations: result,
    plan,
    qualityReport: {
      accepted: acceptedDiagnosticCount,
      rejected: rejectedDiagnosticCount,
      diagnostics,
    },
    warnings,
  };
}

/**
 * Build a deterministic DeepEval-style coverage plan before generation.
 * It turns failure modes into coverage cells with personas, evolutions, and rarity scores.
 *
 * @param request Synthesis request.
 * @returns Coverage plan consumed by the LLM and returned to the UI.
 */
export function buildSynthesisPlan(request: SynthesizeRequest): SynthesisPlan {
  const strategy = request.strategy ?? "long_tail";
  const failureModes = normalizeFailureModes(request.targetFailureModes);
  const includePositiveControl = strategy === "balanced" || failureModes.length === 0;
  const targetModes = includePositiveControl ? [null, ...failureModes] : failureModes;
  const cells: SynthesisPlanCell[] = [];
  const notes: string[] = [
    "先规划覆盖桶，再生成样本，避免 LLM 随机平均化。",
    "每个桶绑定 persona、演化算子和 rarityScore，用于长尾覆盖解释。",
  ];

  const baseModes = targetModes.length > 0 ? targetModes : [null];
  for (let index = 0; index < request.count; index += 1) {
    const failureMode = pickFailureMode(baseModes, index, strategy);
    const operatorOffset = index + (failureMode ? failureMode.length : 1);
    const evolutionOperators = [
      EVOLUTION_OPERATORS[operatorOffset % EVOLUTION_OPERATORS.length],
      EVOLUTION_OPERATORS[(operatorOffset + 3) % EVOLUTION_OPERATORS.length],
    ].filter(Boolean);
    const rarityScore = scoreRarity({
      strategy,
      index,
      failureMode,
      hasAnchor: Boolean(request.anchorCases?.length),
    });
    cells.push({
      planCellId: `cell_${String(index + 1).padStart(2, "0")}`,
      failureMode,
      persona: PERSONA_POOL[index % PERSONA_POOL.length],
      difficultyHint: rarityScore >= 0.78 ? "hard" : rarityScore >= 0.52 ? "medium" : "easy",
      targetCount: 1,
      evolutionOperators,
      rarityScore,
      expectedBehaviorFocus: failureMode
        ? `assistant 应识别并缓解「${failureMode}」，给出可执行下一步。`
        : "assistant 应稳定完成任务，作为正向对照样本。",
    });
  }

  if (request.anchorCases?.length) {
    notes.push("本次使用 anchor case 做长尾扩增，生成时应变形结构而不是复制文本。");
  }

  return {
    strategy,
    totalTargetCount: request.count,
    cells,
    notes,
  };
}

/**
 * Validate one synthesized conversation and normalize fields.
 *
 * @param item Raw item from LLM output.
 * @param warnings Warning collector.
 * @returns Normalized conversation or null.
 */
function validateAndNormalize(item: unknown, warnings: string[]): SyntheticConversation | null {
  if (typeof item !== "object" || item === null) {
    warnings.push("跳过非对象项");
    return null;
  }
  const record = item as Record<string, unknown>;

  const caseId = String(record.caseId ?? "").trim() || `synth_${Math.random().toString(36).slice(2, 10)}`;
  const scenarioTag = String(record.scenarioTag ?? "").trim() || "general";
  const failureMode =
    record.failureMode === null
      ? null
      : record.failureMode != null
        ? String(record.failureMode)
        : null;
  const expectedBehavior = String(record.expectedBehavior ?? "").trim() || "未提供期望行为";
  const planCellId = String(record.planCellId ?? "").trim() || undefined;
  const evolutionOperators = Array.isArray(record.evolutionOperators)
    ? record.evolutionOperators.map((operator) => String(operator).trim()).filter(Boolean).slice(0, 4)
    : [];
  const rarityScore = coerceScore(record.rarityScore);
  const qualityNotes = Array.isArray(record.qualityNotes)
    ? record.qualityNotes.map((note) => String(note).trim()).filter(Boolean).slice(0, 6)
    : [];
  const difficultyHint = (["easy", "medium", "hard"] as const).includes(
    record.difficultyHint as "easy" | "medium" | "hard",
  )
    ? (record.difficultyHint as "easy" | "medium" | "hard")
    : "medium";

  const rawRows = Array.isArray(record.rawRows) ? record.rawRows : [];
  if (rawRows.length === 0) {
    warnings.push(`跳过空对话 ${caseId}`);
    return null;
  }

  const normalized: SyntheticConversation["rawRows"] = [];
  for (const row of rawRows) {
    if (typeof row !== "object" || row === null) continue;
    const r = row as Record<string, unknown>;
    const role = r.role;
    const content = String(r.content ?? "").trim();
    if ((role !== "user" && role !== "assistant" && role !== "system") || !content) continue;
    normalized.push({
      sessionId: String(r.sessionId ?? caseId),
      timestamp: String(r.timestamp ?? new Date().toISOString()),
      role,
      content,
    });
  }

  if (normalized.length < 2) {
    warnings.push(`${caseId} 有效消息数不足 2，跳过`);
    return null;
  }

  return {
    caseId,
    scenarioTag,
    failureMode,
    planCellId,
    evolutionOperators,
    rarityScore,
    rawRows: normalized,
    expectedBehavior,
    difficultyHint,
    qualityNotes,
  };
}

/**
 * Score one conversation using cheap local filters before accepting it.
 * Degrades without LLM judge by combining schema checks, coverage match, and duplicate checks.
 *
 * @param conversation Normalized synthetic conversation.
 * @param context Plan and dedupe context.
 * @returns Diagnostic with accept/reject decision.
 */
function scoreConversationQuality(
  conversation: SyntheticConversation,
  context: {
    plan: SynthesisPlan;
    turnMin: number;
    turnMax: number;
    seenNormalizedTranscripts: Set<string>;
  },
): SynthesisQualityDiagnostic {
  const reasons: string[] = [];
  let score = 1;
  const planCell = conversation.planCellId
    ? context.plan.cells.find((cell) => cell.planCellId === conversation.planCellId)
    : undefined;
  const transcript = transcriptFromRows(conversation.rawRows);
  const normalizedTranscript = normalizeTranscriptForHash(transcript);

  if (!planCell) {
    score -= 0.18;
    reasons.push("未绑定有效 coverage plan cell");
  } else {
    reasons.push(`命中 ${planCell.planCellId}: ${planCell.failureMode ?? "positive_control"}`);
    if ((conversation.failureMode ?? null) !== planCell.failureMode) {
      score -= 0.22;
      reasons.push("failureMode 与覆盖计划不一致");
    }
  }

  if (conversation.rawRows.length < context.turnMin || conversation.rawRows.length > context.turnMax * 2) {
    score -= 0.12;
    reasons.push("对话长度偏离设定轮次范围");
  }

  if (!hasBothUserAndAssistant(conversation)) {
    score -= 0.28;
    reasons.push("缺少 user 或 assistant 角色");
  }

  if (normalizedTranscript.length < 80) {
    score -= 0.2;
    reasons.push("有效文本过短，难以评测");
  }

  if (context.seenNormalizedTranscripts.has(normalizedTranscript)) {
    score -= 0.4;
    reasons.push("与本次生成结果重复");
  } else {
    context.seenNormalizedTranscripts.add(normalizedTranscript);
  }

  if (conversation.failureMode && !coversFailureMode(conversation, transcript)) {
    score -= 0.06;
    reasons.push("failureMode 只在元数据中出现，正文覆盖较弱");
  }

  if ((conversation.evolutionOperators?.length ?? 0) === 0) {
    score -= 0.08;
    reasons.push("缺少演化算子说明");
  }

  const rounded = Number(Math.max(0, Math.min(1, score)).toFixed(4));
  return {
    caseId: conversation.caseId,
    accepted: rounded >= 0.62,
    score: rounded,
    reasons,
    planCellId: conversation.planCellId,
  };
}

/**
 * Normalize user-provided failure mode strings.
 * @param modes Optional raw failure modes.
 * @returns Unique non-empty modes.
 */
function normalizeFailureModes(modes?: string[]): string[] {
  return Array.from(new Set((modes ?? []).map((item) => item.trim()).filter(Boolean)));
}

/**
 * Pick one failure mode for a coverage cell.
 * @param modes Candidate modes.
 * @param index Cell index.
 * @param strategy Generation strategy.
 * @returns Selected failure mode or null.
 */
function pickFailureMode(
  modes: Array<string | null>,
  index: number,
  strategy: "balanced" | "long_tail" | "regression",
): string | null {
  if (modes.length === 0) {
    return null;
  }
  if (strategy === "long_tail" && modes.length > 1 && index % 5 !== 0) {
    return modes[(index % (modes.length - 1)) + 1] ?? modes[0] ?? null;
  }
  return modes[index % modes.length] ?? null;
}

/**
 * Compute intended rarity for one coverage cell.
 * @param input Strategy and mode context.
 * @returns Normalized rarity score.
 */
function scoreRarity(input: {
  strategy: "balanced" | "long_tail" | "regression";
  index: number;
  failureMode: string | null;
  hasAnchor: boolean;
}): number {
  const strategyBase = input.strategy === "long_tail" ? 0.68 : input.strategy === "regression" ? 0.58 : 0.36;
  const failureBoost = input.failureMode ? 0.12 : -0.08;
  const anchorBoost = input.hasAnchor ? 0.08 : 0;
  const variation = (input.index % 4) * 0.04;
  return Number(Math.max(0.12, Math.min(0.95, strategyBase + failureBoost + anchorBoost + variation)).toFixed(2));
}

/**
 * Convert a loosely typed value into a normalized score.
 * @param value Raw score.
 * @returns Number in [0, 1] or undefined.
 */
function coerceScore(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

/**
 * Convert rows into a stable transcript string.
 * @param rows Synthetic rows.
 * @returns Transcript text.
 */
export function transcriptFromRows(rows: SyntheticConversation["rawRows"]): string {
  return rows.map((row) => `${row.role}: ${row.content}`).join("\n");
}

/**
 * Check whether both conversational roles exist.
 * @param conversation Synthetic conversation.
 * @returns True when user and assistant messages are present.
 */
function hasBothUserAndAssistant(conversation: SyntheticConversation): boolean {
  const roles = new Set(conversation.rawRows.map((row) => row.role));
  return roles.has("user") && roles.has("assistant");
}

/**
 * Check whether a generated case visibly carries its target failure mode.
 * Falls back to expected behavior and evolution metadata when the exact label is not conversational text.
 *
 * @param conversation Synthetic conversation.
 * @param transcript Full transcript.
 * @returns True when the failure target is represented in generated content or metadata.
 */
function coversFailureMode(conversation: SyntheticConversation, transcript: string): boolean {
  const failureMode = conversation.failureMode?.trim();
  if (!failureMode) {
    return true;
  }
  const haystack = [
    transcript,
    conversation.expectedBehavior,
    ...(conversation.evolutionOperators ?? []),
    ...(conversation.qualityNotes ?? []),
  ].join("\n");
  if (haystack.includes(failureMode)) {
    return true;
  }
  return failureMode
    .split(/[、,\s/]+/)
    .filter((part) => part.length >= 2)
    .some((part) => haystack.includes(part));
}
