/**
 * @fileoverview Horizontal evaluation stage progress for streamed runs.
 */

import type { EvaluationProgressEvent, EvaluationStageKey, EvaluationStageStatus } from "@/types/evaluation-progress";
import type { ReactNode } from "react";
import styles from "./evaluationProgress.module.css";

export type EvaluationStageState = {
  status: EvaluationStageStatus;
  message?: string;
  detail?: string;
};

const STAGES: Array<{ key: EvaluationStageKey; label: string }> = [
  { key: "parse", label: "解析数据" },
  { key: "objective", label: "客观指标" },
  { key: "subjective", label: "主观指标" },
  { key: "extended", label: "扩展指标" },
  { key: "badcase", label: "bad case 抽取" },
  { key: "complete", label: "完成" },
];

/**
 * Build the initial stage state map for a new evaluation run.
 *
 * @returns Pending stage map.
 */
export function createInitialEvaluationStages(): Record<EvaluationStageKey, EvaluationStageState> {
  return STAGES.reduce(
    (accumulator, stage) => ({
      ...accumulator,
      [stage.key]: { status: "pending" },
    }),
    {} as Record<EvaluationStageKey, EvaluationStageState>,
  );
}

/**
 * Apply one streamed progress event to the local stage map.
 *
 * @param current Current stage state map.
 * @param event Streamed progress event.
 * @returns Updated stage state map.
 */
export function applyEvaluationProgressEvent(
  current: Record<EvaluationStageKey, EvaluationStageState>,
  event: EvaluationProgressEvent,
): Record<EvaluationStageKey, EvaluationStageState> {
  return {
    ...current,
    [event.stage]: {
      status: event.status,
      message: event.message,
      detail: event.detail,
    },
  };
}

/**
 * Render streamed evaluation progress.
 *
 * @param props Stage state and visibility props.
 * @returns Progress bar or null when hidden.
 */
export function EvaluationProgress(props: {
  visible: boolean;
  stages: Record<EvaluationStageKey, EvaluationStageState>;
}): ReactNode {
  if (!props.visible) {
    return null;
  }
  const failed = STAGES.find((stage) => props.stages[stage.key].status === "failed");
  const failedState = failed ? props.stages[failed.key] : null;
  return (
    <div className={styles.progressShell} aria-live="polite">
      <div className={styles.stageTrack}>
        {STAGES.map((stage, index) => {
          const state = props.stages[stage.key];
          return (
            <div className={styles.stageItem} key={stage.key}>
              <div className={`${styles.stageIcon} ${styles[`stage_${state.status}`]}`}>
                {state.status === "running" ? <span className={styles.spinner} /> : null}
                {state.status === "done" ? "✓" : null}
                {state.status === "failed" ? "✕" : null}
                {state.status === "pending" ? index + 1 : null}
              </div>
              <div className={styles.stageText}>
                <strong>{stage.label}</strong>
                <span>{state.message ?? formatStageStatus(state.status)}</span>
              </div>
            </div>
          );
        })}
      </div>
      {failed && failedState?.detail ? (
        <div className={styles.failureBox}>
          <strong>{failed.label}失败</strong>
          <span>{failedState.detail}</span>
        </div>
      ) : null}
    </div>
  );
}

function formatStageStatus(status: EvaluationStageStatus): string {
  if (status === "running") return "进行中";
  if (status === "done") return "已完成";
  if (status === "failed") return "失败";
  return "等待中";
}
