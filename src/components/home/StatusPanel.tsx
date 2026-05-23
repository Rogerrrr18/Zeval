/**
 * @fileoverview Execution status panel for evaluation runs.
 */

import { FeatherIcon } from "@/components/home/FeatherIcon";
import styles from "./evalConsole.module.css";

/**
 * Render the execution status panel with steps and warnings.
 * @param props Status props.
 * @returns Status panel content.
 */
export function StatusPanel(props: {
  processing: boolean;
  processStep: number;
  logs: string[];
  warnings: string[];
}) {
  return (
    <>
      <div className={styles.statusShell}>
        <div className={styles.statusIndicator}>
          <div className={props.processing ? styles.spinner : styles.spinnerIdle} />
          <div>
            <p>链路进度</p>
            <strong>{props.processing ? "运行中" : "等待或已完成"}</strong>
          </div>
        </div>
        <div className={styles.statusTimeline}>
          {props.logs.map((log, index) => {
            const itemClass =
              index < props.processStep
                ? styles.statusItemDone
                : index === props.processStep
                  ? styles.statusItemActive
                  : styles.statusItemPending;
            return (
              <div className={`${styles.statusItem} ${itemClass}`} key={log}>
                <span className={styles.statusMarker}>{index + 1}</span>
                <div className={styles.statusContent}>
                  <p className={styles.statusTitle}>{log}</p>
                  <span className={styles.statusDescription}>
                    {index < props.processStep
                      ? "已完成"
                      : index === props.processStep
                        ? props.processing
                          ? "正在执行"
                          : "当前阶段"
                        : "等待执行"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      {props.warnings.length > 0 ? (
        <div className={styles.warningList}>
          {props.warnings.map((warning) => (
            <div className={styles.warningItem} key={warning}>
              <FeatherIcon name="alertCircle" />
              <span>{warning}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
