/**
 * @fileoverview Convert Benchmark Mode results into Zeval dataset cases.
 */

import { randomBytes } from "node:crypto";
import { computeNormalizedTranscriptHash } from "@/eval-datasets/case-transcript-hash";
import type { DatasetStore } from "@/eval-datasets/storage/dataset-store";
import type { DatasetCaseRecord, DatasetCaseHumanVerdict, DatasetCaseReviewStatus } from "@/eval-datasets/storage/types";
import { capabilityToAdmissionChannel, extractAdmissionFeatures } from "@/benchmark/admission-feature-extractor";
import type { AdmissionPolicy } from "@/benchmark/admission-policy-types";
import { scoreAdmission } from "@/benchmark/admission-scorer";
import type {
  BenchmarkCaseRerank,
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
  admittedCases: Array<{
    caseId: string;
    source: NonNullable<DatasetCaseRecord["source"]>;
    caseSetType: DatasetCaseRecord["caseSetType"];
    reviewStatus: DatasetCaseReviewStatus;
    metricKey: string;
    benchmarkCaseId: string;
    decision?: BenchmarkHumanReviewDecision;
  }>;
};

export type BenchmarkHumanReviewDecision = "accepted" | "rejected" | "needs_evidence";

export type BenchmarkHumanReviewInput = {
  submissionId: string;
  metricKey: string;
  decision: BenchmarkHumanReviewDecision;
  /** Reviewer-selected admission channel (see `admission-channels.ts`). */
  channel?: string;
  reviewer?: string;
  note?: string;
  reviewedAt?: string;
};

type BenchmarkDatasetCaseCandidateWithReview = BenchmarkDatasetCaseCandidate & {
  humanDecision?: BenchmarkHumanReviewDecision;
  humanVerdict?: DatasetCaseHumanVerdict;
  reviewer?: string;
  reviewNotes?: string;
  reviewStatus?: DatasetCaseReviewStatus;
};

/**
 * Build badcase/goldencase candidates from metric-level benchmark results.
 */
/**
 * Attach static policy suggestions to benchmark dataset candidates.
 *
 * @param candidates Dataset candidates built from a benchmark run.
 * @param runResult Source benchmark run with metric results and optional rerank.
 * @param policy Learned admission policy; when null suggestions are omitted.
 * @returns Candidates enriched with `metadata.policySuggestion`.
 */
export function attachPolicySuggestionsToCandidates(
  candidates: BenchmarkDatasetCaseCandidate[],
  runResult: BenchmarkRunResult,
  policy: AdmissionPolicy | null,
): BenchmarkDatasetCaseCandidate[] {
  if (!policy) return candidates;

  const rerankBySubmissionId = new Map<string, BenchmarkCaseRerank>();
  for (const caseScore of runResult.caseScores) {
    if (caseScore.rerank) {
      rerankBySubmissionId.set(caseScore.submissionId, caseScore.rerank);
    }
  }

  const sessionIdByCaseId = new Map(
    runResult.cases.map((benchmarkCase) => [
      benchmarkCase.caseId,
      String(benchmarkCase.input.sessionId ?? benchmarkCase.caseId),
    ]),
  );
  const features = extractAdmissionFeatures(
    runResult.metricResults,
    rerankBySubmissionId,
    sessionIdByCaseId,
  );
  const featureByKey = new Map(
    features.map((feature) => [`${feature.caseId}::${feature.metricKey}`, feature]),
  );

  return candidates.map((candidate) => {
    const feature = featureByKey.get(`${candidate.caseId}::${candidate.metricKey}`);
    const channel = capabilityToAdmissionChannel(candidate.capability);
    const channelPolicy = policy.channels[channel];
    if (!feature || !channelPolicy) {
      return candidate;
    }

    const suggestion = scoreAdmission(feature, channelPolicy);
    return {
      ...candidate,
      metadata: {
        ...candidate.metadata,
        policySuggestion: {
          decision: suggestion.decision,
          channel,
          matchedAcceptRules: suggestion.matchedAcceptRules,
          matchedRejectRules: suggestion.matchedRejectRules,
          matchedUncertaintyRules: suggestion.matchedUncertaintyRules,
        },
      },
    };
  });
}

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
 * Build dataset candidates from explicit human review decisions in the
 * Benchmark Notebook. These decisions are the bridge from metric-level
 * evaluation into Zeval's admission channels.
 */
