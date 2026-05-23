/**
 * @fileoverview Compute 4 intent eval metrics from SimUser replay run logs.
 *
 * Metrics:
 *   intentCompletionRate  = satisfied_intents / total_intents (per session, then averaged)
 *   clarificationEfficiency = total NOT_SATISFIED turns / total_intents
 *   deviationRate           = DEVIATION turns / total replay turns
 *   turnEfficiency          = T_eval / T_hist (replay turns / historical turns)
 */

import type { EnrichedChatlogRow, IntentEvalMetrics, IntentRunLog, IntentSequenceDoc, SessionIntentMetrics } from "@/types/pipeline";

/**
 * Compute intent eval metrics from SimUser replay run logs.
 *
 * @param runLogsBySession Nested array: outer = per session, inner = all run log entries.
 * @param intentSequences Extracted intent sequences (one per session).
 * @param rows Enriched rows for historical turn count.
 * @returns Aggregated intent eval metrics.
 */
export function computeIntentMetrics(
  runLogsBySession: IntentRunLog[][],
  intentSequences: IntentSequenceDoc[],
  rows: EnrichedChatlogRow[],
): IntentEvalMetrics {
  const rowsBySession = groupRowsBySession(rows);
  const seqBySession = new Map<string, IntentSequenceDoc>(
    intentSequences.map((seq) => [seq.sessionId, seq]),
  );

  const perSession: SessionIntentMetrics[] = [];

  for (const sessionLogs of runLogsBySession) {
    if (sessionLogs.length === 0) continue;

    const sessionId = sessionLogs[0].sessionId;
    const seqDoc = seqBySession.get(sessionId);
    const sessionRows = rowsBySession.get(sessionId) ?? [];
    const historicalTurns = sessionRows.length;

    if (!seqDoc) {
      perSession.push(buildSkippedSessionMetrics(sessionId, "missing_intent_sequence"));
      continue;
    }

    const intentCount = seqDoc.intentSequence.length;
    if (intentCount === 0) {
      perSession.push(buildSkippedSessionMetrics(sessionId, "empty_intent_sequence"));
      continue;
    }

    // Group logs by intentIndex
    const logsByIntent = new Map<number, IntentRunLog[]>();
    for (const log of sessionLogs) {
      if (!logsByIntent.has(log.intentIndex)) logsByIntent.set(log.intentIndex, []);
      logsByIntent.get(log.intentIndex)!.push(log);
    }

    let satisfiedCount = 0;
    let budgetFailedCount = 0;
    let totalReplayTurns = 0;
    let notSatisfiedTurns = 0;
    let deviationTurns = 0;

    for (const intent of seqDoc.intentSequence) {
      const intentLogs = logsByIntent.get(intent.intentIndex) ?? [];
      const lastLog = intentLogs[intentLogs.length - 1];

      if (lastLog?.judgeLabel === "SATISFIED") {
        satisfiedCount += 1;
      } else if (intentLogs.length > 0 && intentLogs[intentLogs.length - 1].events.includes("BUDGET_EXHAUSTED")) {
        budgetFailedCount += 1;
      }

      totalReplayTurns += intentLogs.length;
      notSatisfiedTurns += intentLogs.filter((l) => l.judgeLabel === "NOT_SATISFIED").length;
      deviationTurns += intentLogs.filter((l) => l.judgeLabel === "DEVIATION").length;
    }

    const intentCompletionRate = intentCount > 0 ? satisfiedCount / intentCount : 0;
    const clarificationEfficiency = intentCount > 0 ? notSatisfiedTurns / intentCount : 0;
    const deviationRate = totalReplayTurns > 0 ? deviationTurns / totalReplayTurns : 0;
    const turnEfficiency = historicalTurns > 0 ? totalReplayTurns / historicalTurns : 0;

    perSession.push({
      sessionId,
      intentCount,
      satisfiedCount,
      budgetFailedCount,
      totalReplayTurns,
      historicalTurns,
      intentCompletionRate: round4(intentCompletionRate),
      clarificationEfficiency: round4(clarificationEfficiency),
      deviationRate: round4(deviationRate),
      turnEfficiency: round4(turnEfficiency),
    });
  }

  return {
    aggregate: aggregateSessionMetrics(perSession),
    perSession,
  };
}

function aggregateSessionMetrics(
  perSession: SessionIntentMetrics[],
): IntentEvalMetrics["aggregate"] {
  const active = perSession.filter((s) => !s.skippedReason);
  const n = active.length;
  if (n === 0) {
    return {
      intentCompletionRate: 0,
      clarificationEfficiency: 0,
      deviationRate: 0,
      turnEfficiency: 0,
    };
  }

  return {
    intentCompletionRate: round4(active.reduce((sum, s) => sum + s.intentCompletionRate, 0) / n),
    clarificationEfficiency: round4(active.reduce((sum, s) => sum + s.clarificationEfficiency, 0) / n),
    deviationRate: round4(active.reduce((sum, s) => sum + s.deviationRate, 0) / n),
    turnEfficiency: round4(active.reduce((sum, s) => sum + s.turnEfficiency, 0) / n),
  };
}

function buildSkippedSessionMetrics(sessionId: string, skippedReason: string): SessionIntentMetrics {
  return {
    sessionId,
    intentCount: 0,
    satisfiedCount: 0,
    budgetFailedCount: 0,
    totalReplayTurns: 0,
    historicalTurns: 0,
    intentCompletionRate: 0,
    clarificationEfficiency: 0,
    deviationRate: 0,
    turnEfficiency: 0,
    skippedReason,
  };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function groupRowsBySession(rows: EnrichedChatlogRow[]): Map<string, EnrichedChatlogRow[]> {
  const grouped = new Map<string, EnrichedChatlogRow[]>();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId)!.push(row);
  }
  return grouped;
}
