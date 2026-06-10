/**
 * @fileoverview Small generic benchmark run for the notebook workspace.
 */

import { approveRubricMetrics } from "@/benchmark/rubric";
import { runBenchmarkEvaluation } from "@/benchmark/runner";
import { benchmarkProgress } from "@/benchmark/progress";
import {
  persistBenchmarkGenericRunArtifact,
  readBenchmarkRunArtifact,
  type BenchmarkGenericRunArtifact,
} from "@/benchmark/progress-artifacts";
import { buildEvalAnythingDesign, renderEvalAnythingDesignSummary } from "@/benchmark/eval-anything-philosophy";
import { parseJsonObjectFromLlmOutput, readZevalEnvValue, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkJudgeAggregationMode,
  BenchmarkLlmJudge,
  BenchmarkLlmJudgeMemberResult,
  BenchmarkMetricEvaluationResult,
  BenchmarkMatrixCell,
  BenchmarkModelId,
  BenchmarkRubricSet,
  BenchmarkTaskPackage,
} from "@/benchmark/types";
import type { BenchmarkDatasetSnapshot } from "@/benchmark/session-store";
import type { RawChatlogRow } from "@/types/pipeline";

export type RunGenericBenchmarkInput = {
  runId: string;
  requirementText: string;
  rubric: BenchmarkRubricSet;
  dataset: BenchmarkDatasetSnapshot;
  resumeRunId?: string;
};

const DEFAULT_MATRIX: BenchmarkMatrixCell[] = [
  {
    agentFramework: "zeval",
    model: "当前评测模型",
    enabled: true,
    timeoutMs: 45000,
    maxTurns: 1,
    concurrency: 1,
  },
];

