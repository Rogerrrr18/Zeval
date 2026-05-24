/**
 * @fileoverview Admission rule definitions and per-channel evaluators.
 *
 * Implements the 5 channels from PRD §13:
 *   auto_tp          — rule / judge flagged bad (true positive)
 *   auto_fn          — system OK, but behaviour signals bad (false negative)
 *   auto_tn          — high-quality session sampled as golden positive
 *   auto_uncertainty — judge confidence ∈ [0.4, 0.6]
 *   auto_disagreement— skipped in MVP (fused pipeline has no dual-track)
 *
 * Each evaluator is pure and receives only the data it needs,
 * so it can be unit-tested without an evaluate response fixture.
 */

import { findNegativeKeyword } from "@/pipeline/keywords/negative-zh";
import type {
  EnrichedChatlogRow,
  GoalCompletionResult,
  ImplicitSignal,
  SubjectiveDimensionResult,
} from "@/types/pipeline";
import type { BadCaseAsset } from "@/types/pipeline";

// ── Types ──────────────────────────────────────────────────────────────────

export type AdmissionRuleSeverity = "low" | "medium" | "high";

export type AdmissionRuleKey =
  // TP rules
  | "goal_failed"
  | "low_empathy"
  | "off_topic_high"
  | "preachy_high"
  | "interest_decline"
  | "understanding_barrier"
  | "recovery_failure"
  | "high_dropoff"
  // FN rules
  | "fn_dropoff_negative_tail"
  | "fn_repeated_question"
  | "fn_length_collapse"
  | "fn_consecutive_short"
  // TN rules
  | "goal_achieved_high_score"
  | "clean_session_sampled"
  // Uncertainty
  | "judge_uncertainty";

export type TriggeredRule = {
  key: AdmissionRuleKey;
  severity: AdmissionRuleSeverity;
};

/**
 * Default rule catalogue. All thresholds are configurable via
 * `dataset_admission_rules` (future Supabase table). For MVP these
 * defaults are used directly.
 */
export const DEFAULT_ADMISSION_RULES: Record<
  AdmissionRuleKey,
  { severity: AdmissionRuleSeverity; enabled: boolean }
> = {
  // TP
  goal_failed:           { severity: "high",   enabled: true },
  low_empathy:           { severity: "medium", enabled: true },
  off_topic_high:        { severity: "medium", enabled: true },
  preachy_high:          { severity: "medium", enabled: true },
  interest_decline:      { severity: "medium", enabled: true },
  understanding_barrier: { severity: "medium", enabled: true },
  recovery_failure:      { severity: "high",   enabled: true },
  high_dropoff:          { severity: "low",    enabled: true },
  // FN
  fn_dropoff_negative_tail: { severity: "medium", enabled: true },
  fn_repeated_question:     { severity: "medium", enabled: true },
  fn_length_collapse:       { severity: "medium", enabled: true },
  fn_consecutive_short:     { severity: "low",    enabled: true },
  // TN
  goal_achieved_high_score: { severity: "low", enabled: true },
  clean_session_sampled:    { severity: "low", enabled: true },
  // Uncertainty
  judge_uncertainty: { severity: "medium", enabled: true },
};

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Read one subjective dimension score. Defaults to 3 (neutral) when absent.
 *
 * @param dimensions Aggregated subjective dimension results.
 * @param name Chinese dimension name.
 * @returns Score 1–5.
 */
export function getDimensionScore(
  dimensions: SubjectiveDimensionResult[],
  name: string,
): number {
  return dimensions.find((d) => d.dimension === name)?.score ?? 3;
}

/**
 * Read one subjective dimension confidence. Defaults to 1 when absent.
 *
 * @param dimensions Aggregated subjective dimension results.
 * @param name Chinese dimension name.
 * @returns Confidence 0–1.
 */
export function getDimensionConfidence(
  dimensions: SubjectiveDimensionResult[],
  name: string,
): number {
  return dimensions.find((d) => d.dimension === name)?.confidence ?? 1;
}

/**
 * Derive top severity from a list of triggered rules.
 *
 * @param rules Triggered rules.
 * @returns Highest severity, or "low" when the list is empty.
 */
export function topSeverity(rules: TriggeredRule[]): AdmissionRuleSeverity {
  if (rules.some((r) => r.severity === "high")) return "high";
  if (rules.some((r) => r.severity === "medium")) return "medium";
  return "low";
}

/**
 * Normalise a user message for repeated-question detection.
 *
 * @param content Raw message content.
 * @returns Normalised key.
 */
