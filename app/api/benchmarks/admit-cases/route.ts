import { NextResponse } from "next/server";
import { z } from "zod";
import { getZeroreRequestContext } from "@/auth/context";
import { readAdmissionPolicy } from "@/benchmark/admission-policy-store";
import {
  attachPolicySuggestionsToCandidates,
  buildBenchmarkDatasetCaseCandidatesFromReviews,
  persistBenchmarkDatasetCases,
  type BenchmarkHumanReviewDecision,
} from "@/benchmark/case-admission";
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
    decision: reviewDecisionSchema,
    reviewer: z.string().max(120).optional(),
    note: z.string().max(4000).optional(),
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
    const reviews = parsedBody.data.reviews.map((review) => ({
      ...review,
      decision: review.decision as BenchmarkHumanReviewDecision,
    }));
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
