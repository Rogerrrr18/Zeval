/**
 * @fileoverview Rubric-level score snapping and judge guardrails.
 */

import type { BenchmarkRubricScoreLevel } from "./types.ts";

/**
 * Snap a raw judge score to the nearest rubricForm level.
 *
 * @param score Raw judge score.
 * @param rubricForm Structured rubric levels; falls back to min/mid/max when empty.
 * @param scale Metric scale bounds.
 * @returns Nearest allowed rubric score.
 */
export function snapScoreToRubricLevels(
  score: number,
  rubricForm: BenchmarkRubricScoreLevel[] | undefined,
  scale: { min: number; max: number },
): number {
  const levels = rubricForm?.length
    ? [...new Set(rubricForm.map((level) => level.score))].sort((left, right) => left - right)
    : [scale.min, Math.round((scale.min + scale.max) / 2), scale.max];

  if (levels.length === 0) {
    return clamp(score, scale.min, scale.max);
  }

  let nearest = levels[0];
  let minDistance = Math.abs(score - nearest);
  for (const level of levels) {
    const distance = Math.abs(score - level);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = level;
    }
  }
  return nearest;
}

/**
 * Block inflated max scores when the judge returns no evidence.
 *
 * @param score Snapped rubric score.
 * @param evidence Judge evidence strings.
 * @param scale Metric scale bounds.
 * @param evidenceRequired Whether the metric requires evidence for top scores.
 * @returns True when the result should be blocked instead of scored.
 */
export function shouldBlockMaxScoreWithoutEvidence(
  score: number,
  evidence: string[],
  scale: { min: number; max: number },
  evidenceRequired = true,
): boolean {
  if (!evidenceRequired) return false;
  const hasEvidence = evidence.some((item) => item.trim().length > 0);
  return score >= scale.max && !hasEvidence;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
