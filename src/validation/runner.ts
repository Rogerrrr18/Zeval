/**
 * @fileoverview Replay and offline validation runners for remediation packages.
 */

import { randomBytes } from "node:crypto";
import { createDatasetStore } from "@/eval-datasets/storage";
import type { DatasetCaseRecord } from "@/eval-datasets/storage/types";
import { readZevalEnvValue } from "@/lib/siliconflow";
import { resolveReplyEndpoint, replayAssistantRowsWithHttpApi } from "@/online-eval/replayAssistant";
import { runEvaluatePipeline } from "@/pipeline/evaluateRun";
import type { RemediationPackageSnapshot } from "@/remediation";
import { createWorkbenchBaselineStore } from "@/workbench";
import type { EvaluateResponse, RawChatlogRow } from "@/types/pipeline";
import { buildValidationRunFiles } from "@/validation/reporter";
import type {
  OfflineEvalCaseResult,
  OfflineEvalValidationSummary,
  ReplayValidationSummary,
  ValidationGuardResult,
  ValidationRunSnapshot,
  ValidationTargetMetricResult,
} from "@/validation/types";

const SCORE_DELTA_EPSILON = 0.03;

type ValidationSuiteCase = {
  caseId: string;
  label: string;
  transcript: string | null;
  scenarioId?: string;
  baselineCaseScore: number;
};

/**
 * Run one replay validation against the package baseline and persistable summary format.
 *
 * @param params Runner input.
 * @returns Validation run snapshot.
 */
export async function runReplayValidation(params: {
  packageSnapshot: RemediationPackageSnapshot;
  baselineCustomerId?: string;
  replyApiBaseUrl?: string;
  useLlm?: boolean;
  replyTimeoutMs?: number;
  workspaceId?: string;
}): Promise<ValidationRunSnapshot> {
  const validationRunId = allocateValidationRunId("replay");
  const createdAt = new Date().toISOString();
  const artifactDir = `artifacts/validation-runs/${validationRunId}`;
  const workbenchStore = createWorkbenchBaselineStore({ workspaceId: params.workspaceId });
  const resolvedBaseline = await resolveBaselineSnapshot(
    params.packageSnapshot,
    workbenchStore,
    params.baselineCustomerId,
  );

  const baseUrl =
    params.replyApiBaseUrl?.trim() ||
    readZevalEnvValue(["SILICONFLOW_CUSTOMER_API_URL", "ZEVAL_CUSTOMER_API_URL"])?.trim() ||
    "http://127.0.0.1:4200";
  const replyEndpoint = resolveReplyEndpoint(baseUrl);
  const replayedRows = await replayAssistantRowsWithHttpApi(resolvedBaseline.snapshot.rawRows, replyEndpoint, {
    timeoutMs: params.replyTimeoutMs,
  });

  const currentRunId = `${validationRunId}_eval`;
  const evaluate = await runEvaluatePipeline(replayedRows, {
    useLlm: params.useLlm ?? true,
    runId: currentRunId,
    scenarioId: params.packageSnapshot.scenarioId,
  });

  const warnings: string[] = [];
  const targetMetricResults = buildReplayTargetMetricResults(params.packageSnapshot, evaluate);
  const improvedMetricCount = targetMetricResults.filter((item) => item.improved).length;
  const regressedMetricCount = targetMetricResults.filter((item) => !item.improved && !item.passed).length;
  const totalTargetMetricCount = targetMetricResults.length;
  const winRate = totalTargetMetricCount > 0 ? improvedMetricCount / totalTargetMetricCount : 1;
  if (totalTargetMetricCount === 0) {
    warnings.push("当前调优包没有 target metrics，replay win rate 按 1.0 降级处理。");
  }

  const guardResults = buildReplayGuardResults(
    params.packageSnapshot,
    resolvedBaseline.snapshot.evaluate,
    evaluate,
    regressedMetricCount,
    warnings,
  );
  const passed =
    winRate >= params.packageSnapshot.acceptanceGate.replay.minWinRate && guardResults.every((item) => item.passed);

  const summary: ReplayValidationSummary = {
    type: "replay",
    baselineRunId: resolvedBaseline.snapshot.runId,
    baselineCustomerId: resolvedBaseline.customerId,
    currentRunId,
    replyEndpoint,
    replayedRowCount: replayedRows.length,
    minWinRate: params.packageSnapshot.acceptanceGate.replay.minWinRate,
    winRate: roundMetric(winRate),
    improvedMetricCount,
    regressedMetricCount,
    totalTargetMetricCount,
    targetMetricResults,
    guardResults,
    warnings,
  };

  return {
    schemaVersion: 1,
    validationRunId,
    packageId: params.packageSnapshot.packageId,
    mode: "replay",
    status: passed ? "passed" : "failed",
    createdAt,
    artifactDir,
    summary,
    files: buildValidationRunFiles({
      validationRunId,
      packageId: params.packageSnapshot.packageId,
      mode: "replay",
      status: passed ? "passed" : "failed",
      createdAt,
      artifactDir,
      summary,
    }),
  };
}

