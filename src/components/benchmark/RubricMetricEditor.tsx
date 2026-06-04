/**
 * @fileoverview Inline metric editor for benchmark rubric.
 *
 * Edits every field of a BenchmarkRubricMetric inline.
 */

import { useState } from "react";
import type { BenchmarkRubricMetric } from "@/benchmark/types";
import styles from "./benchmarkConsole.module.css";

type BenchmarkEvaluatorType = BenchmarkRubricMetric["evaluatorType"];

const EVALUATOR_OPTIONS: { value: BenchmarkEvaluatorType; label: string }[] = [
  { value: "exact_match", label: "精确匹配" },
  { value: "regex_match", label: "格式匹配" },
  { value: "numeric_tolerance", label: "数值容差" },
  { value: "f1_match", label: "覆盖率匹配" },
  { value: "code_exec", label: "代码执行" },
  { value: "unit_test", label: "单元测试" },
  { value: "environment_state_test", label: "环境状态检测" },
  { value: "llm_judge", label: "模型评审" },
  { value: "human_label", label: "人工标注" },
  { value: "hybrid", label: "混合评估" },
];

export function RubricMetricEditor(props: {
  metric: BenchmarkRubricMetric;
  draftMetric?: BenchmarkRubricMetric;
  onSave: (patch: Partial<Omit<BenchmarkRubricMetric, "metricKey">>) => void;
  onCancel: () => void;
  onReset: () => void;
}) {
  const { metric, draftMetric } = props;
  const [displayName, setDisplayName] = useState(metric.displayName);
  const [description, setDescription] = useState(metric.description);
  const [weight, setWeight] = useState(metric.weight);
  const [min, setMin] = useState(metric.scale.min);
  const [max, setMax] = useState(metric.scale.max);
  const [passThreshold, setPassThreshold] = useState(metric.scale.passThreshold);
  const [evaluatorType, setEvaluatorType] = useState<BenchmarkEvaluatorType>(metric.evaluatorType);
  const [evidenceRequired, setEvidenceRequired] = useState(metric.evidenceRequired);
  const [humanApprovalRequired, setHumanApprovalRequired] = useState(metric.humanApprovalRequired);
  const [failureTags, setFailureTags] = useState(metric.failureTags.join(", "));
  const [criteria, setCriteria] = useState(metric.config?.criteria ?? "");

  const hasChanges =
    displayName !== metric.displayName ||
    description !== metric.description ||
    weight !== metric.weight ||
    min !== metric.scale.min ||
    max !== metric.scale.max ||
    passThreshold !== metric.scale.passThreshold ||
    evaluatorType !== metric.evaluatorType ||
    evidenceRequired !== metric.evidenceRequired ||
    humanApprovalRequired !== metric.humanApprovalRequired ||
    failureTags !== metric.failureTags.join(", ") ||
    criteria !== (metric.config?.criteria ?? "");

  function handleSave() {
    props.onSave({
      displayName,
      description,
      weight,
      scale: { min, max, passThreshold },
      evaluatorType,
      evidenceRequired,
      humanApprovalRequired,
      failureTags: failureTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      config: criteria ? { ...metric.config, criteria } : metric.config,
    });
  }

  return (
    <div className={styles.rubricEditor}>
      <div className={styles.rubricEditorGrid}>
        <label className={styles.editorField}>
          <span>指标名称</span>
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>

        <label className={styles.editorField}>
          <span>权重（1-10）</span>
          <input
            type="number"
            min={1}
            max={10}
            value={weight}
            onChange={(e) => setWeight(Number(e.target.value))}
          />
        </label>

        <label className={styles.editorField}>
          <span>评估器</span>
          <select value={evaluatorType} onChange={(e) => setEvaluatorType(e.target.value as BenchmarkEvaluatorType)}>
            {EVALUATOR_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <label className={styles.editorField}>
          <span>分值范围</span>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              style={{ width: 60 }}
              value={min}
              onChange={(e) => setMin(Number(e.target.value))}
            />
            <span style={{ color: "var(--bm-ink-3)" }}>至</span>
            <input
              type="number"
              style={{ width: 60 }}
              value={max}
              onChange={(e) => setMax(Number(e.target.value))}
            />
          </div>
        </label>

        <label className={styles.editorField}>
          <span>通过阈值</span>
          <input
            type="number"
            value={passThreshold}
            onChange={(e) => setPassThreshold(Number(e.target.value))}
          />
        </label>

        <label className={styles.editorField}>
          <span>失败标签</span>
          <input
            value={failureTags}
            onChange={(e) => setFailureTags(e.target.value)}
            placeholder="失败标签一, 失败标签二, 失败标签三"
          />
        </label>

        <label className={`${styles.editorField} ${styles.editorFieldFull}`}>
          <span>指标说明</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
          />
        </label>

        <label className={`${styles.editorField} ${styles.editorFieldFull}`}>
          <span>评估标准</span>
          <textarea
            value={criteria}
            onChange={(e) => setCriteria(e.target.value)}
            rows={2}
            placeholder="用于模型评审或人工标注的评估标准..."
          />
        </label>

        <div className={styles.editorCheckboxes}>
          <label>
            <input
              type="checkbox"
              checked={evidenceRequired}
              onChange={(e) => setEvidenceRequired(e.target.checked)}
            />
            <span>需要证据</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={humanApprovalRequired}
              onChange={(e) => setHumanApprovalRequired(e.target.checked)}
            />
            <span>需要人工审批</span>
          </label>
        </div>
      </div>

      <div className={styles.rubricEditorActions}>
        <button className={styles.primaryButton} onClick={handleSave} disabled={!hasChanges}>
          保存
        </button>
        <button className={styles.secondaryButton} onClick={props.onCancel}>
          取消
        </button>
        {draftMetric && (
          <button className={styles.textButton} onClick={props.onReset}>
            重置为草稿
          </button>
        )}
      </div>
    </div>
  );
}
