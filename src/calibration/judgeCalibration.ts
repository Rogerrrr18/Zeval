/**
 * @fileoverview Judge calibration runner over a gold set.
 */

import { runEvaluatePipeline } from "../pipeline/evaluateRun";
import type { JudgeRunRecord, GoldSetCaseRecord } from "./types";
import { getZevalJudgeProfileSnapshot } from "@/llm/judgeProfile";

/**
 * Run the current evaluation pipeline against a gold set and persist
 * case-level predictions for later agreement / drift analysis.
 *
 * @param cases Gold-set cases.
 * @param options Judge execution options.
 * @returns Judge-run records.
 */
export async function runJudgeOnGoldSet(
  cases: GoldSetCaseRecord[],
  options: {
    judgeId: string;
    useLlm: boolean;
    runIdPrefix?: string;
  },
): Promise<JudgeRunRecord[]> {
  const records: JudgeRunRecord[] = [];
  const profile = getZevalJudgeProfileSnapshot();
  const model = profile.model;
  const runAt = new Date().toISOString();

  for (const item of cases) {
    const runId = `${options.runIdPrefix ?? "calibration"}_${item.caseId}`;
    try {
      const evaluate = await runEvaluatePipeline(item.rawRows, {
        useLlm: options.useLlm,
        runId,
      });
      const goalCompletion =
        evaluate.subjectiveMetrics.goalCompletions.find((entry) => entry.sessionId === item.sessionId) ??
        evaluate.subjectiveMetrics.goalCompletions[0] ??
        null;
      const recoveryTrace =
        evaluate.subjectiveMetrics.recoveryTraces.find((entry) => entry.sessionId === item.sessionId) ??
        evaluate.subjectiveMetrics.recoveryTraces[0] ??
        null;

      records.push({
        caseId: item.caseId,
        sceneId: item.sceneId,
        sessionId: item.sessionId,
        judgeId: options.judgeId,
        model,
        judgeProfile: {
          profileVersion: profile.profileVersion,
          provider: profile.provider,
          promptVersions: profile.promptVersions,
        },
        useLlm: options.useLlm,
        runAt,
        dimensions: evaluate.subjectiveMetrics.dimensions,
        goalCompletion: goalCompletion
          ? {
              status: goalCompletion.status,
              score: goalCompletion.score,
              userIntent: goalCompletion.userIntent,
              confidence: goalCompletion.confidence,
            }
          : null,
        recoveryTrace: recoveryTrace
          ? {
              status: recoveryTrace.status,
              qualityScore: recoveryTrace.qualityScore,
              repairStrategy: recoveryTrace.repairStrategy,
              confidence: recoveryTrace.confidence,
            }
          : null,
        warnings: evaluate.meta.warnings,
      });
    } catch (error) {
      records.push({
        caseId: item.caseId,
        sceneId: item.sceneId,
        sessionId: item.sessionId,
        judgeId: options.judgeId,
        model,
        judgeProfile: {
          profileVersion: profile.profileVersion,
          provider: profile.provider,
          promptVersions: profile.promptVersions,
        },
        useLlm: options.useLlm,
        runAt,
        dimensions: [],
        goalCompletion: null,
        recoveryTrace: null,
        warnings: [],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return records;
}
