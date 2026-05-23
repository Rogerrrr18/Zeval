/**
 * @fileoverview Durable local async job queue adapter.
 */

import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveWorkspacePath } from "@/workspaces/paths";

export type QueueJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type QueueJobRecord<TResult = unknown> = {
  jobId: string;
  organizationId?: string;
  projectId?: string;
  workspaceId: string;
  type: string;
  status: QueueJobStatus;
  payload: unknown;
  result?: TResult;
  error?: string;
  attempts: number;
  maxAttempts: number;
  createdAt: string;
  updatedAt: string;
  availableAt: string;
  startedAt?: string;
  heartbeatAt?: string;
  finishedAt?: string;
};

export type QueueJobHandler = (job: QueueJobRecord) => Promise<unknown>;

export type QueueWorkerResult = {
  job: QueueJobRecord | null;
  handled: boolean;
};

const DEFAULT_MAX_ATTEMPTS = 2;
const DEFAULT_STALE_RUNNING_MS = 15 * 60 * 1000;

/**
 * Enqueue a job into the local file queue.
 *
 * @param input Job input.
 * @returns Job record.
 */
export async function enqueueLocalJob(input: {
  workspaceId: string;
  organizationId?: string;
  projectId?: string;
  type: string;
  payload: unknown;
  maxAttempts?: number;
  availableAt?: string;
}): Promise<QueueJobRecord> {
  const now = new Date().toISOString();
  const job: QueueJobRecord = {
    jobId: `job_${Date.now()}_${randomBytes(3).toString("hex")}`,
    organizationId: input.organizationId,
    projectId: input.projectId ?? input.workspaceId,
    workspaceId: input.workspaceId,
    type: input.type,
    status: "queued",
    payload: input.payload,
    attempts: 0,
    maxAttempts: input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    createdAt: now,
    updatedAt: now,
    availableAt: input.availableAt ?? now,
  };
  await writeLocalJob(job);
  return job;
}

/**
 * List jobs in one workspace.
 *
 * @param workspaceId Workspace identifier.
 * @param filters Optional status/type filters.
 * @returns Newest-first job records.
 */
export async function listLocalJobs(
  workspaceId: string,
  filters: {
    status?: QueueJobStatus;
    type?: string;
  } = {},
): Promise<QueueJobRecord[]> {
  const directory = resolveQueueDirectory(workspaceId);
  let names: string[] = [];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }

  const jobs: QueueJobRecord[] = [];
  for (const name of names.filter((item) => item.endsWith(".json"))) {
    const job = await readLocalJob(workspaceId, name.replace(/\.json$/, ""));
    if (!job) {
      continue;
    }
    if (filters.status && job.status !== filters.status) {
      continue;
    }
    if (filters.type && job.type !== filters.type) {
      continue;
    }
    jobs.push(job);
  }
  return jobs.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

/**
 * Read one local queue job by id.
 *
 * @param workspaceId Workspace identifier.
 * @param jobId Job identifier.
 * @returns Job record or null.
 */
export async function readLocalJob(workspaceId: string, jobId: string): Promise<QueueJobRecord | null> {
  try {
    const raw = await readFile(resolveJobPath(workspaceId, jobId), "utf8");
    return normalizeQueueJob(JSON.parse(raw) as QueueJobRecord, workspaceId);
  } catch {
    return null;
  }
}

/**
 * Cancel one queued or running job.
 *
 * @param workspaceId Workspace identifier.
 * @param jobId Job identifier.
 * @returns Updated job or null when not found.
 */
export async function cancelLocalJob(workspaceId: string, jobId: string): Promise<QueueJobRecord | null> {
  const job = await readLocalJob(workspaceId, jobId);
  if (!job) {
    return null;
  }
  if (job.status === "succeeded" || job.status === "failed" || job.status === "canceled") {
    return job;
  }
  const now = new Date().toISOString();
  const updated: QueueJobRecord = {
    ...job,
    status: "canceled",
    updatedAt: now,
    finishedAt: now,
  };
  await writeLocalJob(updated);
  return updated;
}

/**
 * Requeue a failed job for another execution attempt.
 *
 * @param workspaceId Workspace identifier.
 * @param jobId Job identifier.
 * @returns Updated job or null when not found.
 */
export async function retryLocalJob(workspaceId: string, jobId: string): Promise<QueueJobRecord | null> {
  const job = await readLocalJob(workspaceId, jobId);
  if (!job) {
    return null;
  }
  if (job.status !== "failed") {
    return job;
  }
  const now = new Date().toISOString();
  const updated: QueueJobRecord = {
    ...job,
    status: "queued",
    updatedAt: now,
    availableAt: now,
    error: undefined,
    finishedAt: undefined,
  };
  await writeLocalJob(updated);
  return updated;
}

/**
 * Recover stale running jobs so a crashed worker does not leave them stuck.
 *
 * @param workspaceId Workspace identifier.
 * @param staleAfterMs Milliseconds after which running jobs are considered stale.
 * @returns Number of recovered jobs.
 */
