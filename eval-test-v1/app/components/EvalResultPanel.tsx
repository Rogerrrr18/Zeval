"use client";

import type { BaselineVector } from "@/lib/baseline";
import type { SessionMetrics } from "@/lib/types";
import { EvalRadarChart, type RadarVec } from "@/app/components/EvalRadarChart";
import styles from "@/app/experiment.module.css";

type Props = {
  baseline: BaselineVector;
  dynamicRaw: SessionMetrics;
  baselineRadar: RadarVec;
  dynamicRadar: RadarVec;
};

type ScalarRow = { key: string; label: string; b: number; d: number; hint?: string };

/**
 * 将 B/D 标量映射为表格行（四维语义对齐）。
 */
function buildScalarRows(b: BaselineVector, d: SessionMetrics): ScalarRow[] {
  return [
    {
      key: "intent_completion_rate",
      label: "意图完成率",
      b: b.intent_completion_rate,
      d: d.intent_completion_rate,
      hint: "越高越好（0–1）",
    },
    {
      key: "followup_efficiency",
      label: "追问负担相关标量",
      b: b.followup_efficiency,
      d: d.followup_efficiency,
      hint: "两套口径数值仅并排对比",
    },
    {
      key: "deviation_rate",
      label: "偏离率",
      b: b.deviation_rate,
      d: d.deviation_rate,
      hint: "越高表示偏离越严重",
    },
    {
      key: "turn_efficiency",
      label: "轮次效率",
      b: b.turn_efficiency,
      d: d.turn_efficiency,
      hint: "越高表示越省轮（0–1）",
    },
  ];
}

/**
 * 单行横向双柱：B 原始 vs D 动态。
 */
function DualMetricBar(props: { row: ScalarRow }) {
  const { row } = props;
  const cap = Math.max(Math.abs(row.b), Math.abs(row.d), 1e-6);
  const wB = (Math.abs(row.b) / cap) * 100;
  const wD = (Math.abs(row.d) / cap) * 100;
  return (
    <div className={styles.metricBarRow}>
      <div className={styles.metricBarLabel}>
        <strong>{row.label}</strong>
        {row.hint ? <span className={styles.metricBarHint}>{row.hint}</span> : null}
      </div>
      <div className={styles.metricBarTracks}>
        <div className={styles.metricBarLine}>
          <span className={styles.metricBarTagB}>B 原始</span>
          <div className={styles.metricBarTrack}>
            <div className={styles.metricBarFillB} style={{ width: `${Math.min(100, wB)}%` }} />
          </div>
          <span className={styles.metricBarVal}>{row.b.toFixed(3)}</span>
        </div>
        <div className={styles.metricBarLine}>
          <span className={styles.metricBarTagD}>D 动态</span>
          <div className={styles.metricBarTrack}>
            <div className={styles.metricBarFillD} style={{ width: `${Math.min(100, wD)}%` }} />
          </div>
          <span className={styles.metricBarVal}>{row.d.toFixed(3)}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * 动态环过程量（会话级汇总）。
 */
function DynamicOnlyStats(props: { m: SessionMetrics }) {
  const { m } = props;
  const capRounds = Math.max(m.T_hist, m.T_eval, 1);
  return (
    <div className={styles.metricBarBlock}>
      <h4 className={styles.metricSubTitle}>动态链过程量（会话级）</h4>
      <p className={styles.metricBarHint} style={{ marginBottom: 10 }}>
        「历史 user 轮」来自 CSV；「动态 user 轮」为评测环内 SimUser 发言次数；其余为动态环计数。
      </p>
      <div className={styles.metricBarRow}>
        <div className={styles.metricBarLabel}>
          <strong>User 轮次</strong>
        </div>
        <div className={styles.metricBarTracks}>
          <div className={styles.metricBarLine}>
            <span className={styles.metricBarTagB}>T_hist（原始）</span>
            <div className={styles.metricBarTrack}>
              <div className={styles.metricBarFillB} style={{ width: `${(m.T_hist / capRounds) * 100}%` }} />
            </div>
            <span className={styles.metricBarVal}>{m.T_hist}</span>
          </div>
          <div className={styles.metricBarLine}>
            <span className={styles.metricBarTagD}>T_eval（动态）</span>
            <div className={styles.metricBarTrack}>
              <div className={styles.metricBarFillD} style={{ width: `${(m.T_eval / capRounds) * 100}%` }} />
            </div>
            <span className={styles.metricBarVal}>{m.T_eval}</span>
          </div>
        </div>
      </div>
      <ul className={styles.dynamicStatList}>
        <li>
          意图满足：<strong>{m.satisfied_intents}</strong> / {m.total_intents}
        </li>
        <li>
          偏离轮次 / 总轮次：<strong>{m.deviation_rounds}</strong> / {m.total_rounds}
        </li>
        <li>
          追问次数（动态）：<strong>{m.followup_count}</strong>
        </li>
      </ul>
    </div>
  );
}

/**
 * 评测结果：雷达 + B/D 横向柱状对比（对话气泡见首页常驻「动态评测对话」区）。
 */
export function EvalResultPanel(props: Props) {
  const { baseline, dynamicRaw, baselineRadar, dynamicRadar } = props;
  const scalarRows = buildScalarRows(baseline, dynamicRaw);

  return (
    <div className="card">
      <h2 className={styles.sectionTitle}>4. 结果 · 雷达（B vs D）</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        以下为<strong>最近一次评测</strong>对应的输出（与当时选中的 session 一致）。若你已切换 session，请重新运行评测以更新本区。
      </p>
      <div className={styles.evalTopGrid}>
        <div className={styles.evalRadarCell}>
          <h3 className={styles.subTitle}>雷达（四维归一）</h3>
          <EvalRadarChart B={baselineRadar} D={dynamicRadar} />
        </div>
        <div className={styles.evalRadarNote}>
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            <strong>B（蓝）</strong>：原始 session 一次打分后的归一雷达；<strong>D（黄）</strong>：动态评测结束后的归一雷达。下方柱状图为<strong>未归一</strong>标量并排对比。
          </p>
        </div>
      </div>

      <h3 className={styles.subTitle}>动态链指标 · 横向对比（B vs D）</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        <strong>B</strong>：原始对白单次模型打分；<strong>D</strong>：动态环汇总。每行柱长按该行 max(|B|,|D|) 缩放。
      </p>
      <div className={styles.metricBarBlock}>
        {scalarRows.map((row) => (
          <DualMetricBar key={row.key} row={row} />
        ))}
      </div>
      <DynamicOnlyStats m={dynamicRaw} />
    </div>
  );
}
