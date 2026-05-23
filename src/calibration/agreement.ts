/**
 * @fileoverview Agreement and drift metrics for judge calibration.
 */

import type {
  CalibrationAgreementBlock,
  CalibrationAgreementReport,
  CalibrationScoreMetrics,
  GoldSetLabelRecord,
  JudgeDriftReport,
  JudgeRunRecord,
} from "./types";

type ScoreStatusPair<T extends string> = {
  goldScore: number;
  predictedScore: number;
  goldStatus: T;
  predictedStatus: T;
};

/**
 * Compute a full agreement report from gold labels and judge predictions.
 *
 * @param labels Human label records.
 * @param predictions Judge-run records.
 * @returns Structured agreement report.
 */
export function computeAgreementReport(
  labels: GoldSetLabelRecord[],
  predictions: JudgeRunRecord[],
): CalibrationAgreementReport {
  const validPredictions = predictions.filter((item) => !item.error);
  const predictionMap = new Map(validPredictions.map((item) => [item.caseId, item]));
  const dimensionNames = [...new Set(labels.flatMap((item) => item.dimensions.map((dimension) => dimension.dimension)))];

  const dimensionMetrics = dimensionNames.map((dimension) => {
    const pairs = labels
      .map((label) => {
        const prediction = predictionMap.get(label.caseId);
        const labelScore = label.dimensions.find((item) => item.dimension === dimension)?.score;
        const predictionScore = prediction?.dimensions.find((item) => item.dimension === dimension)?.score;
        if (typeof labelScore !== "number" || typeof predictionScore !== "number") {
          return null;
        }
        return { gold: labelScore, predicted: predictionScore };
      })
      .filter((item): item is { gold: number; predicted: number } => item !== null);

    return {
      dimension,
      score: buildScoreMetrics(pairs),
    };
  });

  const goalPairs = labels
    .map((label) => {
      const prediction = predictionMap.get(label.caseId)?.goalCompletion;
      if (!prediction) {
        return null;
      }
      return {
        goldScore: label.goalCompletion.score,
        predictedScore: prediction.score,
        goldStatus: label.goalCompletion.status,
        predictedStatus: prediction.status,
      };
    })
    .filter(isPresent);

  const recoveryPairs = labels
    .map((label) => {
      const prediction = predictionMap.get(label.caseId)?.recoveryTrace;
      if (!prediction) {
        return null;
      }
      return {
        goldScore: label.recoveryTrace.qualityScore,
        predictedScore: prediction.qualityScore,
        goldStatus: label.recoveryTrace.status,
        predictedStatus: prediction.status,
      };
    })
    .filter(isPresent);

  const overallPairs = dimensionMetrics
    .flatMap((item) => item.score.sampleCount > 0 ? [item.score] : [])
    .filter((item) => item.mae !== null && item.rmse !== null);

  return {
    judgeId: validPredictions[0]?.judgeId ?? "unknown-judge",
    generatedAt: new Date().toISOString(),
    dimensionMetrics,
    goalCompletion: buildScoreAndStatusBlock(goalPairs),
    recoveryTrace: buildScoreAndStatusBlock(recoveryPairs),
    overall: {
      sampleCount: overallPairs.reduce((sum, item) => sum + item.sampleCount, 0),
      mae: averageNullable(overallPairs.map((item) => item.mae)),
      rmse: averageNullable(overallPairs.map((item) => item.rmse)),
      spearman: averageNullable(overallPairs.map((item) => item.spearman)),
      kappa: averageNullable(overallPairs.map((item) => item.kappa)),
    },
  };
}

/**
 * Render one agreement report into markdown.
 *
 * @param report Structured agreement report.
 * @returns Markdown content.
 */
