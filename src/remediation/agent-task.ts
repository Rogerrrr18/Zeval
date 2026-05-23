/**
 * @fileoverview Compile one remediation package into a coding-agent task payload.
 */

import type { RemediationAgentTask, RemediationPackageSnapshot } from "@/remediation/types";

/**
 * Emit one coding-agent task payload from a remediation package.
 *
 * @param snapshot Saved remediation package snapshot.
 * @returns Structured task payload plus a copyable prompt.
 */
export function emitRemediationAgentTask(snapshot: RemediationPackageSnapshot): RemediationAgentTask {
  const checklist = [
    `阅读 ${snapshot.files.map((file) => file.fileName).join(" / ")}，先理解问题、约束与验收门槛。`,
    `仅在 ${snapshot.editScope.join(", ")} 层做最小必要修改，不做无关重构。`,
    "明确说明修改 why、预期行为变化以及未覆盖的风险。",
    "完成后先跑 replay validation，再跑 offline validation；任何关键 guard 退化都不算通过。",
  ];
  const validationPlan = [
    `Replay gate: baselineRunId=${snapshot.acceptanceGate.replay.baselineRunId}, minWinRate=${snapshot.acceptanceGate.replay.minWinRate}`,
    `Offline gate: sampleBatchId=${snapshot.acceptanceGate.offlineEval.sampleBatchId ?? "待指定"}, maxRegressions=${snapshot.acceptanceGate.offlineEval.maxRegressions}`,
  ];

  return {
    schemaVersion: 1,
    taskId: `task_${snapshot.packageId}`,
    packageId: snapshot.packageId,
    title: `[${snapshot.priority}] ${snapshot.title}`,
    branchName: `remediation/${snapshot.packageId}`,
    checklist,
    validationPlan,
    artifactPaths: snapshot.files.map((file) => file.relativePath),
    prompt: buildAgentPrompt(snapshot, checklist, validationPlan),
  };
}

/**
 * Build one copyable Markdown prompt for Claude Code / Codex.
 *
 * @param snapshot Saved remediation package snapshot.
 * @param checklist Execution checklist.
 * @param validationPlan Validation plan lines.
 * @returns Markdown prompt string.
 */
function buildAgentPrompt(
  snapshot: RemediationPackageSnapshot,
  checklist: string[],
  validationPlan: string[],
): string {
  const problemSummary = snapshot.problemSummary.map((item) => `- ${item}`).join("\n");
  const constraintBlock = snapshot.constraints.map((item) => `- ${item}`).join("\n");
  const metricBlock =
    snapshot.targetMetrics.length > 0
      ? snapshot.targetMetrics
          .map(
            (metric) =>
              `- ${metric.displayName}: ${metric.currentValue.toFixed(4)} -> ${metric.targetValue.toFixed(4)} (${metric.direction === "increase" ? "提高" : "降低"})`,
          )
          .join("\n")
      : "- 当前没有额外 target metric，请以 replay / offline gate 为主。";
  const artifactBlock = snapshot.files.map((file) => `- ${file.relativePath}`).join("\n");
  const checklistBlock = checklist.map((item) => `- ${item}`).join("\n");
  const validationBlock = validationPlan.map((item) => `- ${item}`).join("\n");

  return [
    `# ${snapshot.packageId} Agent Task`,
    "",
    "你正在处理一个来自 Zeval 的 remediation package。",
    "",
    "## 目标",
    problemSummary,
    "",
    "## 优先修改层",
    `- ${snapshot.editScope.join(", ")}`,
    "",
    "## 约束条件",
    constraintBlock,
    "",
    "## 目标指标",
    metricBlock,
    "",
    "## Artifact Paths",
    artifactBlock,
    "",
    "## 执行要求",
    checklistBlock,
    "",
    "## 验证要求",
    validationBlock,
    "",
    "## 输出要求",
    "- 给出最小改动方案并直接落代码。",
    "- 说明改动命中了哪些 bad case / target metrics。",
    "- 如果无法满足 gate，明确指出阻塞点与下一步建议。",
  ].join("\n");
}