export async function runGenericBenchmarkStreaming(input: RunGenericBenchmarkInput) {
  const approvedMetricKeys = input.rubric.modules
    .flatMap((module) => module.metrics)
    .filter((metric) => metric.approvalStatus === "approved")
    .map((metric) => metric.metricKey);

  if (approvedMetricKeys.length === 0) {
    throw new Error("至少确认一个指标后才能运行评测。");
  }

  const rubric = approveRubricMetrics(input.rubric, approvedMetricKeys);
  const matrix = DEFAULT_MATRIX;
  const task = buildTaskPackage(input.requirementText, rubric, matrix);
  const cases = buildCasesFromDataset(task, input.dataset);
  const totalMetrics = cases.length * matrix.length * approvedMetricKeys.length;
  const resumeArtifact = input.resumeRunId
    ? (await readBenchmarkRunArtifact(input.resumeRunId))?.genericRun
    : (await readBenchmarkRunArtifact(input.runId))?.genericRun;
  const reusableArtifact = isReusableGenericArtifact(resumeArtifact, input.requirementText, task)
    ? resumeArtifact
    : null;
  const metricResultsForArtifact = dedupeMetricResults(reusableArtifact?.metricResults ?? []);

  benchmarkProgress.init(input.runId, matrix, cases.length);
  if (task.evalDesign) {
    benchmarkProgress.addEvent(input.runId, {
      phase: "preparing",
      status: "completed",
      title: "Eval-Anything 对齐设计",
      detail: renderEvalAnythingDesignSummary(task.evalDesign),
    });
  }
  benchmarkProgress.update(input.runId, {
    phase: "building_cases",
    totalMetrics,
    activeAnalysis: "正在按 Eval-Anything 的 Environment 思想构建评测案例：每个 session 都会携带输入、期望验收标准、上下文证据、参考来源和人工复核触发条件。",
    datasetSummary: {
      fileName: input.dataset.fileName,
      rows: input.dataset.ingestMeta.rows,
      sessions: input.dataset.ingestMeta.sessions,
      caseCount: input.dataset.ingestMeta.sessions,
      sampledCaseCount: cases.length,
      hasTimestamp: input.dataset.ingestMeta.hasTimestamp,
      warnings: input.dataset.warnings,
    },
  });
  benchmarkProgress.addEvent(input.runId, {
    phase: "ingesting",
    status: "completed",
    title: "数据接入完成",
    detail: `文件 ${input.dataset.fileName} 已标准化为 ${input.dataset.ingestMeta.rows} 条消息，覆盖 ${input.dataset.ingestMeta.sessions} 个会话。`,
  });
  benchmarkProgress.addEvent(input.runId, {
    phase: "building_cases",
    status: cases.length < input.dataset.ingestMeta.sessions ? "warning" : "completed",
    title: "案例构建完成",
    detail: `已从上传数据中构建 ${cases.length} 个评测案例；当前 MVP 为控制耗时最多抽取前 ${MAX_DATASET_CASES} 个 session。`,
  });
  if (reusableArtifact) {
    benchmarkProgress.addEvent(input.runId, {
      phase: "building_cases",
      status: "completed",
      title: "发现可复用断点",
      detail: `将复用 ${reusableArtifact.submissions.filter((item) => item.status === "completed").length} 条被测输出和 ${metricResultsForArtifact.length} 条指标评审结果。`,
    });
  }
  await persistGenericArtifact(input.runId, input.requirementText, task, cases, reusableArtifact?.submissions ?? [], metricResultsForArtifact);

  const submissions = await buildSubmissions({
    runId: input.runId,
    task,
    cases,
    matrix,
    existingSubmissions: reusableArtifact?.submissions ?? [],
    metricResultsForArtifact,
  });

  benchmarkProgress.update(input.runId, {
    phase: "evaluating",
    activeAnalysis: "正在逐指标调用评测器。每个指标会根据用户确认的 rubric 表单、案例上下文、期望标准和被测输出给出分数、理由与证据。",
  });
  benchmarkProgress.addEvent(input.runId, {
    phase: "evaluating",
    status: "running",
    title: "进入指标评审",
    detail: `将对 ${cases.length} 个案例执行 ${approvedMetricKeys.length} 项已确认指标评审。`,
  });

  const result = await runBenchmarkEvaluation({
    runId: input.runId,
    task,
    cases,
    submissions,
    matrix,
    evaluatorContext: {
      llmJudge: createLlmJudge(),
    },
    existingMetricResults: metricResultsForArtifact,
    onMetricReused: (metricResult) => {
      const snap = benchmarkProgress.getSnapshot(input.runId);
      if (!snap) return;
      benchmarkProgress.update(input.runId, {
        evaluatedMetrics: snap.evaluatedMetrics + 1,
      });
      benchmarkProgress.addEvent(input.runId, {
        phase: "evaluating",
        status: "completed",
        title: "复用指标结果",
        detail: `${metricResult.metricKey} 已从上次中断 run 中复用，无需重新调用评测模型。`,
        caseId: metricResult.caseId,
        metricName: metricResult.metricKey,
        score: metricResult.score,
        evidence: metricResult.evidence.slice(0, 3),
      });
    },
    onMetricEvaluated: (metricResult) => {
      const snap = benchmarkProgress.getSnapshot(input.runId);
      if (!snap) return;
      benchmarkProgress.update(input.runId, {
        evaluatedMetrics: snap.evaluatedMetrics + 1,
      });
      upsertMetricResult(metricResultsForArtifact, metricResult);
      void persistGenericArtifact(input.runId, input.requirementText, task, cases, submissions, metricResultsForArtifact);
      addMetricEvaluationEvent(input.runId, metricResult);
    },
  });

  benchmarkProgress.addEvent(input.runId, {
    phase: "completed",
    status: "completed",
    title: "评测完成",
    detail: `平均分 ${result.summary.averageScore.toFixed(1)}%，共生成 ${result.summary.metricResultCount} 条指标评审结果。`,
  });
  benchmarkProgress.setResult(input.runId, result);
  await persistGenericArtifact(input.runId, input.requirementText, task, cases, submissions, result.metricResults);
  return { task, result };
}

const MAX_DATASET_CASES = 8;

