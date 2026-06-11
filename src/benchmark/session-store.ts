/**
 * @fileoverview File-backed benchmark workspace session store.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AutoFindWorkflowState } from "@/benchmark/agent/skills/autofind-data-skill";
import type { BenchmarkRubricSet } from "@/benchmark/types";
import type { BenchmarkProgressSnapshot } from "@/benchmark/progress";
import type { BenchmarkRunResult } from "@/benchmark/types";
import type { RawChatlogRow, UploadFormat } from "@/types/pipeline";
import type { StructuredTaskMetrics } from "@/types/rich-conversation";

export type BenchmarkChatTurn =
  | { kind: "user"; text: string }
  | { kind: "ai"; text: string }
  | { kind: "error"; text: string };

export type BenchmarkWorkspaceViewMode = "rubric" | "progress" | "result";

export type BenchmarkDatasetSnapshot = {
  fileName: string;
  format: UploadFormat;
  rawRows: RawChatlogRow[];
  previewTop20: string[];
  ingestMeta: {
    sessions: number;
    rows: number;
    hasTimestamp: boolean;
    piiRedaction?: {
      enabled: boolean;
      redactedRows: number;
      redactedFields: number;
      categories: string[];
    };
  };
  structuredTaskMetrics?: StructuredTaskMetrics;
  warnings: string[];
  uploadedAt: string;
};

export type BenchmarkRunHistoryItem = {
  runId: string;
  generatedAt: string;
  averageScore: number;
  caseCount: number;
  needsHumanReviewCount: number;
  result: BenchmarkRunResult;
  progress?: BenchmarkProgressSnapshot | null;
};

export type BenchmarkHumanReviewDecision = "accepted" | "rejected" | "needs_evidence";

export type BenchmarkHumanReviewRecord = {
  runId: string;
  submissionId: string;
  metricKey: string;
  decision?: BenchmarkHumanReviewDecision;
  reviewer?: string;
  note?: string;
  reviewedAt?: string;
  savedAt?: string;
  admission?: {
    caseId: string;
    source: string;
    caseSetType: "goodcase" | "badcase";
    reviewStatus: string;
  };
};

export type BenchmarkWorkspaceSession = {
  id: string;
  projectId: string;
  title: string;
  /** When true, UI keeps the user-provided title instead of auto-syncing from rubric/requirement. */
  titleManuallySet?: boolean;
  description: string;
  createdAt: string;
  updatedAt: string;
  requirement: string;
  useLlm: boolean;
  rubric: BenchmarkRubricSet | null;
  viewMode: BenchmarkWorkspaceViewMode;
  copilotTurns: BenchmarkChatTurn[];
  selectedFileId: string | null;
  dataset: BenchmarkDatasetSnapshot | null;
  runResult?: BenchmarkRunResult | null;
  progress?: BenchmarkProgressSnapshot | null;
  runHistory?: BenchmarkRunHistoryItem[];
  humanReviewRecords?: BenchmarkHumanReviewRecord[];
  autofindState?: AutoFindWorkflowState | null;
  autofindTurns?: BenchmarkChatTurn[];
};

export type BenchmarkWorkspaceSessionIndex = {
  projectId: string;
  activeSessionId: string | null;
  sessions: BenchmarkWorkspaceSession[];
  updatedAt: string;
};

const SESSIONS_DIR = path.join(process.cwd(), ".zeval-db", "benchmark-sessions");

export async function readBenchmarkWorkspaceSessions(projectId: string): Promise<BenchmarkWorkspaceSessionIndex> {
  try {
    const raw = await readFile(sessionFilePath(projectId), "utf8");
    const parsed = JSON.parse(raw) as Partial<BenchmarkWorkspaceSessionIndex>;
    return {
      projectId,
      activeSessionId: typeof parsed.activeSessionId === "string" ? parsed.activeSessionId : null,
      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions.filter(isBenchmarkWorkspaceSession).map((session) => ({ ...session, projectId }))
        : [],
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return {
      projectId,
      activeSessionId: null,
      sessions: [],
      updatedAt: new Date().toISOString(),
    };
  }
}

export async function writeBenchmarkWorkspaceSessions(input: BenchmarkWorkspaceSessionIndex): Promise<void> {
  const projectId = safeSegment(input.projectId);
  const payload: BenchmarkWorkspaceSessionIndex = {
    projectId,
    activeSessionId: input.activeSessionId,
    sessions: input.sessions.filter(isBenchmarkWorkspaceSession).map((session) => ({
      ...session,
      projectId,
    })),
    updatedAt: new Date().toISOString(),
  };

  await mkdir(SESSIONS_DIR, { recursive: true });
  await writeFile(sessionFilePath(projectId), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function sessionFilePath(projectId: string): string {
  return path.join(SESSIONS_DIR, `${safeSegment(projectId)}.json`);
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "default";
}

function isBenchmarkWorkspaceSession(value: unknown): value is BenchmarkWorkspaceSession {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BenchmarkWorkspaceSession>;
  return (
    typeof record.id === "string" &&
    typeof record.projectId === "string" &&
    typeof record.title === "string" &&
    typeof record.description === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.updatedAt === "string" &&
    typeof record.requirement === "string" &&
    typeof record.useLlm === "boolean" &&
    Array.isArray(record.copilotTurns)
  );
}
