/**
 * @fileoverview Goal completion insight panel.
 */

import type { GoalCompletionResult } from "@/types/pipeline";
import styles from "./evalConsole.module.css";

/**
 * Render session-level goal completion results.
 *
 * @param props Goal completion panel props.
 * @returns Goal completion content.
 */
export function GoalCompletionPanel(props: { items: GoalCompletionResult[] }) {
  if (props.items.length === 0) {
    return <div className={styles.emptyState}>完成评估后展示每个 session 的目标达成判断与证据。</div>;
  }

  const rows = [...props.items].sort((left, right) => rankStatus(left.status) - rankStatus(right.status));
  return (
    <div className={styles.insightList}>
      {rows.map((item) => (
        <article className={styles.insightCard} key={`${item.sessionId}-${item.status}`}>
          <div className={styles.insightHeader}>
            <div className={styles.insightTitleBlock}>
              <strong>{item.userIntent}</strong>
              <span>session · {item.sessionId}</span>
            </div>
            <div className={styles.insightMeta}>
              <span className={`${styles.insightBadge} ${styles[`insightBadge${statusVariant(item.status)}`]}`}>
                {formatGoalStatus(item.status)}
              </span>
              <span className={styles.scoreBadge}>{item.score}/5</span>
            </div>
          </div>
          <p className={styles.insightSubcopy}>
            来源 {formatSource(item.source)} · 置信度 {Math.round(item.confidence * 100)}%
          </p>
          {item.achievementEvidence.length > 0 ? (
            <div className={styles.insightSection}>
              <p className={styles.insightSectionTitle}>达成证据</p>
              <ul className={styles.insightBulletList}>
                {item.achievementEvidence.slice(0, 2).map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {item.failureReasons.length > 0 ? (
            <div className={styles.insightSection}>
              <p className={styles.insightSectionTitle}>未达成原因</p>
              <ul className={styles.insightBulletList}>
                {item.failureReasons.slice(0, 2).map((entry) => (
                  <li key={entry}>{entry}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  );
}

/**
 * Map goal status to a human-readable label.
 *
 * @param status Goal completion status.
 * @returns Status label.
 */
function formatGoalStatus(status: GoalCompletionResult["status"]): string {
  if (status === "achieved") {
    return "已达成";
  }
  if (status === "partial") {
    return "部分达成";
  }
  if (status === "failed") {
    return "未达成";
  }
  return "待判断";
}

/**
 * Map status to a visual variant suffix.
 *
 * @param status Goal completion status.
 * @returns Variant suffix.
 */
function statusVariant(status: GoalCompletionResult["status"]): "Good" | "Warn" | "Bad" | "Neutral" {
  if (status === "achieved") {
    return "Good";
  }
  if (status === "partial") {
    return "Warn";
  }
  if (status === "failed") {
    return "Bad";
  }
  return "Neutral";
}

/**
 * Format one field source label.
 *
 * @param source Field source.
 * @returns Human-readable source.
 */
function formatSource(source: GoalCompletionResult["source"]): string {
  if (source === "llm") {
    return "LLM Judge";
  }
  if (source === "rule") {
    return "规则";
  }
  return "降级";
}

/**
 * Rank statuses by action priority.
 *
 * @param status Goal completion status.
 * @returns Rank number.
 */
function rankStatus(status: GoalCompletionResult["status"]): number {
  if (status === "failed") {
    return 0;
  }
  if (status === "partial") {
    return 1;
  }
  if (status === "unclear") {
    return 2;
  }
  return 3;
}
