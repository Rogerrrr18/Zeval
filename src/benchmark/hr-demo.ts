/**
 * @fileoverview HR resume-screening benchmark with real agent adapters.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { approveRubricMetrics } from "@/benchmark/rubric";
import { buildBenchmarkDatasetCaseCandidates, persistBenchmarkDatasetCases } from "@/benchmark/case-admission";
import { runBenchmarkEvaluation } from "@/benchmark/runner";
import { createDatasetStore } from "@/eval-datasets/storage";
import { getHrAdapter } from "@/benchmark/adapters";
import { mapWithConcurrency } from "@/lib/concurrency";
import type {
  AgentFrameworkId,
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkMatrixCell,
  BenchmarkRubricSet,
  BenchmarkRunResult,
  BenchmarkTaskPackage,
} from "@/benchmark/types";
import type { AgentAdapterConfig } from "@/benchmark/adapters";

const HR_DEMO_DIR = "examples/benchmarks/hr-resume-screening";
const AVAILABLE_MODELS = [
  "deepseek-v4-flash",
  "gpt-5.4",
  "mimo-v2-flash",
  "kimi-k2.5",
] as const;

const DEFAULT_MATRIX: BenchmarkMatrixCell[] = [
  "claude_code",
  "codex",
  "hermes",
  "openclaw",
].flatMap((framework) =>
  AVAILABLE_MODELS.map((model) => ({
    agentFramework: framework as AgentFrameworkId,
    model,
    enabled: true,
    timeoutMs: 120000,
    maxTurns: 30,
  }))
);

export type RunHrDemoBenchmarkInput = {
  approvedMetricKeys: string[];
  matrix?: BenchmarkMatrixCell[];
  persistCases?: boolean;
  /** Override API key for agent calls (defaults to AGENT_API_KEY env). */
  apiKey?: string;
  /** Override base URL for agent calls (defaults to AGENT_BASE_URL env). */
  baseUrl?: string;
};

export type RunHrDemoBenchmarkResult = {
  task: BenchmarkTaskPackage;
  result: BenchmarkRunResult;
  caseAdmission?: {
    candidateCount: number;
    createdCaseIds: string[];
    skippedDuplicates: number;
  };
};

/**
 * Run the HR resume screening benchmark with REAL agent adapters.
 *
 * Each enabled agent framework in the matrix is called via the
 * OpenAI-compatible API endpoint. No mock submissions are used.
 */
export async function runHrDemoBenchmark(
  input: RunHrDemoBenchmarkInput,
): Promise<RunHrDemoBenchmarkResult> {
  const [rubric, cases] = await Promise.all([loadHrRubric(), loadHrCases()]);
  const approvedRubric = approveRubricMetrics(rubric, input.approvedMetricKeys);
  const task = buildTaskPackage(approvedRubric);
  const matrix = (input.matrix?.length ? input.matrix : DEFAULT_MATRIX).filter((item) => item.enabled);
  const runId = `benchmark_hr_demo_${Date.now()}`;

  const adapterConfig = buildAdapterConfig(input);

  // Run real agent submissions with controlled concurrency
  const submissions = await runRealAgentSubmissions({
    runId,
    task,
    cases,
    matrix,
    adapterConfig,
  });

  const result = await runBenchmarkEvaluation({
    runId,
    task,
    cases,
    submissions,
    matrix,
  });

  if (!input.persistCases) {
    return { task, result };
  }

  const candidates = buildBenchmarkDatasetCaseCandidates(result);
  const store = createDatasetStore();
  const persisted = await persistBenchmarkDatasetCases(store, candidates, "hr-demo");
  return {
    task,
    result,
    caseAdmission: {
      candidateCount: candidates.length,
      createdCaseIds: persisted.createdCaseIds,
      skippedDuplicates: persisted.skippedDuplicates,
    },
  };
}

async function loadHrRubric(): Promise<BenchmarkRubricSet> {
  const filePath = path.join(process.cwd(), HR_DEMO_DIR, "rubrics/hr-screening-rubric.json");
  return JSON.parse(await readFile(filePath, "utf8")) as BenchmarkRubricSet;
}

async function loadHrCases(): Promise<BenchmarkCase[]> {
  const filePath = path.join(process.cwd(), HR_DEMO_DIR, "data/sample-cases.jsonl");
  const lines = (await readFile(filePath, "utf8"))
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.map((line) => JSON.parse(line) as BenchmarkCase);
}

function buildTaskPackage(rubric: BenchmarkRubricSet): BenchmarkTaskPackage {
  return {
    benchmarkId: "benchmark_hr_resume_screening",
    taskId: "hr_resume_screening_v1",
    version: "0.1.0",
    title: "HR Resume Screening",
    description: "Select or reject candidates from resume/JD evidence.",
    domain: "hr",
    requirementText: "Screen candidates using only role-relevant evidence from the job description and resume.",
    inputSchema: {
      required: ["job_description", "resume"],
    },
    outputSchema: {
      required: ["decision", "reason", "evidence"],
    },
    rubric,
  };
}

function buildAdapterConfig(input: RunHrDemoBenchmarkInput): AgentAdapterConfig {
  const apiKey = input.apiKey ?? process.env.AGENT_API_KEY ?? process.env.ZEVAL_JUDGE_API_KEY ?? "";
  const baseUrl = input.baseUrl ?? process.env.AGENT_BASE_URL ?? "http://www.opcrouter.online/v1";
  return {
    apiKey,
    baseUrl,
    timeoutMs: 120000,
    maxRetries: 2,
  };
}

type SubmissionJob = {
  matrixCell: BenchmarkMatrixCell;
  taskCase: BenchmarkCase;
};

async function runRealAgentSubmissions(input: {
  runId: string;
  task: BenchmarkTaskPackage;
  cases: BenchmarkCase[];
  matrix: BenchmarkMatrixCell[];
  adapterConfig: AgentAdapterConfig;
}): Promise<BenchmarkAgentSubmission[]> {
  // Build all jobs
  const jobs: SubmissionJob[] = [];
  for (const matrixCell of input.matrix) {
    for (const taskCase of input.cases) {
      jobs.push({ matrixCell, taskCase });
    }
  }

  // Use concurrency limit from first matrix cell or default
  const concurrency = input.matrix[0]?.concurrency ?? 2;

  console.info(`[hr-demo] Running ${jobs.length} real agent submissions with concurrency=${concurrency}`);

  const results = await mapWithConcurrency(
    jobs,
    concurrency,
    async (job) => {
      const { matrixCell, taskCase } = job;
      try {
        const adapter = getHrAdapter(matrixCell.agentFramework);
        const submission = await adapter.submit(taskCase, {
          runId: input.runId,
          benchmarkId: input.task.benchmarkId,
          taskId: input.task.taskId,
          matrixCell,
        }, input.adapterConfig);
        console.info(`[hr-demo] ✓ ${matrixCell.agentFramework}/${matrixCell.model} case=${taskCase.caseId} decision=${String(submission.parsedOutput?.decision ?? "unknown")}`);
        return submission;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[hr-demo] ✗ ${matrixCell.agentFramework}/${matrixCell.model} case=${taskCase.caseId} error=${message}`);
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
