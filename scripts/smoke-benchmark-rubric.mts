/**
 * @fileoverview Smoke test for companion transcript rubric discrimination.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompanionTranscriptJudge } from "../src/benchmark/companion-transcript-judge.ts";
import { runBenchmarkEvaluation } from "../src/benchmark/runner.ts";
import {
  buildBenchmarkTaskPackage,
  buildCasesFromRawRows,
  buildTranscriptSubmission,
  classifyCompanionSession,
} from "../src/benchmark/transcript-benchmark.ts";
import type { BenchmarkMatrixCell, BenchmarkRubricSet } from "../src/benchmark/types.ts";
import { parseCsvRows } from "../src/parsers/csvParser.ts";

const root = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(root, "../src/benchmark/__fixtures__");
const sampleCsvPath = join(root, "../public/sample-data/companion-autofind-50sessions.csv");
const rubric = JSON.parse(
  readFileSync(join(fixtureDir, "rubric-companion-min.json"), "utf8"),
) as BenchmarkRubricSet;

process.env.ZEVAL_BENCHMARK_MAX_CASES = "20";
const rows = parseCsvRows(readFileSync(sampleCsvPath, "utf8"));
const task = buildBenchmarkTaskPackage(
  "评估陪伴式心理咨询 transcript 的共情、追问与话题聚焦质量。",
  rubric,
);
const cases = buildCasesFromRawRows(
  task,
  rows,
  "companion-autofind-50sessions.csv",
  50,
);
const matrix: BenchmarkMatrixCell[] = [{
  agentFramework: "zeval",
  model: "smoke-model",
  enabled: true,
  timeoutMs: 45000,
  maxTurns: 1,
  concurrency: 1,
}];
const runId = `smoke_${Date.now()}`;
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
const gap = posAvg - negAvg;
const uniqueScores = [...new Set(result.metricResults.map((item) => item.score))].sort((left, right) => left - right);
const normalized = result.metricResults.map((item) => item.normalizedScore);
const blockedCount = result.metricResults.filter((item) => item.status === "blocked").length;
const scoreStdDev = stdDev(normalized);

const summary = {
  module: "rubric",
  runId,
  timestamp: new Date().toISOString(),
  caseCount: cases.length,
  posAvg: round2(posAvg),
  negAvg: round2(negAvg),
  gap: round2(gap),
  uniqueScores,
  scoreStdDev: round2(scoreStdDev),
  blockedCount,
  averageScore: round2(result.summary.averageScore),
  pass: posAvg > negAvg && gap >= 15 && scoreStdDev > 5 && result.summary.averageScore < 99.5,
};

const logDir = join(root, "../.zeval-db/test-logs/module1-rubric");
mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
writeFileSync(join(logDir, `${stamp}-companion-transcript-smoke.json`), `${JSON.stringify(summary, null, 2)}\n`, "utf8");

const mockPath = join(fixtureDir, "metric-results-mock.json");
writeFileSync(
  mockPath,
  `${JSON.stringify(result.metricResults.slice(0, 48), null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify(summary, null, 2));
if (!summary.pass) {
  throw new Error("Companion transcript smoke failed acceptance thresholds.");
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdDev(values: number[]): number {
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
