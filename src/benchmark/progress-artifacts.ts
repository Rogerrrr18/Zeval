/**
 * @fileoverview File-backed benchmark run progress artifacts.
 */

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BenchmarkProgressSnapshot } from "@/benchmark/progress";
import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkMetricEvaluationResult,
  BenchmarkTaskPackage,
} from "@/benchmark/types";

export type BenchmarkRunProgressArtifact = {
  runId: string;
  updatedAt: string;
  snapshot: BenchmarkProgressSnapshot;
  genericRun?: BenchmarkGenericRunArtifact;
};

export type BenchmarkGenericRunArtifact = {
  requirementText: string;
  task: BenchmarkTaskPackage;
  cases: BenchmarkCase[];
  submissions: BenchmarkAgentSubmission[];
  metricResults: BenchmarkMetricEvaluationResult[];
};

const RUNS_DIR = path.join(process.cwd(), ".zeval-db", "benchmark-runs");
const writeQueues = new Map<string, Promise<void>>();
const artifactCache = new Map<string, BenchmarkRunProgressArtifact>();

/**
 * Persist the latest benchmark progress snapshot to disk.
 * Failures are logged and swallowed so checkpoint IO never aborts the run.
 * @param snapshot In-memory progress snapshot.
 */
export async function persistBenchmarkRunSnapshot(snapshot: BenchmarkProgressSnapshot): Promise<void> {
  const updatedAt = snapshot.updatedAt ?? new Date().toISOString();
  const existing = await readBenchmarkRunArtifact(snapshot.runId);
  const artifact: BenchmarkRunProgressArtifact = {
    runId: snapshot.runId,
    updatedAt,
    snapshot: { ...snapshot, updatedAt },
    genericRun: existing?.genericRun,
  };
  await writeRunArtifact(snapshot.runId, artifact);
}

/**
 * Persist generic benchmark run checkpoint data (submissions + metric results).
 * @param runId Benchmark run id.
 * @param genericRun Resumable run payload.
 */
export async function persistBenchmarkGenericRunArtifact(
  runId: string,
  genericRun: BenchmarkGenericRunArtifact,
): Promise<void> {
  const existing = await readBenchmarkRunArtifact(runId);
  const updatedAt = new Date().toISOString();
  const artifact: BenchmarkRunProgressArtifact = {
    runId,
    updatedAt,
    snapshot: existing?.snapshot ?? {
      runId,
      phase: "preparing",
      updatedAt,
      totalSubmissions: genericRun.submissions.length,
      completedSubmissions: genericRun.submissions.filter((item) => item.status === "completed").length,
      failedSubmissions: genericRun.submissions.filter((item) => item.status === "failed").length,
      evaluatedMetrics: genericRun.metricResults.length,
      totalMetrics: 0,
      matrixProgress: [],
      recentItems: [],
      events: [],
    },
    genericRun,
  };
  await writeRunArtifact(runId, artifact);
}

/**
 * Read a persisted benchmark run artifact from disk.
 * @param runId Benchmark run id.
 * @returns Parsed artifact or null when missing/invalid.
 */
export async function readBenchmarkRunArtifact(runId: string): Promise<BenchmarkRunProgressArtifact | null> {
  const cached = artifactCache.get(safeSegment(runId));
  if (cached) {
    return cached;
  }
  try {
    const raw = await readFile(runFilePath(safeSegment(runId)), "utf8");
    const parsed = JSON.parse(raw) as Partial<BenchmarkRunProgressArtifact>;
    if (!parsed.snapshot?.runId) return null;
    const artifact: BenchmarkRunProgressArtifact = {
      runId: parsed.snapshot.runId,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : parsed.snapshot.updatedAt ?? new Date().toISOString(),
      snapshot: parsed.snapshot,
      genericRun: parsed.genericRun,
    };
    artifactCache.set(safeSegment(runId), artifact);
    return artifact;
  } catch {
    return null;
  }
}

function runFilePath(runId: string): string {
  return path.join(RUNS_DIR, `${runId}.json`);
}

async function writeRunArtifact(runIdValue: string, artifact: BenchmarkRunProgressArtifact): Promise<void> {
  const runId = safeSegment(runIdValue);
  const previousWrite = writeQueues.get(runId) ?? Promise.resolve();
  const nextWrite = previousWrite
    .catch(() => undefined)
    .then(async () => {
      await mkdir(RUNS_DIR, { recursive: true });
      const target = runFilePath(runId);
      const current = artifactCache.get(runId) ?? (await readBenchmarkRunArtifact(runIdValue));
      const merged = mergeRunArtifacts(current, artifact);
      await atomicWriteFile(target, `${JSON.stringify(merged, null, 2)}\n`);
      artifactCache.set(runId, merged);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[benchmark-checkpoint] failed to persist run ${runIdValue}: ${message}`);
    });
  writeQueues.set(runId, nextWrite);
  await nextWrite;
}

/**
 * Write JSON atomically with Windows-safe rename retries and direct-write fallback.
 * @param target Final artifact path.
 * @param content Serialized JSON payload.
 */
async function atomicWriteFile(target: string, content: string): Promise<void> {
  const temp = `${target}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temp, content, "utf8");
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rename(temp, target);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EEXIST" || code === "EBUSY") {
        if (attempt >= maxAttempts) {
          await writeFile(target, content, "utf8");
          await unlink(temp).catch(() => undefined);
          return;
        }
        await sleep(120 * attempt);
        continue;
      }
      await unlink(temp).catch(() => undefined);
      throw error;
    }
  }
}

/**
 * Sleep for checkpoint retry backoff.
 * @param ms Delay in milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function mergeRunArtifacts(
  current: BenchmarkRunProgressArtifact | null,
  next: BenchmarkRunProgressArtifact,
): BenchmarkRunProgressArtifact {
  if (!current) return next;
  const currentSnapshotTime = Date.parse(current.snapshot.updatedAt ?? current.updatedAt);
  const nextSnapshotTime = Date.parse(next.snapshot.updatedAt ?? next.updatedAt);
  const snapshot = Number.isFinite(currentSnapshotTime) &&
    Number.isFinite(nextSnapshotTime) &&
    currentSnapshotTime > nextSnapshotTime
    ? current.snapshot
    : next.snapshot;

  const genericRun = pickRicherGenericRun(current.genericRun, next.genericRun);
  return {
    ...next,
    updatedAt: new Date().toISOString(),
    snapshot,
    genericRun,
  };
}

function pickRicherGenericRun(
  current: BenchmarkGenericRunArtifact | undefined,
  next: BenchmarkGenericRunArtifact | undefined,
): BenchmarkGenericRunArtifact | undefined {
  if (!current) return next;
  if (!next) return current;
  const currentWeight = current.submissions.length + current.metricResults.length * 10;
  const nextWeight = next.submissions.length + next.metricResults.length * 10;
  return currentWeight > nextWeight ? current : next;
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140) || "default";
}