/**
 * Run one offline regression validation using a sample batch or the package badcase suite.
 *
 * @param params Runner input.
 * @returns Validation run snapshot.
 */
export async function runOfflineEvalValidation(params: {
  packageSnapshot: RemediationPackageSnapshot;
  sampleBatchId?: string;
  replyApiBaseUrl?: string;
  useLlm?: boolean;
  replyTimeoutMs?: number;
  workspaceId?: string;
}): Promise<ValidationRunSnapshot> {
  const validationRunId = allocateValidationRunId("offline");
  const createdAt = new Date().toISOString();
  const artifactDir = `artifacts/validation-runs/${validationRunId}`;
  const datasetStore = createDatasetStore({ workspaceId: params.workspaceId });
  const suite = await resolveOfflineValidationSuite(params.packageSnapshot, datasetStore, params.sampleBatchId);
  const warnings = [...suite.warnings];
  const baseUrl =
    params.replyApiBaseUrl?.trim() ||
    readZevalEnvValue(["SILICONFLOW_CUSTOMER_API_URL", "ZEVAL_CUSTOMER_API_URL"])?.trim() ||
    "http://127.0.0.1:4200";
  const replyEndpoint = resolveReplyEndpoint(baseUrl);

  const caseResults: OfflineEvalCaseResult[] = [];
  for (const suiteCase of suite.cases) {
    if (!suiteCase.transcript?.trim()) {
      caseResults.push({
        caseId: suiteCase.caseId,
        label: suiteCase.label,
        baselineCaseScore: suiteCase.baselineCaseScore,
        currentCaseScore: null,
        scoreDelta: null,
        isImproved: false,
        isRegressed: false,
        skipped: true,
        reason: "缺少 transcript，当前无法执行 replay regression。",
      });
      continue;
    }

    const rawRows = buildRawRowsFromTranscript(suiteCase.transcript, suiteCase.caseId);
    const replayedRows = await replayAssistantRowsWithHttpApi(rawRows, replyEndpoint, {
      timeoutMs: params.replyTimeoutMs,
    });
    const evaluate = await runEvaluatePipeline(replayedRows, {
      useLlm: params.useLlm ?? true,
      runId: `${validationRunId}_${sanitizeLabel(suiteCase.caseId)}`,
      scenarioId: suiteCase.scenarioId ?? params.packageSnapshot.scenarioId,
    });

    const currentCaseScore = computeValidationCaseScore(evaluate);
    const scoreDelta = roundMetric(currentCaseScore - suiteCase.baselineCaseScore);
    const isImproved = scoreDelta >= SCORE_DELTA_EPSILON;
    const isRegressed = scoreDelta <= -SCORE_DELTA_EPSILON;
    const result: OfflineEvalCaseResult = {
      caseId: suiteCase.caseId,
      label: suiteCase.label,
      baselineCaseScore: suiteCase.baselineCaseScore,
      currentCaseScore,
      scoreDelta,
      isImproved,
      isRegressed,
      skipped: false,
      reason: buildOfflineCaseReason(evaluate, currentCaseScore, scoreDelta),
    };
    caseResults.push(result);

    if (suite.source === "sample_batch" && suite.sampleBatchId) {
      await datasetStore.saveRunResult({
        runId: validationRunId,
        sampleBatchId: suite.sampleBatchId,
        caseId: suiteCase.caseId,
        baselineCaseScore: suiteCase.baselineCaseScore,
        currentCaseScore,
        scoreDelta,
        isImproved,
        isRegressed,
        judgeReason: result.reason,
        createdAt: new Date().toISOString(),
      });
    }
  }

  const executedResults = caseResults.filter((item) => !item.skipped && item.currentCaseScore !== null);
  const regressedCases = executedResults.filter((item) => item.isRegressed).length;
  const improvedCases = executedResults.filter((item) => item.isImproved).length;
  const averageScoreDelta =
    executedResults.length > 0
      ? roundMetric(
          executedResults.reduce((sum, item) => sum + (item.scoreDelta ?? 0), 0) / executedResults.length,
        )
      : null;
  if (executedResults.length === 0) {
    warnings.push("offline validation 没有可执行 case，当前结果无法证明修复有效。");
  }

  const maxRegressions = params.packageSnapshot.acceptanceGate.offlineEval.maxRegressions;
  const passed = executedResults.length > 0 && regressedCases <= maxRegressions;
  const summary: OfflineEvalValidationSummary = {
    type: "offline_eval",
    sampleBatchId: suite.sampleBatchId,
    suiteSource: suite.source,
    totalCases: suite.cases.length,
    executedCases: executedResults.length,
    skippedCases: caseResults.length - executedResults.length,
    improvedCases,
    regressedCases,
    maxRegressions,
    averageScoreDelta,
    caseResults,
    warnings,
  };

  return {
    schemaVersion: 1,
    validationRunId,
    packageId: params.packageSnapshot.packageId,
    mode: "offline_eval",
    status: passed ? "passed" : "failed",
    createdAt,
    artifactDir,
    summary,
    files: buildValidationRunFiles({
      validationRunId,
      packageId: params.packageSnapshot.packageId,
      mode: "offline_eval",
      status: passed ? "passed" : "failed",
      createdAt,
      artifactDir,
      summary,
    }),
  };
}

