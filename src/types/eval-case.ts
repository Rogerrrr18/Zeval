/**
 * @fileoverview DeepEval-style internal evaluation case contracts.
 */

import type { EvalRequiredField } from "@/types/eval-metric";
import type { EvalTrace } from "@/types/eval-trace";
import type { ChatRole } from "@/types/pipeline";

/**
 * One normalized turn inside an evaluation case.
 */
export type EvalCaseTurn = {
  turnIndex: number;
  role: ChatRole;
  content: string;
  timestamp: string;
  topic?: string;
  emotionScore?: number;
};

/**
 * Tool call summary extracted from trace spans or structured annotations.
 */
export type EvalCaseToolCall = {
  name: string;
  turnIndex?: number;
  status: "success" | "error" | "warning" | "unknown";
  input?: unknown;
  output?: unknown;
  source: "trace" | "structured";
};

/**
 * Canonical evaluation case used by metric runners.
 */
export type EvalCase = {
  caseId: string;
  sessionId: string;
  input: string;
  actualOutput: string;
  expectedOutput?: string;
  turns: EvalCaseTurn[];
  retrievalContext?: string[];
  toolsCalled: EvalCaseToolCall[];
  expectedTools: string[];
  trace?: EvalTrace;
  metadata: {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
  };
};

/**
 * Dataset-level capability report used to gate metric execution.
 */
export type EvalCapabilityReport = {
  availableFields: Record<EvalRequiredField, boolean>;
  fieldSources: Partial<Record<EvalRequiredField, string[]>>;
  missingFields: EvalRequiredField[];
  enabledMetricGroups: string[];
  disabledMetricGroups: Array<{
    group: string;
    missingFields: EvalRequiredField[];
    reason: string;
  }>;
  warnings: string[];
};

/**
 * Evaluation cases plus their field capability report.
 */
export type EvalCaseBundle = {
  generatedAt: string;
  caseCount: number;
  cases: EvalCase[];
  capabilityReport: EvalCapabilityReport;
};
