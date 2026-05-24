/**
 * @fileoverview Five-channel eval-case auto-admission pipeline.
 *
 * Flow:
 *   evaluate done
 *     → buildAdmissionCandidates   (runs TP / FN / TN / uncertainty per session)
 *     → deduplicateCandidates      (exact hash + near-duplicate via existing dedupe)
 *     → humanSamplingGate          (marks each case with humanReviewRequired flag)
 *     → persistCandidates          (upsert to eval_cases via DatasetStore)
 *     → return AdmissionResult     (acceptedBySource counts + audit summary)
 *
 * ── Human sampling gate ────────────────────────────────────────────────────
 * ALL cases are stored with reviewStatus="auto_captured" and a
 * `humanReviewRequired` flag in metadata. A case only becomes "pool-active"
 * (usable for benchmark / regression) once a human has reviewed it and the
 * status advances to "human_reviewed" or higher.
 *
 * Use `isPoolActiveCase(record)` anywhere you need to check pool membership.
 *
 * humanSamplingRate controls what fraction of TP / TN (auto_admitted) cases
 * are flagged for mandatory human review. FN and uncertainty cases are always
 * flagged regardless of the rate.
 *   1.0 (default) — every auto-admitted case requires review
 *   0.3           — 30% random sample of TP/TN requires review; rest are
 *                   pre-approved but still start as auto_captured
 *   0.0           — TP/TN skip human review (not recommended for production)
 */

import { randomBytes } from "node:crypto";
import { findBadCaseDuplicate } from "@/badcase/dedupe";
import { buildBadCaseFeatureSnapshot } from "@/badcase/feature";
import { computeNormalizedTranscriptHash } from "@/eval-datasets/case-transcript-hash";
import {
  evaluateFNRules,
  evaluateTNRules,
  evaluateTPRules,
  evaluateUncertaintyRule,
  getDimensionScore,
  topSeverity,
  type AdmissionRuleSeverity,
  type TriggeredRule,
} from "@/eval-datasets/admission/rules";
import type { DatasetStore } from "@/eval-datasets/storage/dataset-store";
import type { DatasetCaseRecord, DatasetCaseSource } from "@/eval-datasets/storage/types";
import type { EnrichedChatlogRow, EvaluateResponse } from "@/types/pipeline";

// ── Public types ───────────────────────────────────────────────────────────

/** One admission candidate produced before dedup / persistence. */
export type AdmissionCandidate = {
  candidateId: string;
  sessionId: string;
  channel: DatasetCaseSource;
  caseSetType: "goodcase" | "badcase";
  triggeredRules: TriggeredRule[];
  severity: AdmissionRuleSeverity;
  normalizedTranscriptHash: string;
  transcript: string;
  /** pending_review = FN / uncertainty; auto_admitted = TP / TN confirmed */
  reviewStatus: "auto_admitted" | "pending_review";
  snapshot: {
    tags: string[];
    goalStatus?: string;
    signalKeys: string[];
  };
};

/** Skip record emitted when dedup prevents admission. */
export type AdmissionSkip = {
  candidateId: string;
  sessionId: string;
  channel: DatasetCaseSource;
  reason: "exact_hash" | "near_duplicate" | "false_positive_match";
  matchedCaseId?: string;
  skippedRules: TriggeredRule[];
};

/** Final result returned to callers. */
export type AdmissionResult = {
  savedCaseIds: string[];
  acceptedBySource: Partial<Record<DatasetCaseSource, number>>;
  pendingReviewCount: number;
  /**
   * Number of saved cases that were flagged for mandatory human review
   * (`metadata.humanReviewRequired === true`). These cases are stored but
   * NOT pool-active until reviewed. Use `isPoolActiveCase()` to check.
   */
  humanReviewQueueCount: number;
  skippedDuplicates: number;
  skippedFalsePositive: number;
  skips: AdmissionSkip[];
  auditSummary: {
    evaluationRunId: string;
    candidateTotal: number;
    accepted: number;
    skipped: number;
    /** How many of the accepted cases are waiting for human review. */
    humanReviewQueued: number;
  };
};

// ── Pipeline entry point ───────────────────────────────────────────────────

/**
 * Run the full five-channel admission pipeline for one evaluate response.
 *
 * @param params Pipeline parameters.
 * @returns Admission result with counts and saved case IDs.
 */
