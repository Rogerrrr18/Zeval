/**
 * @fileoverview Extracted bad case panel for workbench review and harvesting.
 */

import type { BadCaseAsset } from "@/types/pipeline";
import styles from "./badCasePanel.module.css";

type BadCasePanelProps = {
  items: BadCaseAsset[];
};

/**
 * Render extracted bad case assets with tags, evidence and suggested actions.
 * @param props Component props.
 * @returns Panel content.
 */
export function BadCasePanel({ items }: BadCasePanelProps) {
  if (items.length === 0) {
    return <div className={styles.empty}>当前没有识别出可沉淀的 bad case。</div>;
  }

  return (
    <div className={styles.list}>
      {items.map((item) => (
        <article className={styles.card} key={item.caseKey}>
          <div className={styles.header}>
            <div>
              <h3>{item.title}</h3>
              <p>
                session={item.sessionId}
              </p>
            </div>
            <div className={styles.severityBadge}>{Math.round(item.severityScore * 100)}%</div>
          </div>
          <div className={styles.tagRow}>
            {item.tags.map((tag) => (
              <span className={styles.tag} key={`${item.caseKey}_${tag}`}>
                {tag}
              </span>
            ))}
          </div>
          <div className={styles.evidenceBlock}>
            <strong>Evidence</strong>
            <ul>
              {item.evidence.map((evidence) => (
                <li key={`${item.caseKey}_${evidence.turnIndex}`}>
                  [turn {evidence.turnIndex}] [{evidence.role}] {evidence.content}
                </li>
              ))}
            </ul>
          </div>
          <p className={styles.actionText}>{item.suggestedAction}</p>
        </article>
      ))}
    </div>
  );
}
