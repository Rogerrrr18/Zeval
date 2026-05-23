/**
 * @fileoverview Built-in handlers for queued Zeval jobs.
 */

import { createZeroreDatabase } from "@/db";
import { buildEvaluationProjection, persistEvaluationProjection } from "@/db/evaluation-projection";
import { redactRawRows } from "@/pii/redaction";
import { persistEvaluateResult } from "@/persistence/evaluateResultStore";
import { runEvaluatePipeline } from "@/pipeline/evaluateRun";
import { createRemediationPackageStore } from "@/remediation";
import { evaluateRequestSchema } from "@/schemas/api";
import { validationRunCreateBodySchema } from "@/schemas/validation";
import type { QueueJobHandler, QueueJobRecord } from "@/queue";
import {
  createValidationRunStore,
  runOfflineEvalValidation,
  runReplayValidation,
} from "@/validation";

export const ZEVAL_QUEUE_HANDLERS: Record<string, QueueJobHandler> = {
  evaluate: runEvaluateJob,
  validation_run: runValidationRunJob,
};

/**
 * Execute a queued evaluate job and persist its projection.
 *
 * @param job Queue job.
 * @returns Small result payload stored on the job record.
 */
async function runEvaluateJob(job: QueueJobRecord): Promise<unknown> {
  const parsedPayload = evaluateRequestSchema.safeParse(job.payload);
  if (!parsedPayload.success) {
    throw new Error(`evaluate job payload invalid: ${JSON.stringify(parsedPayload.error.flatten())}`);
  }

  const body = parsedPayload.data;
  const redaction = redactRawRows(body.rawRows);
  const rawRows = redaction.rows;
  const runId = body.runId ?? `run_${Date.now()}`;
  const useLlm = body.useLlm ?? true;
  const judgeRequired = body.judgeRequired ?? true;
  const response = await runEvaluatePipeline(rawRows, {
    useLlm,
    judgeRequired,
    runId,
    scenarioId: body.scenarioId,
    scenarioContext: body.scenarioContext
      ? {
          scenarioId: body.scenarioId,
          onboardingAnswers: body.scenarioContext.onboardingAnswers,
        }
      : undefined,
    structuredTaskMetrics: body.structuredTaskMetrics,
    trace: body.trace,
    persistArtifact: body.persistArtifact ?? Boolean(body.artifactBaseName),
    artifactBaseName: body.artifactBaseName,
    extendedInputs: body.extendedInputs,
  });
  response.meta.organizationId = job.organizationId;
  response.meta.projectId = job.projectId;
  response.meta.workspaceId = job.workspaceId;
  response.meta.piiRedaction = redaction.report;

  const projection = buildEvaluationProjection(response, {
    projectId: job.projectId ?? job.workspaceId,
    runId,
    useLlm,
  });
  const database = await createZeroreDatabase();
  await persistEvaluationProjection(database, projection);
  const savedEvaluatePath = await persistEvaluateResult(response);

  return {
    runId,
    warnings: response.meta.warnings,
    artifactPath: response.artifactPath ?? null,
    savedEvaluatePath,
    projectionRecords: projection.dbRecords.length,
    summaryCards: response.summaryCards,
    badCaseCount: response.badCaseAssets.length,
  };
}

/**
 * Execute a queued replay/offline validation run and persist the result.
 *
 * @param job Queue job.
 * @returns Validation run id and terminal status.
 */
async function runValidationRunJob(job: QueueJobRecord): Promise<unknown> {
  const parsedBody = validationRunCreateBodySchema.safeParse(job.payload);
  if (!parsedBody.success) {
    throw new Error(`validation job payload invalid: ${JSON.stringify(parsedBody.error.flatten())}`);
  }

  const remediationStore = createRemediationPackageStore();
  const packageSnapshot = await remediationStore.read(parsedBody.data.packageId);
  if (!packageSnapshot) {
    throw new Error(`未找到 remediation package: ${parsedBody.data.packageId}`);
  }

  const validationRun =
    parsedBody.data.mode === "replay"
      ? await runReplayValidation({
          packageSnapshot,
          baselineCustomerId: parsedBody.data.baselineCustomerId,
          replyApiBaseUrl: parsedBody.data.replyApiBaseUrl,
          useLlm: parsedBody.data.useLlm,
          replyTimeoutMs: parsedBody.data.replyTimeoutMs,
        })
      : await runOfflineEvalValidation({
          packageSnapshot,
          sampleBatchId: parsedBody.data.sampleBatchId,
          replyApiBaseUrl: parsedBody.data.replyApiBaseUrl,
          useLlm: parsedBody.data.useLlm,
          replyTimeoutMs: parsedBody.data.replyTimeoutMs,
        });

  const validationStore = createValidationRunStore();
  await validationStore.save(validationRun);
  return {
    validationRunId: validationRun.validationRunId,
    packageId: validationRun.packageId,
    mode: validationRun.mode,
    status: validationRun.status,
    artifactDir: validationRun.artifactDir,
  };
}