export async function runAdmissionPipeline(params: {
  store: DatasetStore;
  evaluate: EvaluateResponse;
  /** Probability for `clean_session_sampled` TN rule (default 0.05). */
  tnSampleRate?: number;
  /** When true, near-duplicate sessions are admitted despite the near-dup flag. */
  allowNearDuplicate?: boolean;
  baselineVersion?: string;
  /**
   * Fraction of TP / TN (auto-admitted) cases that must pass human review
   * before becoming pool-active. Range [0, 1]. Default from env
   * `ZEVAL_ADMISSION_HUMAN_SAMPLING_RATE`, falling back to 1.0.
   *
   * FN and uncertainty cases are **always** flagged for review regardless of
   * this value — they represent uncertain signals that need human confirmation.
   *
   * Set to 0.0 only in tests / local development where human review is skipped.
   */
  humanSamplingRate?: number;
  /**
   * Capability dimension tag to stamp on every admitted case in this batch
   * (e.g. "multi_turn_coherence"). When provided, all cases get the same
   * dimension; per-case overrides are not yet supported.
   */
  capabilityDimension?: string;
}): Promise<AdmissionResult> {
  const tnSampleRateDefault = Number(
    process.env.ZEVAL_ADMISSION_TN_SAMPLE_RATE ?? "",
  ) || 0.05;
  const humanSamplingRateDefault = Number(
    process.env.ZEVAL_ADMISSION_HUMAN_SAMPLING_RATE ?? "",
  ) || 1.0;
  const {
    store,
    evaluate,
    tnSampleRate = tnSampleRateDefault,
    allowNearDuplicate = false,
    baselineVersion = evaluate.runId,
    humanSamplingRate = humanSamplingRateDefault,
    capabilityDimension,
  } = params;

  // Load existing cases once — used for all dedup checks.
  const existingCases = await store.listCases();

  // 1. Build candidates across all channels.
  const candidates = buildAdmissionCandidates(evaluate, tnSampleRate);

  // 2. Deduplicate and persist.
  const savedCaseIds: string[] = [];
  const acceptedBySource: Partial<Record<DatasetCaseSource, number>> = {};
  const skips: AdmissionSkip[] = [];
  let pendingReviewCount = 0;
  let humanReviewQueueCount = 0;

  for (const candidate of candidates) {
    // Dedup check using existing badcase dedupe logic.
    const dupeResult = checkCandidateDuplicate(candidate, evaluate, existingCases);

    if (dupeResult.isDuplicate) {
      const reason = dupeResult.reason as AdmissionSkip["reason"];

      // false_positive_match: hard block regardless of allowNearDuplicate.
      if (reason === "false_positive_match") {
        skips.push({
          candidateId: candidate.candidateId,
          sessionId: candidate.sessionId,
          channel: candidate.channel,
          reason,
          matchedCaseId: dupeResult.matchedCaseId,
          skippedRules: candidate.triggeredRules,
        });
        continue;
      }

      // exact_hash: always skip.
      if (reason === "exact_hash") {
        skips.push({
          candidateId: candidate.candidateId,
          sessionId: candidate.sessionId,
          channel: candidate.channel,
          reason,
          matchedCaseId: dupeResult.matchedCaseId,
          skippedRules: candidate.triggeredRules,
        });
        continue;
      }

      // near_duplicate: skip unless caller opts in.
      if (reason === "near_duplicate" && !allowNearDuplicate) {
        skips.push({
          candidateId: candidate.candidateId,
          sessionId: candidate.sessionId,
          channel: candidate.channel,
          reason,
          matchedCaseId: dupeResult.matchedCaseId,
          skippedRules: candidate.triggeredRules,
        });
        continue;
      }
    }

    // ── Human sampling gate ──────────────────────────────────────────────────
    // Decide whether this case must be reviewed by a human before it becomes
    // pool-active. FN / uncertainty are always flagged. TP / TN are sampled
    // at the configured humanSamplingRate.
    const humanReviewRequired = decideSamplingForHumanReview(candidate, humanSamplingRate);

    // Persist the candidate as a dataset case.
    const caseId = allocateCaseId(candidate.caseSetType);
    const now = new Date().toISOString();
    const record: DatasetCaseRecord = {
      caseId,
      caseSetType: candidate.caseSetType,
      source: candidate.channel,
      sessionId: candidate.sessionId,
      topicSegmentId: candidate.sessionId,
      topicLabel: buildTopicLabel(candidate),
      topicSummary: "",
      normalizedTranscriptHash: candidate.normalizedTranscriptHash,
      baselineVersion,
      baselineCaseScore: candidate.caseSetType === "badcase"
        ? severityToBaselineScore(candidate.severity)
        : 0.9,
      tags: candidate.snapshot.tags,
      transcript: candidate.transcript,
      autoSignals: candidate.triggeredRules.map((r) => ({ ruleKey: r.key, severity: r.severity })),
      // All cases enter at "auto_captured". Pool membership is determined by
      // isPoolActiveCase(): only "human_reviewed" and above are pool-active.
      // humanReviewRequired in metadata is the authoritative flag for the UI
      // review queue — it gates whether the case can advance to human_reviewed.
      reviewStatus: "auto_captured",
      ...(capabilityDimension ? { capabilityDimension } : {}),
      metadata: {
        humanReviewRequired,
        // Record the queue timestamp so the UI can sort / alert on stale cases.
        ...(humanReviewRequired ? { humanReviewQueuedAt: now } : {}),
      },
      createdAt: now,
      updatedAt: now,
    };

    await store.createCase(record);
    savedCaseIds.push(caseId);
    // Track by source
    acceptedBySource[candidate.channel] = (acceptedBySource[candidate.channel] ?? 0) + 1;
    if (candidate.reviewStatus === "pending_review") pendingReviewCount++;
    if (humanReviewRequired) humanReviewQueueCount++;
    // Keep existing pool in sync for subsequent dedup checks.
    existingCases.push(record);
  }

  const skippedDuplicates = skips.filter(
    (s) => s.reason === "exact_hash" || s.reason === "near_duplicate",
  ).length;
  const skippedFalsePositive = skips.filter((s) => s.reason === "false_positive_match").length;

  return {
    savedCaseIds,
    acceptedBySource,
    pendingReviewCount,
    humanReviewQueueCount,
    skippedDuplicates,
    skippedFalsePositive,
    skips,
    auditSummary: {
      evaluationRunId: evaluate.runId,
      candidateTotal: candidates.length,
      accepted: savedCaseIds.length,
      skipped: skips.length,
      humanReviewQueued: humanReviewQueueCount,
    },
  };
}