function normaliseQuestion(content: string): string {
  return content
    .replace(/[？?，,。.!！\s]/g, "")
    .toLowerCase()
    .slice(0, 20);
}

// ── TP channel ─────────────────────────────────────────────────────────────

/**
 * Evaluate TP admission rules for one session that already appears in
 * `badCaseAssets` (i.e. the pipeline already flagged it bad).
 *
 * Rules that depend on LLM judge output (low_empathy, off_topic_high,
 * preachy_high) use the aggregated dimension scores because per-session
 * dimension breakdowns are not yet stored separately in this MVP.
 *
 * @param asset Bad case asset for this session.
 * @param sessionSignals Implicit signals scoped to this session.
 * @param empathyScore Aggregated empathy score (1–5).
 * @param offTopicScore Aggregated off-topic score (1–5).
 * @param preachyScore Aggregated preachy score (1–5).
 * @param llmAvailable Whether subjective judge ran successfully.
 * @returns Triggered TP rules.
 */
export function evaluateTPRules(
  asset: BadCaseAsset,
  sessionSignals: ImplicitSignal[],
  empathyScore: number,
  offTopicScore: number,
  preachyScore: number,
  llmAvailable: boolean,
): TriggeredRule[] {
  const rules: TriggeredRule[] = [];
  const def = DEFAULT_ADMISSION_RULES;

  // goal_failed — covers both "failed" and "partial" statuses
  if (
    def.goal_failed.enabled &&
    (asset.tags.includes("goal_failed") || asset.tags.includes("goal_partial"))
  ) {
    rules.push({ key: "goal_failed", severity: def.goal_failed.severity });
  }

  // low_empathy / off_topic_high / preachy_high (LLM-gated)
  if (llmAvailable) {
    if (def.low_empathy.enabled && empathyScore <= 2) {
      rules.push({ key: "low_empathy", severity: def.low_empathy.severity });
    }
    if (def.off_topic_high.enabled && offTopicScore <= 2) {
      rules.push({ key: "off_topic_high", severity: def.off_topic_high.severity });
    }
    if (def.preachy_high.enabled && preachyScore <= 2) {
      rules.push({ key: "preachy_high", severity: def.preachy_high.severity });
    }
  }

  // interest_decline — per-session implicit signal
  if (
    def.interest_decline.enabled &&
    sessionSignals.some(
      (s) =>
        s.signalKey === "interestDeclineRisk" &&
        (s.severity === "medium" || s.severity === "high"),
    )
  ) {
    rules.push({ key: "interest_decline", severity: def.interest_decline.severity });
  }

  // understanding_barrier — asset tag or per-session signal
  if (
    def.understanding_barrier.enabled &&
    (asset.tags.includes("understanding_barrier") ||
      sessionSignals.some(
        (s) =>
          s.signalKey === "understandingBarrierRisk" &&
          (s.severity === "medium" || s.severity === "high"),
      ))
  ) {
    rules.push({ key: "understanding_barrier", severity: def.understanding_barrier.severity });
  }

  // recovery_failure
  if (def.recovery_failure.enabled && asset.tags.includes("recovery_failed")) {
    rules.push({ key: "recovery_failure", severity: def.recovery_failure.severity });
  }

  // high_dropoff — short session with negative keyword escalation
  if (
    def.high_dropoff.enabled &&
    (asset.tags.includes("escalation_keyword") || asset.tags.includes("question_repeat"))
  ) {
    rules.push({ key: "high_dropoff", severity: def.high_dropoff.severity });
  }

  return rules;
}

// ── FN channel ─────────────────────────────────────────────────────────────

/**
 * Evaluate FN proxy rules for a session the pipeline did NOT flag as bad.
 * These rules rely solely on text-level behaviour signals.
 *
 * @param rows Enriched rows for this session (all roles).
 * @returns Triggered FN rules.
 */
