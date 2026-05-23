/**
 * @fileoverview Build agent-readable remediation packages from evaluated bad cases.
 */

import { randomBytes } from "node:crypto";
import type { ObjectiveMetrics } from "@/types/pipeline";
import type { ScenarioEvaluation } from "@/types/scenario";
import type {
  RemediationAcceptanceGate,
  RemediationPackageBuildResult,
  RemediationEditScope,
  RemediationPackageFile,
  RemediationPackageSnapshot,
  RemediationPriority,
  RemediationSkillBundle,
  RemediationTargetMetric,
} from "@/remediation/types";
import { renderYamlDocument } from "@/remediation/yaml";

const MAX_CASES_PER_PACKAGE = 5;

type RemediationEvaluateInput = {
  runId: string;
  objectiveMetrics: Pick<
    ObjectiveMetrics,
    "avgResponseGapSec" | "userQuestionRepeatRate" | "agentResolutionSignalRate" | "escalationKeywordHitRate"
  >;
  subjectiveMetrics: {
    dimensions: Array<{
      dimension: string;
      score: number;
      reason: string;
      evidence: string;
      confidence: number;
    }>;
    signals: Array<{
      signalKey: string;
      score: number;
      severity: string;
      evidence: string;
      evidenceTurnRange: string;
      confidence: number;
      reason: string;
      triggeredRules: string[];
    }>;
    goalCompletions: Array<{
      sessionId: string;
      status: "achieved" | "partial" | "failed" | "unclear";
      score: number;
      userIntent: string;
      achievementEvidence: string[];
      failureReasons: string[];
      triggeredRules: string[];
      confidence: number;
    }>;
    recoveryTraces: Array<{
      sessionId: string;
      status: "none" | "completed" | "failed";
      failureTurn: number | null;
      recoveryTurn: number | null;
      spanTurns: number | null;
      failureType: string;
      repairStrategy: string | null;
      qualityScore: number;
      confidence: number;
      triggeredRules: string[];
      evidence: Array<{
        turnIndex: number;
        role: "user" | "assistant" | "system";
        content: string;
      }>;
    }>;
  };
  scenarioEvaluation: ScenarioEvaluation | null;
  badCaseAssets: Array<{
    caseKey: string;
    sessionId: string;
    title: string;
    severityScore: number;
    normalizedTranscriptHash: string;
    duplicateGroupKey: string;
    tags: string[];
    transcript: string;
    evidence: Array<{
      turnIndex: number;
      role: "user" | "assistant" | "system";
      content: string;
    }>;
    suggestedAction: string;
    sourceRunId: string;
  }>;
  suggestions: string[];
};

type RemediationBadCase = RemediationEvaluateInput["badCaseAssets"][number];

/**
 * Build one remediation package from a completed evaluation run.
 *
 * @param input Package build input.
 * @returns Fully rendered remediation package snapshot.
 */
