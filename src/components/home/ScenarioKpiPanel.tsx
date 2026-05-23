/**
 * @fileoverview Compact business-KPI panel for one selected scenario.
 */

import type { ScenarioEvaluation } from "@/types/scenario";
import styles from "./scenarioKpiPanel.module.css";

type ScenarioKpiPanelProps = {
  evaluation: ScenarioEvaluation | null;
};

/**
 * Render scenario-level KPI cards with top evidence and mapped contributions.
 * @param props Component props.
 * @returns KPI panel content.
 */
export function ScenarioKpiPanel({ evaluation }: ScenarioKpiPanelProps) {
  if (!evaluation) {
    return <div className={styles.empty}>选择业务场景后，系统会在这里输出映射后的 KPI 分与证据。</div>;
  }

  return (
    <div className={styles.grid}>
      {evaluation.kpis.map((item) => (
        <article className={styles.card} key={item.id}>
          <div className={styles.cardHeader}>
            <div>
              <h3>{item.displayName}</h3>
              <p>{item.description}</p>
            </div>
            <div className={`${styles.scoreBadge} ${styles[`score_${item.status}`]}`}>
              {Math.round(item.score * 100)}%
            </div>
          </div>
          <div className={styles.evidenceBlock}>
            <strong>Top Evidence</strong>
            <ul>
              {item.topEvidence.map((evidence) => (
                <li key={evidence}>{evidence}</li>
              ))}
            </ul>
          </div>
          <div className={styles.contribList}>
            {item.contributions.map((contribution) => (
              <div className={styles.contribRow} key={`${item.id}_${contribution.source}_${contribution.metricId}`}>
                <span>
                  {contribution.source}.{contribution.metricId}
                </span>
                <strong>{Math.round(contribution.alignedScore * 100)}%</strong>
              </div>
            ))}
          </div>
        </article>
      ))}
    </div>
  );
}