// ── Pool membership gate ───────────────────────────────────────────────────

/**
 * Whether a dataset case record is "pool-active" — i.e. usable for benchmark
 * construction, regression runs, and evaluation statistics.
 *
 * A case is pool-active only after a human has reviewed it (status ≥
 * "human_reviewed"). Cases sitting at "auto_captured" are in the staging
 * area and must NOT be used as ground truth.
 *
 * @param record Dataset case record to check.
 * @returns True when the case may be used as benchmark ground truth.
 */
export function isPoolActiveCase(record: DatasetCaseRecord): boolean {
  const poolActiveStatuses: DatasetCaseRecord["reviewStatus"][] = [
    "human_reviewed",
    "gold_candidate",
    "gold",
    "regression_active",
  ];
  return poolActiveStatuses.includes(record.reviewStatus ?? "auto_captured");
}

// ── Candidate builder ──────────────────────────────────────────────────────

/**
 * Build admission candidates for every session in the evaluate response.
 *
 * @param evaluate Full evaluate response.
 * @param tnSampleRate Probability for clean-session TN sampling.
 * @returns All candidates before dedup.
 */
function buildAdmissionCandidates(
  evaluate: EvaluateResponse,
  tnSampleRate: number,
): AdmissionCandidate[] {
  const sessions = groupRowsBySession(evaluate.enrichedRows);
  const badCaseSessionIds = new Set(evaluate.badCaseAssets.map((a) => a.sessionId));
  const llmAvailable = evaluate.subjectiveMetrics.status === "ready";

  // Aggregated dimension scores (MVP: not per-session).
  const empathyScore = getDimensionScore(evaluate.subjectiveMetrics.dimensions, "共情程度");
  const offTopicScore = getDimensionScore(evaluate.subjectiveMetrics.dimensions, "答非所问/无视风险");
  const preachyScore = getDimensionScore(evaluate.subjectiveMetrics.dimensions, "说教感/压迫感");

  const candidates: AdmissionCandidate[] = [];

  for (const [sessionId, rows] of sessions.entries()) {
    const transcript = rows
      .map((r) => `[turn ${r.turnIndex}] [${r.role}] ${r.content}`)
      .join("\n");
    const normalizedTranscriptHash = computeNormalizedTranscriptHash(transcript);
    const goalCompletion = evaluate.subjectiveMetrics.goalCompletions.find(
      (g) => g.sessionId === sessionId,
    );
    const sessionSignals = evaluate.subjectiveMetrics.signals.filter((s) =>
      s.evidenceTurnRange.startsWith(`${sessionId}:`),
    );

    if (badCaseSessionIds.has(sessionId)) {
      // ── TP channel ─────────────────────────────────────────────────────
      const asset = evaluate.badCaseAssets.find((a) => a.sessionId === sessionId)!;
      const tpRules = evaluateTPRules(
        asset,
        sessionSignals,
        empathyScore,
        offTopicScore,
        preachyScore,
        llmAvailable,
      );

      if (tpRules.length > 0) {
        candidates.push({
          candidateId: allocateCandidateId(),
          sessionId,
          channel: "auto_tp",
          caseSetType: "badcase",
          triggeredRules: tpRules,
          severity: topSeverity(tpRules),
          normalizedTranscriptHash,
          transcript,
          reviewStatus: "auto_admitted",
          snapshot: {
            tags: [...asset.tags],
            goalStatus: goalCompletion?.status,
            signalKeys: sessionSignals.map((s) => s.signalKey),
          },
        });
      }

      // ── Uncertainty channel ─────────────────────────────────────────────
      if (
        llmAvailable &&
        evaluateUncertaintyRule(goalCompletion, evaluate.subjectiveMetrics.dimensions)
      ) {
        candidates.push({
          candidateId: allocateCandidateId(),
          sessionId,
          channel: "auto_uncertainty",
          caseSetType: "badcase",
          triggeredRules: [{ key: "judge_uncertainty", severity: "medium" }],
          severity: "medium",
          normalizedTranscriptHash,
          transcript,
          reviewStatus: "pending_review",
          snapshot: {
            tags: [...asset.tags],
            goalStatus: goalCompletion?.status,
            signalKeys: sessionSignals.map((s) => s.signalKey),
          },
        });
      }
    } else {
      // ── FN channel ──────────────────────────────────────────────────────
      const fnRules = evaluateFNRules(rows);
      if (fnRules.length > 0) {
        candidates.push({
          candidateId: allocateCandidateId(),
          sessionId,
          channel: "auto_fn",
          caseSetType: "badcase",
          triggeredRules: fnRules,
          severity: topSeverity(fnRules),
          normalizedTranscriptHash,
          transcript,
          reviewStatus: "pending_review",
          snapshot: {
            tags: [],
            goalStatus: goalCompletion?.status,
            signalKeys: sessionSignals.map((s) => s.signalKey),
          },
        });
      }

      // ── TN channel ──────────────────────────────────────────────────────
      const tnRules = evaluateTNRules(
        goalCompletion,
        empathyScore,
        llmAvailable,
        tnSampleRate,
      );
      if (tnRules.length > 0) {
        candidates.push({
          candidateId: allocateCandidateId(),
          sessionId,
          channel: "auto_tn",
          caseSetType: "goodcase",
          triggeredRules: tnRules,
          severity: "low",
          normalizedTranscriptHash,
          transcript,
          reviewStatus: "auto_admitted",
          snapshot: {
            tags: [],
            goalStatus: goalCompletion?.status,
            signalKeys: [],
          },
        });
      }
    }
  }

  return candidates;
}