function buildTaskPackage(
  requirementText: string,
  rubric: BenchmarkRubricSet,
  matrix: BenchmarkMatrixCell[],
): BenchmarkTaskPackage {
  const evalDesign = buildEvalAnythingDesign({
    requirementText,
    rubric,
    matrix,
    judgeMode: readJudgePanelMode(),
  });
  return {
    benchmarkId: `benchmark_${rubric.rubricId}`,
    taskId: `${rubric.rubricId}_task`,
    version: "0.1.0",
    title: rubric.title,
    description: rubric.description,
    domain: rubric.domain,
    requirementText,
    inputSchema: { required: ["requirement"] },
    outputSchema: { required: ["answer", "evidence"] },
    rubric,
    evalDesign,
    metadata: {
      evalAnythingAlignment: evalDesign,
    },
  };
}

/**
 * Build benchmark cases from normalized uploaded rows.
 *
 * @param task Runnable benchmark task package.
 * @param dataset Ingested and normalized dataset snapshot from the workspace.
 * @returns Session-level benchmark cases capped for MVP runtime.
 */
function buildCasesFromDataset(task: BenchmarkTaskPackage, dataset: BenchmarkDatasetSnapshot): BenchmarkCase[] {
  const groupedRows = groupRowsBySession(dataset.rawRows);
  const acceptanceCriteria = task.rubric.modules.flatMap((module) =>
    module.metrics.map((metric) => ({
      metric: metric.displayName,
      criteria: metric.config?.criteria ?? metric.description,
      rubricForm: metric.config?.rubricForm ?? [],
      references: metric.config?.references ?? [],
    })),
  );

  return [...groupedRows.entries()].slice(0, MAX_DATASET_CASES).map(([sessionId, rows], index) => ({
    caseId: `${task.taskId}_case_${String(index + 1).padStart(3, "0")}`,
    taskId: task.taskId,
    input: {
      requirement: task.requirementText,
      sessionId,
      transcript: rows.map(formatTranscriptRow).join("\n"),
      messageCount: rows.length,
      sourceFileName: dataset.fileName,
    },
    expected: {
      requirement: task.requirementText,
      acceptanceCriteria,
      evaluationDesign: task.evalDesign,
      sourceSummary: {
        sessionId,
        messageCount: rows.length,
        hasTimestamp: rows.every((row) => Boolean(row.timestamp)),
      },
    },
    source: "imported",
    metadata: {
      sourceFileName: dataset.fileName,
      sourceFormat: dataset.format,
      originalSessionId: sessionId,
      sampled: groupedRows.size > MAX_DATASET_CASES,
      evalDesign: task.evalDesign,
      evalDesignSummary: task.evalDesign ? renderEvalAnythingDesignSummary(task.evalDesign) : undefined,
    },
  }));
}

/**
 * Group normalized chat rows by session id while preserving upload order.
 *
 * @param rows Ingested raw chatlog rows.
 * @returns Map keyed by session id.
 */
function groupRowsBySession(rows: RawChatlogRow[]): Map<string, RawChatlogRow[]> {
  const grouped = new Map<string, RawChatlogRow[]>();
  for (const row of rows) {
    const sessionId = row.sessionId || "unknown";
    if (!grouped.has(sessionId)) grouped.set(sessionId, []);
    grouped.get(sessionId)!.push(row);
  }
  return grouped;
}

/**
 * Format one raw row into the compact transcript used in prompts.
 *
 * @param row Ingested chat row.
 * @returns Human-readable transcript line.
 */
function formatTranscriptRow(row: RawChatlogRow): string {
  const time = row.timestamp ? `[${row.timestamp}] ` : "";
  const role = row.role === "assistant" ? "助手" : row.role === "user" ? "用户" : "系统";
  return `${time}${role}: ${row.content}`;
}

