import { NextResponse } from "next/server";
import { z } from "zod";
import { getZeroreRequestContext } from "@/auth/context";
import { readAdmissionPolicy } from "@/benchmark/admission-policy-store";
import {
  attachPolicySuggestionsToCandidates,
  buildBenchmarkDatasetCaseCandidatesFromReviews,
  persistBenchmarkDatasetCases,
  type BenchmarkHumanReviewDecision,
  type BenchmarkHumanReviewInput,
} from "@/benchmark/case-admission";
import { SESSION_REVIEW_METRIC_KEY } from "@/benchmark/human-review";
import type { BenchmarkRunResult } from "@/benchmark/types";
import { createDatasetStore } from "@/eval-datasets/storage";
import type { DatasetCaseSource } from "@/eval-datasets/storage/types";

const reviewDecisionSchema = z.enum(["accepted", "rejected", "needs_evidence"]);

const benchmarkAdmitCasesBodySchema = z.object({
  baselineVersion: z.string().min(1).optional(),
  runResult: z.object({
    runId: z.string().min(1),
    metricResults: z.array(z.unknown()),
    cases: z.array(z.unknown()),
    submissions: z.array(z.unknown()),
  }).passthrough(),
  reviews: z.array(z.object({
    submissionId: z.string().min(1),
    metricKey: z.string().min(1),
    decision: reviewDecisionSchema.optional(),
    confirmedScore: z.number().finite().optional(),
    channel: z.string().min(1).optional(),
    reviewer: z.string().max(120).optional(),
    note: z.string().max(4000).optional(),
    reviewerRationale: z.string().max(4000).optional(),
    evidenceUsed: z.array(z.string().max(1000)).max(8).optional(),
    boundaryType: z.enum(["clear_accept", "clear_reject", "uncertain", "human_override"]).optional(),
    correctionType: z.enum(["agree_accept", "agree_reject", "false_positive", "false_negative", "needs_more_evidence"]).optional(),
    reviewedAt: z.string().optional(),
  })).min(1),
  usePolicySuggestion: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const parsedBody = benchmarkAdmitCasesBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "请求体不合法。", details: parsedBody.error.flatten() },
        { status: 400 },
      );
    }

    const context = getZeroreRequestContext(request);
    const store = createDatasetStore({ workspaceId: context.workspaceId });
    const reviews = normalizeReviewInputs(parsedBody.data.reviews);
    if (reviews.length === 0) {
      return NextResponse.json({ error: "没有可入池的有效标定记录。" }, { status: 400 });
    }
    const runResult = parsedBody.data.runResult as BenchmarkRunResult;
    let candidates = buildBenchmarkDatasetCaseCandidatesFromReviews(runResult, reviews);
    if (parsedBody.data.usePolicySuggestion !== false) {
      const policy = await readAdmissionPolicy(context.projectId);
      candidates = attachPolicySuggestionsToCandidates(candidates, runResult, policy);
    }
    candidates = candidates.map((candidate) => ({
      ...candidate,
      metadata: {
        ...candidate.metadata,
        projectId: context.projectId,
        workspaceId: context.workspaceId,
      },
    }));
    const persisted = await persistBenchmarkDatasetCases(
      store,
      candidates,
      parsedBody.data.baselineVersion ?? parsedBody.data.runResult.runId,
    );
    const acceptedBySource = countBySource(persisted.admittedCases.map((item) => item.source));

    return NextResponse.json({
      savedCount: persisted.createdCaseIds.length,
      savedCaseIds: persisted.createdCaseIds,
      skippedDuplicates: persisted.skippedDuplicates,
      acceptedBySource,
      admittedCases: persisted.admittedCases,
      candidateCount: candidates.length,
      projectId: context.projectId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: "Benchmark 人工校验入池失败。", detail: message },
      { status: 500 },
    );
  }
}

function countBySource(sources: DatasetCaseSource[]): Partial<Record<DatasetCaseSource, number>> {
  return sources.reduce<Partial<Record<DatasetCaseSource, number>>>((acc, source) => {
    acc[source] = (acc[source] ?? 0) + 1;
    return acc;
  }, {});
}

/**
 * Merge session-level channel tags onto metric reviews and drop session marker rows.
 *
 * @param reviews Raw review rows from the client.
 * @returns Metric-level review inputs ready for candidate building.
 */
function normalizeReviewInputs(
  reviews: Array<{
    submissionId: string;
    metricKey: string;
    decision?: BenchmarkHumanReviewDecision;
    confirmedScore?: number;
    channel?: string;
    reviewer?: string;
    note?: string;
    reviewerRationale?: string;
    evidenceUsed?: string[];
    boundaryType?: "clear_accept" | "clear_reject" | "uncertain" | "human_override";
    correctionType?: "agree_accept" | "agree_reject" | "false_positive" | "false_negative" | "needs_more_evidence";
    reviewedAt?: string;
  }>,
): BenchmarkHumanReviewInput[] {
  const sessionChannelBySubmission = new Map<string, string>();
  for (const review of reviews) {
    if (review.metricKey === SESSION_REVIEW_METRIC_KEY && review.channel?.trim()) {
      sessionChannelBySubmission.set(review.submissionId, review.channel.trim());
    }
  }

  const normalized: BenchmarkHumanReviewInput[] = [];
  for (const review of reviews) {
    if (review.metricKey === SESSION_REVIEW_METRIC_KEY) {
      continue;
    }
    const channel = review.channel?.trim() || sessionChannelBySubmission.get(review.submissionId);
    const decision = review.decision
      ?? (typeof review.confirmedScore === "number"
        ? (review.confirmedScore >= 3 ? "accepted" : "rejected")
        : undefined);
    if (!decision || !channel) {
      continue;
    }
    normalized.push({
      submissionId: review.submissionId,
      metricKey: review.metricKey,
      decision,
      channel,
      reviewer: review.reviewer,
      note: review.note,
      reviewerRationale: review.reviewerRationale,
      evidenceUsed: review.evidenceUsed,
      boundaryType: review.boundaryType,
      correctionType: review.correctionType,
      reviewedAt: review.reviewedAt,
    });
  }
  return normalized;
}
