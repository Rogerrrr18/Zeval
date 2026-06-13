/**
 * @fileoverview Recover benchmark progress snapshots after SSE reconnects.
 */

import { benchmarkProgress, isActiveBenchmarkPhase } from "@/benchmark/progress";
import { persistBenchmarkRunSnapshot, readBenchmarkRunArtifact } from "@/benchmark/progress-artifacts";
import type { BenchmarkProgressSnapshot } from "@/benchmark/progress";

export type BenchmarkRunStatusSource = "memory" | "artifact" | "none";

export type BenchmarkRunStatus = {
  source: BenchmarkRunStatusSource;
  stale: boolean;
  /** True when checkpoint artifacts exist and the run can be resumed. */
  resumable: boolean;
  snapshot: BenchmarkProgressSnapshot | null;
};

const TERMINAL_PHASES = new Set<BenchmarkProgressSnapshot["phase"]>(["completed"]);
const RESUMABLE_PHASES = new Set<BenchmarkProgressSnapshot["phase"]>([
  "preparing",
  "ingesting",
  "building_cases",
  "submitting",
  "evaluating",
  "interrupted",
  "failed",
]);

/** No progress heartbeat for this long → treat as interrupted (not hard failed). */
const STALE_SNAPSHOT_MS = 5 * 60 * 1000;

/**
 * Read the latest benchmark run status from memory or checkpoint artifacts.
 *
 * Live in-memory runs always win. Artifact-only runs stay resumable when a checkpoint
 * exists; stale snapshots are surfaced as `interrupted` rather than blocking resume.
 *
 * @param runId Benchmark run id.
 * @returns Run status for SSE recovery and manual resume.
 */
export async function readBenchmarkRunStatus(runId: string): Promise<BenchmarkRunStatus> {
  const liveSnapshot = benchmarkProgress.getSnapshot(runId);
  if (liveSnapshot) {
    return {
      source: "memory",
      stale: false,
      resumable: RESUMABLE_PHASES.has(liveSnapshot.phase),
      snapshot: liveSnapshot,
    };
  }

  const artifact = await readBenchmarkRunArtifact(runId);
  if (!artifact) {
    return { source: "none", stale: true, resumable: false, snapshot: null };
  }

  const snapshot = artifact.snapshot;
  const phase = snapshot.phase;
  const isTerminal = TERMINAL_PHASES.has(phase);
  const lastProgressAt = Date.parse(snapshot.updatedAt ?? artifact.updatedAt);
  const ageMs = Date.now() - lastProgressAt;
  const stale = !isTerminal && (!Number.isFinite(lastProgressAt) || ageMs > STALE_SNAPSHOT_MS);
  const hasCheckpoint = Boolean(
    artifact.genericRun &&
    (artifact.genericRun.submissions.length > 0 || artifact.genericRun.metricResults.length > 0),
  );
  const resumable = hasCheckpoint && (phase === "interrupted" || phase === "failed" || stale || RESUMABLE_PHASES.has(phase));

  if (!stale) {
    return {
      source: "artifact",
      stale: false,
      resumable,
      snapshot,
    };
  }

  const interruptedSnapshot: BenchmarkProgressSnapshot = {
    ...snapshot,
    phase: "interrupted",
    error: "评测进程已中断（页面断开或服务重启）。可点击「继续评测」从 checkpoint 接续。",
    updatedAt: new Date().toISOString(),
  };
  await persistBenchmarkRunSnapshot(interruptedSnapshot).catch(() => undefined);

  return {
    source: "artifact",
    stale: true,
    resumable,
    snapshot: interruptedSnapshot,
  };
}

/**
 * Whether an SSE stream should stay open waiting for live progress updates.
 *
 * @param status Recovered run status.
 * @returns True when the stream should subscribe to in-memory progress.
 */
export function shouldKeepRunStreamOpen(status: BenchmarkRunStatus): boolean {
  if (!status.snapshot) {
    return false;
  }
  if (status.source === "memory") {
    return status.snapshot.phase !== "completed";
  }
  if (status.snapshot.phase === "completed") {
    return false;
  }
  if (status.resumable) {
    return true;
  }
  return isActiveBenchmarkPhase(status.snapshot.phase);
}
