/**
 * @fileoverview HR resume-screening benchmark with real-time progress streaming.
 *
 * This variant of runHrDemoBenchmark emits progress events so the frontend
 * can show a live dashboard while submissions are in flight.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { approveRubricMetrics } from "@/benchmark/rubric";
import { runBenchmarkEvaluation } from "@/benchmark/runner";
import { benchmarkProgress } from "@/benchmark/progress";
import { getHrAdapter } from "@/benchmark/adapters";
import { mapWithConcurrency } from "@/lib/concurrency";
import type {
  AgentFrameworkId,
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkMatrixCell,
  BenchmarkRunResult,
  BenchmarkTaskPackage,
} from "@/benchmark/types";
import type { AgentAdapterConfig } from "@/benchmark/adapters";

const HR_DEMO_DIR = "examples/benchmarks/hr-resume-screening";

export type RunHrDemoStreamingInput = {
  runId: string;
  approvedMetricKeys: string[];
  matrix?: BenchmarkMatrixCell[];
  persistCases?: boolean;
  apiKey?: string;
  baseUrl?: string;
};

export type RunHrDemoStreamingResult = {
  task: BenchmarkTaskPackage;
  result: BenchmarkRunResult;
};

const AVAILABLE_MODELS = [
  "deepseek-v4-flash",
  "gpt-5.4",
  "kimi-k2.5",
] as const;

const DEFAULT_MATRIX: BenchmarkMatrixCell[] = [
  "claude_code",
  "codex",
  "hermes",
  "openclaw",
  "zeval",
].flatMap((framework) =>
  AVAILABLE_MODELS.map((model) => ({
    agentFramework: framework as AgentFrameworkId,
    model,
    enabled: true,
    timeoutMs: 120000,
    maxTurns: 30,
  }))
);

/**
 * Run the HR benchmark with live progress tracking.
 */
export async function runHrDemoStreaming(
  input: RunHrDemoStreamingInput,
): Promise<RunHrDemoStreamingResult> {
  const [rubric, cases] = await Promise.all([loadHrRubric(), loadHrCases()]);
  const approvedRubric = approveRubricMetrics(rubric, input.approvedMetricKeys);
  const task = buildTaskPackage(approvedRubric);
  const matrix = (input.matrix?.length ? input.matrix : DEFAULT_MATRIX).filter((item) => item.enabled);

  const adapterConfig = buildAdapterConfig(input);

  // Initialize progress tracker
  const approvedMetrics = approvedRubric.modules.flatMap((m) => m.metrics);
  const totalMetrics = matrix.length * cases.length * approvedMetrics.length;
  benchmarkProgress.init(input.runId, matrix, cases.length);
  benchmarkProgress.update(input.runId, {
    phase: "submitting",
    totalMetrics,
  });

  // Run real agent submissions with controlled concurrency
  const submissions = await runRealAgentSubmissionsWithProgress({
    runId: input.runId,
    task,
    cases,
    matrix,
    adapterConfig,
  });

  // Evaluation phase
  benchmarkProgress.setPhase(input.runId, "evaluating");

  const result = await runBenchmarkEvaluation({
    runId: input.runId,
    task,
    cases,
    submissions,
    matrix,
    onMetricEvaluated: () => {
      const snap = benchmarkProgress.getSnapshot(input.runId);
      if (snap) {
        benchmarkProgress.update(input.runId, {
          evaluatedMetrics: snap.evaluatedMetrics + 1,
        });
      }
    },
  });

  benchmarkProgress.setResult(input.runId, result);

  return { task, result };
}

async function loadHrRubric() {
  const filePath = path.join(process.cwd(), HR_DEMO_DIR, "rubrics/hr-screening-rubric.json");
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function loadHrCases(): Promise<BenchmarkCase[]> {
  const filePath = path.join(process.cwd(), HR_DEMO_DIR, "data/sample-cases.jsonl");
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line) as BenchmarkCase);
}

function buildTaskPackage(rubric: unknown): BenchmarkTaskPackage {
  return {
    benchmarkId: "benchmark_hr_resume_screening",
    taskId: "hr_resume_screening_v1",
    version: "0.1.0",
    title: "HR Resume Screening",
    description: "Select or reject candidates from resume/JD evidence.",
    domain: "hr",
    requirementText: "Screen candidates using only role-relevant evidence from the job description and resume.",
    inputSchema: { required: ["job_description", "resume"] },
    outputSchema: { required: ["decision", "reason", "evidence"] },
    rubric: rubric as BenchmarkTaskPackage["rubric"],
  };
}