export function buildRemediationPackage(input: {
  evaluate: RemediationEvaluateInput;
  sourceFileName?: string;
  baselineCustomerId?: string;
  selectedCaseKeys?: string[];
}): RemediationPackageBuildResult {
  const createdAt = new Date().toISOString();
  const selectedCases = selectBadCases(input.evaluate.badCaseAssets, input.selectedCaseKeys);
  if (selectedCases.length === 0) {
    return {
      skipped: true,
      reason: "no_bad_cases",
      message: "当前评估未发现 bad case，场景健康，无需生成调优包。",
      package: null,
    };
  }

  const packageId = allocatePackageId(createdAt);
  const dominantTags = collectDominantTags(selectedCases);
  const priority = resolvePriority(selectedCases);
  const editScope = resolveEditScope(selectedCases);
  const problemSummary = buildProblemSummary(selectedCases, input.evaluate);
  const constraints = buildConstraints(selectedCases);
  const targetMetrics = buildTargetMetrics(input.evaluate, selectedCases);
  const acceptanceGate = buildAcceptanceGate(input.evaluate, selectedCases, targetMetrics, input.baselineCustomerId);
  const title = buildPackageTitle(selectedCases, input.evaluate);
  const skillFolderName = `remediation-skill-${packageId}`;
  const artifactDir = `artifacts/remediation-packages/${skillFolderName}`;
  const issueBrief = buildIssueBrief({
    packageId,
    createdAt,
    evaluate: input.evaluate,
    selectedCases,
    priority,
    editScope,
    problemSummary,
    constraints,
    targetMetrics,
    acceptanceGate,
  });
  const remediationSpec = buildRemediationSpecYaml({
    packageId,
    createdAt,
    evaluate: input.evaluate,
    selectedCases,
    priority,
    editScope,
    problemSummary,
    constraints,
    targetMetrics,
  });
  const badcasesJsonl = buildBadcasesJsonl(selectedCases);
  const acceptanceGateYaml = renderYamlDocument(acceptanceGate);

  const files: RemediationPackageFile[] = [
    {
      fileName: "issue-brief.md",
      relativePath: `${artifactDir}/reference/issue-brief.md`,
      content: issueBrief,
    },
    {
      fileName: "remediation-spec.yaml",
      relativePath: `${artifactDir}/reference/remediation-spec.yaml`,
      content: remediationSpec,
    },
    {
      fileName: "badcases.jsonl",
      relativePath: `${artifactDir}/reference/badcases.jsonl`,
      content: badcasesJsonl,
    },
    {
      fileName: "acceptance-gate.yaml",
      relativePath: `${artifactDir}/reference/acceptance-gate.yaml`,
      content: acceptanceGateYaml,
    },
  ];
  const skillBundle = buildSkillBundle({
    packageId,
    title,
    createdAt,
    artifactDir,
    skillFolderName,
    evaluate: input.evaluate,
    selectedCases,
    priority,
    editScope,
    problemSummary,
    constraints,
    targetMetrics,
    acceptanceGate,
    referenceFiles: files,
  });

  const snapshot: RemediationPackageSnapshot = {
    schemaVersion: 1,
    packageId,
    createdAt,
    runId: input.evaluate.runId,
    title,
    priority,
    scenarioId: input.evaluate.scenarioEvaluation?.scenarioId,
    sourceFileName: input.sourceFileName,
    selectedCaseKeys: selectedCases.map((item) => item.caseKey),
    selectedCaseCount: selectedCases.length,
    dominantTags,
    problemSummary,
    editScope,
    constraints,
    targetMetrics,
    acceptanceGate,
    artifactDir,
    files,
    skillFolder: skillBundle.rootPath,
    skillBundle,
  };

  return {
    skipped: false,
    package: snapshot,
  };
}

/**
 * Select which bad cases should be bundled into the package.
 *
 * @param badCases All extracted bad cases.
 * @param selectedCaseKeys Optional user-selected case keys.
 * @returns Prioritized bad case subset.
 */
function selectBadCases(badCases: RemediationBadCase[], selectedCaseKeys?: string[]): RemediationBadCase[] {
  if (selectedCaseKeys && selectedCaseKeys.length > 0) {
    const selected = badCases.filter((item) => selectedCaseKeys.includes(item.caseKey));
    return selected.slice(0, MAX_CASES_PER_PACKAGE);
  }

  return [...badCases]
    .sort((left, right) => right.severityScore - left.severityScore)
    .slice(0, MAX_CASES_PER_PACKAGE);
}

/**
 * Allocate one stable-looking remediation package identifier.
 *
 * @param createdAt ISO timestamp.
 * @returns Package identifier.
 */
function allocatePackageId(createdAt: string): string {
  const stamp = createdAt.slice(0, 10).replace(/-/g, "");
  return `rem_${stamp}_${randomBytes(3).toString("hex")}`;
}

/**
 * Collect dominant tags from the selected bad cases.
 *
 * @param badCases Selected bad cases.
 * @returns Top tag list.
 */