/**
 * Resolve one baseline snapshot using explicit customerId first, then runId lookup fallback.
 *
 * @param packageSnapshot Remediation package snapshot.
 * @param store Workbench baseline store.
 * @param baselineCustomerId Optional explicit customer identifier.
 * @returns Resolved customer + baseline snapshot.
 */
async function resolveBaselineSnapshot(
  packageSnapshot: RemediationPackageSnapshot,
  store: ReturnType<typeof createWorkbenchBaselineStore>,
  baselineCustomerId?: string,
): Promise<{ customerId: string; snapshot: NonNullable<Awaited<ReturnType<typeof store.read>>> }> {
  const preferredCustomerId =
    baselineCustomerId?.trim() || packageSnapshot.acceptanceGate.replay.baselineCustomerId?.trim();
  const baselineRunId = packageSnapshot.acceptanceGate.replay.baselineRunId;

  if (preferredCustomerId) {
    const snapshot = await store.read(preferredCustomerId, baselineRunId);
    if (snapshot) {
      return {
        customerId: preferredCustomerId,
        snapshot,
      };
    }
  }

  const matched = await store.findByRunId(baselineRunId);
  if (matched) {
    return matched;
  }

  throw new Error(`未找到 replay baseline：runId=${baselineRunId}。请先保存工作台基线或补充 customerId。`);
}

/**
 * Build target-metric comparison results for one replay validation.
 *
 * @param packageSnapshot Remediation package snapshot.
 * @param evaluate Current replay evaluate response.
 * @returns Metric result list.
 */
function buildReplayTargetMetricResults(
  packageSnapshot: RemediationPackageSnapshot,
  evaluate: EvaluateResponse,
): ValidationTargetMetricResult[] {
  return packageSnapshot.targetMetrics.map((metric) => {
    const currentValue = lookupMetricValue(evaluate, metric.metricId);
    if (currentValue === null) {
      return {
        metricId: metric.metricId,
        displayName: metric.displayName,
        direction: metric.direction,
        baselineValue: roundMetric(metric.currentValue),
        currentValue: null,
        targetValue: roundMetric(metric.targetValue),
        improved: false,
        passed: false,
        detail: "当前 evaluate 结果无法映射该 metric。",
      };
    }

    const improved =
      metric.direction === "increase"
        ? currentValue > metric.currentValue + Number.EPSILON
        : currentValue < metric.currentValue - Number.EPSILON;
    const passed = metric.direction === "increase" ? currentValue >= metric.targetValue : currentValue <= metric.targetValue;
    return {
      metricId: metric.metricId,
      displayName: metric.displayName,
      direction: metric.direction,
      baselineValue: roundMetric(metric.currentValue),
      currentValue: roundMetric(currentValue),
      targetValue: roundMetric(metric.targetValue),
      improved,
      passed,
      detail: improved ? "相对 baseline 已改善。" : "相对 baseline 尚未改善。",
    };
  });
}

