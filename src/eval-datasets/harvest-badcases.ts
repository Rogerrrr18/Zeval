/**
 * @fileoverview Public entry point for the eval-case auto-admission pipeline.
 *
 * Delegates to `runAdmissionPipeline` which implements the five admission
 * channels (TP / FN / TN / uncertainty / FP) described in PRD §13.
 * The old single-channel harvest logic has been superseded by the pipeline.
 */

import { runAdmissionPipeline, type AdmissionResult } from "@/eval-datasets/admission/pipeline";
import type { DatasetStore } from "@/eval-datasets/storage/dataset-store";
import type { EvaluateResponse } from "@/types/pipeline";

export type { AdmissionResult } from "@/eval-datasets/admission/pipeline";

/**
 * Run the full five-channel admission pipeline for one evaluate response
 * and persist accepted cases into the dataset store.
 *
 * @param params Harvest parameters.
 * @returns Admission result with per-source counts and skipped details.
 */
export async function harvestBadCasesToDataset(params: {
  store: DatasetStore;
  evaluate: EvaluateResponse;
  baselineVersion?: string;
  allowNearDuplicate?: boolean;
  /** TN channel random sampling rate (0–1). Defaults to 0.05. */
  tnSampleRate?: number;
  /**
   * Fraction of TP/TN cases that must pass human review before entering the
   * benchmark pool (0 = skip all review, 1 = review everything). FN and
   * uncertainty cases are always reviewed regardless of this value.
   * Defaults to 1.0 when omitted.
   */
  humanSamplingRate?: number;
}): Promise<AdmissionResult> {
  return runAdmissionPipeline({
    store: params.store,
    evaluate: params.evaluate,
    baselineVersion: params.baselineVersion,
    allowNearDuplicate: params.allowNearDuplicate,
    tnSampleRate: params.tnSampleRate,
    humanSamplingRate: params.humanSamplingRate,
  });
}