function buildAdapterConfig(input: { apiKey?: string; baseUrl?: string }): AgentAdapterConfig {
  const apiKey = input.apiKey ?? process.env.AGENT_API_KEY ?? process.env.ZEVAL_JUDGE_API_KEY ?? "";
  const baseUrl = input.baseUrl ?? process.env.AGENT_BASE_URL ?? "http://www.opcrouter.online/v1";
  return { apiKey, baseUrl, timeoutMs: 120000, maxRetries: 2 };
}

type SubmissionJob = { matrixCell: BenchmarkMatrixCell; taskCase: BenchmarkCase };

async function runRealAgentSubmissionsWithProgress(input: {
  runId: string;
  task: BenchmarkTaskPackage;
  cases: BenchmarkCase[];
  matrix: BenchmarkMatrixCell[];
  adapterConfig: AgentAdapterConfig;
}): Promise<BenchmarkAgentSubmission[]> {
  const jobs: SubmissionJob[] = [];
  for (const matrixCell of input.matrix) {
    for (const taskCase of input.cases) {
      jobs.push({ matrixCell, taskCase });
    }
  }

  const concurrency = Math.min(input.matrix[0]?.concurrency ?? 2, 2);
  const total = jobs.length;
  let completed = 0;
  let failed = 0;

  const updateMatrixProgress = (cell: BenchmarkMatrixCell, success: boolean) => {
    const snap = benchmarkProgress.getSnapshot(input.runId);
    if (!snap) return;
    const matrixProgress = snap.matrixProgress.map((row) => {
      if (row.agentFramework === cell.agentFramework && row.model === cell.model) {
        return {
          ...row,
          completed: row.completed + (success ? 1 : 0),
          failed: row.failed + (success ? 0 : 1),
        };
      }
      return row;
    });
    benchmarkProgress.update(input.runId, {
      matrixProgress,
      completedSubmissions: completed,
      failedSubmissions: failed,
    });
  };

  const results = await mapWithConcurrency(
    jobs,
    concurrency,
    async (job) => {
      const { matrixCell, taskCase } = job;
      const itemKey = `${matrixCell.agentFramework}/${matrixCell.model}/${taskCase.caseId}`;

      benchmarkProgress.addItem(input.runId, {
        agentFramework: matrixCell.agentFramework,
        model: matrixCell.model,
        caseId: taskCase.caseId,
        status: "running",
      });

      try {
        const adapter = getHrAdapter(matrixCell.agentFramework);
        const submission = await adapter.submit(
          taskCase,
          {
            runId: input.runId,
            benchmarkId: input.task.benchmarkId,
            taskId: input.task.taskId,
            matrixCell,
          },
          input.adapterConfig,
        );

        completed += 1;
        updateMatrixProgress(matrixCell, true);

        const decision = String(submission.parsedOutput?.decision ?? "unknown");
        benchmarkProgress.addItem(input.runId, {
          agentFramework: matrixCell.agentFramework,
          model: matrixCell.model,
          caseId: taskCase.caseId,
          status: "completed",
          durationMs: submission.durationMs,
          decision,
        });

        return submission;
      } catch (error) {
        failed += 1;
        completed += 1;
        updateMatrixProgress(matrixCell, false);

        const message = error instanceof Error ? error.message : String(error);
        benchmarkProgress.addItem(input.runId, {
          agentFramework: matrixCell.agentFramework,
          model: matrixCell.model,
          caseId: taskCase.caseId,
          status: "failed",
          error: message,
        });

        return buildFailedSubmission(input.runId, input.task, matrixCell, taskCase, message);
      }
    },
  );

  return results;
}

function buildFailedSubmission(
  runId: string,
  task: BenchmarkTaskPackage,
  matrixCell: BenchmarkMatrixCell,
  taskCase: BenchmarkCase,
  error: string,
): BenchmarkAgentSubmission {
  return {
    submissionId: `${runId}_${matrixCell.agentFramework}_${slug(matrixCell.model)}_${taskCase.caseId}`,
    runId,
    benchmarkId: task.benchmarkId,
    taskId: task.taskId,
    caseId: taskCase.caseId,
    agentFramework: matrixCell.agentFramework,
    model: matrixCell.model,
    status: "failed",
    rawOutput: "",
    error,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 0,
    artifacts: {},
  };
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}