function collectDominantTags(badCases: RemediationBadCase[]): string[] {
  const counts = new Map<string, number>();
  badCases.forEach((item) => {
    item.tags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([tag]) => tag);
}

/**
 * Resolve remediation priority from the selected bad cases.
 *
 * @param badCases Selected bad cases.
 * @returns Priority level.
 */
function resolvePriority(badCases: RemediationBadCase[]): RemediationPriority {
  const maxSeverity = Math.max(...badCases.map((item) => item.severityScore));
  const hasHardFailure = badCases.some((item) =>
    item.tags.some((tag) => tag === "goal_failed" || tag === "recovery_failed" || tag === "escalation_keyword"),
  );

  if (hasHardFailure || maxSeverity >= 0.72) {
    return "P0";
  }
  if (maxSeverity >= 0.48) {
    return "P1";
  }
  return "P2";
}

/**
 * Resolve which layers should be edited first.
 *
 * @param badCases Selected bad cases.
 * @returns Prioritized edit scope.
 */
function resolveEditScope(badCases: RemediationBadCase[]): RemediationEditScope[] {
  const scope = new Set<RemediationEditScope>();

  badCases.forEach((item) => {
    item.tags.forEach((tag) => {
      if (tag === "goal_failed" || tag === "goal_partial" || tag === "goal_unclear" || tag === "off_topic_shift") {
        scope.add("prompt");
      }
      if (tag === "recovery_failed" || tag === "question_repeat" || tag === "understanding_barrier") {
        scope.add("orchestration");
      }
      if (tag === "escalation_keyword") {
        scope.add("policy");
      }
      if (tag === "long_response_gap") {
        scope.add("code");
      }
    });
  });

  if (scope.size === 0) {
    scope.add("prompt");
    scope.add("orchestration");
  }

  return ["prompt", "policy", "orchestration", "code"].filter((item): item is RemediationEditScope =>
    scope.has(item as RemediationEditScope),
  );
}

/**
 * Build one problem-summary list readable by PMs and coding agents.
 *
 * @param badCases Selected bad cases.
 * @param evaluate Full evaluation result.
 * @returns Summary bullets.
 */
function buildProblemSummary(badCases: RemediationBadCase[], evaluate: RemediationEvaluateInput): string[] {
  const summaries = new Set<string>();
  const dominantTags = collectDominantTags(badCases);

  dominantTags.forEach((tag) => {
    summaries.add(mapTagToSummary(tag));
  });

  const atRiskKpis = evaluate.scenarioEvaluation?.kpis
    .filter((item) => item.status === "at_risk")
    .map((item) => `${item.displayName} 已跌到 at_risk（${Math.round(item.score * 100)}%）。`) ?? [];
  atRiskKpis.forEach((item) => summaries.add(item));

  return [...summaries];
}

/**
 * Build constraint list for agent execution.
 *
 * @param badCases Selected bad cases.
 * @returns Constraint descriptions.
 */
function buildConstraints(badCases: RemediationBadCase[]): string[] {
  const constraints = new Set<string>([
    "不要降低现有安全拒答质量。",
    "不要让平均响应时延恶化超过 20%。",
    "不要破坏当前已支持的业务场景与回放链路。",
  ]);

  if (badCases.some((item) => item.tags.includes("escalation_keyword"))) {
    constraints.add("投诉与转人工路径要保留可追踪的 SLA 与兜底话术。");
  }
  if (badCases.some((item) => item.tags.includes("goal_failed") || item.tags.includes("goal_partial"))) {
    constraints.add("优先保证用户主任务闭环，不要用冗长解释替代动作完成。");
  }

  return [...constraints];
}

/**
 * Build target metrics for the coding agent.
 *
 * @param evaluate Full evaluation result.
 * @param badCases Selected bad cases.
 * @returns Target metric list.
 */
function buildTargetMetrics(
  evaluate: RemediationEvaluateInput,
  badCases: RemediationBadCase[],
): RemediationTargetMetric[] {
  const metrics: RemediationTargetMetric[] = [];
  const empathy = getDimensionScore(evaluate, "共情程度");
  const offTopic = getDimensionScore(evaluate, "答非所问/无视风险");
  const recovery = getDimensionScore(evaluate, "情绪恢复能力");
  const goalCompletionRate = getGoalCompletionRate(evaluate);
  const recoveryCompletionRate = getRecoveryCompletionRate(evaluate);

  if (badCases.some((item) => item.tags.includes("goal_failed") || item.tags.includes("goal_partial"))) {
    metrics.push({
      metricId: "goal_completion_rate",
      displayName: "目标达成率",
      currentValue: goalCompletionRate,
      targetValue: clamp01(Math.max(goalCompletionRate + 0.15, 0.7)),
      direction: "increase",
      reason: "失败案例显示用户主任务没有闭环，必须先把任务完成态拉回安全线。",
    });
  }

  if (badCases.some((item) => item.tags.includes("recovery_failed"))) {
    metrics.push({
      metricId: "recovery_completion_rate",
      displayName: "恢复成功率",
      currentValue: recoveryCompletionRate,
      targetValue: clamp01(Math.max(recoveryCompletionRate + 0.2, 0.6)),
      direction: "increase",
      reason: "已出现失败后未能拉回的 session，需要补完整的修复序列。",
    });
    metrics.push({
      metricId: "emotion_recovery_score",
      displayName: "情绪恢复能力",
      currentValue: recovery,
      targetValue: clampScore(Math.max(recovery + 1, 4)),
      direction: "increase",
      reason: "主观维度显示情绪恢复不足，需要增强安抚、澄清与动作承诺。",
    });
  }

  if (badCases.some((item) => item.tags.includes("question_repeat") || item.tags.includes("understanding_barrier"))) {
    metrics.push({
      metricId: "user_question_repeat_rate",
      displayName: "重复提问率",
      currentValue: evaluate.objectiveMetrics.userQuestionRepeatRate,
      targetValue: clamp01(Math.max(evaluate.objectiveMetrics.userQuestionRepeatRate - 0.08, 0.05)),
      direction: "decrease",
      reason: "用户在追问同一个问题，说明回答结构仍然不够直接。",
    });
    metrics.push({
      metricId: "empathy_score",
      displayName: "共情得分",
      currentValue: empathy,
      targetValue: clampScore(Math.max(empathy + 1, 4)),
      direction: "increase",
      reason: "理解障碍与重复追问通常伴随共情不足和回答方式僵硬。",
    });
  }

  if (badCases.some((item) => item.tags.includes("off_topic_shift"))) {
    metrics.push({
      metricId: "off_topic_score",
      displayName: "答非所问风险维度",
      currentValue: offTopic,
      targetValue: clampScore(Math.max(offTopic + 1, 4)),
      direction: "increase",
      reason: "多条 bad case 表明 agent 在关键问题后跑偏，需要压缩无关展开。",
    });
  }

  if (badCases.some((item) => item.tags.includes("escalation_keyword"))) {
    metrics.push({
      metricId: "escalation_keyword_hit_rate",
      displayName: "升级触发率",
      currentValue: evaluate.objectiveMetrics.escalationKeywordHitRate,
      targetValue: clamp01(Math.max(evaluate.objectiveMetrics.escalationKeywordHitRate - 0.1, 0)),
      direction: "decrease",
      reason: "用户已进入投诉/转人工语境，需先降低升级触发。",
    });
  }

  if (badCases.some((item) => item.tags.includes("long_response_gap"))) {
    metrics.push({
      metricId: "avg_response_gap_sec",
      displayName: "平均响应间隔",
      currentValue: evaluate.objectiveMetrics.avgResponseGapSec,
      targetValue: Math.max(Math.round(evaluate.objectiveMetrics.avgResponseGapSec - 10), 10),
      direction: "decrease",
      reason: "长等待本身正在放大失败体验，需要把执行时延和显式反馈控制住。",
    });
  }

  if (evaluate.scenarioEvaluation && evaluate.scenarioEvaluation.averageScore < 0.75) {
    metrics.push({
      metricId: "scenario_average_score",
      displayName: `${evaluate.scenarioEvaluation.displayName} KPI 均分`,
      currentValue: evaluate.scenarioEvaluation.averageScore,
      targetValue: clamp01(Math.max(evaluate.scenarioEvaluation.averageScore + 0.1, 0.75)),
      direction: "increase",
      reason: "业务 KPI 已经进入低位，需要同时关注业务侧结果而不是只看通用对话分。",
    });
  }

  return dedupeTargetMetrics(metrics);
}

/**
 * Build replay and regression acceptance gates.
 *
 * @param evaluate Full evaluation result.
 * @param badCases Selected bad cases.
 * @param targetMetrics Target metrics.
 * @returns Acceptance gate object.
 */
function buildAcceptanceGate(
  evaluate: RemediationEvaluateInput,
  badCases: RemediationBadCase[],
  targetMetrics: RemediationTargetMetric[],
  baselineCustomerId?: string,
): RemediationAcceptanceGate {
  const guards: Record<string, boolean | number | string> = {
    dangerous_reply_count: 0,
    max_regressions: 0,
  };

  targetMetrics.forEach((metric) => {
    if (metric.direction === "increase") {
      guards[`${metric.metricId}_min`] = roundMetric(metric.targetValue);
    } else {
      guards[`${metric.metricId}_max`] = roundMetric(metric.targetValue);
    }
  });

  if (badCases.some((item) => item.tags.includes("long_response_gap"))) {
    guards.avg_latency_regression_max_ratio = 1.2;
  }
  if (badCases.some((item) => item.tags.includes("escalation_keyword"))) {
    guards.escalation_keyword_hit_rate_max = roundMetric(
      clamp01(Math.max(evaluate.objectiveMetrics.escalationKeywordHitRate - 0.1, 0)),
    );
  }

  return {
    replay: {
      required: true,
      baselineRunId: evaluate.runId,
      baselineCustomerId: baselineCustomerId?.trim() || null,
      minWinRate: 0.65,
    },
    offlineEval: {
      required: true,
      sampleBatchId: null,
      maxRegressions: 0,
    },
    sandbox: {
      required: false,
      scenarios: [],
    },
    guards,
  };
}

/**
 * Build the package title shown in viewers and lists.
 *
 * @param badCases Selected bad cases.
 * @param evaluate Full evaluation result.
 * @returns Human-readable title.
 */
function buildPackageTitle(badCases: RemediationBadCase[], evaluate: RemediationEvaluateInput): string {
  const scenario = evaluate.scenarioEvaluation?.displayName ?? "通用对话";
  const dominantTag = collectDominantTags(badCases)[0] ?? "generic_failure";
  return `${scenario} · ${mapTagToLabel(dominantTag)} 调优包`;
}

/**
 * Build the markdown issue brief artifact.
 *
 * @param input Rendering input.
 * @returns Markdown content.
 */
function buildIssueBrief(input: {
  packageId: string;
  createdAt: string;
  evaluate: RemediationEvaluateInput;
  selectedCases: RemediationBadCase[];
  priority: RemediationPriority;
  editScope: RemediationEditScope[];
  problemSummary: string[];
  constraints: string[];
  targetMetrics: RemediationTargetMetric[];
  acceptanceGate: RemediationAcceptanceGate;
}): string {
  const scenarioLabel = input.evaluate.scenarioEvaluation?.displayName ?? "通用评估";
  const evidenceBlock = input.selectedCases
    .map((item) => {
      const evidence = item.evidence
        .slice(0, 2)
        .map((row) => `- [turn ${row.turnIndex}] [${row.role}] ${row.content}`)
        .join("\n");
      return `### ${item.title}\n- tags: ${item.tags.join(", ")}\n- severity: ${item.severityScore.toFixed(2)}\n- suggested_action: ${item.suggestedAction}\n${evidence}`;
    })
    .join("\n\n");

  const targetMetricBlock = input.targetMetrics
    .map(
      (item) =>
        `- ${item.displayName}: ${roundMetric(item.currentValue)} -> ${roundMetric(item.targetValue)} (${item.direction === "increase" ? "提高" : "降低"})。${item.reason}`,
    )
    .join("\n");

  const constraintBlock = input.constraints.map((item) => `- ${item}`).join("\n");
  const summaryBlock = input.problemSummary.map((item) => `- ${item}`).join("\n");

  return [
    `# ${input.packageId}`,
    "",
    "## 概览",
    `- 生成时间：${input.createdAt}`,
    `- 来源 Run：${input.evaluate.runId}`,
    `- 场景：${scenarioLabel}`,
    `- 优先级：${input.priority}`,
    `- 选中 bad case：${input.selectedCases.length}`,
    `- 建议优先修改层：${input.editScope.join(", ")}`,
    "",
    "## 问题摘要",
    summaryBlock,
    "",
    "## 目标指标",
    targetMetricBlock || "- 当前未生成额外 target metrics，请先以 replay gate 为主。",
    "",
    "## 关键证据",
    evidenceBlock,
    "",
    "## 约束条件",
    constraintBlock,
    "",
    "## Agent Handoff",
    "- 将本目录下的 `remediation-spec.yaml`、`badcases.jsonl`、`acceptance-gate.yaml` 一起交给 Claude Code / Codex。",
    "- 优先从 edit_scope 指定的层开始改，不要无关重构。",
    "- 完成后必须先跑 replay，再跑固定 sample batch；任何 guard 退化都不算通过。",
    "",
    "## 验收摘要",
    `- replay.min_win_rate = ${input.acceptanceGate.replay.minWinRate}`,
    `- offline_eval.max_regressions = ${input.acceptanceGate.offlineEval.maxRegressions}`,
  ].join("\n");
}

/**
 * Build a Claude Code / Codex compatible skill bundle.
 *
 * @param input Bundle rendering input.
 * @returns Skill bundle descriptor.
 */
function buildSkillBundle(input: {
  packageId: string;
  title: string;
  createdAt: string;
  artifactDir: string;
  skillFolderName: string;
  evaluate: RemediationEvaluateInput;
  selectedCases: RemediationBadCase[];
  priority: RemediationPriority;
  editScope: RemediationEditScope[];
  problemSummary: string[];
  constraints: string[];
  targetMetrics: RemediationTargetMetric[];
  acceptanceGate: RemediationAcceptanceGate;
  referenceFiles: RemediationPackageFile[];
}): RemediationSkillBundle {
  const skillFile = {
    fileName: "SKILL.md",
    relativePath: `${input.artifactDir}/SKILL.md`,
    role: "overview" as const,
    content: buildSkillMarkdown(input),
  };
  const readmeFile = {
    fileName: "README.md",
    relativePath: `${input.artifactDir}/README.md`,
    role: "readme" as const,
    content: buildSkillReadme(input),
  };
  const referenceFiles = input.referenceFiles.map((file) => ({
    fileName: file.fileName,
    relativePath: file.relativePath,
    content: file.content,
    role: "reference" as const,
  }));
  return {
    folderName: input.skillFolderName,
    rootPath: input.artifactDir,
    skillFile,
    readmeFile,
    referenceFiles,
    files: [skillFile, ...referenceFiles, readmeFile],
  };
}

/**
 * Render the human-facing SKILL.md entrypoint.
 *
 * @param input Bundle rendering input.
 * @returns Markdown content.
 */
function buildSkillMarkdown(input: {
  packageId: string;
  title: string;
  createdAt: string;
  evaluate: RemediationEvaluateInput;
  selectedCases: RemediationBadCase[];
  priority: RemediationPriority;
  editScope: RemediationEditScope[];
  problemSummary: string[];
  constraints: string[];
  targetMetrics: RemediationTargetMetric[];
  acceptanceGate: RemediationAcceptanceGate;
}): string {
  const topCases = input.selectedCases.slice(0, 3);
  const targetMetricBlock = input.targetMetrics.length
    ? input.targetMetrics
        .map(
          (item) =>
            `- ${item.displayName}: ${roundMetric(item.currentValue)} -> ${roundMetric(item.targetValue)} (${item.direction === "increase" ? "提高" : "降低"})`,
        )
        .join("\n")
    : "- 以 replay win rate 与 offline regression gate 为主。";
  return [
    `# ${input.title}`,
    "",
    "## 什么时候使用",
    `当 Zeval run \`${input.evaluate.runId}\` 暴露出以下问题时使用本 skill：`,
    ...input.problemSummary.slice(0, 5).map((item) => `- ${item}`),
    "",
    "## 修复策略",
    `- 优先级：${input.priority}`,
    `- 优先修改层：${input.editScope.join(", ") || "prompt"}`,
    "- 先修复覆盖面最大的失败标签，再处理单点异常。",
    "- 不做无关重构；所有改动都要能被 reference/acceptance-gate.yaml 验证。",
    "",
    "## 关键 bad case",
    ...topCases.map(
      (item) =>
        `- ${item.title}：severity=${item.severityScore.toFixed(2)}，tags=${item.tags.join(", ")}，建议=${item.suggestedAction}`,
    ),
    "",
    "## 目标指标",
    targetMetricBlock,
    "",
    "## 验收标准",
    `- Replay win rate >= ${input.acceptanceGate.replay.minWinRate}`,
    `- Offline eval max regressions <= ${input.acceptanceGate.offlineEval.maxRegressions}`,
    "- `reference/badcases.jsonl` 中的关键样例不再触发同类失败。",
    "- 如果修改 prompt/policy/orchestration/code，必须在提交说明里写清楚影响范围。",
    "",
    "## Reference",
    "- `reference/issue-brief.md`：完整问题说明与证据。",
    "- `reference/badcases.jsonl`：机器可读 bad case。",
    "- `reference/remediation-spec.yaml`：修复范围、约束与目标指标。",
    "- `reference/acceptance-gate.yaml`：验收门禁。",
  ].join("\n");
}

/**
 * Render README.md for agents consuming the skill folder.
 *
 * @param input Bundle rendering input.
 * @returns Markdown content.
 */
function buildSkillReadme(input: {
  packageId: string;
  createdAt: string;
  artifactDir: string;
  skillFolderName: string;
  evaluate: RemediationEvaluateInput;
}): string {
  return [
    `# ${input.skillFolderName}`,
    "",
    "这是 Zeval 自动生成的 remediation skill 文件夹，面向 Claude Code / Codex 使用。",
    "",
    "## 使用方式",
    "1. 先读 `SKILL.md`，理解问题、修复策略与验收标准。",
    "2. 再读 `reference/issue-brief.md` 和 `reference/badcases.jsonl`，确认证据。",
    "3. 按 `reference/remediation-spec.yaml` 限定的 edit_scope 修改系统。",
    "4. 用 `reference/acceptance-gate.yaml` 验证 replay / offline eval 门禁。",
    "",
    "## 元数据",
    `- package_id: ${input.packageId}`,
    `- source_run_id: ${input.evaluate.runId}`,
    `- generated_at: ${input.createdAt}`,
    `- artifact_dir: ${input.artifactDir}`,
  ].join("\n");
}

/**
 * Build the remediation-spec YAML artifact.
 *
 * @param input Rendering input.
 * @returns YAML content.
 */
function buildRemediationSpecYaml(input: {
  packageId: string;
  createdAt: string;
  evaluate: RemediationEvaluateInput;
  selectedCases: RemediationBadCase[];
  priority: RemediationPriority;
  editScope: RemediationEditScope[];
  problemSummary: string[];
  constraints: string[];
  targetMetrics: RemediationTargetMetric[];
}): string {
  return renderYamlDocument({
    package_id: input.packageId,
    created_at: input.createdAt,
    source_run_id: input.evaluate.runId,
    scenario_id: input.evaluate.scenarioEvaluation?.scenarioId ?? null,
    priority: input.priority,
    goal: input.problemSummary[0] ?? "stabilize_dialog_quality",
    problem_summary: input.problemSummary,
    selected_case_keys: input.selectedCases.map((item) => item.caseKey),
    edit_scope: input.editScope,
    constraints: input.constraints,
    target_metrics: input.targetMetrics.map((item) => ({
      metric_id: item.metricId,
      display_name: item.displayName,
      current_value: roundMetric(item.currentValue),
      target_value: roundMetric(item.targetValue),
      direction: item.direction,
      reason: item.reason,
    })),
    execution_notes: [
      "优先处理 P0/P1 失败标签最多的 case。",
      "如需改 prompt，请同步说明 why 与 expected behavior。",
      "如需改代码或 orchestration，保持回放输入兼容。",
    ],
  });
}

/**
 * Build the JSONL bad case artifact.
 *
 * @param badCases Selected bad cases.
 * @returns JSONL content.
 */
function buildBadcasesJsonl(badCases: RemediationBadCase[]): string {
  return `${badCases
    .map((item) =>
      JSON.stringify({
        case_id: item.caseKey,
        session_id: item.sessionId,
        severity_score: roundMetric(item.severityScore),
        turn_range: getTurnRange(item),
        current_output: getCurrentOutput(item),
        problem_tags: item.tags,
        expected_behavior: buildExpectedBehavior(item.tags),
        evidence: item.evidence,
        transcript: item.transcript,
        suggested_action: item.suggestedAction,
        source_run_id: item.sourceRunId,
      }),
    )
    .join("\n")}\n`;
}

/**
 * Get one friendly summary sentence for a failure tag.
 *
 * @param tag Failure tag.
 * @returns Summary sentence.
 */
function mapTagToSummary(tag: string): string {
  if (tag === "goal_failed") {
    return "用户主任务没有完成，session 结束在失败态。";
  }
  if (tag === "goal_partial") {
    return "用户目标只部分达成，仍需额外追问或人工补救。";
  }
  if (tag === "goal_unclear") {
    return "用户目标表达与 agent 响应没有形成稳定闭环。";
  }
  if (tag === "recovery_failed") {
    return "失败出现后没有被有效修复，体验在低谷停留过久。";
  }
  if (tag === "question_repeat") {
    return "用户重复追问同一件事，说明回答没有直接命中核心问题。";
  }
  if (tag === "understanding_barrier") {
    return "对话出现理解障碍，agent 的表达方式对用户不够友好。";
  }
  if (tag === "escalation_keyword") {
    return "会话已经进入投诉 / 转人工风险区，需要优先压降升级触发。";
  }
  if (tag === "emotion_drop") {
    return "用户情绪显著下探，当前回复无法稳住体验。";
  }
  if (tag === "off_topic_shift") {
    return "关键轮次后出现跑题，agent 在应答结构上需要收敛。";
  }
  if (tag === "long_response_gap") {
    return "长等待或无反馈正在放大失败感知。";
  }
  return "存在需要修复的失败模式。";
}

/**
 * Map one failure tag to a shorter label.
 *
 * @param tag Failure tag.
 * @returns Short label.
 */
function mapTagToLabel(tag: string): string {
  if (tag === "goal_failed") {
    return "目标未达成";
  }
  if (tag === "recovery_failed") {
    return "恢复失败";
  }
  if (tag === "question_repeat") {
    return "重复追问";
  }
  if (tag === "escalation_keyword") {
    return "升级风险";
  }
  if (tag === "off_topic_shift") {
    return "跑题";
  }
  return tag;
}

/**
 * Get one subjective-dimension score by name.
 *
 * @param evaluate Full evaluation result.
 * @param dimensionName Dimension label.
 * @returns Score or neutral fallback.
 */
function getDimensionScore(evaluate: RemediationEvaluateInput, dimensionName: string): number {
  return evaluate.subjectiveMetrics.dimensions.find((item) => item.dimension === dimensionName)?.score ?? 3;
}

/**
 * Compute goal completion rate from session-level results.
 *
 * @param evaluate Full evaluation result.
 * @returns Normalized completion rate.
 */
function getGoalCompletionRate(evaluate: RemediationEvaluateInput): number {
  const rows = evaluate.subjectiveMetrics.goalCompletions;
  if (rows.length === 0) {
    return 0;
  }
  const achieved = rows.filter((item) => item.status === "achieved").length;
  return achieved / rows.length;
}

/**
 * Compute recovery completion rate from trace results.
 *
 * @param evaluate Full evaluation result.
 * @returns Normalized recovery rate.
 */
function getRecoveryCompletionRate(evaluate: RemediationEvaluateInput): number {
  const candidates = evaluate.subjectiveMetrics.recoveryTraces.filter((item) => item.status !== "none");
  if (candidates.length === 0) {
    return 0;
  }
  const completed = candidates.filter((item) => item.status === "completed").length;
  return completed / candidates.length;
}

/**
 * Dedupe target metrics by metric identifier.
 *
 * @param metrics Raw metric list.
 * @returns Dedupe-preserved metric list.
 */
function dedupeTargetMetrics(metrics: RemediationTargetMetric[]): RemediationTargetMetric[] {
  const byId = new Map<string, RemediationTargetMetric>();
  metrics.forEach((item) => {
    if (!byId.has(item.metricId)) {
      byId.set(item.metricId, item);
      return;
    }
    const current = byId.get(item.metricId);
    if (!current) {
      byId.set(item.metricId, item);
      return;
    }
    if (item.direction === "increase" && item.targetValue > current.targetValue) {
      byId.set(item.metricId, item);
      return;
    }
    if (item.direction === "decrease" && item.targetValue < current.targetValue) {
      byId.set(item.metricId, item);
    }
  });
  return [...byId.values()];
}

/**
 * Compute the evidence turn range string for one bad case.
 *
 * @param badCase Selected bad case.
 * @returns Turn range string.
 */
function getTurnRange(badCase: RemediationBadCase): string {
  if (badCase.evidence.length === 0) {
    return "unknown";
  }
  const turns = badCase.evidence.map((item) => item.turnIndex);
  return `${Math.min(...turns)}-${Math.max(...turns)}`;
}

/**
 * Get the most relevant current output from one bad case.
 *
 * @param badCase Selected bad case.
 * @returns Current assistant output excerpt.
 */
function getCurrentOutput(badCase: RemediationBadCase): string {
  const assistantEvidence = [...badCase.evidence].reverse().find((item) => item.role === "assistant");
  if (assistantEvidence) {
    return assistantEvidence.content;
  }

  const transcriptLines = badCase.transcript.split("\n").filter((line) => line.includes("[assistant]"));
  return transcriptLines.at(-1) ?? badCase.transcript;
}

/**
 * Build the expected behavior field for one bad case line.
 *
 * @param tags Failure tags.
 * @returns Expected behavior summary.
 */
function buildExpectedBehavior(tags: string[]): string {
  const behaviors = new Set<string>();
  if (tags.includes("goal_failed") || tags.includes("goal_partial") || tags.includes("goal_unclear")) {
    behaviors.add("明确重述用户主任务，给出完成态或清晰的下一步动作。");
  }
  if (tags.includes("recovery_failed") || tags.includes("emotion_drop")) {
    behaviors.add("先承认问题与情绪，再澄清，再给可执行修复动作。");
  }
  if (tags.includes("question_repeat") || tags.includes("understanding_barrier")) {
    behaviors.add("先直接回答问题核心，再补背景，避免用户重复追问。");
  }
  if (tags.includes("off_topic_shift")) {
    behaviors.add("保持主题收敛，不要在关键追问后切到无关信息。");
  }
  if (tags.includes("escalation_keyword")) {
    behaviors.add("在升级前给出兜底动作、SLA 承诺和明确升级路径。");
  }
  if (tags.includes("long_response_gap")) {
    behaviors.add("缩短等待时间，或显式告知当前处理状态与预计时长。");
  }

  return [...behaviors].join(" ");
}

/**
 * Clamp one normalized score into the 0-1 range.
 *
 * @param value Raw numeric value.
 * @returns Safe normalized score.
 */
function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

/**
 * Clamp one 1-5 style score.
 *
 * @param value Raw score.
 * @returns Safe integer-like score.
 */
function clampScore(value: number): number {
  return Math.max(1, Math.min(5, Number(value.toFixed(2))));
}

/**
 * Round one metric for file serialization.
 *
 * @param value Raw metric.
 * @returns Stable rounded value.
 */
function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}
