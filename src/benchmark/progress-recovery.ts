/**
 * @fileoverview Recover benchmark progress snapshots after SSE reconnects.
 */

import { benchmarkProgress } from "@/benchmark/progress";
import { readBenchmarkRunArtifact } from "@/benchmark/progress-artifacts";
import type { BenchmarkProgressSnapshot } from "@/benchmark/progress";

export type BenchmarkRunStatusSource = "memory" | "artifact" | "none";

export type BenchmarkRunStatus = {
  source: BenchmarkRunStatusSource;
  stale: boolean;
  snapshot: BenchmarkProgressSnapshot | null;
};

const TERMINAL_PHASES = new Set(["completed", "failed"]);
const STALE_ARTIFACT_MS = 120_000;

export async function readBenchmarkRunStatus(runId: string): Promise<BenchmarkRunStatus> {
  const liveSnapshot = benchmarkProgress.getSnapshot(runId);
  if (liveSnapshot) {
    return { source: "memory", stale: false, snapshot: liveSnapshot };
  }

  const artifact = await readBenchmarkRunArtifact(runId);
  if (!artifact) {
    return { source: "none", stale: true, snapshot: null };
  }

  const ageMs = Date.now() - Date.parse(artifact.updatedAt);
  const isTerminal = TERMINAL_PHASES.has(artifact.snapshot.phase);
  const stale = !isTerminal && (!Number.isFinite(ageMs) || ageMs > STALE_ARTIFACT_MS);

  if (!stale) {
    return { source: "artifact", stale: false, snapshot: artifact.snapshot };
  }

  return {
    source: "artifact",
    stale: true,
    snapshot: {
      ...artifact.snapshot,
      phase: "failed",
      error: "评测进度已中断：后端没有可恢复的活跃 run。请重新运行本次评测。",
      updatedAt: new Date().toISOString(),
    },
  };
}
