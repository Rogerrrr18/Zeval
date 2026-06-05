/**
 * @fileoverview Smoke test for the five-channel admission pipeline.
 *
 * Exercises TP, FN, TN, and uncertainty channels without a running server
 * or live LLM — all test data is synthetic.  Runs in < 1 s.
 *
 * Usage:
 *   node --import tsx scripts/smoke-admission-pipeline.mts
 *
 * Exit 0 on pass, non-zero on failure.
 */

import * as admissionPipelineModule from "../src/eval-datasets/admission/pipeline.ts";
import * as transcriptHashModule from "../src/eval-datasets/case-transcript-hash.ts";
import type { DatasetStore } from "../src/eval-datasets/storage/dataset-store.ts";
import type {
  DatasetBaselineRecord,
  DatasetCaseRecord,
  DuplicateCheckResult,
  SampleBatchRecord,
} from "../src/eval-datasets/storage/types.ts";
import type {
  BadCaseAsset,
  EnrichedChatlogRow,
  EvaluateResponse,
  ImplicitSignal,
  SubjectiveDimensionResult,
  GoalCompletionResult,
} from "../src/types/pipeline.ts";

function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}

const { runAdmissionPipeline } = resolveInteropModule(admissionPipelineModule);
const { jaccardTranscriptSimilarity } = resolveInteropModule(transcriptHashModule);

// ── Colours ───────────────────────────────────────────────────────────────────
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