export function evaluateFNRules(rows: EnrichedChatlogRow[]): TriggeredRule[] {
  const rules: TriggeredRule[] = [];
  const userRows = rows.filter((r) => r.role === "user");
  const def = DEFAULT_ADMISSION_RULES;

  // fn_dropoff_negative_tail — ≥2 of last 3 user msgs carry negative keywords,
  // and the final message is from a user
  if (def.fn_dropoff_negative_tail.enabled && userRows.length >= 2) {
    const lastThree = userRows.slice(-3);
    const negCount = lastThree.filter((r) => findNegativeKeyword(r.content) !== null).length;
    const lastRow = rows[rows.length - 1];
    if (negCount >= 2 && lastRow?.role === "user") {
      rules.push({ key: "fn_dropoff_negative_tail", severity: def.fn_dropoff_negative_tail.severity });
    }
  }

  // fn_repeated_question — same normalised question appears ≥2 times
  if (def.fn_repeated_question.enabled) {
    const counts = new Map<string, number>();
    userRows.forEach((r) => {
      const key = normaliseQuestion(r.content);
      if (key.length >= 3) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    if ([...counts.values()].some((c) => c >= 2)) {
      rules.push({ key: "fn_repeated_question", severity: def.fn_repeated_question.severity });
    }
  }

  // fn_length_collapse — user back-half avg length < front-half × 0.6, ≥6 turns total
  if (def.fn_length_collapse.enabled && rows.length >= 6 && userRows.length >= 4) {
    const half = Math.floor(userRows.length / 2);
    const front = userRows.slice(0, half);
    const back = userRows.slice(half);
    const avgFront = front.reduce((s, r) => s + r.content.length, 0) / front.length;
    const avgBack = back.reduce((s, r) => s + r.content.length, 0) / back.length;
    if (avgFront > 0 && avgBack < avgFront * 0.6) {
      rules.push({ key: "fn_length_collapse", severity: def.fn_length_collapse.severity });
    }
  }

  // fn_consecutive_short — 3+ consecutive user msgs ≤5 chars, ending on user
  if (def.fn_consecutive_short.enabled && userRows.length >= 3) {
    const lastThreeUser = userRows.slice(-3);
    const lastRow = rows[rows.length - 1];
    if (
      lastThreeUser.every((r) => r.content.trim().length <= 5) &&
      lastRow?.role === "user"
    ) {
      rules.push({ key: "fn_consecutive_short", severity: def.fn_consecutive_short.severity });
    }
  }

  return rules;
}

// ── TN channel ─────────────────────────────────────────────────────────────

/**
 * Evaluate TN rules for a session the pipeline did NOT flag as bad.
 * Returns at most one TN rule per session.
 *
 * @param goalCompletion Per-session goal completion result (or undefined).
 * @param empathyScore Aggregated empathy score (1–5).
 * @param llmAvailable Whether subjective judge ran successfully.
 * @param sampleRate Probability for random clean-session sampling (0–1).
 * @returns Triggered TN rules (0 or 1 entry).
 */
export function evaluateTNRules(
  goalCompletion: GoalCompletionResult | undefined,
  empathyScore: number,
  llmAvailable: boolean,
  sampleRate: number,
): TriggeredRule[] {
  const def = DEFAULT_ADMISSION_RULES;

  // goal_achieved_high_score — strong LLM signal
  if (
    def.goal_achieved_high_score.enabled &&
    llmAvailable &&
    goalCompletion?.status === "achieved" &&
    (goalCompletion.confidence ?? 0) > 0.6 &&
    empathyScore >= 4
  ) {
    return [{ key: "goal_achieved_high_score", severity: def.goal_achieved_high_score.severity }];
  }

  // clean_session_sampled — stochastic fallback
  if (def.clean_session_sampled.enabled && Math.random() < sampleRate) {
    return [{ key: "clean_session_sampled", severity: def.clean_session_sampled.severity }];
  }

  return [];
}

// ── Uncertainty channel ─────────────────────────────────────────────────────

/**
 * Determine whether a session should enter the uncertainty channel.
 * Fires when any subjective judge confidence falls in [lo, hi].
 *
 * Bounds are configurable via:
 *   ZEVAL_UNCERTAINTY_CONF_LO  (default 0.4)
 *   ZEVAL_UNCERTAINTY_CONF_HI  (default 0.6)
 *
 * @param goalCompletion Per-session goal completion result (or undefined).
 * @param dimensions Aggregated dimension results.
 * @returns True when uncertainty rule fires.
 */
export function evaluateUncertaintyRule(
  goalCompletion: GoalCompletionResult | undefined,
  dimensions: SubjectiveDimensionResult[],
): boolean {
  if (!DEFAULT_ADMISSION_RULES.judge_uncertainty.enabled) return false;

  const lo = parseFloat(process.env.ZEVAL_UNCERTAINTY_CONF_LO ?? "0.4");
  const hi = parseFloat(process.env.ZEVAL_UNCERTAINTY_CONF_HI ?? "0.6");

  const gcConf = goalCompletion?.confidence ?? 1;
  if (gcConf >= lo && gcConf <= hi) return true;

  return dimensions.some((d) => d.confidence >= lo && d.confidence <= hi);
}
