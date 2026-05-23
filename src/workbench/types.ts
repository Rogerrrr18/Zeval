/**
 * @fileoverview Workbench baseline snapshot contracts for online evaluation linkage.
 */

import type { EvaluateResponse, RawChatlogRow } from "@/types/pipeline";

/**
 * One persisted baseline snapshot captured from the home evaluation console.
 */
export type WorkbenchBaselineSnapshot = {
  schemaVersion: 1;
  customerId: string;
  runId: string;
  createdAt: string;
  label?: string;
  sourceFileName?: string;
  evaluate: EvaluateResponse;
  rawRows: RawChatlogRow[];
};

/**
 * Lightweight baseline index row for customer-level listing.
 */
export type WorkbenchBaselineIndexRow = {
  runId: string;
  createdAt: string;
  label?: string;
  sourceFileName?: string;
  fileName: string;
};

/**
 * One resolved baseline lookup result when only runId is known.
 */
export type WorkbenchBaselineLookup = {
  customerId: string;
  snapshot: WorkbenchBaselineSnapshot;
};
