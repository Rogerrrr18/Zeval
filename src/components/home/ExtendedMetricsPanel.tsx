/**
 * @fileoverview Render the 10 DeepEval-aligned extended metrics in a card grid.
 *
 * Each metric tile shows: name, score, pass/fail badge, threshold, reason, evidence.
 * `null` metrics (input not provided) are rendered as a "未启用" placeholder so users
 * know which inputs they could supply to unlock more metrics.
 */

"use client";

import { useState } from "react";
import type { ExtendedMetricResult, ExtendedMetricsBundle } from "@/types/extended-metrics";
import styles from "./extendedMetricsPanel.module.css";

const METRIC_GROUPS: Array<{
  groupName: string;
  metrics: Array<{ key: keyof ExtendedMetricsBundle; label: string; needs: string }>;
}> = [
  {
    groupName: "RAG",
    metrics: [
      { key: "faithfulness", label: "忠实度", needs: "需提供 retrievalContexts" },
      { key: "hallucination", label: "幻觉", needs: "需提供 retrievalContexts" },
      { key: "answerRelevancy", label: "回答相关性", needs: "需提供 retrievalContexts.query" },
      { key: "contextualRelevancy", label: "上下文相关性", needs: "需提供 retrievalContexts" },
    ],
  },
  {
    groupName: "Agentic",
    metrics: [
      { key: "toolCorrectness", label: "工具调用正确性", needs: "需提供 toolCalls + expected*" },
      { key: "taskCompletion", label: "任务完成度", needs: "需提供 toolCalls 或场景目标" },
    ],
  },
  {
    groupName: "MultiTurn",
    metrics: [{ key: "knowledgeRetention", label: "知识保持度", needs: "需提供 retentionFacts" }],
  },
  {
    groupName: "Safety",
    metrics: [
      { key: "toxicity", label: "Toxicity", needs: "默认对 assistant 文本检测" },
      { key: "bias", label: "Bias", needs: "默认对 assistant 文本检测" },
    ],
  },
  {
    groupName: "RolePlay",
    metrics: [{ key: "roleAdherence", label: "角色一致性", needs: "需提供 roleProfile" }],
  },
];

type ExtendedMetricsPanelProps = {
  metrics: ExtendedMetricsBundle | undefined | null;
};

/**
 * Render the extended metrics panel.
 *
 * @param props The panel props.
 * @returns The panel element, or null if no metrics bundle is present.
 */
export function ExtendedMetricsPanel({ metrics }: ExtendedMetricsPanelProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!metrics) {
    return (
      <div className={styles.empty}>
        <strong>扩展指标未启用</strong>
        <p>
          通过 <code>extendedInputs</code>（retrievalContexts / toolCalls / retentionFacts / roleProfile）
          提供输入即可解锁 10 项 DeepEval 对齐指标。接入方法见 README 与产品首页。
        </p>
      </div>
    );
  }

  const total = METRIC_GROUPS.reduce((acc, g) => acc + g.metrics.length, 0);
  const enabled = METRIC_GROUPS.reduce(
    (acc, g) => acc + g.metrics.filter((m) => metrics[m.key] && !metrics[m.key]?.skipped).length,
    0,
  );

  return (
    <div className={styles.wrap}>
      <div className={styles.summary}>
        <span>
          已启用 <strong>{enabled}</strong> / {total} 项扩展指标
        </span>
        <span className={styles.legend}>
          <span className={`${styles.dot} ${styles.dotPass}`} /> 通过
          <span className={`${styles.dot} ${styles.dotFail}`} /> 未通过
          <span className={`${styles.dot} ${styles.dotSkip}`} /> 未启用
        </span>
      </div>

      {METRIC_GROUPS.map((group) => (
        <div key={group.groupName} className={styles.group}>
          <h3 className={styles.groupTitle}>{group.groupName}</h3>
          <div className={styles.grid}>
            {group.metrics.map((m) => {
              const data = metrics[m.key];
              const id = `${group.groupName}-${m.key}`;
              return (
                <MetricCard
                  key={m.key}
                  label={m.label}
                  needs={m.needs}
                  data={data}
                  expanded={expanded === id}
                  onToggle={() => setExpanded(expanded === id ? null : id)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Render a single metric card.
 *
 * @param props Card props.
 * @returns The card element.
 */
function MetricCard(props: {
  label: string;
  needs: string;
  data: ExtendedMetricResult | null;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { label, needs, data, expanded, onToggle } = props;

  if (!data || data.skipped) {
    return (
      <div className={`${styles.card} ${styles.cardSkip}`}>
        <div className={styles.cardHead}>
          <span className={styles.cardLabel}>{label}</span>
          <span className={styles.skipBadge}>未启用</span>
        </div>
        <p className={styles.needs}>{data?.skipReason || needs}</p>
      </div>
    );
  }

  const pct = Math.round(data.score * 100);
  const passClass = data.passed ? styles.cardPass : styles.cardFail;

  return (
    <div className={`${styles.card} ${passClass}`}>
      <button type="button" className={styles.cardHead} onClick={onToggle} aria-expanded={expanded}>
        <span className={styles.cardLabel}>{label}</span>
        <span className={styles.scorePill}>
          {pct}
          <small>/100</small>
        </span>
      </button>
      <div className={styles.bar}>
        <div className={styles.barFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.cardMeta}>
        <span className={data.passed ? styles.passText : styles.failText}>
          {data.passed ? "✓ passed" : "✗ failed"}
        </span>
        <span className={styles.threshold}>阈值 {Math.round(data.threshold * 100)}</span>
        <span className={styles.source}>{data.source}</span>
      </div>
      {expanded ? (
        <div className={styles.detail}>
          <p className={styles.reason}>{data.reason}</p>
          {data.evidence?.length ? (
            <ul className={styles.evidenceList}>
              {data.evidence.slice(0, 5).map((ev, i) => (
                <li key={i}>{ev}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : (
        <button type="button" className={styles.expandLink} onClick={onToggle}>
          查看 reason / evidence →
        </button>
      )}
    </div>
  );
}
