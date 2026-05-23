/**
 * @fileoverview Suggestion list panel.
 */

import styles from "./evalConsole.module.css";

/**
 * Render optimization strategy items.
 * @param props Suggestion props.
 * @returns Suggestion list.
 */
export function SuggestionPanel(props: { suggestions: string[] }) {
  if (props.suggestions.length === 0) {
    return (
      <div className={styles.emptySuggestion}>
        <p>暂无优化策略，完成评估后将基于指标自动生成行动建议。</p>
      </div>
    );
  }

  return (
    <ul className={styles.suggestionList}>
      {props.suggestions.map((suggestion, index) => {
        const { priority, content } = parseSuggestionPriority(suggestion);
        return (
          <li key={`${priority}-${suggestion}`}>
            <div className={styles.suggestionBadgeColumn}>
              <span className={styles.suggestionIndex}>{index + 1}</span>
              <span className={`${styles.suggestionPriority} ${styles[`suggestionPriority${priority}`]}`}>
                {priority}
              </span>
            </div>
            <p>{content}</p>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Extract priority label from suggestion copy.
 * @param suggestion Suggestion text.
 * @returns Priority and normalized content.
 */
function parseSuggestionPriority(suggestion: string): {
  priority: "P0" | "P1" | "P2";
  content: string;
} {
  if (suggestion.startsWith("P0")) {
    return { priority: "P0", content: suggestion.replace(/^P0[:：\s-]*/, "") };
  }
  if (suggestion.startsWith("P1")) {
    return { priority: "P1", content: suggestion.replace(/^P1[:：\s-]*/, "") };
  }
  if (suggestion.startsWith("P2")) {
    return { priority: "P2", content: suggestion.replace(/^P2[:：\s-]*/, "") };
  }
  return { priority: "P1", content: suggestion };
}
