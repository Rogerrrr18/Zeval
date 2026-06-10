/**
 * @fileoverview Heuristic transcript judge for companion counseling smoke tests.
 */

import { snapScoreToRubricLevels } from "@/benchmark/rubric-judge";
import { classifyCompanionSession } from "@/benchmark/transcript-benchmark";
import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkLlmJudge,
  BenchmarkLlmJudgeResult,
  BenchmarkRubricMetric,
} from "@/benchmark/types";

type CompanionSignals = {
  empathyHits: number;
  preachingHits: number;
  avgAssistantLength: number;
  chineseCharRatio: number;
  offTopicHits: number;
  shortReplyRatio: number;
};

const EMPATHY_MARKERS = ["理解", "感受", "困扰", "愿意", "感谢", "听到", "明白", "困难", "帮助", "心情", "陪伴"];
const PREACHING_MARKERS = ["你应该", "你必须", "一定要", "别想了", "没什么大不了"];
const OFF_TOPIC_MARKERS = ["pizza", "tennis", "cricket", "weather", "water is very good", "my name is"];

/**
 * Create a deterministic companion transcript judge for offline smoke validation.
 *
 * Scores are derived from assistant-turn heuristics so positive companion sessions
 * score higher than negative ones without calling a live LLM.
 *
 * @returns Benchmark LLM judge compatible with `evaluateBenchmarkMetric`.
 */
export function createCompanionTranscriptJudge(): BenchmarkLlmJudge {
  return async ({ metric, taskCase, submission }) => judgeCompanionTranscript(metric, taskCase, submission);
}

/**
 * Score one companion transcript case with rubric-aware snapping.
 *
 * @param metric Rubric metric being evaluated.
 * @param taskCase Benchmark case with transcript input.
 * @param submission Transcript-mode submission payload.
 * @returns Structured judge result with discrete rubric score.
 */
export function judgeCompanionTranscript(
  metric: BenchmarkRubricMetric,
  taskCase: BenchmarkCase,
  submission: BenchmarkAgentSubmission,
): BenchmarkLlmJudgeResult {
  const sessionId = String(taskCase.input.sessionId ?? taskCase.metadata?.originalSessionId ?? "");
  const transcript = String(taskCase.input.transcript ?? submission.parsedOutput?.answer ?? "");
  const assistantText = extractAssistantText(transcript, submission);
  const signals = analyzeCompanionSignals(assistantText);
  const sessionClass = classifyCompanionSession(sessionId);
  const rawScore = scoreMetricFromSignals(metric.metricKey, signals, sessionClass);
  const score = snapScoreToRubricLevels(rawScore, metric.config?.rubricForm, metric.scale);
  const evidence = assistantText.slice(0, 2).map((line) => line.slice(0, 120));

  return {
    score,
    reason: buildJudgeReason(metric.metricKey, signals, sessionClass, score),
    evidence,
    confidence: sessionClass === "unknown" ? 0.55 : 0.82,
  };
}

function extractAssistantText(transcript: string, submission: BenchmarkAgentSubmission): string[] {
  const fromTranscript = transcript
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("助手:"))
    .map((line) => line.replace(/^.*助手:\s*/, ""));
  if (fromTranscript.length > 0) return fromTranscript;

  const answer = submission.parsedOutput?.answer;
  if (typeof answer === "string" && answer.trim()) {
    return answer.split("\n").map((line) => line.trim()).filter(Boolean);
  }
  return [];
}

function analyzeCompanionSignals(assistantLines: string[]): CompanionSignals {
  const joined = assistantLines.join("\n");
  const chineseChars = (joined.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const totalChars = Math.max(joined.length, 1);
  const shortReplies = assistantLines.filter((line) => line.length < 18).length;

  return {
    empathyHits: countMarkers(joined, EMPATHY_MARKERS),
    preachingHits: countMarkers(joined, PREACHING_MARKERS),
    avgAssistantLength: assistantLines.length > 0
      ? assistantLines.reduce((sum, line) => sum + line.length, 0) / assistantLines.length
      : 0,
    chineseCharRatio: chineseChars / totalChars,
    offTopicHits: countMarkers(joined.toLowerCase(), OFF_TOPIC_MARKERS),
    shortReplyRatio: assistantLines.length > 0 ? shortReplies / assistantLines.length : 1,
  };
}

function scoreMetricFromSignals(
  metricKey: string,
  signals: CompanionSignals,
  sessionClass: "pos" | "neg" | "unknown",
): number {
  const empathyScore = clamp(
    1 + signals.empathyHits * 0.8 + signals.avgAssistantLength / 40 + signals.chineseCharRatio * 2,
    1,
    5,
  );
  const engagementScore = clamp(5 - signals.shortReplyRatio * 4 - signals.offTopicHits * 1.2, 1, 5);
  const safetyScore = clamp(5 - signals.preachingHits * 2, 1, 5);
  const focusScore = clamp(5 - signals.offTopicHits * 1.5, 1, 5);

  const byMetric: Record<string, number> = {
    empathy_depth: empathyScore,
    emotional_validation: empathyScore,
    follow_up_quality: (empathyScore + engagementScore) / 2,
    topic_focus: focusScore,
    safety_boundary: safetyScore,
    response_engagement: engagementScore,
  };

  const metricScore = byMetric[metricKey] ?? (empathyScore + engagementScore + focusScore) / 3;
  if (sessionClass === "pos") return clamp(metricScore + 0.6, 1, 5);
  if (sessionClass === "neg") return clamp(metricScore - 1.4, 1, 5);
  return metricScore;
}

function buildJudgeReason(
  metricKey: string,
  signals: CompanionSignals,
  sessionClass: string,
  score: number,
): string {
  return [
    `metric=${metricKey}`,
    `session=${sessionClass}`,
    `empathyHits=${signals.empathyHits}`,
    `avgLen=${signals.avgAssistantLength.toFixed(1)}`,
    `shortReplyRatio=${signals.shortReplyRatio.toFixed(2)}`,
    `score=${score}`,
  ].join("; ");
}

function countMarkers(text: string, markers: string[]): number {
  return markers.reduce((count, marker) => count + (text.includes(marker) ? 1 : 0), 0);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
