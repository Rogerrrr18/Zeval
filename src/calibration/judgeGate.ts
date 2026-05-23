/**
 * @fileoverview CI gate checks for Zeval judge agreement and drift reports.
 */

import {
  ZEVAL_JUDGE_GATE_CONFIG,
  type ZevalJudgeGateConfig,
  getZevalJudgeProfileSnapshot,
} from "@/llm/judgeProfile";
import { computeAgreementReport, computeJudgeDriftReport } from "./agreement";
import type {
  CalibrationAgreementReport,
  GoldSetLabelRecord,
  JudgeDriftReport,
  JudgeRunRecord,
} from "./types";

export type JudgeCiGateCheck = {
  key: string;
  passed: boolean;
  detail: string;
};

export type JudgeCiGateReport = {
  generatedAt: string;
  judgeId: string;
  profileVersion: string;
  passed: boolean;
  agreement: CalibrationAgreementReport;
  drift: JudgeDriftReport | null;
  checks: JudgeCiGateCheck[];
};

/**
 * Evaluate whether one judge run is stable enough to merge or deploy.
 *
 * @param input Gold labels, judge predictions and optional drift pair.
 * @returns Gate report with individual check details.
 */
export function evaluateJudgeCiGate(input: {
  labels: GoldSetLabelRecord[];
  predictions: JudgeRunRecord[];
  baseline?: JudgeRunRecord[];
  candidate?: JudgeRunRecord[];
  config?: Partial<ZevalJudgeGateConfig>;
}): JudgeCiGateReport {
  const config = { ...ZEVAL_JUDGE_GATE_CONFIG, ...(input.config ?? {}) };
  const profile = getZevalJudgeProfileSnapshot();
  const agreement = computeAgreementReport(input.labels, input.predictions);
  const drift =
    input.baseline && input.candidate
      ? computeJudgeDriftReport(input.baseline, input.candidate)
      : null;
  const errorCount = input.predictions.filter((item) => Boolean(item.error)).length;
  const errorRate = input.predictions.length > 0 ? errorCount / input.predictions.length : 1;
  const checks: JudgeCiGateCheck[] = [
    {
      key: "gold_case_count",
      passed: input.labels.length >= config.minGoldCases,
      detail: `${input.labels.length}/${config.minGoldCases} gold labels available.`,
    },
    {
      key: "judge_run_errors",
      passed: errorRate <= config.maxJudgeRunErrorRate,
      detail: `${errorCount}/${input.predictions.length} judge rows errored.`,
    },
    {
      key: "overall_mae",
      passed: agreement.overall.mae !== null && agreement.overall.mae <= config.maxOverallMae,
      detail: `overall MAE=${formatNullable(agreement.overall.mae)}, max=${config.maxOverallMae}.`,
    },
    {
      key: "goal_status_accuracy",
      passed:
        agreement.goalCompletion.statusAccuracy !== null &&
        agreement.goalCompletion.statusAccuracy >= config.minGoalStatusAccuracy,
      detail: `goal status accuracy=${formatNullable(agreement.goalCompletion.statusAccuracy)}, min=${config.minGoalStatusAccuracy}.`,
    },
  ];

  if (drift) {
    checks.push(...buildDriftChecks(drift, config));
  }

  return {
    generatedAt: new Date().toISOString(),
    judgeId: agreement.judgeId,
    profileVersion: profile.profileVersion,
    passed: checks.every((item) => item.passed),
    agreement,
    drift,
    checks,
  };
}

/**
 * Render a gate report to Markdown for CI artifacts and human review.
 *
 * @param report Gate report.
 * @returns Markdown document.
 */
export function renderJudgeCiGateReport(report: JudgeCiGateReport): string {
  return `${[
    "# Zeval Judge CI Gate",
    "",
    `- Judge: \`${report.judgeId}\``,
    `- Profile: \`${report.profileVersion}\``,
    `- Generated At: \`${report.generatedAt}\``,
    `- Result: **${report.passed ? "PASSED" : "FAILED"}**`,
    "",
    "## Checks",
    "",
    "| Check | Status | Detail |",
    "|---|---|---|",
    ...report.checks.map((item) => `| ${item.key} | ${item.passed ? "pass" : "fail"} | ${item.detail} |`),
    "",
    "## Agreement Snapshot",
    "",
    `- Samples: ${report.agreement.overall.sampleCount}`,
    `- Overall MAE: ${formatNullable(report.agreement.overall.mae)}`,
    `- Overall Spearman: ${formatNullable(report.agreement.overall.spearman)}`,
    `- Overall Kappa: ${formatNullable(report.agreement.overall.kappa)}`,
    `- Goal Status Accuracy: ${formatNullable(report.agreement.goalCompletion.statusAccuracy)}`,
    report.drift
      ? [
          "",
          "## Drift Snapshot",
          "",
          `- Baseline: \`${report.drift.baselineJudgeId}\``,
          `- Candidate: \`${report.drift.candidateJudgeId}\``,
          `- Compared Cases: ${report.drift.comparedCaseCount}`,
          `- Goal Avg Delta: ${formatNullable(report.drift.goalCompletionAverageDelta)}`,
          `- Recovery Avg Delta: ${formatNullable(report.drift.recoveryTraceAverageDelta)}`,
        ].join("\n")
      : "",
  ].join("\n")}\n`;
}

/**
 * Build drift checks using the gate thresholds instead of report defaults.
 *
 * @param drift Drift report.
 * @param config Gate thresholds.
 * @returns Drift-related checks.
 */
function buildDriftChecks(
  drift: JudgeDriftReport,
  config: ZevalJudgeGateConfig,
): JudgeCiGateCheck[] {
  const maxDimensionDrift = drift.dimensionAverageDeltas.reduce(
    (max, item) => Math.max(max, Math.abs(item.averageDelta)),
    0,
  );
  return [
    {
      key: "dimension_average_drift",
      passed: maxDimensionDrift <= config.maxDimensionAverageDrift,
      detail: `max abs dimension avg drift=${maxDimensionDrift.toFixed(4)}, max=${config.maxDimensionAverageDrift}.`,
    },
    {
      key: "goal_average_drift",
      passed:
        drift.goalCompletionAverageDelta === null ||
        Math.abs(drift.goalCompletionAverageDelta) <= config.maxGoalAverageDrift,
      detail: `goal avg drift=${formatNullable(drift.goalCompletionAverageDelta)}, max=${config.maxGoalAverageDrift}.`,
    },
    {
      key: "recovery_average_drift",
      passed:
        drift.recoveryTraceAverageDelta === null ||
        Math.abs(drift.recoveryTraceAverageDelta) <= config.maxRecoveryAverageDrift,
      detail: `recovery avg drift=${formatNullable(drift.recoveryTraceAverageDelta)}, max=${config.maxRecoveryAverageDrift}.`,
    },
  ];
}

/**
 * Format nullable numeric values for human-readable gate output.
 *
 * @param value Nullable number.
 * @returns Display string.
 */
function formatNullable(value: number | null): string {
  return value === null ? "--" : value.toFixed(4);
}
