/**
 * @fileoverview Local HR resume-screening benchmark demo runner.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { approveRubricMetrics } from "@/benchmark/rubric";
import { buildBenchmarkDatasetCaseCandidates, persistBenchmarkDatasetCases } from "@/benchmark/case-admission";
import { runBenchmarkEvaluation } from "@/benchmark/runner";
import { createDatasetStore } from "@/eval-datasets/storage";
import type {
  AgentFrameworkId,
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkMatrixCell,
  BenchmarkRubricSet,
  BenchmarkRunResult,
  BenchmarkTaskPackage,
} from "@/benchmark/types";

const HR_DEMO_DIR = "examples/benchmarks/hr-resume-screening";
const DEFAULT_MATRIX: BenchmarkMatrixCell[] = [
  { agentFramework: "claude_code", model: "deepseek-v4-flash", enabled: true, timeoutMs: 600000, maxTurns: 30 },
  { agentFramework: "codex", model: "gpt-5.5", enabled: true, timeoutMs: 600000, maxTurns: 30 },
  { agentFramework: "hermes", model: "gpt-5.4-mini", enabled: true, timeoutMs: 600000, maxTurns: 30 },
  { agentFramework: "openclaw", model: "mimo-v2-flash", enabled: true, timeoutMs: 600000, maxTurns: 30 },
];

export type RunHrDemoBenchmarkInput = {
  approvedMetricKeys: string[];
  matrix?: BenchmarkMatrixCell[];
  persistCases?: boolean;
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
 * Run the local HR resume screening demo with deterministic mock submissions.
 * This validates the Benchmark Mode scoring and case admission path before
 * wiring real Agent adapters.
 */
export async function runHrDemoBenchmark(
  input: RunHrDemoBenchmarkInput,
): Promise<RunHrDemoBenchmarkResult> {
  const [rubric, cases] = await Promise.all([loadHrRubric(), loadHrCases()]);
  const approvedRubric = approveRubricMetrics(rubric, input.approvedMetricKeys);
  const task = buildTaskPackage(approvedRubric);
  const matrix = (input.matrix?.length ? input.matrix : DEFAULT_MATRIX).filter((item) => item.enabled);
  const runId = `benchmark_hr_demo_${Date.now()}`;
  const submissions = buildMockSubmissions(runId, task, cases, matrix);
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

function buildMockSubmissions(
  runId: string,
  task: BenchmarkTaskPackage,
  cases: BenchmarkCase[],
  matrix: BenchmarkMatrixCell[],
): BenchmarkAgentSubmission[] {
  const submissions: BenchmarkAgentSubmission[] = [];
  for (const matrixCell of matrix) {
    for (const taskCase of cases) {
      const parsedOutput = buildMockOutput(matrixCell.agentFramework, taskCase);
      const rawOutput = JSON.stringify(parsedOutput);
      submissions.push({
        submissionId: `${runId}_${matrixCell.agentFramework}_${slug(matrixCell.model)}_${taskCase.caseId}`,
        runId,
        benchmarkId: task.benchmarkId,
        taskId: task.taskId,
        caseId: taskCase.caseId,
        agentFramework: matrixCell.agentFramework,
        model: matrixCell.model,
        status: "completed",
        rawOutput,
        parsedOutput,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        durationMs: resolveMockDuration(matrixCell.agentFramework),
        artifacts: {
          evaluatorResults: {
            tool_call_success: {
              score: 5,
              reason: "No external tool was required for the fixture run.",
              evidence: [],
              confidence: 1,
            },
          },
        },
      });
    }
  }
  return submissions;
}

function buildMockOutput(
  agentFramework: AgentFrameworkId,
  taskCase: BenchmarkCase,
): Record<string, unknown> {
  const expectedDecision = String(taskCase.expected.decision ?? "reject");
  const shouldMiss = agentFramework === "openclaw" && taskCase.caseId === "hr_sample_002";
  const shouldOverReject = agentFramework === "hermes" && taskCase.caseId === "hr_sample_001";
  const decision = shouldMiss || shouldOverReject
    ? invertDecision(expectedDecision)
    : expectedDecision;

  return {
    decision,
    reason: decision === "select"
      ? "The candidate shows role-relevant experience and enough evidence for the requested responsibilities."
      : "The candidate lacks enough direct evidence for the core requirements in the job description.",
    evidence: extractEvidence(taskCase),
  };
}

function extractEvidence(taskCase: BenchmarkCase): string[] {
  const resume = String(taskCase.input.resume ?? "");
  const jobDescription = String(taskCase.input.job_description ?? "");
  return [
    resume.split(/[.;\n]/).find((part) => part.trim().length > 20)?.trim() ?? resume.slice(0, 120),
    jobDescription.split(/[.;\n]/).find((part) => part.trim().length > 20)?.trim() ?? jobDescription.slice(0, 120),
  ].filter(Boolean);
}

function invertDecision(decision: string): string {
  return decision === "select" ? "reject" : "select";
}

function resolveMockDuration(agentFramework: AgentFrameworkId): number {
  if (agentFramework === "claude_code") return 14000;
  if (agentFramework === "codex") return 18000;
  if (agentFramework === "hermes") return 11000;
  return 22000;
}

function slug(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase();
}