/**
 * Build guard results for replay validation.
 *
 * @param packageSnapshot Remediation package snapshot.
 * @param baselineEvaluate Baseline evaluate response.
 * @param currentEvaluate Current replay evaluate response.
 * @param regressedMetricCount Count of target metrics moving in the wrong direction.
 * @param warnings Mutable warning collector.
 * @returns Guard result list.
 */
function buildReplayGuardResults(
  packageSnapshot: RemediationPackageSnapshot,
  baselineEvaluate: EvaluateResponse,
  currentEvaluate: EvaluateResponse,
  regressedMetricCount: number,
  warnings: string[],
): ValidationGuardResult[] {
  const results: ValidationGuardResult[] = [];

  Object.entries(packageSnapshot.acceptanceGate.guards).forEach(([guardKey, threshold]) => {
    if (typeof threshold !== "number" && typeof threshold !== "boolean" && typeof threshold !== "string") {
      return;
    }

    if (guardKey === "max_regressions" && typeof threshold === "number") {
      results.push({
        guardKey,
        comparator: "lte",
        threshold,
        currentValue: regressedMetricCount,
        passed: regressedMetricCount <= threshold,
        detail: `target metric 反向退化 ${regressedMetricCount} 项。`,
      });
      return;
    }

    if (guardKey === "dangerous_reply_count" && typeof threshold === "number") {
      warnings.push("当前 pipeline 暂无危险回复计数，dangerous_reply_count 按 0 降级处理。");
      results.push({
        guardKey,
        comparator: "lte",
        threshold,
        currentValue: 0,
        passed: 0 <= threshold,
        detail: "暂无显式 dangerous reply 检测器，当前按 0 处理。",
      });
      return;
    }

    if (guardKey === "avg_latency_regression_max_ratio" && typeof threshold === "number") {
      const baselineGap = baselineEvaluate.objectiveMetrics.avgResponseGapSec;
      const currentGap = currentEvaluate.objectiveMetrics.avgResponseGapSec;
      const ratio = baselineGap > 0 ? currentGap / baselineGap : null;
      results.push({
        guardKey,
        comparator: "lte",
        threshold,
        currentValue: ratio === null ? null : roundMetric(ratio),
        passed: ratio === null ? true : ratio <= threshold,
        detail:
          ratio === null
            ? "baseline avgResponseGapSec <= 0，跳过 ratio 校验。"
            : `当前延迟倍率 ${roundMetric(ratio)}。`,
      });
      return;
    }

    if (guardKey.endsWith("_min") && typeof threshold === "number") {
      const metricId = guardKey.slice(0, -4);
      const currentValue = lookupMetricValue(currentEvaluate, metricId);
      results.push({
        guardKey,
        comparator: "gte",
        threshold,
        currentValue: currentValue === null ? null : roundMetric(currentValue),
        passed: currentValue === null ? false : currentValue >= threshold,
        detail: currentValue === null ? "当前 evaluate 无法映射该 guard。" : "达到最小阈值校验。",
      });
      return;
    }

    if (guardKey.endsWith("_max") && typeof threshold === "number") {
      const metricId = guardKey.slice(0, -4);
      const currentValue = lookupMetricValue(currentEvaluate, metricId);
      results.push({
        guardKey,
        comparator: "lte",
        threshold,
        currentValue: currentValue === null ? null : roundMetric(currentValue),
        passed: currentValue === null ? false : currentValue <= threshold,
        detail: currentValue === null ? "当前 evaluate 无法映射该 guard。" : "达到最大阈值校验。",
      });
    }
  });

  return results;
}

/**
 * Resolve offline validation suite from dataset sample batch first, then package badcases.
 *
 * @param packageSnapshot Remediation package snapshot.
 * @param datasetStore Dataset store.
 * @param sampleBatchId Optional explicit sample batch identifier.
 * @returns Validation suite definition and warnings.
 */
