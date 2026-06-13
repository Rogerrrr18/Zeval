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
import { persistBenchmarkRunSnapshot } from "@/benchmark/progress-artifacts";

export type BenchmarkProgressPhase =
  | "preparing"
  | "ingesting"
  | "building_cases"
  | "submitting"
  | "evaluating"
  | "completed"
  | "failed"
  | "interrupted";

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
  updatedAt?: string;
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
  private cancelledRuns = new Set<string>();
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>();

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
    this.persist(runId);
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
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    if (patch.phase && isActiveBenchmarkPhase(patch.phase) && patch.error === undefined) {
      next.error = undefined;
    }
    this.snapshots.set(runId, next);
    this.persist(runId);
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
    this.clearCancel(runId);
    this.update(runId, { phase: "completed", result });
  }

  /**
   * Register a cooperative cancel request for an active run.
   *
   * @param runId Benchmark run id.
   */
  requestCancel(runId: string): void {
    this.cancelledRuns.add(runId);
  }

  /**
   * Whether a run has been marked for cancellation.
   *
   * @param runId Benchmark run id.
   * @returns True when cancel was requested.
   */
  isCancelled(runId: string): boolean {
    return this.cancelledRuns.has(runId);
  }

  /**
   * Clear a pending cancel flag after the run stops.
   *
   * @param runId Benchmark run id.
   */
  clearCancel(runId: string): void {
    this.cancelledRuns.delete(runId);
  }

  /**
   * Persist an interrupted checkpoint and notify listeners.
   *
   * @param runId Benchmark run id.
   * @param error User-facing interruption reason.
   */
  interrupt(runId: string, error: string): void {
    this.clearCancel(runId);
    this.addEvent(runId, {
      phase: "interrupted",
      status: "warning",
      title: "评测已中断",
      detail: error,
    });
    this.update(runId, { phase: "interrupted", error });
  }

  getSnapshot(runId: string): BenchmarkProgressSnapshot | undefined {
    return this.snapshots.get(runId);
  }

  restoreSnapshot(snapshot: BenchmarkProgressSnapshot): void {
    this.snapshots.set(snapshot.runId, snapshot);
    if (!this.listeners.has(snapshot.runId)) {
      this.listeners.set(snapshot.runId, new Set());
    }
  }

  cleanup(runId: string): void {
    this.snapshots.delete(runId);
    this.listeners.delete(runId);
    this.cancelledRuns.delete(runId);
  }

  private persist(runId: string): void {
    const snapshot = this.snapshots.get(runId);
    if (!snapshot) return;
    const existingTimer = this.persistTimers.get(runId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }
    this.persistTimers.set(
      runId,
      setTimeout(() => {
        this.persistTimers.delete(runId);
        const latest = this.snapshots.get(runId);
        if (!latest) return;
        void persistBenchmarkRunSnapshot(latest).catch(() => {
          // Progress streaming should not fail just because disk persistence did.
        });
      }, 800),
    );
  }

  /**
   * Flush pending snapshot persistence immediately (e.g. before run completion).
   * @param runId Benchmark run id.
   */
  async flushPersist(runId: string): Promise<void> {
    const pending = this.persistTimers.get(runId);
    if (pending) {
      clearTimeout(pending);
      this.persistTimers.delete(runId);
    }
    const snapshot = this.snapshots.get(runId);
    if (!snapshot) return;
    await persistBenchmarkRunSnapshot(snapshot).catch(() => undefined);
  }
}

export const benchmarkProgress = new BenchmarkProgressTracker();

const ACTIVE_BENCHMARK_PHASES = new Set<BenchmarkProgressPhase>([
  "preparing",
  "ingesting",
  "building_cases",
  "submitting",
  "evaluating",
]);

/**
 * Whether a benchmark phase indicates the run is actively progressing.
 * @param phase Benchmark progress phase.
 * @returns True for non-terminal in-flight phases.
 */
export function isActiveBenchmarkPhase(phase: BenchmarkProgressPhase): boolean {
  return ACTIVE_BENCHMARK_PHASES.has(phase);
}