async function buildSubmissions(input: {
  runId: string;
  task: BenchmarkTaskPackage;
  cases: BenchmarkCase[];
  matrix: BenchmarkMatrixCell[];
  existingSubmissions?: BenchmarkAgentSubmission[];
  metricResultsForArtifact: BenchmarkMetricEvaluationResult[];
}): Promise<BenchmarkAgentSubmission[]> {
  const submissions: BenchmarkAgentSubmission[] = [];
  const existingByKey = new Map(
    (input.existingSubmissions ?? [])
      .filter((submission) => submission.status === "completed")
      .map((submission) => [submissionCacheKey(submission.agentFramework, submission.model, submission.caseId), submission]),
  );

  for (const matrixCell of input.matrix) {
    for (const taskCase of input.cases) {
      const existingSubmission = existingByKey.get(submissionCacheKey(matrixCell.agentFramework, matrixCell.model, taskCase.caseId));
      if (existingSubmission) {
        submissions.push(existingSubmission);
        markSubmissionDone(input.runId, matrixCell, taskCase, true, existingSubmission.durationMs);
        benchmarkProgress.addEvent(input.runId, {
          phase: "submitting",
          status: "completed",
          title: "复用被测输出",
          detail: `案例 ${taskCase.caseId} 已从上次中断 run 中复用，无需重新调用被测模型。`,
          caseId: taskCase.caseId,
          evidence: extractOutputEvidence(existingSubmission.parsedOutput ?? {}),
        });
        await persistGenericArtifact(
          input.runId,
          input.task.requirementText,
          input.task,
          input.cases,
          submissions,
          input.metricResultsForArtifact,
        );
        continue;
      }

      benchmarkProgress.addItem(input.runId, {
        agentFramework: matrixCell.agentFramework,
        model: matrixCell.model,
        caseId: taskCase.caseId,
        status: "running",
      });
      benchmarkProgress.update(input.runId, {
        phase: "submitting",
        activeAnalysis: `正在让被测智能体处理案例 ${taskCase.caseId}，随后会用确认后的指标逐项评分。`,
      });
      benchmarkProgress.addEvent(input.runId, {
        phase: "submitting",
        status: "running",
        title: "生成被测输出",
        detail: `正在处理案例 ${taskCase.caseId}，输入来自上传数据的一个 session。`,
        caseId: taskCase.caseId,
      });

      const startedAt = new Date().toISOString();
      const startedMs = Date.now();
      try {
        const rawOutput = await requestSiliconFlowChatCompletion(
          [
            {
              role: "system",
              content: [
                "你是被测业务智能体，请根据用户任务给出可评测的业务输出。",
                "必须返回 JSON，不要输出 Markdown。",
                '输出格式：{"answer":"任务结果","evidence":["证据1","证据2"],"notes":"必要说明"}',
              ].join("\n"),
            },
            {
              role: "user",
              content: [
                `评测任务：${input.task.title}`,
                `任务需求：${input.task.requirementText}`,
                "请基于案例 transcript 完成任务，不要臆造未出现的信息。",
                "案例输入：",
                JSON.stringify(taskCase.input, null, 2),
              ].join("\n\n"),
            },
          ],
          { stage: "benchmark_generic_submission", temperature: 0.2, seed: 42 },
        );
        const parsedOutput = parseRecord(rawOutput);
        const completedAt = new Date().toISOString();
        const submission: BenchmarkAgentSubmission = {
          submissionId: `${input.runId}_${matrixCell.agentFramework}_${taskCase.caseId}`,
          runId: input.runId,
          benchmarkId: input.task.benchmarkId,
          taskId: input.task.taskId,
          caseId: taskCase.caseId,
          agentFramework: matrixCell.agentFramework,
          model: matrixCell.model,
          status: "completed",
          rawOutput,
          parsedOutput,
          startedAt,
          completedAt,
          durationMs: Date.now() - startedMs,
          artifacts: {},
        };
        submissions.push(submission);
        markSubmissionDone(input.runId, matrixCell, taskCase, true, submission.durationMs);
        await persistGenericArtifact(
          input.runId,
          input.task.requirementText,
          input.task,
          input.cases,
          submissions,
          input.metricResultsForArtifact,
        );
        benchmarkProgress.addEvent(input.runId, {
          phase: "submitting",
          status: "completed",
          title: "被测输出完成",
          detail: `案例 ${taskCase.caseId} 已生成可评测输出，用时 ${submission.durationMs ?? 0}ms。`,
          caseId: taskCase.caseId,
          evidence: extractOutputEvidence(parsedOutput),
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        submissions.push({
          submissionId: `${input.runId}_${matrixCell.agentFramework}_${taskCase.caseId}`,
          runId: input.runId,
          benchmarkId: input.task.benchmarkId,
          taskId: input.task.taskId,
          caseId: taskCase.caseId,
          agentFramework: matrixCell.agentFramework,
          model: matrixCell.model,
          status: "failed",
          rawOutput: "",
          error: message,
          startedAt,
          completedAt: new Date().toISOString(),
          durationMs: Date.now() - startedMs,
        });
        markSubmissionDone(input.runId, matrixCell, taskCase, false);
        await persistGenericArtifact(
          input.runId,
          input.task.requirementText,
          input.task,
          input.cases,
          submissions,
          input.metricResultsForArtifact,
        );
        benchmarkProgress.addEvent(input.runId, {
          phase: "submitting",
          status: "failed",
          title: "被测输出失败",
          detail: message,
          caseId: taskCase.caseId,
        });
      }
    }
  }

  return submissions;
}

async function persistGenericArtifact(
  runId: string,
  requirementText: string,
  task: BenchmarkTaskPackage,
  cases: BenchmarkCase[],
  submissions: BenchmarkAgentSubmission[],
  metricResults: BenchmarkMetricEvaluationResult[],
): Promise<void> {
  await persistBenchmarkGenericRunArtifact(runId, {
    requirementText,
    task,
    cases,
    submissions,
    metricResults: dedupeMetricResults(metricResults),
  });
}

function isReusableGenericArtifact(
  artifact: BenchmarkGenericRunArtifact | null | undefined,
  requirementText: string,
  task: BenchmarkTaskPackage,
): artifact is BenchmarkGenericRunArtifact {
  return Boolean(
    artifact &&
    artifact.requirementText === requirementText &&
    artifact.task.rubric.rubricId === task.rubric.rubricId &&
    artifact.task.taskId === task.taskId,
  );
}

function upsertMetricResult(
  results: BenchmarkMetricEvaluationResult[],
  nextResult: BenchmarkMetricEvaluationResult,
): void {
  const key = metricCacheKey(nextResult);
  const existingIndex = results.findIndex((item) => metricCacheKey(item) === key);
  if (existingIndex >= 0) {
    results[existingIndex] = nextResult;
  } else {
    results.push(nextResult);
  }
}

function dedupeMetricResults(results: BenchmarkMetricEvaluationResult[]): BenchmarkMetricEvaluationResult[] {
  const byKey = new Map<string, BenchmarkMetricEvaluationResult>();
  for (const result of results) {
    byKey.set(metricCacheKey(result), result);
  }
  return [...byKey.values()];
}

function metricCacheKey(result: BenchmarkMetricEvaluationResult): string {
  return `${result.submissionId}::${result.metricKey}`;
}

function submissionCacheKey(agentFramework: string, model: string, caseId: string): string {
  return `${agentFramework}::${model}::${caseId}`;
}

/**
 * Add a compact metric-result event to the real-time progress stream.
 *
 * @param runId Benchmark run identifier.
 * @param metricResult Completed metric evaluation result.
 */
function addMetricEvaluationEvent(runId: string, metricResult: BenchmarkMetricEvaluationResult): void {
  benchmarkProgress.addEvent(runId, {
    phase: "evaluating",
    status: metricResult.passed ? "completed" : "warning",
    title: metricResult.passed ? "指标通过" : "指标需关注",
    detail: `${metricResult.metricKey} 得分 ${metricResult.score}，${metricResult.reason}`,
    caseId: metricResult.caseId,
    metricName: metricResult.metricKey,
    score: metricResult.score,
    evidence: metricResult.evidence.slice(0, 3),
  });
}

/**
 * Extract short evidence snippets from a generated submission.
 *
 * @param parsedOutput Parsed model output.
 * @returns Evidence strings for the progress timeline.
 */
function extractOutputEvidence(parsedOutput: Record<string, unknown>): string[] {
  const evidence = parsedOutput.evidence;
  if (Array.isArray(evidence)) return evidence.map(String).slice(0, 3);
  const answer = parsedOutput.answer;
  return typeof answer === "string" ? [answer.slice(0, 180)] : [];
}

function createLlmJudge(): BenchmarkLlmJudge {
  const panelMode = readJudgePanelMode();
  const panelMembers = readJudgePanelMembers(panelMode);
  const aggregation = readJudgeAggregationMode();
  const disagreementThreshold = readJudgeDisagreementThreshold();

  return async ({ metric, taskCase, submission }) => {
    const members: BenchmarkLlmJudgeMemberResult[] = [];
    for (const [index, member] of panelMembers.entries()) {
      const raw = await requestSiliconFlowChatCompletion(
        [
          {
            role: "system",
            content: [
              "你是 Zeval benchmark 评测器，也是 Eval-Anything 风格 Judge Panel 的一个独立成员。",
              "请严格根据指标准则、参考依据、案例输入、期望标准和被测输出评分。",
              "不要迁就被测模型；如果证据不足，要降低分数和 confidence。",
              "如果该案例暴露 rubric 歧义、边界样本或需要人工复核，请在 labels 中加入对应标签。",
              "只返回 JSON，不要输出 Markdown。",
              '输出格式：{"score":0-5,"passed":true,"labels":["missing_evidence"],"comment":"中文理由","evidence":["证据1"],"dimensions":{"criteria_fit":0-5,"evidence_grounding":0-5},"confidence":0-1}',
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              judgeMember: member,
              evalDesign: taskCase.metadata?.evalDesign,
              metric: {
                key: metric.metricKey,
                name: metric.displayName,
                capability: metric.capability,
                description: metric.description,
                criteria: metric.config?.criteria,
                rubricForm: metric.config?.rubricForm,
                references: metric.config?.references ?? [],
                scale: metric.scale,
              },
              caseInput: taskCase.input,
              expected: taskCase.expected,
              submission: submission.parsedOutput ?? submission.rawOutput,
            }, null, 2),
          },
        ],
        {
          stage: panelMode === "panel" ? "benchmark_generic_llm_judge_panel" : "benchmark_generic_llm_judge",
          model: member.model,
          temperature: 0.1,
          seed: 42 + index,
        },
      );
      members.push(parseJudgeMemberResult(raw, member, metric.scale.passThreshold));
    }

    const aggregated = aggregateJudgeMembers({
      members,
      aggregation,
      disagreementThreshold,
      passThreshold: metric.scale.passThreshold,
      mode: panelMode,
    });
    return {
      score: aggregated.score,
      passed: aggregated.passed,
      reason: aggregated.reason,
      evidence: aggregated.evidence,
      confidence: aggregated.confidence,
      labels: aggregated.labels,
      dimensions: aggregated.dimensions,
      judge: {
        mode: panelMode,
        aggregation,
        memberCount: members.length,
        disagreement: aggregated.disagreement,
        disagreementThreshold,
        panelDisagree: aggregated.panelDisagree,
        members,
      },
    };
  };
}

type JudgePanelMemberConfig = {
  judgeId: string;
  model?: BenchmarkModelId;
  family?: string;
};

type AggregatedJudgeMembers = {
  score: number;
  passed: boolean;
  reason: string;
  evidence: string[];
  confidence: number;
  labels: string[];
  dimensions: Record<string, number>;
  disagreement: number;
  panelDisagree: boolean;
};

function readJudgePanelMode(): "single" | "panel" {
  const value = readZevalEnvValue(["ZEVAL_JUDGE_PANEL_MODE", "ZEVAL_LLM_JUDGE_PANEL_MODE"])?.toLowerCase();
  return value === "panel" || value === "poll" ? "panel" : "single";
}

function readJudgeAggregationMode(): BenchmarkJudgeAggregationMode {
  const value = readZevalEnvValue(["ZEVAL_JUDGE_PANEL_AGGREGATION"])?.toLowerCase();
  if (value === "mean" || value === "median" || value === "majority") return value;
  return "trimmed_mean";
}

function readJudgeDisagreementThreshold(): number {
  const raw = Number.parseFloat(readZevalEnvValue(["ZEVAL_JUDGE_PANEL_DISAGREEMENT_THRESHOLD"]) ?? "");
  return Number.isFinite(raw) && raw >= 0 ? raw : 1.5;
}

function readJudgePanelMembers(mode: "single" | "panel"): JudgePanelMemberConfig[] {
  const raw = readZevalEnvValue(["ZEVAL_JUDGE_PANEL_MEMBERS", "ZEVAL_LLM_JUDGE_PANEL_MEMBERS"]);
  const parsed = raw
    ?.split(",")
    .map((item, index) => parseJudgePanelMember(item, index))
    .filter((item): item is JudgePanelMemberConfig => Boolean(item)) ?? [];

  if (mode === "panel" && parsed.length > 0) return parsed.slice(0, 5);
  if (mode === "panel" && parsed.length === 0) {
    return [
      { judgeId: "default_judge", family: "default" },
      { judgeId: "default_judge_recheck", family: "default" },
      { judgeId: "default_judge_boundary", family: "default" },
    ];
  }
  return [parsed[0] ?? { judgeId: "default_judge", family: "default" }];
}

function parseJudgePanelMember(value: string, index: number): JudgePanelMemberConfig | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(":").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 1) {
    return {
      judgeId: `judge_${index + 1}`,
      model: parts[0] as BenchmarkModelId,
      family: inferModelFamily(parts[0]),
    };
  }
  return {
    judgeId: parts[0] || `judge_${index + 1}`,
    model: parts[1] as BenchmarkModelId | undefined,
    family: parts[2] || inferModelFamily(parts[1] ?? parts[0]),
  };
}