export function renderAgreementReport(report: CalibrationAgreementReport): string {
  const lines = [
    `# Judge Agreement Report`,
    ``,
    `- Judge: \`${report.judgeId}\``,
    `- Generated At: \`${report.generatedAt}\``,
    ``,
    `## Subjective Dimensions`,
    ``,
    `| Dimension | Samples | MAE | RMSE | Spearman | Kappa |`,
    `|---|---:|---:|---:|---:|---:|`,
    ...report.dimensionMetrics.map(
      (item) =>
        `| ${item.dimension} | ${item.score.sampleCount} | ${formatNullable(item.score.mae)} | ${formatNullable(item.score.rmse)} | ${formatNullable(item.score.spearman)} | ${formatNullable(item.score.kappa)} |`,
    ),
    ``,
    `## Goal Completion`,
    ``,
    `- Score MAE: ${formatNullable(report.goalCompletion.score.mae)}`,
    `- Score RMSE: ${formatNullable(report.goalCompletion.score.rmse)}`,
    `- Score Spearman: ${formatNullable(report.goalCompletion.score.spearman)}`,
    `- Score Kappa: ${formatNullable(report.goalCompletion.score.kappa)}`,
    `- Status Accuracy: ${formatNullable(report.goalCompletion.statusAccuracy)}`,
    `- Status Kappa: ${formatNullable(report.goalCompletion.statusKappa)}`,
    ``,
    `## Recovery Trace`,
    ``,
    `- Score MAE: ${formatNullable(report.recoveryTrace.score.mae)}`,
    `- Score RMSE: ${formatNullable(report.recoveryTrace.score.rmse)}`,
    `- Score Spearman: ${formatNullable(report.recoveryTrace.score.spearman)}`,
    `- Score Kappa: ${formatNullable(report.recoveryTrace.score.kappa)}`,
    `- Status Accuracy: ${formatNullable(report.recoveryTrace.statusAccuracy)}`,
    `- Status Kappa: ${formatNullable(report.recoveryTrace.statusKappa)}`,
    ``,
    `## Overall`,
    ``,
    `- Samples: ${report.overall.sampleCount}`,
    `- Avg MAE: ${formatNullable(report.overall.mae)}`,
    `- Avg RMSE: ${formatNullable(report.overall.rmse)}`,
    `- Avg Spearman: ${formatNullable(report.overall.spearman)}`,
    `- Avg Kappa: ${formatNullable(report.overall.kappa)}`,
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * Compute a drift report between two judge-run outputs.
 *
 * @param baseline Baseline judge-run rows.
 * @param candidate Candidate judge-run rows.
 * @returns Structured drift report.
 */
export function computeJudgeDriftReport(
  baseline: JudgeRunRecord[],
  candidate: JudgeRunRecord[],
): JudgeDriftReport {
  const baselineMap = new Map(baseline.filter((item) => !item.error).map((item) => [item.caseId, item]));
  const candidateMap = new Map(candidate.filter((item) => !item.error).map((item) => [item.caseId, item]));
  const sharedCaseIds = [...baselineMap.keys()].filter((caseId) => candidateMap.has(caseId));
  const dimensionNames = [
    ...new Set(
      sharedCaseIds.flatMap((caseId) => {
        const left = baselineMap.get(caseId)?.dimensions.map((item) => item.dimension) ?? [];
        const right = candidateMap.get(caseId)?.dimensions.map((item) => item.dimension) ?? [];
        return [...left, ...right];
      }),
    ),
  ];

  const dimensionAverageDeltas = dimensionNames.map((dimension) => {
    const deltas = sharedCaseIds
      .map((caseId) => {
        const left = baselineMap.get(caseId)?.dimensions.find((item) => item.dimension === dimension)?.score;
        const right = candidateMap.get(caseId)?.dimensions.find((item) => item.dimension === dimension)?.score;
        if (typeof left !== "number" || typeof right !== "number") {
          return null;
        }
        return right - left;
      })
      .filter((item): item is number => item !== null);

    return {
      dimension,
      averageDelta: roundNumber(average(deltas)),
      maxDelta: roundNumber(deltas.length ? Math.max(...deltas.map((item) => Math.abs(item))) : 0),
    };
  });

  const goalCompletionAverageDelta = buildAverageFieldDelta(sharedCaseIds, baselineMap, candidateMap, "goalCompletion");
  const recoveryTraceAverageDelta = buildAverageFieldDelta(sharedCaseIds, baselineMap, candidateMap, "recoveryTrace");

  return {
    baselineJudgeId: baseline.find((item) => !item.error)?.judgeId ?? "baseline",
    candidateJudgeId: candidate.find((item) => !item.error)?.judgeId ?? "candidate",
    generatedAt: new Date().toISOString(),
    comparedCaseCount: sharedCaseIds.length,
    dimensionAverageDeltas,
    goalCompletionAverageDelta,
    recoveryTraceAverageDelta,
    significantDriftWarnings: buildDriftWarnings(
      dimensionAverageDeltas,
      goalCompletionAverageDelta,
      recoveryTraceAverageDelta,
    ),
  };
}

/**
 * Render one drift report to markdown.
 *
 * @param report Structured drift report.
 * @returns Markdown content.
 */
export function renderJudgeDriftReport(report: JudgeDriftReport): string {
  const lines = [
    `# Judge Drift Report`,
    ``,
    `- Baseline Judge: \`${report.baselineJudgeId}\``,
    `- Candidate Judge: \`${report.candidateJudgeId}\``,
    `- Generated At: \`${report.generatedAt}\``,
    `- Compared Cases: ${report.comparedCaseCount}`,
    ``,
    `## Dimension Drift`,
    ``,
    `| Dimension | Avg Delta | Max |`,
    `|---|---:|---:|`,
    ...report.dimensionAverageDeltas.map(
      (item) => `| ${item.dimension} | ${item.averageDelta.toFixed(2)} | ${item.maxDelta.toFixed(2)} |`,
    ),
    ``,
    `## Goal / Recovery`,
    ``,
    `- Goal Completion Avg Delta: ${formatNullable(report.goalCompletionAverageDelta)}`,
    `- Recovery Trace Avg Delta: ${formatNullable(report.recoveryTraceAverageDelta)}`,
    ``,
    `## Warnings`,
    ``,
    ...(report.significantDriftWarnings.length > 0
      ? report.significantDriftWarnings.map((item) => `- ${item}`)
      : ["- No significant drift warnings."]),
  ];
  return `${lines.join("\n")}\n`;
}

function buildScoreAndStatusBlock(
  pairs: Array<ScoreStatusPair<string>>,
): CalibrationAgreementBlock {
  const statusPairs = pairs.map((item) => ({
    gold: item.goldStatus,
    predicted: item.predictedStatus,
  }));

  return {
    score: buildScoreMetrics(
      pairs.map((item) => ({
        gold: item.goldScore,
        predicted: item.predictedScore,
      })),
    ),
    statusAccuracy:
      pairs.length > 0
        ? roundNumber(pairs.filter((item) => item.goldStatus === item.predictedStatus).length / pairs.length)
        : null,
    statusKappa: statusPairs.length > 0 ? roundNumber(cohenKappa(statusPairs)) : null,
  };
}

function buildScoreMetrics(
  pairs: Array<{ gold: number; predicted: number }>,
): CalibrationScoreMetrics {
  const bucketPairs = pairs.map((item) => ({
    gold: normalizeScoreBucket(item.gold),
    predicted: normalizeScoreBucket(item.predicted),
  }));

  return {
    sampleCount: pairs.length,
    mae: pairs.length > 0 ? roundNumber(meanAbsoluteError(pairs)) : null,
    rmse: pairs.length > 0 ? roundNumber(rootMeanSquaredError(pairs)) : null,
    spearman: pairs.length > 1 ? roundNumber(spearmanCorrelation(pairs)) : null,
    kappa: bucketPairs.length > 0 ? roundNumber(cohenKappa(bucketPairs)) : null,
  };
}

function meanAbsoluteError(pairs: Array<{ gold: number; predicted: number }>): number {
  return average(pairs.map((item) => Math.abs(item.predicted - item.gold)));
}

function rootMeanSquaredError(pairs: Array<{ gold: number; predicted: number }>): number {
  return Math.sqrt(average(pairs.map((item) => (item.predicted - item.gold) ** 2)));
}

function spearmanCorrelation(pairs: Array<{ gold: number; predicted: number }>): number {
  const goldRanks = rankValues(pairs.map((item) => item.gold));
  const predictedRanks = rankValues(pairs.map((item) => item.predicted));
  const goldMean = average(goldRanks);
  const predictedMean = average(predictedRanks);
  const numerator = goldRanks.reduce(
    (sum, rank, index) => sum + (rank - goldMean) * (predictedRanks[index]! - predictedMean),
    0,
  );
  const goldDenominator = Math.sqrt(goldRanks.reduce((sum, rank) => sum + (rank - goldMean) ** 2, 0));
  const predictedDenominator = Math.sqrt(
    predictedRanks.reduce((sum, rank) => sum + (rank - predictedMean) ** 2, 0),
  );
  if (goldDenominator === 0 || predictedDenominator === 0) {
    return 0;
  }
  return numerator / (goldDenominator * predictedDenominator);
}

function rankValues(values: number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index })).sort((left, right) => left.value - right.value);
  const ranks = new Array<number>(values.length);
  let index = 0;

  while (index < indexed.length) {
    let next = index + 1;
    while (next < indexed.length && indexed[next]!.value === indexed[index]!.value) {
      next += 1;
    }
    const rank = (index + next - 1) / 2 + 1;
    for (let cursor = index; cursor < next; cursor += 1) {
      ranks[indexed[cursor]!.index] = rank;
    }
    index = next;
  }

  return ranks;
}

