/**
 * @fileoverview Convert Benchmark Mode results into Zeval dataset cases.
 */

import { randomBytes } from "node:crypto";
import { computeNormalizedTranscriptHash } from "@/eval-datasets/case-transcript-hash";
import type { DatasetStore } from "@/eval-datasets/storage/dataset-store";
import type { DatasetCaseRecord } from "@/eval-datasets/storage/types";
import type {
  BenchmarkDatasetCaseCandidate,
  BenchmarkMetricEvaluationResult,
  BenchmarkRunResult,
} from "@/benchmark/types";

export type BuildBenchmarkCaseCandidatesOptions = {
  badcaseThreshold?: number;
  goldencaseThreshold?: number;
};

export type PersistBenchmarkCasesResult = {
  createdCaseIds: string[];
  skippedDuplicates: number;
};

/**
 * Build badcase/goldencase candidates from metric-level benchmark results.
 */
export function buildBenchmarkDatasetCaseCandidates(
  runResult: BenchmarkRunResult,
  options: BuildBenchmarkCaseCandidatesOptions = {},
): BenchmarkDatasetCaseCandidate[] {
  const badcaseThreshold = options.badcaseThreshold ?? 60;
  const goldencaseThreshold = options.goldencaseThreshold ?? 90;
  const candidates: BenchmarkDatasetCaseCandidate[] = [];

  for (const result of runResult.metricResults) {
    if (result.status === "skipped" || result.status === "unsupported") {
      continue;
    }
    if (result.normalizedScore < badcaseThreshold) {
      candidates.push(buildCandidate(runResult, result, "badcase"));
    } else if (result.normalizedScore >= goldencaseThreshold) {
      candidates.push(buildCandidate(runResult, result, "goodcase"));
    }
  }

  return candidates;
}

/**
 * Persist benchmark candidates into the existing Zeval dataset store.
 */
export async function persistBenchmarkDatasetCases(
  store: DatasetStore,
  candidates: BenchmarkDatasetCaseCandidate[],
  baselineVersion: string,
): Promise<PersistBenchmarkCasesResult> {
  const createdCaseIds: string[] = [];
  let skippedDuplicates = 0;

  for (const candidate of candidates) {
    const normalizedTranscriptHash = computeNormalizedTranscriptHash(candidate.transcript);
    const duplicate = await store.checkDuplicate({
      normalizedTranscriptHash,
      topicLabel: candidate.metricKey,
      baselineCaseScore: candidate.score / 100,
    });
    if (duplicate.isDuplicate && duplicate.reason === "exact_hash") {
      skippedDuplicates += 1;
      continue;
    }

    const now = new Date().toISOString();
    const caseId = allocateDatasetCaseId(candidate.caseSetType);
    const record: DatasetCaseRecord = {
      caseId,
      caseSetType: candidate.caseSetType,
      source: candidate.source,
      sessionId: candidate.caseId,
      topicSegmentId: `${candidate.taskId}:${candidate.metricKey}`,
      topicLabel: candidate.metricKey,
      topicSummary: candidate.reason,
      normalizedTranscriptHash,
      duplicateGroupKey: `${candidate.taskId}:${candidate.metricKey}:${candidate.capability}`,
      baselineVersion,
      baselineCaseScore: candidate.score / 100,
      tags: candidate.tags,
      title: `${candidate.capability} / ${candidate.metricKey}`,
      transcript: candidate.transcript,
      suggestedAction: candidate.caseSetType === "badcase"
        ? "Inspect the failed metric, compare against the gold case, and tune the agent framework/model configuration."
        : "Use this case as a regression guard for future benchmark runs.",
      reviewStatus: "auto_captured",
      capabilityDimension: candidate.capability,
      sourceRunId: candidate.metadata.runId as string | undefined,
      harvestedAt: now,
      failureSeverityScore: candidate.caseSetType === "badcase" ? round4(1 - candidate.score / 100) : 0,
      autoSignals: [
        {
          kind: "benchmark_metric",
          metricKey: candidate.metricKey,
          capability: candidate.capability,
          score: candidate.score,
          agentFramework: candidate.agentFramework,
          model: candidate.model,
        },
      ],
      metadata: candidate.metadata,
      createdAt: now,
      updatedAt: now,
    };

    await store.createCase(record);
    createdCaseIds.push(caseId);
  }

  return { createdCaseIds, skippedDuplicates };
}

function buildCandidate(
  runResult: BenchmarkRunResult,
  result: BenchmarkMetricEvaluationResult,
  caseSetType: "badcase" | "goodcase",
): BenchmarkDatasetCaseCandidate {
  const benchmarkCase = runResult.cases.find((item) => item.caseId === result.caseId);
  const submission = runResult.submissions.find((item) => item.submissionId === result.submissionId);
  const source = resolveCandidateSource(result, caseSetType);
  const transcript = [
    `benchmark=${result.benchmarkId}`,
    `task=${result.taskId}`,
    `case=${result.caseId}`,
    `agent=${result.agentFramework}`,
    `model=${result.model}`,
    "",
    "INPUT",
    JSON.stringify(benchmarkCase?.input ?? {}, null, 2),
    "",
    "EXPECTED",
    JSON.stringify(result.expected ?? benchmarkCase?.expected ?? {}, null, 2),
    "",
    "ACTUAL",
    JSON.stringify(result.actual ?? submission?.rawOutput ?? "", null, 2),
    "",
    "EVIDENCE",
    result.evidence.join("\n"),
  ].join("\n");

  return {
    caseSetType,
    source,
    benchmarkId: result.benchmarkId,
    taskId: result.taskId,
    caseId: result.caseId,
    submissionId: result.submissionId,
    agentFramework: result.agentFramework,
    model: result.model,
    metricKey: result.metricKey,
    capability: result.capability,
    score: result.normalizedScore,
    evidence: result.evidence,
    reason: result.reason,
    transcript,
    tags: [
      `benchmark:${result.benchmarkId}`,
      `task:${result.taskId}`,
      `metric:${result.metricKey}`,
      `capability:${result.capability}`,
      `agent:${result.agentFramework}`,
      `model:${result.model}`,
      ...result.failureTags,
    ],
    metadata: {
      runId: result.runId,
      benchmarkId: result.benchmarkId,
      taskId: result.taskId,
      benchmarkCaseId: result.caseId,
      submissionId: result.submissionId,
      metricKey: result.metricKey,
      capability: result.capability,
      evaluatorType: result.evaluatorType,
      score: result.score,
      normalizedScore: result.normalizedScore,
      passed: result.passed,
      needsHumanReview: result.needsHumanReview,
      status: result.status,
      humanLabel: result.humanLabel,
    },
  };
}

function resolveCandidateSource(
  result: BenchmarkMetricEvaluationResult,
  caseSetType: "badcase" | "goodcase",
): BenchmarkDatasetCaseCandidate["source"] {
  if (result.status === "needs_human_review" || result.needsHumanReview) {
    return "auto_uncertainty";
  }
  if (result.humanLabel && result.humanLabel.passed !== result.passed) {
    return "auto_disagreement";
  }
  if (caseSetType === "goodcase" && result.humanLabel?.passed) {
    return "manual_gold";
  }
  return caseSetType === "badcase" ? "auto_tp" : "auto_tn";
}

function allocateDatasetCaseId(caseSetType: "badcase" | "goodcase"): string {
  const prefix = caseSetType === "badcase" ? "benchmark_bc" : "benchmark_gc";
  return `${prefix}_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
