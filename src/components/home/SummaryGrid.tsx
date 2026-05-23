/**
 * @fileoverview Summary card grid for overview metrics.
 */

import type { SummaryCard } from "@/types/pipeline";
import styles from "./evalConsole.module.css";

/**
 * Render summary cards.
 * @param props Summary card props.
 * @returns Summary grid.
 */
export function SummaryGrid(props: { cards: SummaryCard[] }) {
  return (
    <div className={styles.metricGrid}>
      {props.cards.map((card) => (
        <article key={card.key} className={styles.metricCard}>
          <p>{card.label}</p>
          <strong>{card.value}</strong>
          <span>{card.hint}</span>
        </article>
      ))}
    </div>
  );
}
