/**
 * @fileoverview Companion transcript judge smoke unit tests.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createCompanionTranscriptJudge } from "./companion-transcript-judge.ts";
import { evaluateBenchmarkMetric } from "./evaluators.ts";
import { runBenchmarkEvaluation } from "./runner.ts";
import {
  buildBenchmarkTaskPackage,
  buildCasesFromRawRows,
  buildTranscriptSubmission,
  classifyCompanionSession,
} from "./transcript-benchmark.ts";
import type { BenchmarkMatrixCell, BenchmarkRubricSet } from "./types.ts";
import { parseCsvRows } from "../parsers/csvParser.ts";

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__");
const sampleCsvPath = join(fixtureDir, "../../../public/sample-data/companion-autofind-20sessions.csv");

function loadCompanionRubric(): BenchmarkRubricSet {
  return JSON.parse(readFileSync(join(fixtureDir, "rubric-companion-min.json"), "utf8")) as BenchmarkRubricSet;
}

const matrix: BenchmarkMatrixCell[] = [{
  agentFramework: "zeval",
  model: "smoke-model",
  enabled: true,
  timeoutMs: 45000,
  maxTurns: 1,
  concurrency: 1,
}];

describe("companion transcript benchmark", () => {
  it("M1-E2E: positive sessions score higher than negative sessions", async () => {
    const rubric = loadCompanionRubric();
    const rows = parseCsvRows(readFileSync(sampleCsvPath, "utf8"));
    const task = buildBenchmarkTaskPackage(
      "评估陪伴式心理咨询 transcript 的共情、追问与话题聚焦质量。",
      rubric,
    );
    const cases = buildCasesFromRawRows(task, rows, "companion-autofind-20sessions.csv", 20);
    const runId = "smoke_companion_transcript";
    const submissions = cases.map((taskCase) => buildTranscriptSubmission({
      runId,
      task,
      matrixCell: matrix[0],
      taskCase,
    }));

    const result = await runBenchmarkEvaluation({
      runId,
      task,
      cases,
      submissions,
      matrix,
      evaluatorContext: { llmJudge: createCompanionTranscriptJudge() },
    });

    const posScores: number[] = [];
    const negScores: number[] = [];
    for (const caseScore of result.caseScores) {
      const benchmarkCase = cases.find((item) => item.caseId === caseScore.caseId);
      const sessionId = String(benchmarkCase?.input.sessionId ?? "");
      const bucket = classifyCompanionSession(sessionId);
      if (bucket === "pos") posScores.push(caseScore.taskScore);
      if (bucket === "neg") negScores.push(caseScore.taskScore);
    }

    const posAvg = average(posScores);
    const negAvg = average(negScores);
    const uniqueScores = [...new Set(result.metricResults.map((item) => item.score))].sort((a, b) => a - b);
    const normalized = result.metricResults.map((item) => item.normalizedScore);
    const blockedCount = result.metricResults.filter((item) => item.status === "blocked").length;

    assert.equal(cases.length, 20);
    assert.equal(posScores.length, 10);
    assert.equal(negScores.length, 10);
    assert.ok(posAvg > negAvg, `posAvg=${posAvg}, negAvg=${negAvg}`);
    assert.ok(posAvg - negAvg >= 15, `score gap too small: ${posAvg - negAvg}`);
    assert.ok(stdDev(normalized) > 5);
    assert.ok(uniqueScores.some((score) => score <= 3));
    assert.ok(uniqueScores.some((score) => score >= 3));
    assert.ok(blockedCount >= 0);
    assert.ok(result.summary.averageScore < 99.5, "average should not be degenerate 100%");
  });

  it("M1-E2E-b: companion judge snaps to rubric levels", async () => {
    const rubric = loadCompanionRubric();
    const metric = rubric.modules[0].metrics[0];
    const result = await evaluateBenchmarkMetric(
      metric,
      {
        caseId: "case_pos",
        taskId: "task",
        input: {
          sessionId: "companion_pos_01",
          transcript: "用户: 我很困扰\n助手: 我理解你现在的心情，面对这样的情况确实很困难，我愿意继续听你说。",
        },
        expected: {},
      },
      {
        submissionId: "sub_pos",
        runId: "run",
        benchmarkId: "bench",
        taskId: "task",
        caseId: "case_pos",
        agentFramework: "zeval",
        model: "smoke-model",
        status: "completed",
        rawOutput: "{}",
        parsedOutput: { answer: "我理解你现在的心情" },
      },
      { llmJudge: createCompanionTranscriptJudge() },
    );
    assert.ok([1, 3, 5].includes(result.score));
    assert.equal(result.status, "scored");
  });
});

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}
