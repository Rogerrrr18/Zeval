/**
 * @fileoverview Benchmark progress tracking for real-time UI updates.
 *
 * Uses an in-memory EventEmitter pattern. Each benchmark run gets a
 * unique runId; the frontend opens an SSE stream keyed by that id.
 */

import type {
  AgentFrameworkId,
  BenchmarkMatrixCell,
  BenchmarkModelId,
  BenchmarkRunResult,
} from "@/benchmark/types";

export type BenchmarkProgressPhase =
  | "preparing"
  | "ingesting"
  | "building_cases"
  | "submitting"
  | "evaluating"
  | "completed"
  | "failed";

export type SubmissionProgressItem = {
  agentFramework: AgentFrameworkId;
  model: BenchmarkModelId;
  caseId: string;
  status: "pending" | "running" | "completed" | "failed";
  durationMs?: number;
  error?: string;
  decision?: string;
};

export type BenchmarkProgressEvent = {
  eventId: string;
  occurredAt: string;
  phase: BenchmarkProgressPhase;
  title: string;
  detail: string;
  status: "running" | "completed" | "warning" | "failed";
  caseId?: string;
  metricName?: string;
  score?: number;
  evidence?: string[];
};

export type BenchmarkDatasetProgressSummary = {
  fileName?: string;
  rows: number;
  sessions: number;
  caseCount: number;
  sampledCaseCount: number;
  hasTimestamp: boolean;
  warnings: string[];
};

export type BenchmarkProgressSnapshot = {
  runId: string;
  phase: BenchmarkProgressPhase;
  totalSubmissions: number;
  completedSubmissions: number;
  failedSubmissions: number;
  /** How many evaluation metric results have been computed so far. */
  evaluatedMetrics: number;
  totalMetrics: number;
  /** Per-matrix-cell progress. */
  matrixProgress: MatrixProgressRow[];
  /** Recently finished items (last 20). */
  recentItems: SubmissionProgressItem[];
  /** White-box event timeline shown in the benchmark progress view. */
  events: BenchmarkProgressEvent[];
  /** Latest transparent analysis note for the active pipeline step. */
  activeAnalysis?: string;
  datasetSummary?: BenchmarkDatasetProgressSummary;
  error?: string;
  result?: BenchmarkRunResult;
};

export type MatrixProgressRow = {
  agentFramework: AgentFrameworkId;
  model: BenchmarkModelId;
  total: number;
  completed: number;
  failed: number;
};

export type ProgressListener = (snapshot: BenchmarkProgressSnapshot) => void;

class BenchmarkProgressTracker {
  private snapshots = new Map<string, BenchmarkProgressSnapshot>();
  private listeners = new Map<string, Set<ProgressListener>>();

  init(runId: string, matrix: BenchmarkMatrixCell[], caseCount: number): void {
    const totalSubmissions = matrix.length * caseCount;
    this.snapshots.set(runId, {
      runId,
      phase: "preparing",
      totalSubmissions,
      completedSubmissions: 0,
      failedSubmissions: 0,
      evaluatedMetrics: 0,
      totalMetrics: 0,
      matrixProgress: matrix.map((cell) => ({
        agentFramework: cell.agentFramework,
        model: cell.model,
        total: caseCount,
        completed: 0,
        failed: 0,
      })),
      recentItems: [],
      events: [],
    });
    this.listeners.set(runId, new Set());
  }

  subscribe(runId: string, listener: ProgressListener): () => void {
    if (!this.listeners.has(runId)) {
      this.listeners.set(runId, new Set());
    }
    this.listeners.get(runId)!.add(listener);
    const snapshot = this.snapshots.get(runId);
    if (snapshot) listener(snapshot);
    return () => {
      this.listeners.get(runId)?.delete(listener);
    };
  }

  update(runId: string, patch: Partial<BenchmarkProgressSnapshot>): void {
    const current = this.snapshots.get(runId);
    if (!current) return;
    const next = { ...current, ...patch };
    this.snapshots.set(runId, next);
    this.listeners.get(runId)?.forEach((listener) => listener(next));
  }

  addItem(runId: string, item: SubmissionProgressItem): void {
    const current = this.snapshots.get(runId);
    if (!current) return;
    const recentItems = [item, ...current.recentItems].slice(0, 20);
    this.update(runId, { recentItems });
  }

  /**
   * Add one transparent pipeline event to the progress timeline.
   *
   * @param runId Benchmark run identifier.
   * @param event Event payload without generated id and timestamp.
   */
  addEvent(runId: string, event: Omit<BenchmarkProgressEvent, "eventId" | "occurredAt">): void {
    const current = this.snapshots.get(runId);
    if (!current) return;
    const nextEvent: BenchmarkProgressEvent = {
      ...event,
      eventId: `${runId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      occurredAt: new Date().toISOString(),
    };
    this.update(runId, { events: [nextEvent, ...current.events].slice(0, 60) });
  }

  setPhase(runId: string, phase: BenchmarkProgressPhase, error?: string): void {
    this.update(runId, { phase, error });
  }

  setResult(runId: string, result: BenchmarkRunResult): void {
    this.update(runId, { phase: "completed", result });
  }

  getSnapshot(runId: string): BenchmarkProgressSnapshot | undefined {
    return this.snapshots.get(runId);
  }

  cleanup(runId: string): void {
    this.snapshots.delete(runId);
    this.listeners.delete(runId);
  }
}

export const benchmarkProgress = new BenchmarkProgressTracker();
