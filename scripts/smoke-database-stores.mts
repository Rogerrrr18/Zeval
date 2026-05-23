import { readFile } from "node:fs/promises";
import path from "node:path";
import * as datasetStorage from "../src/eval-datasets/storage/index.ts";
import * as csvParser from "../src/parsers/csvParser.ts";
import * as evaluateRun from "../src/pipeline/evaluateRun.ts";
import * as workbench from "../src/workbench/index.ts";
import { loadDotEnvFile } from "./load-env.mts";
import type { DatasetBaselineRecord, DatasetCaseRecord, SampleBatchRecord } from "../src/eval-datasets/storage/types.ts";
import type { WorkbenchBaselineSnapshot } from "../src/workbench/types.ts";

const datasetApi = resolveInteropModule(datasetStorage);
const workbenchApi = resolveInteropModule(workbench);
const csvParserApi = resolveInteropModule(csvParser);
const evaluateRunApi = resolveInteropModule(evaluateRun);

void main().catch((error) => {
  console.error("[db:stores] failed", error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  await loadDotEnvFile();

  const workspaceId = process.env.DB_SMOKE_WORKSPACE_ID ?? "db-store-smoke";
  const suffix = Date.now();
  const caseId = `db_case_${suffix}`;
  const sampleBatchId = `db_sample_${suffix}`;
  const runId = `db_store_run_${suffix}`;

  const rawCsvPath = path.resolve(
    process.env.DB_SMOKE_RAW_CSV ?? "mock-chatlog/raw-data/support-refund-short.csv",
  );
  const rawRows = csvParserApi.parseCsvRows(await readFile(rawCsvPath, "utf8"));
  const evaluate = await evaluateRunApi.runEvaluatePipeline(rawRows, {
    useLlm: false,
    runId,
    scenarioId: "toB-customer-support",
  });
  evaluate.meta.workspaceId = workspaceId;

  const datasetStore = datasetApi.createDatasetStore({ workspaceId });
  const workbenchStore = workbenchApi.createWorkbenchBaselineStore({ workspaceId });
  const now = new Date().toISOString();

  const caseRecord: DatasetCaseRecord = {
    caseId,
    caseSetType: "badcase",
    sessionId: rawRows[0]?.sessionId ?? "unknown",
    topicSegmentId: "unknown-topic",
    topicLabel: "unknown",
    topicSummary: "smoke case",
    normalizedTranscriptHash: `hash_${caseId}`,
    duplicateGroupKey: `group_${caseId}`,
    baselineVersion: "smoke",
    baselineCaseScore: 42,
    tags: ["smoke"],
    title: "Database store smoke case",
    transcript: rawRows.map((row) => `[${row.role}] ${row.content}`).join("\n"),
    suggestedAction: "Verify database-backed store can persist case records.",
    scenarioId: "toB-customer-support",
    sourceRunId: runId,
    harvestedAt: now,
    failureSeverityScore: 58,
    createdAt: now,
    updatedAt: now,
  };
  const baselineRecord: DatasetBaselineRecord = {
    caseId,
    baselineCaseScore: 42,
    baselineObjectiveScore: 50,
    baselineSubjectiveScore: 40,
    baselineRiskPenaltyScore: 8,
    baselineSignals: [{ signalKey: "smoke", score: 0.5, severity: "medium" }],
    baselineGeneratedAt: now,
    baselineProductVersion: "smoke",
  };
  const sampleBatch: SampleBatchRecord = {
    sampleBatchId,
    caseIds: [caseId],
    requestedGoodcaseCount: 0,
    requestedBadcaseCount: 1,
    strategy: "smoke",
    createdAt: now,
    actualGoodcaseCount: 0,
    actualBadcaseCount: 1,
  };
  const snapshot: WorkbenchBaselineSnapshot = {
    schemaVersion: 1,
    customerId: "db_store_smoke_customer",
    runId,
    createdAt: now,
    label: "database store smoke baseline",
    sourceFileName: path.basename(rawCsvPath),
    evaluate,
    rawRows,
  };

  await datasetStore.createCase(caseRecord);
  await datasetStore.saveBaseline(baselineRecord);
  await datasetStore.saveSampleBatch(sampleBatch);
  await workbenchStore.save(snapshot);

  const storedCase = await datasetStore.getCaseById(caseId);
  const duplicate = await datasetStore.checkDuplicate({
    normalizedTranscriptHash: caseRecord.normalizedTranscriptHash,
    topicLabel: caseRecord.topicLabel,
    baselineCaseScore: caseRecord.baselineCaseScore,
  });
  const storedBaseline = await datasetStore.getBaseline(caseId);
  const storedSample = await datasetStore.getSampleBatch(sampleBatchId);
  const storedWorkbenchBaseline = await workbenchStore.read(snapshot.customerId, runId);
  const workbenchLookup = await workbenchStore.findByRunId(runId);

  if (!storedCase || !storedBaseline || !storedSample || !storedWorkbenchBaseline || !workbenchLookup) {
    throw new Error("At least one database-backed store read failed.");
  }
  if (!duplicate.isDuplicate || duplicate.matchedCaseId !== caseId) {
    throw new Error("Database-backed duplicate check did not find the stored case.");
  }

  console.info(
    JSON.stringify(
      {
        ok: true,
        adapter: process.env.ZEVAL_DATABASE_ADAPTER ?? process.env.ZERORE_DATABASE_ADAPTER ?? "local-json",
        datasetProvider: process.env.DATASET_STORE_PROVIDER ?? "filesystem",
        workbenchProvider: process.env.WORKBENCH_BASELINE_STORE_PROVIDER ?? "filesystem",
        workspaceId,
        caseId,
        sampleBatchId,
        runId,
      },
      null,
      2,
    ),
  );
}

function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}
