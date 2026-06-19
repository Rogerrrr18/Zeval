import { NextResponse } from "next/server";
import { z } from "zod";
import { extractAdmissionFeatures } from "@/benchmark/admission-feature-extractor";
import { learnAdmissionPolicy } from "@/benchmark/admission-policy-learner";
import {
  listAdmissionPolicyProjectIds,
  readAdmissionPolicy,
  saveAdmissionPolicy,
} from "@/benchmark/admission-policy-store";
import type { AdmissionFeature, AdmissionLabelRow } from "@/benchmark/admission-policy-types";
import { scoreAdmission } from "@/benchmark/admission-scorer";
import type { BenchmarkCaseRerank, BenchmarkMetricEvaluationResult } from "@/benchmark/types";

const labelRowSchema = z.object({
  sessionId: z.string().min(1),
  caseId: z.string().min(1),
  channel: z.string().min(1),
  metricKey: z.string().min(1),
  decision: z.enum(["accepted", "rejected", "needs_evidence"]),
  autoScore: z.number(),
  confidence: z.number(),
  qualityScore: z.number().optional(),
  qualityTier: z.string().optional(),
  autoPassed: z.boolean(),
  judgeVariance: z.number().optional(),
  reviewerRationale: z.string().max(4000).optional(),
  evidenceUsed: z.array(z.string().max(1000)).max(8).optional(),
  boundaryType: z.enum(["clear_accept", "clear_reject", "uncertain", "human_override"]).optional(),
  correctionType: z.enum(["agree_accept", "agree_reject", "false_positive", "false_negative", "needs_more_evidence"]).optional(),
});

const learnBodySchema = z.object({
  action: z.literal("learn"),
  projectId: z.string().min(1).default("default"),
  labels: z.array(labelRowSchema).min(1),
  policyId: z.string().min(1).optional(),
});

const scoreBodySchema = z.object({
  action: z.literal("score"),
  projectId: z.string().min(1).default("default"),
  features: z.array(z.object({
    sessionId: z.string().min(1),
    caseId: z.string().min(1),
    channel: z.string().min(1),
    metricKey: z.string().min(1),
    autoScore: z.number(),
    confidence: z.number(),
    qualityScore: z.number().optional(),
    qualityPercentile: z.number().optional(),
    judgeVariance: z.number().optional(),
  })).min(1),
});

const extractBodySchema = z.object({
  action: z.literal("extract"),
  metricResults: z.array(z.unknown()).min(1),
  rerankBySubmissionId: z.record(z.string(), z.unknown()).optional(),
});

const postBodySchema = z.discriminatedUnion("action", [
  learnBodySchema,
  scoreBodySchema,
  extractBodySchema,
]);

/**
 * Read a persisted admission policy or list available project ids.
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const projectId = url.searchParams.get("projectId");
    if (!projectId) {
      const projectIds = await listAdmissionPolicyProjectIds();
      return NextResponse.json({ projectIds });
    }

    const policy = await readAdmissionPolicy(projectId);
    if (!policy) {
      return NextResponse.json({ error: `未找到 projectId=${projectId} 的 policy。` }, { status: 404 });
    }
    return NextResponse.json({ policy });
  } catch (error) {
    const message = error instanceof Error ? error.message : "读取 admission policy 失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Learn, persist, extract, or score admission policies.
 */
export async function POST(request: Request) {
  try {
    const parsedBody = postBodySchema.safeParse(await request.json());
    if (!parsedBody.success) {
      return NextResponse.json(
        { error: "请求体不合法。", details: parsedBody.error.flatten() },
        { status: 400 },
      );
    }

    if (parsedBody.data.action === "learn") {
      const policy = learnAdmissionPolicy(parsedBody.data.labels as AdmissionLabelRow[], {
        projectId: parsedBody.data.projectId,
        policyId: parsedBody.data.policyId,
      });
      await saveAdmissionPolicy(policy);
      return NextResponse.json({ policy });
    }

    if (parsedBody.data.action === "extract") {
      const rerankMap = new Map<string, BenchmarkCaseRerank>();
      for (const [submissionId, value] of Object.entries(parsedBody.data.rerankBySubmissionId ?? {})) {
        if (value && typeof value === "object") {
          rerankMap.set(submissionId, value as BenchmarkCaseRerank);
        }
      }
      const features = extractAdmissionFeatures(
        parsedBody.data.metricResults as BenchmarkMetricEvaluationResult[],
        rerankMap,
      );
      return NextResponse.json({ features });
    }

    const policy = await readAdmissionPolicy(parsedBody.data.projectId);
    if (!policy) {
      return NextResponse.json(
        { error: `未找到 projectId=${parsedBody.data.projectId} 的 policy，请先 learn。` },
        { status: 404 },
      );
    }

    const results = parsedBody.data.features.map((feature) => {
      const channelPolicy = policy.channels[feature.channel];
      if (!channelPolicy) {
        return {
          feature,
          decision: "human" as const,
          matchedAcceptRules: [],
          matchedRejectRules: [],
          matchedUncertaintyRules: [],
          warning: `channel ${feature.channel} 未在 policy 中定义`,
        };
      }
      const scored = scoreAdmission(feature as AdmissionFeature, channelPolicy);
      return { feature, ...scored };
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "admission policy 操作失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