function inferModelFamily(model: string): string {
  const normalized = model.toLowerCase();
  if (/gpt|openai|o[0-9]/.test(normalized)) return "openai";
  if (/claude|anthropic/.test(normalized)) return "anthropic";
  if (/qwen|通义/.test(normalized)) return "qwen";
  if (/deepseek/.test(normalized)) return "deepseek";
  if (/gemini|google/.test(normalized)) return "google";
  if (/glm|zhipu|智谱/.test(normalized)) return "zhipu";
  if (/kimi|moonshot/.test(normalized)) return "moonshot";
  return "unknown";
}

function parseJudgeMemberResult(
  raw: string,
  member: JudgePanelMemberConfig,
  passThreshold: number,
): BenchmarkLlmJudgeMemberResult {
  const parsed = parseRecord(raw);
  const score = readNumber(parsed.score, 0);
  return {
    judgeId: member.judgeId,
    model: member.model,
    family: member.family,
    score,
    passed: typeof parsed.passed === "boolean" ? parsed.passed : score >= passThreshold,
    labels: readStringArray(parsed.labels).slice(0, 8),
    comment: typeof parsed.comment === "string"
      ? parsed.comment
      : typeof parsed.reason === "string"
        ? parsed.reason
        : "模型评审未返回理由。",
    evidence: readStringArray(parsed.evidence).slice(0, 6),
    dimensions: readNumberRecord(parsed.dimensions),
    confidence: readNumber(parsed.confidence, 0.6),
  };
}

