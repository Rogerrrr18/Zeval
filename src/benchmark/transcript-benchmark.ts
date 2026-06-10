/**
 * @fileoverview Shared helpers for transcript-mode benchmark runs.
 */

import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkMatrixCell,
  BenchmarkRubricSet,
  BenchmarkTaskPackage,
} from "@/benchmark/types";
import type { RawChatlogRow } from "@/types/pipeline";

const DEFAULT_MAX_DATASET_CASES = 8;

/**
 * Resolve the session cap for benchmark case building.
 *
 * @returns Max sessions per run from `ZEVAL_BENCHMARK_MAX_CASES` or default 8.
 */
export function getMaxDatasetCases(): number {
  const configured = Number(process.env.ZEVAL_BENCHMARK_MAX_CASES ?? DEFAULT_MAX_DATASET_CASES);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_DATASET_CASES;
}

/**
 * Build a runnable task package from requirement text and rubric.
 *
 * @param requirementText Business requirement for the benchmark task.
 * @param rubric Approved rubric set.
 * @returns Task package used by the benchmark runner.
 */
export function buildBenchmarkTaskPackage(
  requirementText: string,
  rubric: BenchmarkRubricSet,
): BenchmarkTaskPackage {
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
 * Group normalized chat rows by session id while preserving upload order.
 *
 * @param rows Ingested raw chatlog rows.
 * @returns Map keyed by session id.
 */
export function groupRowsBySession(rows: RawChatlogRow[]): Map<string, RawChatlogRow[]> {
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
export function formatTranscriptRow(row: RawChatlogRow): string {
  const time = row.timestamp ? `[${row.timestamp}] ` : "";
  const role = row.role === "assistant" ? "助手" : row.role === "user" ? "用户" : "系统";
  return `${time}${role}: ${row.content}`;
}

/**
 * Build session-level benchmark cases from normalized rows.
 *
 * @param task Runnable benchmark task package.
 * @param rows Normalized chat rows.
 * @param sourceFileName Uploaded file name for metadata.
 * @param maxCases Optional session cap override.
 * @returns Benchmark cases capped for runtime control.
 */
export function buildCasesFromRawRows(
  task: BenchmarkTaskPackage,
  rows: RawChatlogRow[],
  sourceFileName: string,
  maxCases = getMaxDatasetCases(),
): BenchmarkCase[] {
  const groupedRows = groupRowsBySession(rows);
  const acceptanceCriteria = task.rubric.modules.flatMap((module) =>
    module.metrics.map((metric) => ({
      metric: metric.displayName,
      criteria: metric.config?.criteria ?? metric.description,
      rubricForm: metric.config?.rubricForm ?? [],
      references: metric.config?.references ?? [],
    })),
  );

  return [...groupedRows.entries()].slice(0, maxCases).map(([sessionId, sessionRows], index) => ({
    caseId: `${task.taskId}_case_${String(index + 1).padStart(3, "0")}`,
    taskId: task.taskId,
    input: {
      requirement: task.requirementText,
      sessionId,
      transcript: sessionRows.map(formatTranscriptRow).join("\n"),
      messageCount: sessionRows.length,
      sourceFileName,
    },
    expected: {
      requirement: task.requirementText,
      acceptanceCriteria,
      sourceSummary: {
        sessionId,
        messageCount: sessionRows.length,
        hasTimestamp: sessionRows.every((row) => Boolean(row.timestamp)),
      },
    },
    source: "imported",
    metadata: {
      sourceFileName,
      sourceFormat: "csv",
      originalSessionId: sessionId,
      sampled: groupedRows.size > maxCases,
    },
  }));
}

/**
 * Build a transcript-mode submission that evaluates historical assistant turns.
 *
 * @param input Submission build context.
 * @returns Completed submission without calling the agent model.
 */
export function buildTranscriptSubmission(input: {
  runId: string;
  task: BenchmarkTaskPackage;
  matrixCell: BenchmarkMatrixCell;
  taskCase: BenchmarkCase;
  startedAt?: string;
  startedMs?: number;
}): BenchmarkAgentSubmission {
  const startedAt = input.startedAt ?? new Date().toISOString();
  const startedMs = input.startedMs ?? Date.now();
  const transcript = String(input.taskCase.input.transcript ?? "");
  const assistantLines = transcript
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("助手:"));
  const evidence = assistantLines.slice(0, 5);
  const parsedOutput = {
    answer: assistantLines.join("\n") || transcript,
    evidence,
    evalMode: "transcript",
    notes: "Evaluated from historical assistant transcript; no secondary agent generation.",
  };

  return {
    submissionId: `${input.runId}_${input.matrixCell.agentFramework}_${input.taskCase.caseId}`,
    runId: input.runId,
    benchmarkId: input.task.benchmarkId,
    taskId: input.task.taskId,
    caseId: input.taskCase.caseId,
    agentFramework: input.matrixCell.agentFramework,
    model: input.matrixCell.model,
    status: "completed",
    rawOutput: JSON.stringify(parsedOutput),
    parsedOutput,
    startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - startedMs,
    artifacts: {},
  };
}

/**
 * Classify a companion autofind session id as positive or negative.
 *
 * @param sessionId Original session id from the dataset.
 * @returns `pos`, `neg`, or `unknown`.
 */
export function classifyCompanionSession(sessionId: string): "pos" | "neg" | "unknown" {
  if (sessionId.startsWith("companion_pos_")) return "pos";
  if (sessionId.startsWith("companion_neg_")) return "neg";
  return "unknown";
}
