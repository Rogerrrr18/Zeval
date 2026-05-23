/**
 * @fileoverview Shared progress event types for streamed evaluation runs.
 */

export type EvaluationStageKey =
  | "parse"
  | "objective"
  | "subjective"
  | "extended"
  | "badcase"
  | "complete";

export type EvaluationStageStatus = "pending" | "running" | "done" | "failed";

export type EvaluationProgressEvent = {
  type: "stage";
  stage: EvaluationStageKey;
  status: EvaluationStageStatus;
  message?: string;
  detail?: string;
};