function aggregateJudgeMembers(input: {
  members: BenchmarkLlmJudgeMemberResult[];
  aggregation: BenchmarkJudgeAggregationMode;
  disagreementThreshold: number;
  passThreshold: number;
  mode: "single" | "panel";
}): AggregatedJudgeMembers {
  const scores = input.members.map((member) => member.score);
  const score = aggregateNumbers(scores, input.aggregation);
  const support = input.members.filter((member) => member.passed).length;
  const passed = input.mode === "panel"
    ? support > input.members.length / 2
    : score >= input.passThreshold;
  const disagreement = scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
  const panelDisagree = input.mode === "panel" && disagreement > input.disagreementThreshold;
  const labels = aggregateLabels(input.members, panelDisagree);
  const evidence = dedupeStrings(input.members.flatMap((member) => member.evidence)).slice(0, 8);
  const dimensions = aggregateDimensions(input.members, input.aggregation);
  const confidence = aggregateNumbers(input.members.map((member) => member.confidence), "mean");
  const reason = input.members.map((member) => `[${member.judgeId}] ${member.comment}`).join("\n");

  return {
    score,
    passed,
    reason,
    evidence,
    confidence,
    labels,
    dimensions,
    disagreement,
    panelDisagree,
  };
}

function aggregateNumbers(values: number[], mode: BenchmarkJudgeAggregationMode): number {
  const finite = values.filter((value) => Number.isFinite(value)).sort((left, right) => left - right);
  if (finite.length === 0) return 0;
  if (mode === "median") {
    const middle = Math.floor(finite.length / 2);
    return finite.length % 2 === 0 ? round2((finite[middle - 1] + finite[middle]) / 2) : finite[middle];
  }
  if (mode === "trimmed_mean" && finite.length >= 3) {
    return round2(mean(finite.slice(1, -1)));
  }
  return round2(mean(finite));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function aggregateLabels(members: BenchmarkLlmJudgeMemberResult[], panelDisagree: boolean): string[] {
  const support = new Map<string, number>();
  for (const member of members) {
    for (const label of new Set(member.labels.map((item) => item.trim()).filter(Boolean))) {
      support.set(label, (support.get(label) ?? 0) + 1);
    }
  }
  const minSupport = Math.ceil(members.length / 2);
  const labels = [...support.entries()]
    .filter(([, count]) => count >= minSupport)
    .map(([label]) => label);
  if (panelDisagree) labels.push("panel_disagree");
  return dedupeStrings(labels).slice(0, 10);
}

function aggregateDimensions(
  members: BenchmarkLlmJudgeMemberResult[],
  aggregation: BenchmarkJudgeAggregationMode,
): Record<string, number> {
  const values = new Map<string, number[]>();
  for (const member of members) {
    for (const [dimension, value] of Object.entries(member.dimensions)) {
      if (!values.has(dimension)) values.set(dimension, []);
      values.get(dimension)!.push(value);
    }
  }
  return Object.fromEntries(
    [...values.entries()].map(([dimension, dimensionValues]) => [
      dimension,
      aggregateNumbers(dimensionValues, aggregation),
    ]),
  );
}

function readStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function readNumberRecord(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const result: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const numeric = typeof raw === "number" ? raw : Number.parseFloat(String(raw));
    if (Number.isFinite(numeric)) result[key] = numeric;
  }
  return result;
}

function markSubmissionDone(
  runId: string,
  matrixCell: BenchmarkMatrixCell,
  taskCase: BenchmarkCase,
  success: boolean,
  durationMs?: number,
): void {
  const snap = benchmarkProgress.getSnapshot(runId);
  if (!snap) return;
  benchmarkProgress.update(runId, {
    completedSubmissions: snap.completedSubmissions + 1,
    failedSubmissions: snap.failedSubmissions + (success ? 0 : 1),
    matrixProgress: snap.matrixProgress.map((row) =>
      row.agentFramework === matrixCell.agentFramework && row.model === matrixCell.model
        ? {
            ...row,
            completed: row.completed + (success ? 1 : 0),
            failed: row.failed + (success ? 0 : 1),
          }
        : row,
    ),
  });
  benchmarkProgress.addItem(runId, {
    agentFramework: matrixCell.agentFramework,
    model: matrixCell.model,
    caseId: taskCase.caseId,
    status: success ? "completed" : "failed",
    durationMs,
  });
}

function parseRecord(raw: string): Record<string, unknown> {
  try {
    const parsed = parseJsonObjectFromLlmOutput(raw);
    return isRecord(parsed) ? parsed : { answer: raw };
  } catch {
    return { answer: raw };
  }
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim();
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
