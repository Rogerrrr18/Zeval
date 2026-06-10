/**
 * @fileoverview Full benchmark flow smoke with real LLM API (.env + .zeval-db).
 *
 * Pipeline: companion CSV → transcript submissions → real LLM judge →
 * rerank → policy learn/store/score → autofind cache search.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import autofindSkill from "../src/benchmark/agent/skills/autofind-data-skill.ts";
import admissionFeatureExtractor from "../src/benchmark/admission-feature-extractor.ts";
import admissionPolicyHoldout from "../src/benchmark/admission-policy-holdout.ts";
import admissionPolicyLearner from "../src/benchmark/admission-policy-learner.ts";
import admissionPolicyStore from "../src/benchmark/admission-policy-store.ts";
import type { AdmissionLabelRow } from "../src/benchmark/admission-policy-types.ts";
import admissionScorer from "../src/benchmark/admission-scorer.ts";
import rubricJudge from "../src/benchmark/rubric-judge.ts";
import runner from "../src/benchmark/runner.ts";
import transcriptBenchmark from "../src/benchmark/transcript-benchmark.ts";
import type {
  BenchmarkLlmJudge,
  BenchmarkMatrixCell,
  BenchmarkRubricMetric,
  BenchmarkRubricSet,
} from "../src/benchmark/types.ts";
import siliconflow from "../src/lib/siliconflow.ts";
import csvParser from "../src/parsers/csvParser.ts";

const root = dirname(fileURLToPath(import.meta.url));
const fixtureDir = join(root, "../src/benchmark/__fixtures__");
const sampleCsvPath = join(root, "../public/sample-data/companion-autofind-20sessions.csv");
const logDir = join(root, "../.zeval-db/test-logs/fullflow-real-api");
const projectId = process.env.ZEVAL_FULLFLOW_PROJECT_ID ?? "default";

const maxCases = Number(process.env.ZEVAL_FULLFLOW_MAX_CASES ?? 4);
const maxMetrics = Number(process.env.ZEVAL_FULLFLOW_MAX_METRICS ?? 3);

function loadRubric(): BenchmarkRubricSet {
  const rubric = JSON.parse(
    readFileSync(join(fixtureDir, "rubric-companion-min.json"), "utf8"),
  ) as BenchmarkRubricSet;
  const pickedMetrics = rubric.modules
    .flatMap((module) => module.metrics.map((metric) => ({ module, metric })))
    .slice(0, maxMetrics);
  const modules = rubric.modules
    .map((module) => ({
      ...module,
      metrics: pickedMetrics.filter((item) => item.module.capability === module.capability).map((item) => item.metric),
    }))
    .filter((module) => module.metrics.length > 0);
  return { ...rubric, modules };
}

function createRealLlmJudge(): BenchmarkLlmJudge {
  return async ({ metric, taskCase, submission }) => {
    const allowedScores = (metric.config?.rubricForm ?? [])
      .map((level) => level.score)
      .filter((score, index, scores) => scores.indexOf(score) === index)
      .sort((left, right) => left - right);
    const raw = await siliconflow.requestSiliconFlowChatCompletion(
      [
        {
          role: "system",
          content: [
            "你是 Zeval benchmark 评测器，评估历史心理咨询 transcript 中助手表现。",
            allowedScores.length > 0
              ? `score 必须且只能是：${allowedScores.join("、")}。`
              : "score 必须为 rubric 离散档位。",
            "必须返回 JSON：{\"score\":档位,\"reason\":\"中文\",\"evidence\":[\"引用\"],\"confidence\":0-1}",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify({
            metric: {
              key: metric.metricKey,
              name: metric.displayName,
              criteria: metric.config?.criteria,
              rubricForm: metric.config?.rubricForm,
            },
            sessionId: taskCase.input.sessionId,
            transcript: taskCase.input.transcript,
            submission: submission.parsedOutput,
          }, null, 2),
        },
      ],
      { stage: "benchmark_fullflow_llm_judge", temperature: 0.1, seed: 42 },
    );
    const parsed = siliconflow.parseJsonObjectFromLlmOutput(raw) as Record<string, unknown>;
    const rawScore = typeof parsed.score === "number" ? parsed.score : metric.scale.min;
    return {
      score: rubricJudge.snapScoreToRubricLevels(rawScore, metric.config?.rubricForm, metric.scale),
      reason: typeof parsed.reason === "string" ? parsed.reason : "real api judge",
      evidence: Array.isArray(parsed.evidence) ? parsed.evidence.map(String).slice(0, 5) : [],
      confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0.7,
    };
  };
}

function pickLimitedCases(rows: ReturnType<typeof csvParser.parseCsvRows>) {
  const grouped = transcriptBenchmark.groupRowsBySession(rows);
  const pos = [...grouped.entries()].filter(([id]) => id.startsWith("companion_pos_")).slice(0, Math.ceil(maxCases / 2));
  const neg = [...grouped.entries()].filter(([id]) => id.startsWith("companion_neg_")).slice(0, Math.floor(maxCases / 2));
  return [...pos, ...neg].flatMap(([, sessionRows]) => sessionRows);
}

const startedAt = new Date().toISOString();
const rubric = loadRubric();
const limitedRows = pickLimitedCases(csvParser.parseCsvRows(readFileSync(sampleCsvPath, "utf8")));
const task = transcriptBenchmark.buildBenchmarkTaskPackage(
  "真实 API 全流程：陪伴式心理咨询 transcript 评测 + policy 标定验证。",
  rubric,
);
const cases = transcriptBenchmark.buildCasesFromRawRows(
  task,
  limitedRows,
  "companion-autofind-20sessions.csv",
  maxCases,
);
const matrix: BenchmarkMatrixCell[] = [{
  agentFramework: "zeval",
  model: "real-api-smoke",
  enabled: true,
  timeoutMs: 60000,
  maxTurns: 1,
  concurrency: 1,
}];
const runId = `fullflow_real_${Date.now()}`;
const submissions = cases.map((taskCase) => transcriptBenchmark.buildTranscriptSubmission({
  runId,
  task,
  matrixCell: matrix[0],
  taskCase,
}));

console.log(`[fullflow] judging ${cases.length} cases × ${rubric.modules.flatMap((m) => m.metrics).length} metrics via real API...`);
const benchmarkResult = await runner.runBenchmarkEvaluation({
  runId,
  task,
  cases,
  submissions,
  matrix,
  evaluatorContext: { llmJudge: createRealLlmJudge() },
});

const labels = JSON.parse(
  readFileSync(join(fixtureDir, "human-labels-mock-100.json"), "utf8"),
) as AdmissionLabelRow[];
const policy = admissionPolicyLearner.learnAdmissionPolicy(labels, {
  projectId,
  policyId: "fullflow-policy-v1",
});
await admissionPolicyStore.saveAdmissionPolicy(policy);

const rerankBySubmissionId = new Map(
  benchmarkResult.caseScores
    .filter((item) => item.rerank)
    .map((item) => [item.submissionId, item.rerank!]),
);
const features = admissionFeatureExtractor.extractAdmissionFeatures(
  benchmarkResult.metricResults,
  rerankBySubmissionId,
);
const scored = features.slice(0, 8).flatMap((feature) => {
  const channelPolicy = policy.channels[feature.channel];
  if (!channelPolicy) {
    return [{
      feature,
      decision: "human" as const,
      warning: `channel ${feature.channel} 未在 policy 中定义`,
      matchedAcceptRules: [],
      matchedRejectRules: [],
      matchedUncertaintyRules: [],
    }];
  }
  return [{
    feature,
    ...admissionScorer.scoreAdmission(feature, channelPolicy),
  }];
});
const holdout = admissionPolicyHoldout.evaluatePolicyHoldoutAgreement(labels, { seed: 42 });

const autofind = await autofindSkill.runAutoFindDataSkill({
  action: "search",
  requirementText: "寻找陪伴式心理咨询正负样本多轮对话，用于 benchmark 区分度验证。",
  state: {
    phase: "planned",
    requirementText: "陪伴式心理咨询正负样本",
    positiveCount: 2,
    negativeCount: 2,
    includeEnglishNegative: true,
    sources: [],
    warnings: [],
  },
});

const posScores: number[] = [];
const negScores: number[] = [];
for (const caseScore of benchmarkResult.caseScores) {
  const benchmarkCase = cases.find((item) => item.caseId === caseScore.caseId);
  const sessionId = String(benchmarkCase?.input.sessionId ?? "");
  const bucket = transcriptBenchmark.classifyCompanionSession(sessionId);
  if (bucket === "pos") posScores.push(caseScore.taskScore);
  if (bucket === "neg") negScores.push(caseScore.taskScore);
}

const summary = {
  module: "fullflow-real-api",
  startedAt,
  finishedAt: new Date().toISOString(),
  runId,
  projectId,
  apiModel: process.env.ZEVAL_JUDGE_MODEL ?? "(from .env)",
  caseCount: cases.length,
  metricResultCount: benchmarkResult.metricResults.length,
  averageScore: round2(benchmarkResult.summary.averageScore),
  posAvg: round2(average(posScores)),
  negAvg: round2(average(negScores)),
  gap: round2(average(posScores) - average(negScores)),
  uniqueScores: [...new Set(benchmarkResult.metricResults.map((item) => item.score))].sort((a, b) => a - b),
  policyChannels: Object.keys(policy.channels),
  holdoutAgreement: round2(holdout.agreementRate),
  policyScoredSample: scored,
  autofindPhase: autofind.state.phase,
  autofindFile: autofind.state.fileName,
  autofindSessions: autofind.state.summary?.sessions,
  pass: benchmarkResult.metricResults.length > 0
    && Object.keys(policy.channels).length > 0
    && holdout.agreementRate >= 0.7,
};

mkdirSync(logDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const logPath = join(logDir, `${stamp}-fullflow-real-api.json`);
writeFileSync(logPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary, null, 2));
console.log(`[fullflow] log written: ${logPath}`);

if (!summary.pass) {
  process.exitCode = 1;
  throw new Error("Fullflow real API smoke failed acceptance checks.");
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
