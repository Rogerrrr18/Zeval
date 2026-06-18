/**
 * @fileoverview Small generic benchmark run for the notebook workspace.
 */

import { approveRubricMetrics } from "@/benchmark/rubric";
import { assembleBenchmarkRunResult, evaluateSubmissionMetrics } from "@/benchmark/runner";
import { computeSubmissionProgressCounts } from "@/benchmark/progress-sync";
import { benchmarkProgress } from "@/benchmark/progress";
import {
  persistBenchmarkGenericRunArtifact,
  readBenchmarkRunArtifact,
  type BenchmarkGenericRunArtifact,
} from "@/benchmark/progress-artifacts";
import {
  assertBenchmarkRunActive,
  BenchmarkRunCancelledError,
  interruptBenchmarkRun,
} from "@/benchmark/run-cancellation";
import type { BenchmarkJudgeProgressMember, BenchmarkProgressSnapshot } from "@/benchmark/progress";
import { buildEvalAnythingDesign, renderEvalAnythingDesignSummary } from "@/benchmark/eval-anything-philosophy";
import { snapScoreToRubricLevels } from "@/benchmark/rubric-judge";
import {
  buildBenchmarkTaskPackage,
  buildCasesFromRawRows,
  buildTranscriptSubmission,
  getMaxDatasetCases,
} from "@/benchmark/transcript-benchmark";
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
  BenchmarkRubricScoreLevel,
  BenchmarkRubricSet,
  BenchmarkScoringScale,
  BenchmarkTaskPackage,
} from "@/benchmark/types";
import type { BenchmarkDatasetSnapshot } from "@/benchmark/session-store";
import { mapWithConcurrency } from "@/lib/concurrency";
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
  try {
    return await runGenericBenchmarkStreamingInternal(input);
  } catch (error) {
    if (error instanceof BenchmarkRunCancelledError) {
      interruptBenchmarkRun(input.runId, "评测已由用户手动停止。");
      return null;
    }
    throw error;
  }
}