// ── Assert helper ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, actual: unknown, expected: unknown): void {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ${GREEN}✔${RESET} ${label}`);
    passed++;
  } else {
    console.error(`  ${RED}✘ ${label}${RESET}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ── In-memory mock DatasetStore ───────────────────────────────────────────────

function createMockStore(): DatasetStore & { cases: DatasetCaseRecord[] } {
  const cases: DatasetCaseRecord[] = [];
  return {
    cases,
    async createCase(record) {
      cases.push(record);
    },
    async updateCase(record) {
      const idx = cases.findIndex((c) => c.caseId === record.caseId);
      if (idx >= 0) cases[idx] = record;
    },
    async saveBaseline() {},
    async getBaseline(): Promise<DatasetBaselineRecord | null> {
      return null;
    },
    async getCaseById(caseId: string): Promise<DatasetCaseRecord | null> {
      return cases.find((c) => c.caseId === caseId) ?? null;
    },
    async listCases(): Promise<DatasetCaseRecord[]> {
      return [...cases];
    },
    async checkDuplicate(): Promise<DuplicateCheckResult> {
      return { isDuplicate: false, reason: "none" };
    },
    async saveRunResult() {},
    async saveSampleBatch() {},
    async getSampleBatch(): Promise<SampleBatchRecord | null> {
      return null;
    },
    async listSampleBatches(): Promise<SampleBatchRecord[]> {
      return [];
    },
  };
}

// ── Row factory ───────────────────────────────────────────────────────────────

function makeRow(
  sessionId: string,
  role: "user" | "assistant",
  content: string,
  turnIndex: number,
): EnrichedChatlogRow {
  return {
    sessionId,
    timestamp: new Date(Date.UTC(2026, 0, 1, 0, 0, turnIndex)).toISOString(),
    role,
    content,
    turnIndex,
    timestampMs: Date.UTC(2026, 0, 1, 0, 0, turnIndex),
    activeHour: 0,
    responseGapSec: turnIndex > 0 ? 2 : null,
    isDropoffTurn: false,
    isQuestion: content.endsWith("?"),
    tokenCountEstimate: Math.max(1, Math.ceil(content.length / 1.6)),
  };
}

// ── Minimal BadCaseAsset factory ──────────────────────────────────────────────

function makeBadCaseAsset(
  sessionId: string,
  tags: BadCaseAsset["tags"],
  runId: string,
): BadCaseAsset {
  return {
    caseKey: `${sessionId}_bc`,
    sessionId,
    title: `${sessionId} 失败`,
    severityScore: 0.8,
    normalizedTranscriptHash: `hash_${sessionId}`,
    duplicateGroupKey: sessionId,
    tags,
    transcript: `[turn 0] [user] 测试\n[turn 1] [assistant] 回复`,
    evidence: [],
    suggestedAction: "review",
    sourceRunId: runId,
  };
}

// ── GoalCompletion factory ────────────────────────────────────────────────────

function makeGoalCompletion(
  sessionId: string,
  status: GoalCompletionResult["status"],
  confidence: number,
): GoalCompletionResult {
  return {
    sessionId,
    status,
    score: status === "achieved" ? 0.9 : 0.2,
    userIntent: "test intent",
    intentSource: "rule",
    achievementEvidence: [],
    failureReasons: [],
    triggeredRules: [],
    confidence,
    source: "rule",
  };
}

// ── Dimension result factory ──────────────────────────────────────────────────

function makeDimension(dimension: string, score: number, confidence: number): SubjectiveDimensionResult {
  return { dimension, score, confidence, reason: "", evidence: "" };
}

// ── Build the test EvaluateResponse ──────────────────────────────────────────
// Four sessions in one evaluate run:
//   s_tp  — TP channel (goal_failed tag, no uncertainty)
//   s_fn  — FN channel (negative keyword tail, not in badCaseAssets)
//   s_tn  — TN channel (clean session, sampled at tnSampleRate=1.0)
//   s_unc — TP + uncertainty channels (goal_failed + goalCompletion.confidence=0.5)

const RUN_ID = "smoke_admission_test";

// s_tp: simple bad session, clear TP, no uncertainty
const rowsTp: EnrichedChatlogRow[] = [
  makeRow("s_tp", "user", "我要退款", 0),
  makeRow("s_tp", "assistant", "好的，请稍候", 1),
  makeRow("s_tp", "user", "还没解决", 2),
  makeRow("s_tp", "assistant", "非常抱歉", 3),
];

// s_fn: negative keyword tail — triggers fn_dropoff_negative_tail
// Last 3 user turns all have negative keywords; final turn is user
const rowsFn: EnrichedChatlogRow[] = [
  makeRow("s_fn", "assistant", "您好，有什么可以帮您？", 0),
  makeRow("s_fn", "user", "不对啊，这不是我想要的", 1),     // negative: 不对
  makeRow("s_fn", "assistant", "好的，我再尝试一下", 2),
  makeRow("s_fn", "user", "没用，你根本不懂", 3),             // negative: 没用
  makeRow("s_fn", "assistant", "非常抱歉，请再说明一下", 4),
  makeRow("s_fn", "user", "不行了，我放弃了", 5),             // negative: 不行
];

// s_tn: clean session, no signals → TN via clean_session_sampled (tnSampleRate=1.0)
const rowsTn: EnrichedChatlogRow[] = [
  makeRow("s_tn", "user", "我想查询账单", 0),
  makeRow("s_tn", "assistant", "好的，这是您的账单信息", 1),
  makeRow("s_tn", "user", "谢谢，已解决", 2),
];

// s_unc: bad session with goal_failed tag + goalCompletion.confidence=0.5 → TP + uncertainty
const rowsUnc: EnrichedChatlogRow[] = [
  makeRow("s_unc", "user", "请帮我查一下订单", 0),
  makeRow("s_unc", "assistant", "好的", 1),
  makeRow("s_unc", "user", "还是不行", 2),
  makeRow("s_unc", "assistant", "抱歉，请稍等", 3),
];

const allRows = [...rowsTp, ...rowsFn, ...rowsTn, ...rowsUnc];

const badCaseAssets: BadCaseAsset[] = [
  makeBadCaseAsset("s_tp", ["goal_failed"], RUN_ID),
  makeBadCaseAsset("s_unc", ["goal_failed"], RUN_ID),
];

const goalCompletions: GoalCompletionResult[] = [
  makeGoalCompletion("s_tp", "failed", 0.9),   // high confidence — no uncertainty
  makeGoalCompletion("s_unc", "failed", 0.5),  // confidence in [0.4, 0.6] → uncertainty
  makeGoalCompletion("s_tn", "achieved", 0.85), // clean session (used by TN rule)
];

// Dimensions: default scores (no strong empathy so goal_achieved_high_score won't fire)
const dimensions: SubjectiveDimensionResult[] = [
  makeDimension("共情程度", 3, 0.9),
  makeDimension("答非所问/无视风险", 3, 0.9),
  makeDimension("说教感/压迫感", 3, 0.9),
];

const signals: ImplicitSignal[] = [];

const evaluate = {
  runId: RUN_ID,
  meta: {
    sessions: 4,
    messages: allRows.length,
    hasTimestamp: true,
    generatedAt: new Date().toISOString(),
    warnings: [],
  },
  summaryCards: [],
  enrichedRows: allRows,
  enrichedCsv: "",
  objectiveMetrics: {
    avgResponseGapSec: 2,
    userQuestionRepeatRate: 0,
    agentResolutionSignalRate: 0.5,
    escalationKeywordHitRate: 0.1,
  },
  subjectiveMetrics: {
    status: "ready" as const,
    dimensions,
    signals,
    goalCompletions,
    recoveryTraces: [],
  },
  badCaseAssets,
  charts: [],
  suggestions: [],
  dynamicReplayStatus: "skipped" as const,
  intentMetrics: null,
  intentSequences: null,
  intentRunLogs: null,
  scenarioEvaluation: null,
} as unknown as EvaluateResponse;

function assertApproxGte(label: string, actual: number, min: number): void {
  const ok = actual >= min;
  if (ok) {
    console.log(`  ${GREEN}✔${RESET} ${label} (${actual.toFixed(3)} >= ${min})`);
    passed++;
  } else {
    console.error(`  ${RED}✘ ${label}${RESET}: expected >= ${min}, got ${actual.toFixed(3)}`);
    failed++;
  }
}

// ── Jaccard inter-session near-dedup smoke ────────────────────────────────────
//
// Two separate pipeline runs on the same fresh store:
//   Run 1: s_jac  — 10-turn session admitted as FN (fn_dropoff_negative_tail)
//   Run 2: s_near — same 10 turns but turn 8 content changed → not exact hash,
//          but Jaccard(s_near, s_jac) ≈ 0.917 ≥ 0.85 → near_duplicate SKIP
//
// This verifies cross-session near-dedup for non-TP channels.

async function runJaccardNearDedupSmoke(): Promise<void> {
  // 10-turn base session: last 3 user turns carry negative keywords → FN admission.
  // Turn layout: assistant(0) user(1) assistant(2) user(3) assistant(4)
  //              user(5) assistant(6) user(7) assistant(8) user(9)
  // Last 3 user turns: [5] 还没解决呢 (没解决) · [7] 太慢了这根本没用 (没用) · [9] 我要投诉你们 (投诉)
  const baseRows: EnrichedChatlogRow[] = [
    makeRow("s_jac", "assistant", "您好有什么可以帮您",           0),
    makeRow("s_jac", "user",      "我想查询我的订单情况",         1),
    makeRow("s_jac", "assistant", "请提供您的订单编号",           2),
    makeRow("s_jac", "user",      "订单编号是SF123456",           3),
    makeRow("s_jac", "assistant", "正在为您查询请稍候",           4),
    makeRow("s_jac", "user",      "还没解决呢",                   5),
    makeRow("s_jac", "assistant", "系统处理需要时间请继续等待",   6),
    makeRow("s_jac", "user",      "太慢了这根本没用",             7),
    makeRow("s_jac", "assistant", "非常抱歉给您造成了困扰",       8),
    makeRow("s_jac", "user",      "我要投诉你们",                 9),
  ];

  // Near-dup: identical except turn 8 assistant content.
  // Structural tokens shared: turn·0-9·user·assistant = 13
  // Content tokens: 9 matching + 2 unique → Jaccard = (13+9)/(13+9+2) = 22/24 ≈ 0.917
  const nearDupRows: EnrichedChatlogRow[] = [
    ...baseRows.slice(0, 8).map((r) => ({ ...r, sessionId: "s_near" })),
    makeRow("s_near", "assistant", "十分抱歉给您带来了不便",     8),
    makeRow("s_near", "user",      "我要投诉你们",               9),
  ];

  // Build minimal evaluate responses (no badCaseAssets → FN channel).
  const baseEval = {
    ...evaluate,
    runId: "jac_run_1",
    enrichedRows: baseRows,
    badCaseAssets: [],
    subjectiveMetrics: { ...evaluate.subjectiveMetrics, goalCompletions: [] },
  } as unknown as EvaluateResponse;

  const nearEval = {
    ...evaluate,
    runId: "jac_run_2",
    enrichedRows: nearDupRows,
    badCaseAssets: [],
    subjectiveMetrics: { ...evaluate.subjectiveMetrics, goalCompletions: [] },
  } as unknown as EvaluateResponse;

  const jStore = createMockStore();

  // Run 1 — admit s_jac as FN.
  const run1 = await runAdmissionPipeline({
    store: jStore,
    evaluate: baseEval,
    tnSampleRate: 0.0,
    humanSamplingRate: 0.0,
  });

  // Run 2 — s_near should be blocked as near_duplicate.
  const run2 = await runAdmissionPipeline({
    store: jStore,
    evaluate: nearEval,
    tnSampleRate: 0.0,
    humanSamplingRate: 0.0,
    allowNearDuplicate: false,
  });

  // ── Compute expected Jaccard score from actual stored transcripts ──────────
  const s_jacRecord  = jStore.cases.find((c) => c.sessionId === "s_jac");
  const s_nearRecord = jStore.cases.find((c) => c.sessionId === "s_near");
  const s_jacTranscript  = s_jacRecord?.transcript ?? "";
  const s_nearTranscript = run2.skips.find((s) => s.sessionId === "s_near") && nearDupRows
    .map((r) => `[turn ${r.turnIndex}] [${r.role}] ${r.content}`)
    .join("\n");

  const jacScore = typeof s_nearTranscript === "string"
    ? jaccardTranscriptSimilarity(s_jacTranscript, s_nearTranscript)
    : 0;

  console.log(`\n${BOLD}Jaccard inter-session near-dedup${RESET}`);

  assert("run 1: s_jac admitted as auto_fn",
    run1.acceptedBySource["auto_fn"] ?? 0, 1);

  assertApproxGte("Jaccard(s_jac, s_near) >= 0.85 (sanity check)", jacScore, 0.85);

  assert("run 2: s_near NOT saved (near_duplicate blocked)",
    s_nearRecord, undefined);

  const nearSkip = run2.skips.find((s) => s.sessionId === "s_near");
  assert("run 2: s_near skip reason = near_duplicate",
    nearSkip?.reason, "near_duplicate");
}

// ── Run the pipeline ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`\n${BOLD}smoke-admission-pipeline${RESET}\n`);
  console.log(`Run: ${RUN_ID}   Sessions: s_tp · s_fn · s_tn · s_unc\n`);

  const store = createMockStore();

  const result = await runAdmissionPipeline({
    store,
    evaluate,
    tnSampleRate: 1.0,          // force TN sampling for clean sessions
    humanSamplingRate: 0.0,     // skip human gate (TP/TN auto-approved)
    allowNearDuplicate: false,
  });

  // ── Assertions ────────────────────────────────────────────────────────────
  //
  // NOTE: The pipeline appends each saved case to existingCases inside the loop
  // so same-session candidates with identical transcript hashes block each other:
  //
  //   s_fn   → FN candidate saved first; TN candidate (same hash) → exact_hash SKIP
  //   s_unc  → TP candidate saved first; uncertainty candidate (same hash) → exact_hash SKIP
  //
  // This is by-design dedup behaviour — a session may only appear once.

  console.log("Channel counts (dedup-aware):");

  const tpCases = store.cases.filter((c) => c.source === "auto_tp");
  const fnCases = store.cases.filter((c) => c.source === "auto_fn");
  const tnCases = store.cases.filter((c) => c.source === "auto_tn");
  const uncCases = store.cases.filter((c) => c.source === "auto_uncertainty");

  // TP: s_tp + s_unc (both have goal_failed tag)
  assert("auto_tp count = 2 (s_tp + s_unc)", tpCases.length, 2);
  // FN: s_fn (negative keyword tail)
  assert("auto_fn count = 1 (s_fn)", fnCases.length, 1);
  // TN: s_tn only (s_fn TN candidate is hash-blocked by its FN candidate)
  assert("auto_tn count = 1 (s_tn only; s_fn TN blocked by hash)", tnCases.length, 1);
  // uncertainty: s_unc is hash-blocked by its TP candidate
  assert("auto_uncertainty count = 0 (s_unc blocked by TP hash)", uncCases.length, 0);

  console.log("\nTotal case counts:");
  // 4 saved: s_tp(TP) + s_fn(FN) + s_tn(TN) + s_unc(TP)  [NOT 5 — unc+fn_tn blocked]
  assert("total saved cases = 4", store.cases.length, 4);
  assert("result.savedCaseIds.length = 4", result.savedCaseIds.length, 4);

  console.log("\nDedup skips:");
  // 2 skipped: s_fn TN (exact_hash) + s_unc uncertainty (exact_hash)
  assert("skippedDuplicates = 2 (s_fn_tn + s_unc_uncertainty)", result.skippedDuplicates, 2);

  console.log("\nhuman review gate (humanSamplingRate=0.0):");
  // FN always flagged; TP/TN sampled at humanSamplingRate=0 → not flagged
  // uncertainty candidate was blocked before reaching human-gate check
  const reviewRequired = store.cases.filter(
    (c) => (c.metadata as Record<string, unknown>)?.humanReviewRequired === true,
  );
  assert("humanReviewQueueCount = 1 (only s_fn FN; TP/TN at rate=0)", result.auditSummary.humanReviewQueued, 1);
  assert("cases with humanReviewRequired=true = 1", reviewRequired.length, 1);
  assert("the flagged case is s_fn FN", reviewRequired[0]?.source, "auto_fn");

  console.log("\ncase set types:");
  const badCaseCases = store.cases.filter((c) => c.caseSetType === "badcase");
  const goodCaseCases = store.cases.filter((c) => c.caseSetType === "goodcase");
  // badcase: s_tp(TP) + s_fn(FN) + s_unc(TP) = 3
  assert("badcase count = 3 (tp×2 + fn)", badCaseCases.length, 3);
  assert("goodcase count = 1 (tn)", goodCaseCases.length, 1);

  console.log("\nreviewed status (all start as auto_captured):");
  const allAutoCaptured = store.cases.every((c) => c.reviewStatus === "auto_captured");
  assert("all cases start as auto_captured", allAutoCaptured, true);

  console.log("\nTP session tags propagated:");
  const tpTpCase = tpCases.find((c) => c.sessionId === "s_tp");
  assert("s_tp has goal_failed tag", tpTpCase?.tags.includes("goal_failed"), true);

  console.log("\nFN triggers fn_dropoff_negative_tail:");
  const fnAutoSignals = fnCases[0]?.autoSignals ?? [];
  const hasFnNegTailRule = fnAutoSignals.some(
    (s: Record<string, unknown>) => s.ruleKey === "fn_dropoff_negative_tail",
  );
  assert("s_fn auto_signal has fn_dropoff_negative_tail", hasFnNegTailRule, true);

  console.log("\nuncertainty channel dedup (known pipeline behaviour):");
  // s_unc uncertainty shares its normalizedTranscriptHash with the s_unc TP
  // candidate (same session rows). The pipeline appends each saved record to
  // existingCases inside the loop, so the uncertainty candidate is rejected as
  // "exact_hash" after TP is saved. One session = one entry.
  assert("s_unc uncertainty blocked: 0 uncertainty cases", uncCases.length, 0);
  const uncSkip = result.skips.find(
    (s) => s.sessionId === "s_unc" && s.channel === "auto_uncertainty",
  );
  assert("s_unc skip reason is exact_hash", uncSkip?.reason, "exact_hash");

  // ── Jaccard near-dedup smoke ──────────────────────────────────────────────
  await runJaccardNearDedupSmoke();

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(`  Total cases saved:    ${store.cases.length}`);
  console.log(`  Channels hit:         TP:${tpCases.length}  FN:${fnCases.length}  TN:${tnCases.length}  UNC:${uncCases.length}`);
  console.log(`  Human review queued:  ${result.auditSummary.humanReviewQueued}`);
  console.log(`  Duplicates skipped:   ${result.skippedDuplicates}`);

  const total = passed + failed;
  if (failed === 0) {
    console.log(`\n${GREEN}${BOLD}✔ All ${total} assertions passed${RESET}\n`);
    process.exitCode = 0;
  } else {
    console.error(`\n${RED}${BOLD}✘ ${failed}/${total} assertions failed${RESET}\n`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(`${RED}[smoke] Fatal error:${RESET}`, error);
  process.exitCode = 1;
});
