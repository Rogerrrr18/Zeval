/**
 * @fileoverview Linear stepper for progress-focused console flows.
 */

"use client";

import type { ReactNode } from "react";
import styles from "./stepper.module.css";

export type StepperStep = {
  key: string;
  title: string;
  hint?: string;
};

type StepperProps = {
  steps: StepperStep[];
  /** Index of the current step (0-based). */
  current: number;
  /** Index up to which the user has completed (>= current). */
  completed?: number;
  /** Index up to which the user may navigate even if the step is not complete. */
  maxReachable?: number;
  onSelect?: (index: number) => void;
};

/**
 * Render a horizontal stepper with clickable past/current steps.
 */
export function Stepper({ steps, current, completed = current, maxReachable = completed, onSelect }: StepperProps) {
  return (
    <ol className={styles.stepper} aria-label="流程进度">
      {steps.map((step, index) => {
        const isCurrent = index === current;
        const isDone = index < current || (index === current && completed > current);
        const isReachable = onSelect !== undefined && index <= Math.max(current, completed, maxReachable);
        const className = [
          styles.step,
          isCurrent ? styles.stepCurrent : "",
          isDone ? styles.stepDone : "",
          !isCurrent && !isDone ? styles.stepPending : "",
          isReachable ? styles.stepReachable : "",
        ]
          .filter(Boolean)
          .join(" ");

        const content: ReactNode = (
          <>
            <span className={styles.dot} aria-hidden>
              {isDone ? <CheckIcon /> : <span className={styles.dotIndex}>{index + 1}</span>}
            </span>
            <span className={styles.label}>
              <strong>{step.title}</strong>
              {step.hint ? <small>{step.hint}</small> : null}
            </span>
          </>
        );

        return (
          <li key={step.key} className={className}>
            {isReachable ? (
              <button
                type="button"
                className={styles.stepButton}
                onClick={() => onSelect?.(index)}
                aria-current={isCurrent ? "step" : undefined}
              >
                {content}
              </button>
            ) : (
              <div className={styles.stepButton} aria-current={isCurrent ? "step" : undefined}>
                {content}
              </div>
            )}
            {index < steps.length - 1 ? <span className={styles.connector} aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Render a small check icon used to mark completed steps.
 */
function CheckIcon() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
      <path
        d="M3 8.5l3 3 7-7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