async function runGenericBenchmarkStreamingInternal(input: RunGenericBenchmarkInput) {
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
  const existingArtifact = await readBenchmarkRunArtifact(input.runId);
  const resumeArtifact = input.resumeRunId
    ? (await readBenchmarkRunArtifact(input.resumeRunId))?.genericRun
    : existingArtifact?.genericRun;
  const reusableArtifact = isReusableGenericArtifact(resumeArtifact, input.requirementText, task)
    ? resumeArtifact
    : null;
  const metricResultsForArtifact = dedupeMetricResults(reusableArtifact?.metricResults ?? []);

  restoreOrInitProgress({
    runId: input.runId,
    matrix,
    cases,
    approvedMetricCount: approvedMetricKeys.length,
    reusableArtifact,
    existingSnapshot: existingArtifact?.snapshot ?? null,
    totalMetrics,
  });
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
    detail: `已从上传数据中构建 ${cases.length} 个评测案例；当前 MVP 为控制耗时最多抽取前 ${getMaxDatasetCases()} 个 session。`,
  });
  if (reusableArtifact) {
    benchmarkProgress.addEvent(input.runId, {
      phase: "building_cases",
      status: "completed",
      title: "发现可复用断点",
      detail: `将复用 ${reusableArtifact.submissions.filter((item) => item.status === "completed").length} 条被测输出和 ${metricResultsForArtifact.length} 条指标评审结果。`,
    });
  }
  await persistGenericArtifact(input.runId, input.requirementText, task, cases, reusableArtifact?.submissions ?? [], metricResultsForArtifact)
    .catch(() => undefined);
  assertBenchmarkRunActive(input.runId);

  const existingMetricByKey = new Map(
    metricResultsForArtifact.map((result) => [metricCacheKey(result), result]),
  );

  let checkpointPersistTimer: ReturnType<typeof setTimeout> | null = null;
  let submissionsRef: BenchmarkAgentSubmission[] = reusableArtifact?.submissions ?? [];
  const scheduleCheckpointPersist = () => {
    if (checkpointPersistTimer) {
      clearTimeout(checkpointPersistTimer);
    }
    checkpointPersistTimer = setTimeout(() => {
      checkpointPersistTimer = null;
      void persistGenericArtifact(
        input.runId,
        input.requirementText,
        task,
        cases,
        submissionsRef,
        metricResultsForArtifact,
      ).catch(() => undefined);
    }, 2000);
  };
  const flushCheckpointPersist = async () => {
    if (checkpointPersistTimer) {
      clearTimeout(checkpointPersistTimer);
      checkpointPersistTimer = null;
    }
    await persistGenericArtifact(
      input.runId,
      input.requirementText,
      task,
      cases,
      submissionsRef,
      metricResultsForArtifact,
    ).catch(() => undefined);
  };

  const llmJudge = createLlmJudge({ runId: input.runId });
  const metricConcurrency = resolveBenchmarkMetricConcurrency();

  const syncEvaluatedMetrics = () => {
    benchmarkProgress.update(input.runId, {
      evaluatedMetrics: metricResultsForArtifact.length,
      phase: "evaluating",
      judgeProgress: undefined,
      activeAnalysis: "正在逐指标调用评测器。每个指标会根据用户确认的 rubric 表单、案例上下文、期望标准和被测输出给出分数、理由与证据。",
    });
  };

  const evaluateMetricsForSubmission = async (
    submission: BenchmarkAgentSubmission,
    taskCase: BenchmarkCase,
  ) => {
    if (submission.status !== "completed") {
      return;
    }
    await evaluateSubmissionMetrics({
      runId: input.runId,
      task,
      taskCase,
      submission,
      evaluatorContext: { llmJudge },
      existingMetricByKey,
      metricResults: metricResultsForArtifact,
      shouldCancel: () => benchmarkProgress.isCancelled(input.runId),
      metricConcurrency,
      onMetricReused: () => {
        syncEvaluatedMetrics();
      },
      onMetricEvaluated: (metricResult) => {
        upsertMetricResult(metricResultsForArtifact, metricResult);
        syncEvaluatedMetrics();
        scheduleCheckpointPersist();
        addMetricEvaluationEvent(input.runId, metricResult);
      },
    });
  };

  const submissions = await buildSubmissions({
    runId: input.runId,
    task,
    cases,
    matrix,
    existingSubmissions: reusableArtifact?.submissions ?? [],
    metricResultsForArtifact,
    onSubmissionReady: evaluateMetricsForSubmission,
  });
  submissionsRef = submissions;

  assertBenchmarkRunActive(input.runId);

  const result = assembleBenchmarkRunResult({
    runId: input.runId,
    task,
    cases,
    submissions,
    matrix,
    metricResults: metricResultsForArtifact,
  });

  benchmarkProgress.addEvent(input.runId, {
    phase: "completed",
    status: "completed",
    title: "评测完成",
    detail: `平均分 ${result.summary.averageScore.toFixed(1)}%，共生成 ${result.summary.metricResultCount} 条指标评审结果。`,
  });
  benchmarkProgress.setResult(input.runId, result);
  await benchmarkProgress.flushPersist(input.runId);
  await flushCheckpointPersist();
  await persistGenericArtifact(input.runId, input.requirementText, task, cases, submissions, result.metricResults)
    .catch(() => undefined);
  return { task, result };
}

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
  const task = buildBenchmarkTaskPackage(requirementText, rubric);
  return {
    ...task,
    evalDesign,
    metadata: {
      ...(task.metadata ?? {}),
      evalAnythingAlignment: evalDesign,
    },
  };
}

/**
 * Build benchmark cases from normalized uploaded rows and attach the evaluator design.
 *
 * @param task Runnable benchmark task package.
 * @param dataset Ingested and normalized dataset snapshot from the workspace.
 * @returns Session-level benchmark cases capped for runtime.
 */
function buildCasesFromDataset(task: BenchmarkTaskPackage, dataset: BenchmarkDatasetSnapshot): BenchmarkCase[] {
  return buildCasesFromRawRows(task, dataset.rawRows, dataset.fileName).map((taskCase) => ({
    ...taskCase,
    expected: {
      ...taskCase.expected,
      evaluationDesign: task.evalDesign,
    },
    metadata: {
      ...(taskCase.metadata ?? {}),
      sourceFormat: dataset.format,
      evalDesign: task.evalDesign,
      evalDesignSummary: task.evalDesign ? renderEvalAnythingDesignSummary(task.evalDesign) : undefined,
    },
  }));
}

