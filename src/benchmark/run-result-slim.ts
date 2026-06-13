/**
 * @fileoverview Trim heavy benchmark run payloads before API transport or disk persistence.
 */

import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkMetricEvaluationResult,
  BenchmarkRunResult,
} from "@/benchmark/types";

const MAX_EVIDENCE_ITEMS = 4;
const MAX_EVIDENCE_CHARS = 480;
const MAX_TRANSCRIPT_CHARS = 6000;
const MAX_RAW_OUTPUT_CHARS = 4000;

/**
 * Slim one metric evaluation result by dropping judge traces and truncating evidence.
 *
 * @param result Full metric evaluation result.
 * @returns Lightweight copy safe for session persistence.
 */
export function slimMetricEvaluationResult(
  result: BenchmarkMetricEvaluationResult,
): BenchmarkMetricEvaluationResult {
  return {
    ...result,
    evidence: result.evidence
      .slice(0, MAX_EVIDENCE_ITEMS)
      .map((item) => truncateText(item, MAX_EVIDENCE_CHARS)),
    judge: result.judge
      ? {
          ...result.judge,
          members: result.judge.members.slice(0, 2).map((member) => ({
            ...member,
            comment: truncateText(member.comment, 240),
          })),
        }
      : undefined,
    reason: truncateText(result.reason, 1200),
  };
}

/**
 * Slim benchmark case input, mainly truncating long transcripts.
 *
 * @param benchmarkCase Source benchmark case.
 * @returns Case copy with bounded transcript size.
 */
export function slimBenchmarkCase(benchmarkCase: BenchmarkCase): BenchmarkCase {
  const input = benchmarkCase.input ?? {};
  const transcript = typeof input.transcript === "string" ? input.transcript : undefined;
  if (!transcript || transcript.length <= MAX_TRANSCRIPT_CHARS) {
    return benchmarkCase;
  }
  return {
    ...benchmarkCase,
    input: {
      ...input,
      transcript: `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n…[transcript truncated for persistence]`,
    },
  };
}

/**
 * Slim submission raw output for persistence.
 *
 * @param submission Benchmark submission record.
 * @returns Submission with bounded raw output.
 */
export function slimBenchmarkSubmission(submission: BenchmarkAgentSubmission): BenchmarkAgentSubmission {
  if (typeof submission.rawOutput !== "string" || submission.rawOutput.length <= MAX_RAW_OUTPUT_CHARS) {
    return submission;
  }
  return {
    ...submission,
    rawOutput: `${submission.rawOutput.slice(0, MAX_RAW_OUTPUT_CHARS)}\n…[output truncated for persistence]`,
  };
}

/**
 * Slim a full benchmark run result for session sync or admit-cases transport.
 *
 * @param runResult Source run result.
 * @returns Reduced payload that keeps UI + admission logic usable.
 */
export function slimBenchmarkRunResult(runResult: BenchmarkRunResult): BenchmarkRunResult {
  return {
    ...runResult,
    metricResults: runResult.metricResults.map(slimMetricEvaluationResult),
    cases: runResult.cases.map(slimBenchmarkCase),
    submissions: runResult.submissions.map(slimBenchmarkSubmission),
  };
}

/**
 * Build a minimal run result containing only rows needed for one admit batch.
 *
 * @param runResult Full benchmark run result.
 * @param submissionId Target session submission id.
 * @param metricKeys Metric keys included in the admit batch.
 * @returns Subset run result for admit-cases API.
 */
export function subsetRunResultForAdmit(
  runResult: BenchmarkRunResult,
  submissionId: string,
  metricKeys: Set<string>,
): BenchmarkRunResult {
  const metricResults = runResult.metricResults.filter(
    (result) => result.submissionId === submissionId && metricKeys.has(result.metricKey),
  );
  const caseIds = new Set(metricResults.map((result) => result.caseId));
  return slimBenchmarkRunResult({
    ...runResult,
    metricResults,
    cases: runResult.cases.filter((item) => caseIds.has(item.caseId)),
    submissions: runResult.submissions.filter((item) => item.submissionId === submissionId),
    caseScores: runResult.caseScores.filter((item) => item.submissionId === submissionId),
  });
}

/**
 * @param value Source string.
 * @param maxLength Maximum preserved length.
 * @returns Truncated string.
 */
function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}…`;
}