// ── Dedup ──────────────────────────────────────────────────────────────────

type DupeDecision =
  | { isDuplicate: false }
  | { isDuplicate: true; reason: "exact_hash" | "near_duplicate" | "false_positive_match"; matchedCaseId?: string };

/**
 * Check one admission candidate against the existing case pool.
 * Respects `false_positive` metadata to prevent re-admission.
 *
 * @param candidate Admission candidate.
 * @param evaluate Full evaluate response (used to build feature snapshot for TP cases).
 * @param existingCases Current case pool.
 * @returns Dedup decision.
 */
function checkCandidateDuplicate(
  candidate: AdmissionCandidate,
  evaluate: EvaluateResponse,
  existingCases: DatasetCaseRecord[],
): DupeDecision {
  // 1. false_positive guard — block session regardless of channel.
  const fpMatch = existingCases.find(
    (c) =>
      c.sessionId === candidate.sessionId &&
      (c.metadata as Record<string, unknown> | undefined)?.false_positive === true,
  );
  if (fpMatch) {
    return { isDuplicate: true, reason: "false_positive_match", matchedCaseId: fpMatch.caseId };
  }

  // 2. Exact hash.
  const exactMatch = existingCases.find(
    (c) => c.normalizedTranscriptHash === candidate.normalizedTranscriptHash,
  );
  if (exactMatch) {
    return { isDuplicate: true, reason: "exact_hash", matchedCaseId: exactMatch.caseId };
  }

  // 3. Near-duplicate (TP / badcases only) — reuse feature-vector dedupe.
  if (candidate.channel === "auto_tp") {
    const assetIndex = evaluate.badCaseAssets.findIndex(
      (a) => a.sessionId === candidate.sessionId,
    );
    if (assetIndex >= 0) {
      const featureSnapshot = buildBadCaseFeatureSnapshot(evaluate, assetIndex);
      const decision = findBadCaseDuplicate(
        { normalizedTranscriptHash: candidate.normalizedTranscriptHash, featureSnapshot },
        existingCases,
      );
      if (decision.isDuplicate && decision.layer !== "l1_exact_hash") {
        return { isDuplicate: true, reason: "near_duplicate", matchedCaseId: decision.matchedCaseId };
      }
    }
  }

  return { isDuplicate: false };
}