async function buildSubmissions(input: {
  runId: string;
  task: BenchmarkTaskPackage;
  cases: BenchmarkCase[];
  matrix: BenchmarkMatrixCell[];
  existingSubmissions?: BenchmarkAgentSubmission[];
  metricResultsForArtifact: BenchmarkMetricEvaluationResult[];
  onSubmissionReady?: (submission: BenchmarkAgentSubmission, taskCase: BenchmarkCase) => Promise<void>;
}): Promise<BenchmarkAgentSubmission[]> {
  const submissions: BenchmarkAgentSubmission[] = [];
  const existingByKey = new Map(
    (input.existingSubmissions ?? [])
      .filter((submission) => submission.status === "completed")
      .map((submission) => [submissionCacheKey(submission.agentFramework, submission.model, submission.caseId), submission]),
  );
  const workItems = input.matrix.flatMap((matrixCell) =>
    input.cases.map((taskCase) => ({ matrixCell, taskCase })),
  );
  const workOrder = new Map(
    workItems.map((item, index) => [submissionCacheKey(item.matrixCell.agentFramework, item.matrixCell.model, item.taskCase.caseId), index]),
  );

  await mapWithConcurrency(workItems, resolveBenchmarkSubmissionConcurrency(), async ({ matrixCell, taskCase }) => {
    assertBenchmarkRunActive(input.runId);
    const existingSubmission = existingByKey.get(submissionCacheKey(matrixCell.agentFramework, matrixCell.model, taskCase.caseId));
    if (existingSubmission) {
      submissions.push(existingSubmission);
      await input.onSubmissionReady?.(existingSubmission, taskCase);
      return;
    }

    benchmarkProgress.addItem(input.runId, {
      agentFramework: matrixCell.agentFramework,
      model: matrixCell.model,
      caseId: taskCase.caseId,
      status: "running",
    });
    benchmarkProgress.update(input.runId, {
      phase: "submitting",
      activeAnalysis: `正在并行处理评测案例；当前生成案例 ${taskCase.caseId} 的被测输出。`,
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
      if (isTranscriptEvalMode()) {
        const submission = buildTranscriptSubmission({
          runId: input.runId,
          task: input.task,
          matrixCell,
          taskCase,
          startedAt,
          startedMs,
        });
        submissions.push(submission);
        markSubmissionDone(input.runId, matrixCell, taskCase, submissions, input.matrix, input.cases, true, submission.durationMs);
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
          title: "复用历史 transcript",
          detail: `案例 ${taskCase.caseId} 使用 transcript 评测模式，直接评历史助手回复。`,
          caseId: taskCase.caseId,
          evidence: extractOutputEvidence(submission.parsedOutput ?? {}),
        });
        await input.onSubmissionReady?.(submission, taskCase);
        return;
      }

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
      assertBenchmarkRunActive(input.runId);
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
      markSubmissionDone(input.runId, matrixCell, taskCase, submissions, input.matrix, input.cases, true, submission.durationMs);
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
      await input.onSubmissionReady?.(submission, taskCase);
    } catch (error) {
      if (error instanceof BenchmarkRunCancelledError) {
        throw error;
      }
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
      markSubmissionDone(input.runId, matrixCell, taskCase, submissions, input.matrix, input.cases, false);
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
  });

  return submissions.sort((left, right) => {
    const leftIndex = workOrder.get(submissionCacheKey(left.agentFramework, left.model, left.caseId)) ?? 0;
    const rightIndex = workOrder.get(submissionCacheKey(right.agentFramework, right.model, right.caseId)) ?? 0;
    return leftIndex - rightIndex;
  });
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

function restoreOrInitProgress(input: {
  runId: string;
  matrix: BenchmarkMatrixCell[];
  cases: BenchmarkCase[];
  approvedMetricCount: number;
  reusableArtifact: BenchmarkGenericRunArtifact | null;
  existingSnapshot: BenchmarkProgressSnapshot | null;
  totalMetrics: number;
}): void {
  if (input.reusableArtifact && input.existingSnapshot) {
    const submissionCounts = computeSubmissionProgressCounts(
      input.matrix,
      input.cases,
      input.reusableArtifact.submissions,
    );
    benchmarkProgress.restoreSnapshot({
      ...input.existingSnapshot,
      runId: input.runId,
      phase: "building_cases",
      error: undefined,
      totalSubmissions: input.matrix.length * input.cases.length,
      completedSubmissions: submissionCounts.completedSubmissions,
      failedSubmissions: submissionCounts.failedSubmissions,
      matrixProgress: submissionCounts.matrixProgress,
      evaluatedMetrics: input.reusableArtifact.metricResults.length,
      totalMetrics: input.totalMetrics,
    });
    return;
  }

  benchmarkProgress.init(input.runId, input.matrix, input.cases.length);
  benchmarkProgress.update(input.runId, {
    totalMetrics: input.totalMetrics,
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
 * Publish the current LLM judge member progress to the real-time progress snapshot.
 *
 * @param runId Benchmark run id; omitted when the judge is used outside streaming mode.
 * @param input Current metric and judge member state.
 */
function updateJudgeProgress(
  runId: string | undefined,
  input: {
    mode: "single" | "panel";
    aggregation: BenchmarkJudgeAggregationMode;
    caseId: string;
    submissionId: string;
    metricKey: string;
    metricName: string;
    members: BenchmarkJudgeProgressMember[];
    activeJudgeId?: string;
  },
): void {
  if (!runId) return;
  const members = input.members.map((member) => ({ ...member }));
  benchmarkProgress.update(runId, {
    phase: "evaluating",
    judgeProgress: {
      mode: input.mode,
      aggregation: input.aggregation,
      caseId: input.caseId,
      submissionId: input.submissionId,
      metricKey: input.metricKey,
      metricName: input.metricName,
      totalMembers: members.length,
      completedMembers: members.filter((member) => member.status === "completed").length,
      failedMembers: members.filter((member) => member.status === "failed").length,
      activeJudgeId: input.activeJudgeId,
      members,
    },
    activeAnalysis: `${input.mode === "panel" ? "Judge Panel" : "Single Judge"} 正在评审 ${input.metricName}：${members.filter((member) => member.status === "completed").length}/${members.length} 个成员已完成。`,
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

/**
 * Whether benchmark should score historical assistant turns instead of re-generating outputs.
 *
 * @returns True when `ZEVAL_BENCHMARK_EVAL_MODE=transcript`.
 */
function isTranscriptEvalMode(): boolean {
  return process.env.ZEVAL_BENCHMARK_EVAL_MODE === "transcript";
}

function createLlmJudge(input: { runId?: string } = {}): BenchmarkLlmJudge {
  const panelMode = readJudgePanelMode();
  const panelMembers = readJudgePanelMembers(panelMode);
  const aggregation = readJudgeAggregationMode();
  const disagreementThreshold = readJudgeDisagreementThreshold();
  const panelConcurrency = resolveJudgePanelConcurrency(panelMode, panelMembers.length);

  return async ({ metric, taskCase, submission }) => {
    if (input.runId) assertBenchmarkRunActive(input.runId);
    const allowedScores = (metric.config?.rubricForm ?? [])
      .map((level) => level.score)
      .filter((score, index, scores) => scores.indexOf(score) === index)
      .sort((left, right) => left - right);
    const members = new Array<BenchmarkLlmJudgeMemberResult | undefined>(panelMembers.length);
    const progressMembers: BenchmarkJudgeProgressMember[] = panelMembers.map((member) => ({
      judgeId: member.judgeId,
      model: member.model,
      family: member.family,
      status: "pending",
    }));
    updateJudgeProgress(input.runId, {
      mode: panelMode,
      aggregation,
      caseId: taskCase.caseId,
      submissionId: submission.submissionId,
      metricKey: metric.metricKey,
      metricName: metric.displayName,
      members: progressMembers,
      activeJudgeId: panelMembers[0]?.judgeId,
    });
    await mapWithConcurrency(panelMembers, panelConcurrency, async (member, index) => {
      if (input.runId) assertBenchmarkRunActive(input.runId);
      progressMembers[index] = { ...progressMembers[index], status: "running" };
      updateJudgeProgress(input.runId, {
        mode: panelMode,
        aggregation,
        caseId: taskCase.caseId,
        submissionId: submission.submissionId,
        metricKey: metric.metricKey,
        metricName: metric.displayName,
        members: progressMembers,
        activeJudgeId: member.judgeId,
      });
      try {
        const raw = await requestSiliconFlowChatCompletion(
          [
            {
              role: "system",
              content: [
                "你是 Zeval benchmark 评测器，也是 Eval-Anything 风格 Judge Panel 的一个独立成员。",
                "请严格根据指标准则、参考依据、案例输入、期望标准和被测输出评分。",
                "不要迁就被测模型；如果证据不足，要降低分数和 confidence。",
                "如果该案例暴露 rubric 歧义、边界样本或需要人工复核，请在 labels 中加入对应标签。",
                allowedScores.length > 0
                  ? `score 必须且只能是以下离散档位之一：${allowedScores.join("、")}。`
                  : "score 必须落在 rubricForm 定义的离散档位上，禁止给出中间分。",
                "若给最高分，evidence 必须引用 transcript 中的具体片段。",
                "只返回 JSON，不要输出 Markdown。",
                '输出格式：{"score":离散档位,"passed":true,"labels":["missing_evidence"],"comment":"中文理由","evidence":["证据1"],"dimensions":{"criteria_fit":0-5,"evidence_grounding":0-5},"confidence":0-1}',
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
                  fewshotExamples: (metric.config?.rubricForm ?? []).flatMap((level) =>
                    (level.fewshot ?? []).map((excerpt) => ({
                      score: level.score,
                      label: level.label,
                      excerpt,
                    })),
                  ),
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
        if (input.runId) assertBenchmarkRunActive(input.runId);
        const parsedMember = parseJudgeMemberResult(
          raw,
          member,
          metric.scale.passThreshold,
          metric.config?.rubricForm,
          metric.scale,
        );
        members[index] = parsedMember;
        progressMembers[index] = { ...progressMembers[index], status: "completed", score: parsedMember.score };
        updateJudgeProgress(input.runId, {
          mode: panelMode,
          aggregation,
          caseId: taskCase.caseId,
          submissionId: submission.submissionId,
          metricKey: metric.metricKey,
          metricName: metric.displayName,
          members: progressMembers,
          activeJudgeId: panelMembers[index + 1]?.judgeId,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        progressMembers[index] = { ...progressMembers[index], status: "failed", error: message };
        updateJudgeProgress(input.runId, {
          mode: panelMode,
          aggregation,
          caseId: taskCase.caseId,
          submissionId: submission.submissionId,
          metricKey: metric.metricKey,
          metricName: metric.displayName,
          members: progressMembers,
          activeJudgeId: undefined,
        });
        throw error;
      }
    });

    const completedMembers = members.filter((member): member is BenchmarkLlmJudgeMemberResult => Boolean(member));

    const aggregated = aggregateJudgeMembers({
      members: completedMembers,
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
        memberCount: completedMembers.length,
        disagreement: aggregated.disagreement,
        disagreementThreshold,
        panelDisagree: aggregated.panelDisagree,
        members: completedMembers,
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

/**
 * Resolve how many benchmark submissions can be generated and evaluated concurrently.
 * This is the outer pipeline parallelism across cases/matrix cells.
 *
 * @returns Positive integer concurrency limit.
 */
function resolveBenchmarkSubmissionConcurrency(): number {
  return readPositiveIntegerEnv(["ZEVAL_BENCHMARK_SUBMISSION_CONCURRENCY"], 2);
}

/**
 * Resolve how many rubric metrics can be judged concurrently for one submission.
 * Falls back to a conservative default so local MVP runs speed up without flooding the provider.
 *
 * @returns Positive integer concurrency limit.
 */
function resolveBenchmarkMetricConcurrency(): number {
  return readPositiveIntegerEnv(["ZEVAL_BENCHMARK_METRIC_CONCURRENCY"], 2);
}

/**
 * Resolve how many judge panel members can run at the same time for one metric.
 * Single-judge mode always stays serial; panel mode is capped by member count.
 *
 * @param mode Judge mode for this run.
 * @param memberCount Number of configured judge members.
 * @returns Positive integer concurrency limit.
 */
function resolveJudgePanelConcurrency(mode: "single" | "panel", memberCount: number): number {
  if (mode !== "panel") return 1;
  return Math.min(memberCount, readPositiveIntegerEnv(["ZEVAL_JUDGE_PANEL_CONCURRENCY"], 2));
}

/**
 * Read a positive integer from the first matching environment key.
 *
 * @param keys Environment variable keys in priority order.
 * @param fallback Value used when no key contains a positive integer.
 * @returns Positive integer value.
 */
function readPositiveIntegerEnv(keys: string[], fallback: number): number {
  const raw = readZevalEnvValue(keys);
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  rubricForm: BenchmarkRubricScoreLevel[] | undefined,
  scale: BenchmarkScoringScale,
): BenchmarkLlmJudgeMemberResult {
  const parsed = parseRecord(raw);
  const rawScore = readNumber(parsed.score, scale.min);
  const score = snapScoreToRubricLevels(rawScore, rubricForm, scale);
  return {
    judgeId: member.judgeId,
    model: member.model,
    family: member.family,
    score,
    passed: score >= passThreshold,
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
  submissions: BenchmarkAgentSubmission[],
  matrix: BenchmarkMatrixCell[],
  cases: BenchmarkCase[],
  success: boolean,
  durationMs?: number,
): void {
  const submissionCounts = computeSubmissionProgressCounts(matrix, cases, submissions);
  benchmarkProgress.update(runId, submissionCounts);
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
