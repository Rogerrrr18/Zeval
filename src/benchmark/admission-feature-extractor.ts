/**
 * @fileoverview Extract admission features from benchmark metric results.
 */

import type { AdmissionFeature } from "./admission-policy-types.ts";
import type { BenchmarkCaseRerank, BenchmarkMetricEvaluationResult } from "./types.ts";

/**
 * Map a benchmark capability dimension to a static admission channel id.
 *
 * @param capability Benchmark capability dimension key.
 * @returns Channel id used by the policy learner.
 */
export function capabilityToAdmissionChannel(capability: string): string {
  return `ch_${capability}`;
}

/**
 * Build session×channel feature vectors from metric evaluation results.
 *
 * @param metricResults Completed benchmark metric results.
 * @param rerankBySubmissionId Optional rerank stats keyed by submission id.
 * @param sessionIdByCaseId Optional caseId → sessionId map from benchmark cases.
 * @returns Feature vectors for policy scoring.
 */
export function extractAdmissionFeatures(
  metricResults: BenchmarkMetricEvaluationResult[],
  rerankBySubmissionId: Map<string, BenchmarkCaseRerank> = new Map(),
  sessionIdByCaseId: Map<string, string> = new Map(),
): AdmissionFeature[] {
  return metricResults
    .filter((result) => result.status !== "skipped" && result.status !== "unsupported")
    .map((result) => {
      const rerank = rerankBySubmissionId.get(result.submissionId);
      return {
        sessionId: sessionIdByCaseId.get(result.caseId) ?? result.caseId,
        caseId: result.caseId,
        channel: capabilityToAdmissionChannel(result.capability),
        metricKey: result.metricKey,
        autoScore: result.score,
        confidence: result.confidence,
        qualityScore: rerank?.qualityScore,
        qualityPercentile: rerank?.qualityPercentile,
        judgeVariance: result.judgeVariance,
      };
    });
}