// ── Utilities ──────────────────────────────────────────────────────────────

/**
 * Decide whether a candidate must be reviewed by a human before it becomes
 * pool-active.
 *
 * Policy:
 *  - FN / uncertainty channels: always required — these represent uncertain or
 *    potentially missed signals that need human confirmation before entering
 *    the benchmark as ground truth.
 *  - TP / TN channels: sampled at `humanSamplingRate`. When rate=1.0 every
 *    auto-admitted case is queued; when rate=0.3 only 30% are.
 *
 * @param candidate Admission candidate.
 * @param samplingRate Fraction of TP/TN cases to flag (0–1).
 * @returns Whether this case requires human review before pool activation.
 */
function decideSamplingForHumanReview(
  candidate: AdmissionCandidate,
  samplingRate: number,
): boolean {
  // FN and uncertainty always need human confirmation — their signals are
  // weaker or the judge confidence is low.
  if (candidate.channel === "auto_fn" || candidate.channel === "auto_uncertainty") {
    return true;
  }
  // TP and TN: apply the configured sampling rate.
  const rate = Math.max(0, Math.min(1, samplingRate));
  return Math.random() < rate;
}

function groupRowsBySession(
  rows: EnrichedChatlogRow[],
): Map<string, EnrichedChatlogRow[]> {
  const map = new Map<string, EnrichedChatlogRow[]>();
  for (const row of rows) {
    if (!map.has(row.sessionId)) map.set(row.sessionId, []);
    map.get(row.sessionId)!.push(row);
  }
  return map;
}

function allocateCandidateId(): string {
  return `ca_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

function allocateCaseId(caseSetType: "goodcase" | "badcase"): string {
  const prefix = caseSetType === "goodcase" ? "gc" : "bc";
  return `${prefix}_${Date.now()}_${randomBytes(3).toString("hex")}`;
}

/**
 * Map admission severity to a normalised baseline case score.
 *
 * @param severity Admission severity.
 * @returns Baseline score (0–1, lower is worse for badcases).
 */
function severityToBaselineScore(severity: AdmissionRuleSeverity): number {
  if (severity === "high") return 0.2;
  if (severity === "medium") return 0.4;
  return 0.6;
}

/**
 * Build a human-readable topic label for one admission candidate.
 *
 * @param candidate Admission candidate.
 * @returns Short label string.
 */
function buildTopicLabel(candidate: AdmissionCandidate): string {
  if (candidate.channel === "auto_tn") return "golden_positive";
  const primaryRule = candidate.triggeredRules[0]?.key ?? "unknown";
  return `${candidate.channel}:${primaryRule}`;
}
