/**
 * @fileoverview Recovery trace insight panel.
 */

import type { RecoveryTraceResult } from "@/types/pipeline";
import styles from "./evalConsole.module.css";

/**
 * Render extracted recovery traces.
 *
 * @param props Recovery trace props.
 * @returns Recovery trace content.
 */
export function RecoveryTracePanel(props: { items: RecoveryTraceResult[] }) {
  const rows = [...props.items]
    .filter((item) => item.status !== "none")
    .sort((left, right) => rankTrace(left) - rankTrace(right))
    .slice(0, 6);

  if (rows.length === 0) {
    return <div className={styles.emptyState}>当前尚未识别到明确的失败后恢复轨迹。</div>;
  }

  return (
    <div className={styles.traceList}>
      {rows.map((item) => (
        <article className={styles.traceCard} key={`${item.sessionId}-${item.failureTurn}-${item.recoveryTurn}`}>
          <div className={styles.insightHeader}>
            <div className={styles.insightTitleBlock}>
              <strong>{formatFailureType(item.failureType)}</strong>
              <span>session · {item.sessionId}</span>
            </div>
            <div className={styles.insightMeta}>
              <span className={`${styles.insightBadge} ${styles[`insightBadge${traceVariant(item.status)}`]}`}>
                {formatTraceStatus(item.status)}
              </span>
              <span className={styles.scoreBadge}>{item.qualityScore.toFixed(1)}/5</span>
            </div>
          </div>
          <p className={styles.insightSubcopy}>
            失败轮次 {formatTurn(item.failureTurn)} · 恢复轮次 {formatTurn(item.recoveryTurn)} ·
            策略来源 {item.repairStrategySource === "llm" ? " LLM" : " 规则"}
          </p>
          <p className={styles.traceStrategy}>
            {item.repairStrategy ?? "尚未识别到明确的修复策略"}
          </p>
          <div className={styles.traceEvidenceList}>
            {item.evidence.slice(0, 3).map((entry) => (
              <div className={styles.traceEvidenceRow} key={`${entry.turnIndex}-${entry.role}-${entry.content}`}>
                <span>{entry.turnIndex}</span>
                <strong>{entry.role}</strong>
                <p>{entry.content}</p>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}

/**
 * Format recovery trace status.
 *
 * @param status Trace status.
 * @returns Label.
 */
function formatTraceStatus(status: RecoveryTraceResult["status"]): string {
  return status === "completed" ? "已恢复" : "恢复失败";
}

/**
 * Map trace status to a visual variant.
 *
 * @param status Trace status.
 * @returns Variant suffix.
 */
function traceVariant(status: RecoveryTraceResult["status"]): "Good" | "Bad" {
  return status === "completed" ? "Good" : "Bad";
}

/**
 * Format one failure type.
 *
 * @param failureType Failure type.
 * @returns Human-readable label.
 */
function formatFailureType(failureType: RecoveryTraceResult["failureType"]): string {
  if (failureType === "ignore") {
    return "问题被忽视";
  }
  if (failureType === "understanding-barrier") {
    return "理解障碍";
  }
  return "未知失败";
}

/**
 * Format a possibly missing turn number.
 *
 * @param turn Turn number.
 * @returns Text label.
 */
function formatTurn(turn: number | null): string {
  return turn === null ? "--" : `${turn}`;
}

/**
 * Rank traces by urgency.
 *
 * @param trace Recovery trace.
 * @returns Rank number.
 */
function rankTrace(trace: RecoveryTraceResult): number {
  if (trace.status === "failed") {
    return 0;
  }
  return 1;
}
