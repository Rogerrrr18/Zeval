/**
 * @fileoverview Small generic benchmark run for the notebook workspace.
 */

import { approveRubricMetrics } from "@/benchmark/rubric";
import { runBenchmarkEvaluation } from "@/benchmark/runner";
import { benchmarkProgress } from "@/benchmark/progress";
import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkLlmJudge,
  BenchmarkMetricEvaluationResult,
  BenchmarkMatrixCell,
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
  const task = buildTaskPackage(input.requirementText, rubric);
  const cases = buildCasesFromDataset(task, input.dataset);
  const matrix = DEFAULT_MATRIX;
  const totalMetrics = cases.length * matrix.length * approvedMetricKeys.length;

  benchmarkProgress.init(input.runId, matrix, cases.length);
  benchmarkProgress.update(input.runId, {
    phase: "building_cases",
    totalMetrics,
    activeAnalysis: "正在按 session 切分评测案例，并将每个会话转成包含输入、期望验收标准和上下文证据的 benchmark case。",
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

  const submissions = await buildSubmissions({
    runId: input.runId,
    task,
    cases,
    matrix,
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
    onMetricEvaluated: (metricResult) => {
      const snap = benchmarkProgress.getSnapshot(input.runId);
      if (!snap) return;
      benchmarkProgress.update(input.runId, {
        evaluatedMetrics: snap.evaluatedMetrics + 1,
      });
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
  return { task, result };
}

const MAX_DATASET_CASES = 8;

function buildTaskPackage(requirementText: string, rubric: BenchmarkRubricSet): BenchmarkTaskPackage {
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
}): Promise<BenchmarkAgentSubmission[]> {
  const submissions: BenchmarkAgentSubmission[] = [];

  for (const matrixCell of input.matrix) {
    for (const taskCase of input.cases) {
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
  return async ({ metric, taskCase, submission }) => {
    const raw = await requestSiliconFlowChatCompletion(
      [
        {
          role: "system",
          content: [
            "你是 Zeval benchmark 评测器。",
            "请严格根据指标准则、案例输入、期望标准和被测输出评分。",
            "只返回 JSON，不要输出 Markdown。",
            '输出格式：{"score":0-5,"reason":"中文理由","evidence":["证据1"],"confidence":0-1}',
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            metric: {
              name: metric.displayName,
              description: metric.description,
              criteria: metric.config?.criteria,
              rubricForm: metric.config?.rubricForm,
              scale: metric.scale,
            },
            caseInput: taskCase.input,
            expected: taskCase.expected,
            submission: submission.parsedOutput ?? submission.rawOutput,
          }, null, 2),
        },
      ],
      { stage: "benchmark_generic_llm_judge", temperature: 0.1, seed: 42 },
    );
    const parsed = parseRecord(raw);
    return {
      score: readNumber(parsed.score, metric.scale.min),
      reason: typeof parsed.reason === "string" ? parsed.reason : "模型评审未返回理由。",
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 5) : [],
      confidence: readNumber(parsed.confidence, 0.6),
    };
  };
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
