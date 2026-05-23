/**
 * @fileoverview Suggestion builder bound to metric outputs.
 *
 * P1 重构：已移除 emotionCurve / emotionScore / isTopicSwitch 依赖。
 * 建议内容从行为信号、目标达成率、回复间隔等客观指标推导。
 */

import type { EnrichedChatlogRow, ObjectiveMetrics, SubjectiveMetrics } from "@/types/pipeline";

/**
 * Build ranked optimization suggestions for the frontend.
 * @param rows Enriched rows.
 * @param objectiveMetrics Objective metrics.
 * @param subjectiveMetrics Subjective metrics.
 * @returns Ranked suggestion list.
 */
export function buildSuggestions(
  rows: EnrichedChatlogRow[],
  objectiveMetrics: ObjectiveMetrics,
  subjectiveMetrics: SubjectiveMetrics,
): string[] {
  const userQuestions = rows.filter((row) => row.isQuestion && row.role === "user").length;
  const empathy = subjectiveMetrics.dimensions.find((item) => item.dimension === "共情程度")?.score ?? 1;
  const offTopicRisk = subjectiveMetrics.dimensions.find((item) => item.dimension === "答非所问/无视风险")?.score ?? 1;
  const interestDeclineRisk = subjectiveMetrics.signals.find((item) => item.signalKey === "interestDeclineRisk")?.severity ?? "low";
  const understandingBarrierRisk = subjectiveMetrics.signals.find((item) => item.signalKey === "understandingBarrierRisk")?.severity ?? "low";
  const goalCompletionTotal = subjectiveMetrics.goalCompletions.length;
  const achievedGoalCount = subjectiveMetrics.goalCompletions.filter((item) => item.status === "achieved").length;
  const failedGoalCount = subjectiveMetrics.goalCompletions.filter((item) => item.status === "failed").length;
  const goalCompletionRate = goalCompletionTotal ? Math.round((achievedGoalCount / goalCompletionTotal) * 100) : 0;
  const completedRecoveryCount = subjectiveMetrics.recoveryTraces.filter((item) => item.status === "completed").length;
  const failedRecoveryCount = subjectiveMetrics.recoveryTraces.filter((item) => item.status === "failed").length;
  const avgGap = Math.round(objectiveMetrics.avgResponseGapSec);

  return [
    `P0：当前目标达成率为 ${goalCompletionRate}%，共有 ${failedGoalCount} 个 session 明确未达成，建议优先把这些 bad case 编译为调优包并加入回放回归。`,
    `P0：平均响应间隔为 ${avgGap} 秒，建议首轮确认性回复压缩到 20 秒内，并监控长间隔后的追问率变化。`,
    `P0：兴趣衰减风险为 ${interestDeclineRisk}、理解障碍风险为 ${understandingBarrierRisk}，建议把信号层直接接入策略触发器。`,
    `P1：当前共情维度得分 ${empathy}/5，建议继续沉淀 session 级证据片段，提升主观评估的可解释性。`,
    `P1：答非所问维度得分 ${offTopicRisk}/5（分越高越好），建议执行"先回答、再扩展"的固定顺序，减少用户重复提问（当前 ${userQuestions} 次）。`,
    `P1：当前识别到 ${completedRecoveryCount} 条成功恢复轨迹、${failedRecoveryCount} 条失败恢复轨迹，建议沉淀成功修复话术并对失败片段生成 remediation spec。`,
    `P2：当前流失断点主要集中在第 ${getMostCommonDropoffTurn(objectiveMetrics)} 轮，建议在该轮次前后增加主动确认问句。`,
    `P2：当前共有 ${userQuestions} 次用户提问，建议统计重复提问 fingerprint 并纳入 eval case 候选。`,
  ];
}

/**
 * Get the most common dropoff turn index.
 */
function getMostCommonDropoffTurn(metrics: ObjectiveMetrics): string {
  const entries = Object.entries(metrics.dropoffTurnDistribution);
  if (entries.length === 0) return "未知";
  return entries.reduce((maxEntry, curr) => (curr[1] > maxEntry[1] ? curr : maxEntry))[0];
}