async function resolveOfflineValidationSuite(
  packageSnapshot: RemediationPackageSnapshot,
  datasetStore: ReturnType<typeof createDatasetStore>,
  sampleBatchId?: string,
): Promise<{
  source: "sample_batch" | "package_badcases";
  sampleBatchId: string | null;
  cases: ValidationSuiteCase[];
  warnings: string[];
}> {
  const resolvedSampleBatchId =
    sampleBatchId?.trim() || packageSnapshot.acceptanceGate.offlineEval.sampleBatchId?.trim() || "";
  if (resolvedSampleBatchId) {
    const sampleBatch = await datasetStore.getSampleBatch(resolvedSampleBatchId);
    if (!sampleBatch) {
      throw new Error(`未找到 sample batch: ${resolvedSampleBatchId}`);
    }

    const cases: ValidationSuiteCase[] = [];
    for (const caseId of sampleBatch.caseIds) {
      const caseRecord = await datasetStore.getCaseById(caseId);
      if (!caseRecord) {
        cases.push({
          caseId,
          label: caseId,
          transcript: null,
          baselineCaseScore: 0,
        });
        continue;
      }
      const baseline = await datasetStore.getBaseline(caseId);
      cases.push(buildDatasetSuiteCase(caseRecord, baseline?.baselineCaseScore ?? caseRecord.baselineCaseScore));
    }

    return {
      source: "sample_batch",
      sampleBatchId: sampleBatch.sampleBatchId,
      cases,
      warnings: sampleBatch.warnings ?? [],
    };
  }

  return {
    source: "package_badcases",
    sampleBatchId: null,
    cases: buildPackageSuiteCases(packageSnapshot),
    warnings: ["未指定 sample batch，offline validation 将退化为 package badcases regression suite。"],
  };
}

/**
 * Convert one dataset case record into an executable validation suite case.
 *
 * @param caseRecord Dataset case record.
 * @param baselineCaseScore Baseline case score.
 * @returns Suite case.
 */
function buildDatasetSuiteCase(caseRecord: DatasetCaseRecord, baselineCaseScore: number): ValidationSuiteCase {
  return {
    caseId: caseRecord.caseId,
    label: caseRecord.title ?? `${caseRecord.topicLabel} · ${caseRecord.caseId}`,
    transcript: caseRecord.transcript ?? null,
    scenarioId: caseRecord.scenarioId,
    baselineCaseScore: roundMetric(baselineCaseScore),
  };
}

/**
 * Build one regression suite directly from the package `badcases.jsonl` artifact.
 *
 * @param packageSnapshot Remediation package snapshot.
 * @returns Suite cases.
 */
function buildPackageSuiteCases(packageSnapshot: RemediationPackageSnapshot): ValidationSuiteCase[] {
  const badcasesFile = packageSnapshot.files.find((file) => file.fileName === "badcases.jsonl");
  if (!badcasesFile) {
    return [];
  }

  return badcasesFile.content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { case_id: string; topic_label: string; severity_score: number; transcript: string })
    .map((row) => ({
      caseId: row.case_id,
      label: `${row.topic_label} · ${row.case_id}`,
      transcript: row.transcript,
      scenarioId: packageSnapshot.scenarioId,
      baselineCaseScore: roundMetric(Math.max(0, 1 - row.severity_score)),
    }));
}

/**
 * Build raw rows from stored transcript text for replay validation.
 *
 * @param transcript Stored transcript text.
 * @param fallbackSessionId Fallback session identifier.
 * @returns Canonical raw rows.
 */
function buildRawRowsFromTranscript(transcript: string, fallbackSessionId: string): RawChatlogRow[] {
  const rows: RawChatlogRow[] = [];
  const lines = transcript
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  lines.forEach((line, index) => {
    const matched = line.match(/^\[turn\s+\d+\]\s+\[(user|assistant|system)\]\s+([\s\S]+)$/i);
    if (!matched) {
      return;
    }
    const role = matched[1]?.toLowerCase();
    if (role !== "user" && role !== "assistant" && role !== "system") {
      return;
    }
    rows.push({
      sessionId: fallbackSessionId,
      role,
      content: matched[2] ?? "",
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString(),
    });
  });

  return rows;
}

/**
 * Compute one normalized validation case score from an evaluate response.
 *
 * @param evaluate Evaluate response for one replayed case.
 * @returns Normalized score in `[0, 1]`.
 */
function computeValidationCaseScore(evaluate: EvaluateResponse): number {
  const dimensionAverage =
    evaluate.subjectiveMetrics.dimensions.length > 0
      ? evaluate.subjectiveMetrics.dimensions.reduce((sum, item) => sum + item.score, 0) /
        evaluate.subjectiveMetrics.dimensions.length
      : 3;
  const goalCompletionRate = getGoalCompletionRate(evaluate);
  const recoveryCompletionRate = getRecoveryCompletionRate(evaluate);
  const worstSeverity = evaluate.badCaseAssets.length > 0 ? Math.max(...evaluate.badCaseAssets.map((item) => item.severityScore)) : 0;

  return roundMetric(
    clamp01((dimensionAverage / 5) * 0.35 + goalCompletionRate * 0.3 + recoveryCompletionRate * 0.15 + (1 - worstSeverity) * 0.2),
  );
}

