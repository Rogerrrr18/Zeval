/**
 * @fileoverview Shared LLM judge utility for extended metrics (DeepEval-style G-Eval).
 *
 * 核心思想（参考 DeepEval G-Eval）：
 *   - 给 judge 一段「评估准则 + 对话片段」
 *   - 让它输出 {score: 0-1, reason, evidence, confidence}
 *   - 用 prompt-locked JSON schema 强约束输出格式
 */

import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import { buildVersionedJudgeSystemPrompt } from "@/llm/judgeProfile";

/**
 * 一个标准化的 judge 调用输入。
 */
export type JudgeInvocation = {
  /** 指标 ID（用于日志） */
  metricId: string;
  /** 评估准则（中文，含 0~1 分级标准） */
  criteria: string;
  /** 待判定内容（query + response 或对话片段） */
  payload: string;
  /** 额外约束 */
  extraInstruction?: string;
  /** 触发上下文 */
  runId?: string;
  /** 触发上下文 */
  sessionId?: string;
};

/**
 * judge 输出的标准结构。
 */
export type JudgeVerdict = {
  score: number;
  reason: string;
  evidence: string[];
  confidence: number;
};

/**
 * Build a deterministic system prompt for one extended metric judge.
 *
 * @param metricId Metric identifier.
 * @param criteria Plain-language evaluation criteria.
 * @returns System prompt string.
 */
function buildSystemPrompt(metricId: string, criteria: string): string {
  return buildVersionedJudgeSystemPrompt("extended_metric_judge", [
    `你是 Zeval 的扩展指标评估专家，正在评估指标 [${metricId}]。`,
    "",
    "评估准则：",
    criteria,
    "",
    "输出要求：必须严格输出一个 JSON 对象，且只输出 JSON：",
    "{",
    '  "score": <0~1 之间的数字，保留 2 位小数>,',
    '  "reason": "<判定原因，1~2 句话>",',
    '  "evidence": ["<具体证据片段 1>", "<具体证据片段 2>"],',
    '  "confidence": <0~1 之间的数字，表示你对此判定的把握>',
    "}",
    "",
    "不要返回 markdown，不要返回解释，只返回 JSON。",
  ]);
}

/**
 * 调用 LLM 做一次评估，并把输出 normalize 成 {score, reason, evidence, confidence}。
 *
 * @param invocation Judge inputs.
 * @returns Normalized verdict.
 */
export async function callJudge(invocation: JudgeInvocation): Promise<JudgeVerdict> {
  const systemPrompt = buildSystemPrompt(invocation.metricId, invocation.criteria);
  const userPrompt = invocation.extraInstruction
    ? `${invocation.payload}\n\n额外说明：${invocation.extraInstruction}`
    : invocation.payload;

  const raw = await requestSiliconFlowChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    {
      stage: `extended-metric:${invocation.metricId}`,
      runId: invocation.runId,
      sessionId: invocation.sessionId,
    },
  );

  const parsed = parseJsonObjectFromLlmOutput(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`judge 返回非 JSON: ${raw.slice(0, 200)}`);
  }

  const score = clampScore(Number((parsed as Record<string, unknown>).score));
  const reason = String((parsed as Record<string, unknown>).reason ?? "").slice(0, 300);
  const confidence = clampScore(Number((parsed as Record<string, unknown>).confidence));
  const rawEvidence = (parsed as Record<string, unknown>).evidence;
  const evidence = Array.isArray(rawEvidence)
    ? rawEvidence.slice(0, 5).map((item) => String(item ?? "").slice(0, 240))
    : [];

  return { score, reason, evidence, confidence };
}

/**
 * Normalize a numeric value into [0, 1].
 *
 * @param value Numeric input.
 * @returns Clamped value or 0 when invalid.
 */
function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}
