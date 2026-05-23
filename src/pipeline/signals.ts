/**
 * @fileoverview Rule-based implicit signal extraction for enriched chatlogs.
 *
 * P1 重构：已移除 emotionRecoveryFailureRisk（依赖 emotionScore / isTopicSwitch）。
 * 当前保留两个纯行为信号：interestDeclineRisk + understandingBarrierRisk。
 */

import type { EnrichedChatlogRow, ImplicitSignal, ImplicitSignalKey } from "@/types/pipeline";

/**
 * Build implicit signals from enriched rows.
 * @param rows Enriched rows.
 * @returns Stable signal layer outputs.
 */
export function buildImplicitSignals(rows: EnrichedChatlogRow[]): ImplicitSignal[] {
  return [
    buildInterestDeclineRisk(rows),
    buildUnderstandingBarrierRisk(rows),
  ];
}

/**
 * Detect whether user engagement is declining based on message length and gap trends.
 */
function buildInterestDeclineRisk(rows: EnrichedChatlogRow[]): ImplicitSignal {
  const userRows = rows.filter((row) => row.role === "user");
  const userLengths = userRows.map((row) => row.content.length);
  const half = Math.max(1, Math.ceil(userLengths.length / 2));
  const earlyAvgLength = average(userLengths.slice(0, half));
  const lateAvgLength = average(userLengths.slice(half));
  const gapValues = userRows.map((row) => row.responseGapSec ?? 0);
  const earlyAvgGap = average(gapValues.slice(0, half));
  const lateAvgGap = average(gapValues.slice(half));
  const earlyQuestionRate = rate(half, userRows.slice(0, half).filter((row) => row.isQuestion).length);
  const lateQuestionRate = rate(userLengths.slice(half).length, userRows.slice(half).filter((row) => row.isQuestion).length);

  const triggeredRules: string[] = [];
  let score = 0.22;
  if (lateAvgLength < earlyAvgLength * 0.78) { triggeredRules.push("连续短回复"); score += 0.26; }
  if (lateAvgGap > Math.max(30, earlyAvgGap * 1.4)) { triggeredRules.push("回复间隔拉长"); score += 0.28; }
  if (lateQuestionRate < earlyQuestionRate && earlyQuestionRate > 0) { triggeredRules.push("提问意愿下降"); score += 0.18; }

  const evidenceRow = userRows[userRows.length - 1] ?? rows[rows.length - 1];
  return createSignal(
    "interestDeclineRisk",
    score,
    triggeredRules,
    triggeredRules.length ? "后半段用户回复更短且互动欲望下降，存在兴趣衰减迹象。" : "当前未检测到明显的兴趣衰减模式。",
    evidenceRow ? `[turn ${evidenceRow.turnIndex}] ${evidenceRow.content}` : "无可用证据",
    evidenceRow ? `${evidenceRow.sessionId}:${Math.max(1, evidenceRow.turnIndex - 2)}-${evidenceRow.turnIndex}` : "unknown",
    triggeredRules.length ? 0.78 : 0.62,
  );
}

/**
 * Detect understanding barriers from repeated or confused user turns.
 */
function buildUnderstandingBarrierRisk(rows: EnrichedChatlogRow[]): ImplicitSignal {
  const userRows = rows.filter((row) => row.role === "user");
  const triggeredRules: string[] = [];
  let score = 0.2;

  const confusionRows = userRows.filter((row) =>
    /(什么意思|不懂|你是说|再说一遍|没明白|怎么理解)/.test(row.content),
  );
  if (confusionRows.length > 0) { triggeredRules.push("困惑表达升高"); score += 0.3; }

  const normalizedQuestions = userRows
    .filter((row) => row.isQuestion)
    .map((row) => row.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 18))
    .filter((v) => v.length > 0);
  const questionCounts = new Map<string, number>();
  normalizedQuestions.forEach((q) => questionCounts.set(q, (questionCounts.get(q) ?? 0) + 1));
  if ([...questionCounts.values()].some((c) => c >= 2)) { triggeredRules.push("重复提问"); score += 0.28; }

  const evidenceRow = confusionRows[0] ?? userRows.find((row) => row.isQuestion) ?? rows[0];
  return createSignal(
    "understandingBarrierRisk",
    score,
    triggeredRules,
    triggeredRules.length ? "用户出现困惑表达或重复提问，说明理解障碍风险正在上升。" : "当前没有显著的理解障碍信号。",
    evidenceRow ? `[turn ${evidenceRow.turnIndex}] ${evidenceRow.content}` : "无可用证据",
    evidenceRow ? `${evidenceRow.sessionId}:${evidenceRow.turnIndex}-${evidenceRow.turnIndex}` : "unknown",
    triggeredRules.length ? 0.81 : 0.6,
  );
}

function createSignal(
  signalKey: ImplicitSignalKey,
  rawScore: number,
  triggeredRules: string[],
  reason: string,
  evidence: string,
  evidenceTurnRange: string,
  confidence: number,
): ImplicitSignal {
  const score = clamp(rawScore);
  return {
    signalKey,
    score,
    severity: score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low",
    triggeredRules,
    reason,
    evidence,
    evidenceTurnRange,
    confidence: clamp(confidence),
  };
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function rate(total: number, part: number): number {
  return total === 0 ? 0 : part / total;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