export async function recoverStaleLocalJobs(
  workspaceId: string,
  staleAfterMs = DEFAULT_STALE_RUNNING_MS,
): Promise<number> {
  const jobs = await listLocalJobs(workspaceId, { status: "running" });
  const now = Date.now();
  let recovered = 0;
  for (const job of jobs) {
    const heartbeat = Date.parse(job.heartbeatAt ?? job.startedAt ?? job.updatedAt);
    if (Number.isNaN(heartbeat) || now - heartbeat < staleAfterMs) {
      continue;
    }
    const updated = buildFailureOrRetryJob(job, `job running stale for ${staleAfterMs}ms`);
    await writeLocalJob(updated);
    recovered += 1;
  }
  return recovered;
}

/**
 * Run at most one queued job for the workspace.
 *
 * @param workspaceId Workspace identifier.
 * @param handlers Job handler map.
 * @returns Worker result.
 */
export async function runNextLocalJob(
  workspaceId: string,
  handlers: Record<string, QueueJobHandler>,
): Promise<QueueWorkerResult> {
  await recoverStaleLocalJobs(workspaceId);
  const queued = (await listLocalJobs(workspaceId, { status: "queued" }))
    .filter((job) => Date.parse(job.availableAt) <= Date.now())
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  const job = queued[0] ?? null;
  if (!job) {
    return { job: null, handled: false };
  }

  const handler = handlers[job.type];
  if (!handler) {
    const failed = buildFailureOrRetryJob(job, `unsupported job type: ${job.type}`);
    await writeLocalJob(failed);
    return { job: failed, handled: false };
  }

  const running = markJobRunning(job);
  await writeLocalJob(running);
  try {
    const result = await handler(running);
    const succeeded = markJobSucceeded(running, result);
    await writeLocalJob(succeeded);
    return { job: succeeded, handled: true };
  } catch (error) {
    const failed = buildFailureOrRetryJob(
      running,
      error instanceof Error ? error.message : String(error),
    );
    await writeLocalJob(failed);
    return { job: failed, handled: true };
  }
}

/**
 * Run queued jobs up to a concurrency limit.
 *
 * @param workspaceId Workspace identifier.
 * @param handlers Job handler map.
 * @param concurrency Number of jobs to attempt in this tick.
 * @returns Worker results.
 */
export async function runLocalJobBatch(
  workspaceId: string,
  handlers: Record<string, QueueJobHandler>,
  concurrency = 1,
): Promise<QueueWorkerResult[]> {
  const count = Math.max(1, Math.floor(concurrency));
  const results: QueueWorkerResult[] = [];
  for (let index = 0; index < count; index += 1) {
    results.push(await runNextLocalJob(workspaceId, handlers));
  }
  return results;
}

/**
 * Persist one job record.
 *
 * @param job Job record.
 */
async function writeLocalJob(job: QueueJobRecord): Promise<void> {
  const filePath = resolveJobPath(job.workspaceId, job.jobId);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
}

/**
 * Mark a job as running.
 *
 * @param job Queued job.
 * @returns Running job.
 */
function markJobRunning(job: QueueJobRecord): QueueJobRecord {
  const now = new Date().toISOString();
  return {
    ...job,
    status: "running",
    attempts: job.attempts + 1,
    updatedAt: now,
    startedAt: now,
    heartbeatAt: now,
    error: undefined,
  };
}

/**
 * Mark a job as succeeded.
 *
 * @param job Running job.
 * @param result Handler result.
 * @returns Succeeded job.
 */
function markJobSucceeded(job: QueueJobRecord, result: unknown): QueueJobRecord {
  const now = new Date().toISOString();
  return {
    ...job,
    status: "succeeded",
    result,
    updatedAt: now,
    heartbeatAt: now,
    finishedAt: now,
  };
}

/**
 * Build either a retryable queued job or terminal failed job from an error.
 *
 * @param job Current job.
 * @param error Error message.
 * @returns Updated job.
 */
function buildFailureOrRetryJob(job: QueueJobRecord, error: string): QueueJobRecord {
  const now = new Date().toISOString();
  const retryable = job.attempts < job.maxAttempts && job.status !== "canceled";
  return {
    ...job,
    status: retryable ? "queued" : "failed",
    error,
    updatedAt: now,
    heartbeatAt: now,
    finishedAt: retryable ? undefined : now,
    availableAt: retryable ? new Date(Date.now() + 1500).toISOString() : job.availableAt,
  };
}

/**
 * Normalize old queue records that predate attempts/result fields.
 *
 * @param job Parsed job record.
 * @param workspaceId Workspace id from the path.
 * @returns Normalized job record.
 */
function normalizeQueueJob(job: QueueJobRecord, workspaceId: string): QueueJobRecord {
  return {
    ...job,
    workspaceId: job.workspaceId || workspaceId,
    projectId: job.projectId ?? job.workspaceId ?? workspaceId,
    attempts: job.attempts ?? 0,
    maxAttempts: job.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    availableAt: job.availableAt ?? job.createdAt ?? new Date().toISOString(),
  };
}

/**
 * Resolve the queue directory for one workspace.
 *
 * @param workspaceId Workspace identifier.
 * @returns Queue directory path.
 */
function resolveQueueDirectory(workspaceId: string): string {
  return resolveWorkspacePath(workspaceId, "queue");
}

/**
 * Resolve one queue job file path.
 *
 * @param workspaceId Workspace identifier.
 * @param jobId Job identifier.
 * @returns Job JSON path.
 */
function resolveJobPath(workspaceId: string, jobId: string): string {
  const safeJobId = jobId.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "");
  return path.join(resolveQueueDirectory(workspaceId), `${safeJobId}.json`);
}
