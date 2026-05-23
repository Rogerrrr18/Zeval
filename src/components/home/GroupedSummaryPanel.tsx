/**
 * @fileoverview Grouped summary panel: clusters flat SummaryCard[] into 4 top-level
 * groups (对话质量 / 任务完成度 / 工具调用可用性 / 风险信号) and shows an inline
 * tooltip on each metric explaining its meaning, formula, and threshold.
 *
 * Designed to replace the flat `SummaryGrid` rendering in the workbench overview
 * tab. Reduces information density by ≥ 50% vs the previous flat grid.
 */

"use client";

import { useState } from "react";
import {
  SUMMARY_GROUPS,
  getSummaryGroupForKey,
  getSummaryMetricExplain,
  type SummaryGroupId,
} from "@/pipeline/summaryMetricGroups";
import type { SummaryCard } from "@/types/pipeline";
import styles from "./groupedSummaryPanel.module.css";

type Props = {
  cards: SummaryCard[];
};

/**
 * Render summary cards grouped by top-level category.
 *
 * @param props Component props.
 * @returns Panel element.
 */
export function GroupedSummaryPanel({ cards }: Props) {
  // Group cards by category, preserving original order within a group.
  const buckets = new Map<SummaryGroupId, SummaryCard[]>();
  cards.forEach((card) => {
    const group = getSummaryGroupForKey(card.key);
    const list = buckets.get(group) ?? [];
    list.push(card);
    buckets.set(group, list);
  });

  // Pull out scale (sessionCount) as a hero number above the grid.
  const scaleCards = buckets.get("scale") ?? [];
  buckets.delete("scale");

  const orderedGroups = SUMMARY_GROUPS
    .filter((group) => group.id !== "scale")
    .filter((group) => (buckets.get(group.id)?.length ?? 0) > 0)
    .sort((a, b) => a.order - b.order);

  return (
    <div className={styles.wrap}>
      {scaleCards.length > 0 ? (
        <div className={styles.scaleRow}>
          {scaleCards.map((card) => (
            <ScaleHero key={card.key} card={card} />
          ))}
        </div>
      ) : null}

      <div className={styles.groupGrid}>
        {orderedGroups.map((group) => {
          const groupCards = buckets.get(group.id) ?? [];
          return (
            <section key={group.id} className={styles.groupCard}>
              <header className={styles.groupHeader}>
                <h3>{group.title}</h3>
                <small>{group.description}</small>
              </header>
              <div className={styles.metricList}>
                {groupCards.map((card) => (
                  <MetricRow key={card.key} card={card} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Render a single hero row for the "scale" group (e.g. sessionCount).
 *
 * @param props Hero card props.
 * @returns Hero element.
 */
function ScaleHero({ card }: { card: SummaryCard }) {
  const explain = getSummaryMetricExplain(card.key);
  return (
    <article className={styles.scaleHero}>
      <div className={styles.scaleLeft}>
        <span className={styles.scaleLabel}>{card.label}</span>
        <strong className={styles.scaleValue}>{card.value}</strong>
      </div>
      <div className={styles.scaleHint}>
        {card.hint}
        {explain ? <MetricInfo explain={explain} card={card} /> : null}
      </div>
    </article>
  );
}

/**
 * Render one metric row inside a group card.
 *
 * @param props Metric row props.
 * @returns Row element.
 */
function MetricRow({ card }: { card: SummaryCard }) {
  const explain = getSummaryMetricExplain(card.key);
  return (
    <div className={styles.metricRow}>
      <div className={styles.metricLabelCol}>
        <span className={styles.metricLabel}>{card.label}</span>
        {explain ? <MetricInfo explain={explain} card={card} /> : null}
      </div>
      <strong className={styles.metricValue}>{card.value}</strong>
    </div>
  );
}

/**
 * Render the ⓘ tooltip trigger + popover content.
 *
 * @param props Tooltip props.
 * @returns Tooltip element.
 */
function MetricInfo({
  explain,
  card,
}: {
  explain: NonNullable<ReturnType<typeof getSummaryMetricExplain>>;
  card: SummaryCard;
}) {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={styles.tooltipWrap}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className={styles.infoIcon}
        aria-expanded={open}
        aria-label={`查看「${card.label}」指标解释`}
        onClick={() => setOpen((prev) => !prev)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ⓘ
      </button>
      {open ? (
        <div role="tooltip" className={styles.tooltipPopover}>
          <p className={styles.tooltipBody}>{explain.oneLineExplain}</p>
          <dl className={styles.tooltipMeta}>
            <dt>计算口径</dt>
            <dd>{explain.formula}</dd>
            {explain.threshold ? (
              <>
                <dt>阈值建议</dt>
                <dd>{explain.threshold}</dd>
              </>
            ) : null}
            {card.hint ? (
              <>
                <dt>当前 hint</dt>
                <dd>{card.hint}</dd>
              </>
            ) : null}
          </dl>
        </div>
      ) : null}
    </span>
  );
}