/**
 * Build one concise case-level validation reason.
 *
 * @param evaluate Evaluate response for the case.
 * @param currentCaseScore Current normalized case score.
 * @param scoreDelta Score delta vs baseline.
 * @returns Human-readable reason.
 */
function buildOfflineCaseReason(
  evaluate: EvaluateResponse,
  currentCaseScore: number,
  scoreDelta: number,
): string {
  const goalCompletionRate = getGoalCompletionRate(evaluate);
  const worstSeverity = evaluate.badCaseAssets.length > 0 ? Math.max(...evaluate.badCaseAssets.map((item) => item.severityScore)) : 0;
  return `current=${currentCaseScore.toFixed(4)}，delta=${scoreDelta.toFixed(4)}，goal_completion=${goalCompletionRate.toFixed(4)}，worst_severity=${worstSeverity.toFixed(4)}。`;
}

/**
 * Map one metric identifier to the current evaluate value.
 *
 * @param evaluate Evaluate response.
 * @param metricId Metric identifier.
 * @returns Metric value or null when unsupported.
 */
function lookupMetricValue(evaluate: EvaluateResponse, metricId: string): number | null {
  if (metricId === "goal_completion_rate") {
    return getGoalCompletionRate(evaluate);
  }
  if (metricId === "recovery_completion_rate") {
    return getRecoveryCompletionRate(evaluate);
  }
  if (metricId === "emotion_recovery_score") {
    return getDimensionScore(evaluate, "情绪恢复能力");
  }
  if (metricId === "empathy_score") {
    return getDimensionScore(evaluate, "共情程度");
  }
  if (metricId === "off_topic_score") {
    return getDimensionScore(evaluate, "答非所问/无视风险");
  }
  if (metricId === "user_question_repeat_rate") {
    return evaluate.objectiveMetrics.userQuestionRepeatRate;
  }
  if (metricId === "escalation_keyword_hit_rate") {
    return evaluate.objectiveMetrics.escalationKeywordHitRate;
  }
  if (metricId === "avg_response_gap_sec") {
    return evaluate.objectiveMetrics.avgResponseGapSec;
  }
  if (metricId === "scenario_average_score") {
    return evaluate.scenarioEvaluation?.averageScore ?? null;
  }
  return null;
}

/**
 * Read one subjective dimension score by display name.
 *
 * @param evaluate Evaluate response.
 * @param displayName Dimension display name.
 * @returns Score with neutral fallback.
 */
function getDimensionScore(evaluate: EvaluateResponse, displayName: string): number {
  return evaluate.subjectiveMetrics.dimensions.find((item) => item.dimension === displayName)?.score ?? 3;
}

/**
 * Compute goal completion rate from session-level results.
 *
 * @param evaluate Evaluate response.
 * @returns Normalized completion rate.
 */
function getGoalCompletionRate(evaluate: EvaluateResponse): number {
  const rows = evaluate.subjectiveMetrics.goalCompletions;
  if (rows.length === 0) {
    return 0.5;
  }
  const achieved = rows.filter((item) => item.status === "achieved").length;
  return achieved / rows.length;
}

/**
 * Compute recovery completion rate from recovery traces.
 *
 * @param evaluate Evaluate response.
 * @returns Normalized completion rate.
 */
function getRecoveryCompletionRate(evaluate: EvaluateResponse): number {
  const rows = evaluate.subjectiveMetrics.recoveryTraces.filter((item) => item.status !== "none");
  if (rows.length === 0) {
    return 0.5;
  }
  const completed = rows.filter((item) => item.status === "completed").length;
  return completed / rows.length;
}

/**
 * Allocate one stable-looking validation run identifier.
 *
 * @param mode Validation mode label.
 * @returns Validation run identifier.
 */
function allocateValidationRunId(mode: "replay" | "offline"): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `val_${mode}_${stamp}_${randomBytes(3).toString("hex")}`;
}

/**
 * Sanitize one label fragment before it becomes part of a run id.
 *
 * @param value Raw label.
 * @returns Safe label fragment.
 */
function sanitizeLabel(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "case";
}

/**
 * Clamp one numeric value into `[0, 1]`.
 *
 * @param value Raw value.
 * @returns Clamped value.
 */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Round one metric value for stable persistence and UI display.
 *
 * @param value Raw metric value.
 * @returns Rounded numeric value.
 */
function roundMetric(value: number): number {
  return Number(value.toFixed(4));
}