export function buildBenchmarkDatasetCaseCandidatesFromReviews(
  runResult: BenchmarkRunResult,
  reviews: BenchmarkHumanReviewInput[],
): BenchmarkDatasetCaseCandidate[] {
  const byKey = new Map(runResult.metricResults.map((result) => [metricResultKey(result), result]));
  const candidates: BenchmarkDatasetCaseCandidateWithReview[] = [];

  for (const review of reviews) {
    const result = byKey.get(metricResultKey(review));
    if (!result || result.status === "skipped" || result.status === "unsupported") {
      continue;
    }

    const humanPassed = inferHumanPassed(result, review.decision);
    const reviewedAt = review.reviewedAt ?? new Date().toISOString();
    const reviewedResult: BenchmarkMetricEvaluationResult = {
      ...result,
      humanLabel: {
        score: humanPassed ? Math.max(result.score, result.normalizedScore) : Math.min(result.score, result.normalizedScore),
        passed: humanPassed,
        reason: humanReviewDecisionReason(review.decision, result),
        evidence: review.note?.trim() || result.evidence[0],
        reviewer: review.reviewer?.trim() || "benchmark-reviewer",
        labeledAt: reviewedAt,
      },
      needsHumanReview: review.decision === "needs_evidence",
      status: review.decision === "needs_evidence" ? "needs_human_review" : "scored",
    };
    const admission = resolveHumanReviewAdmission(result, review.decision);
    const baseCandidate = buildCandidate(runResult, reviewedResult, admission.caseSetType);

    candidates.push({
      ...baseCandidate,
      source: admission.source,
      humanDecision: review.decision,
      humanVerdict: admission.humanVerdict,
      reviewer: review.reviewer?.trim() || "benchmark-reviewer",
      reviewNotes: review.note?.trim(),
      reviewStatus: admission.reviewStatus,
      metadata: {
        ...baseCandidate.metadata,
        humanReviewDecision: review.decision,
        humanReviewChannel: review.channel,
        humanReviewNote: review.note?.trim(),
        humanReviewedAt: reviewedAt,
        humanReviewer: review.reviewer?.trim() || "benchmark-reviewer",
        humanReviewRequired: review.decision === "needs_evidence",
        ...(admission.source === "manual_fp" ? { false_positive: true } : {}),
      },
    });
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
  const admittedCases: PersistBenchmarkCasesResult["admittedCases"] = [];
  let skippedDuplicates = 0;

  for (const candidate of candidates) {
    const reviewedCandidate = candidate as BenchmarkDatasetCaseCandidateWithReview;
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
    const reviewStatus = reviewedCandidate.reviewStatus ?? "auto_captured";
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
      humanVerdict: reviewedCandidate.humanVerdict,
      reviewNotes: reviewedCandidate.reviewNotes,
      reviewer: reviewedCandidate.reviewer,
      reviewedAt: reviewedCandidate.humanDecision && reviewedCandidate.humanDecision !== "needs_evidence" ? now : undefined,
      reviewStatus,
      manualOverrides: candidate.source === "manual_fp"
        ? [{ type: "false_positive", note: reviewedCandidate.reviewNotes, createdAt: now }]
        : undefined,
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
    admittedCases.push({
      caseId,
      source: candidate.source,
      caseSetType: candidate.caseSetType,
      reviewStatus,
      metricKey: candidate.metricKey,
      benchmarkCaseId: candidate.caseId,
      decision: reviewedCandidate.humanDecision,
    });
  }

  return { createdCaseIds, skippedDuplicates, admittedCases };
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

function resolveHumanReviewAdmission(
  result: BenchmarkMetricEvaluationResult,
  decision: BenchmarkHumanReviewDecision,
): {
  caseSetType: "badcase" | "goodcase";
  source: BenchmarkDatasetCaseCandidate["source"];
  humanVerdict?: DatasetCaseHumanVerdict;
  reviewStatus: DatasetCaseReviewStatus;
} {
  if (decision === "needs_evidence") {
    return {
      caseSetType: result.passed ? "goodcase" : "badcase",
      source: "auto_uncertainty",
      humanVerdict: "unclear",
      reviewStatus: "auto_captured",
    };
  }

  if (decision === "accepted") {
    return result.passed
      ? { caseSetType: "goodcase", source: "manual_gold", reviewStatus: "gold_candidate" }
      : { caseSetType: "badcase", source: "auto_tp", humanVerdict: "valid_bad_case", reviewStatus: "human_reviewed" };
  }

  return result.passed
    ? { caseSetType: "badcase", source: "auto_disagreement", humanVerdict: "valid_bad_case", reviewStatus: "human_reviewed" }
    : { caseSetType: "goodcase", source: "manual_fp", humanVerdict: "false_positive", reviewStatus: "human_reviewed" };
}

function inferHumanPassed(result: BenchmarkMetricEvaluationResult, decision: BenchmarkHumanReviewDecision): boolean {
  if (decision === "accepted") return result.passed;
  if (decision === "rejected") return !result.passed;
  return result.passed;
}

function humanReviewDecisionReason(
  decision: BenchmarkHumanReviewDecision,
  result: BenchmarkMetricEvaluationResult,
): string {
  if (decision === "accepted") return `Human reviewer accepted the evaluator verdict: ${result.reason}`;
  if (decision === "rejected") return `Human reviewer rejected the evaluator verdict: ${result.reason}`;
  return `Human reviewer requested more evidence before activation: ${result.reason}`;
}

function metricResultKey(input: { submissionId: string; metricKey: string }): string {
  return `${input.submissionId}:${input.metricKey}`;
}

function allocateDatasetCaseId(caseSetType: "badcase" | "goodcase"): string {
  const prefix = caseSetType === "badcase" ? "benchmark_bc" : "benchmark_gc";
  return `${prefix}_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
