/**
 * @fileoverview Build summary cards for the frontend overview panel.
 */

import type { ObjectiveMetrics, SubjectiveMetrics, SummaryCard } from "@/types/pipeline";
import type { StructuredTaskMetrics } from "@/types/rich-conversation";
import type { ScenarioEvaluation } from "@/types/scenario";

/**
 * Build summary cards for the primary insight row.
 * @param objectiveMetrics Objective metrics.
 * @param subjectiveMetrics Subjective metrics.
 * @param sessionCount Session count.
 * @param messageCount Message count.
 * @returns Summary card array.
 */
export function buildSummaryCards(
  objectiveMetrics: ObjectiveMetrics,
  subjectiveMetrics: SubjectiveMetrics,
  sessionCount: number,
  messageCount: number,
  scenarioEvaluation?: ScenarioEvaluation | null,
  badCaseCount = 0,
  structuredTaskMetrics?: StructuredTaskMetrics,
): SummaryCard[] {
  const empathyScore =
    subjectiveMetrics.dimensions.find((item) => item.dimension === "共情程度")?.score ?? 0;
  const highRiskSignals = subjectiveMetrics.signals.filter((item) => item.severity === "high").length;
  const goalCompletionTotal = subjectiveMetrics.goalCompletions.length;
  const achievedGoalCount = subjectiveMetrics.goalCompletions.filter((item) => item.status === "achieved").length;
  const goalCompletionRate = goalCompletionTotal ? Math.round((achievedGoalCount / goalCompletionTotal) * 100) : 0;
  const completedRecoveryCount = subjectiveMetrics.recoveryTraces.filter((item) => item.status === "completed").length;
  const failedRecoveryCount = subjectiveMetrics.recoveryTraces.filter((item) => item.status === "failed").length;

  const cards: SummaryCard[] = [
    {
      key: "sessionCount",
      label: "会话规模",
      value: `${sessionCount}`,
      hint: `${messageCount} 条消息进入本次评估`,
    },
    {
      key: "responseGap",
      label: "平均响应间隔",
      value: `${Math.round(objectiveMetrics.avgResponseGapSec)}s`,
      hint: "越低通常意味着更平顺的交互节奏",
    },
    {
      key: "empathy",
      label: "共情得分",
      value: `${empathyScore}/5`,
      hint: "情绪分与共情分联合反映体验质量",
    },
    {
      key: "goalCompletion",
      label: "目标达成率",
      value: `${goalCompletionRate}%`,
      hint: goalCompletionTotal
        ? `${achievedGoalCount}/${goalCompletionTotal} 个 session 明确达成用户初始目标`
        : "等待 goal completion 评估结果",
    },
  ];

  if (scenarioEvaluation) {
    cards.push({
      key: "businessKpi",
      label: "业务 KPI",
      value: `${Math.round(scenarioEvaluation.averageScore * 100)}%`,
      hint: `${scenarioEvaluation.displayName} 的业务映射均分`,
    });
  }

  if (structuredTaskMetrics?.status === "ready") {
    cards.push({
      key: "structuredEval",
      label: "结构化标注",
      value: `${structuredTaskMetrics.serviceCallCount}`,
      hint: `Service call ${structuredTaskMetrics.serviceCallCount} 次，Slot ${structuredTaskMetrics.slotMentionCount} 个，State ${structuredTaskMetrics.dialogueStateCount} 条`,
    });
    cards.push({
      key: "serviceGrounding",
      label: "调用参数追溯",
      value: `${Math.round(structuredTaskMetrics.serviceCallGroundingRate * 100)}%`,
      hint: "service_call 参数是否能从 dialogue state 中追溯",
    });
    if (structuredTaskMetrics.schemaServiceCount) {
      cards.push({
        key: "schemaCompliance",
        label: "Schema 合法率",
        value: `${Math.round((structuredTaskMetrics.schemaSlotCoverageRate ?? 0) * 100)}%`,
        hint: `${structuredTaskMetrics.schemaServiceCount} 个 service schema，未知 slot ${structuredTaskMetrics.unknownSlotReferenceCount ?? 0} 个`,
      });
    }
  }

  if (badCaseCount > 0) {
    cards.push({
      key: "badCaseCount",
      label: "Bad Case",
      value: `${badCaseCount}`,
      hint: "已识别可沉淀进案例池的失败 session",
    });
  }

  cards.push(
    {
      key: "recoveryTrace",
      label: "恢复轨迹",
      value: `${completedRecoveryCount}`,
      hint:
        completedRecoveryCount || failedRecoveryCount
          ? `完成恢复 ${completedRecoveryCount} 条，未恢复 ${failedRecoveryCount} 条`
          : "当前尚未识别到明显的失败后恢复弧线",
    },
    {
      key: "signals",
      label: "高风险信号",
      value: `${highRiskSignals}`,
      hint: "来自隐式推断信号层的高风险项数量",
    },
  );

  return cards;
}