function buildAverageFieldDelta(
  sharedCaseIds: string[],
  baselineMap: Map<string, JudgeRunRecord>,
  candidateMap: Map<string, JudgeRunRecord>,
  field: "goalCompletion" | "recoveryTrace",
): number | null {
  const deltas = sharedCaseIds
    .map((caseId) => {
      const left = extractComparableScore(baselineMap.get(caseId), field);
      const right = extractComparableScore(candidateMap.get(caseId), field);
      if (typeof left !== "number" || typeof right !== "number") {
        return null;
      }
      return right - left;
    })
    .filter((item): item is number => item !== null);
  return deltas.length > 0 ? roundNumber(average(deltas)) : null;
}

function buildDriftWarnings(
  dimensionAverageDeltas: JudgeDriftReport["dimensionAverageDeltas"],
  goalCompletionAverageDelta: number | null,
  recoveryTraceAverageDelta: number | null,
): string[] {
  const warnings: string[] = [];
  dimensionAverageDeltas.forEach((item) => {
    if (Math.abs(item.averageDelta) >= 0.4) {
      warnings.push(`${item.dimension} 的平均漂移达到 ${item.averageDelta.toFixed(2)}，建议复查 judge prompt 或模型切换。`);
    }
  });
  if (goalCompletionAverageDelta !== null && Math.abs(goalCompletionAverageDelta) >= 0.4) {
    warnings.push(`goal completion 平均漂移达到 ${goalCompletionAverageDelta.toFixed(2)}。`);
  }
  if (recoveryTraceAverageDelta !== null && Math.abs(recoveryTraceAverageDelta) >= 0.4) {
    warnings.push(`recovery trace 平均漂移达到 ${recoveryTraceAverageDelta.toFixed(2)}。`);
  }
  return warnings;
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function isPresent<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

function cohenKappa<T extends string | number>(
  pairs: Array<{ gold: T; predicted: T }>,
): number {
  if (pairs.length === 0) {
    return 0;
  }

  const labels = [...new Set(pairs.flatMap((item) => [item.gold, item.predicted]))];
  if (labels.length <= 1) {
    return 1;
  }

  const goldCounts = new Map<T, number>();
  const predictedCounts = new Map<T, number>();
  let agreementCount = 0;

  pairs.forEach((item) => {
    goldCounts.set(item.gold, (goldCounts.get(item.gold) ?? 0) + 1);
    predictedCounts.set(item.predicted, (predictedCounts.get(item.predicted) ?? 0) + 1);
    if (item.gold === item.predicted) {
      agreementCount += 1;
    }
  });

  const observed = agreementCount / pairs.length;
  const expected = labels.reduce((sum, label) => {
    const goldRate = (goldCounts.get(label) ?? 0) / pairs.length;
    const predictedRate = (predictedCounts.get(label) ?? 0) / pairs.length;
    return sum + goldRate * predictedRate;
  }, 0);

  if (expected === 1) {
    return 1;
  }
  return (observed - expected) / (1 - expected);
}

function normalizeScoreBucket(value: number): number {
  return Math.min(5, Math.max(1, Math.round(value)));
}

function extractComparableScore(
  record: JudgeRunRecord | undefined,
  field: "goalCompletion" | "recoveryTrace",
): number | null {
  if (!record) {
    return null;
  }

  if (field === "goalCompletion") {
    return record.goalCompletion?.score ?? null;
  }

  return record.recoveryTrace?.qualityScore ?? null;
}

function averageNullable(values: Array<number | null>): number | null {
  const filtered = values.filter((item): item is number => item !== null);
  return filtered.length > 0 ? roundNumber(average(filtered)) : null;
}

function roundNumber(value: number): number {
  return Number(value.toFixed(4));
}

function formatNullable(value: number | null): string {
  return value === null ? "--" : value.toFixed(4);
}
