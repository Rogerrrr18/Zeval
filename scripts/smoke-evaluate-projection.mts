import { readFile } from "node:fs/promises";
import path from "node:path";
import * as dbIndex from "../src/db/index.ts";
import * as evaluationProjection from "../src/db/evaluation-projection.ts";
import * as csvParser from "../src/parsers/csvParser.ts";
import * as evaluateRun from "../src/pipeline/evaluateRun.ts";
import { loadDotEnvFile } from "./load-env.mts";

const dbApi = resolveInteropModule(dbIndex);
const projectionApi = resolveInteropModule(evaluationProjection);
const csvParserApi = resolveInteropModule(csvParser);
const evaluateRunApi = resolveInteropModule(evaluateRun);

void main().catch((error) => {
  console.error("[db:evaluate-projection] failed", error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  await loadDotEnvFile();

  const workspaceId = process.env.DB_SMOKE_WORKSPACE_ID ?? "db-smoke";
  const rawCsvPath = path.resolve(
    process.env.DB_SMOKE_RAW_CSV ?? "mock-chatlog/raw-data/support-refund-short.csv",
  );
  const scenarioId = process.env.DB_SMOKE_SCENARIO_ID ?? "toB-customer-support";
  const runId = `db_projection_smoke_${Date.now()}`;

  const rawRows = csvParserApi.parseCsvRows(await readFile(rawCsvPath, "utf8"));
  const response = await evaluateRunApi.runEvaluatePipeline(rawRows, {
    useLlm: false,
    runId,
    scenarioId,
    scenarioContext: {
      scenarioId,
      onboardingAnswers: {
        primary_channel: "Web chat",
        has_human_handoff: "yes",
        resolution_field: "not present in raw CSV",
      },
    },
  });
  response.meta.workspaceId = workspaceId;

  const projection = projectionApi.buildEvaluationProjection(response, {
    projectId: workspaceId,
    runId,
    useLlm: false,
  });
  const database = await dbApi.createZeroreDatabase();
  await projectionApi.persistEvaluationProjection(database, projection);

  const evaluationRunRecord = projection.dbRecords.find((record) => record.type === "evaluation_runs");
  if (!evaluationRunRecord) {
    throw new Error("Projection did not produce an evaluation_runs record.");
  }
  const persistedRun = await database.get(workspaceId, "evaluation_runs", evaluationRunRecord.id);
  const objectiveSignals = await database.list(workspaceId, "objective_signals");

  if (!persistedRun) {
    throw new Error(`Persisted evaluation run was not readable: ${evaluationRunRecord.id}`);
  }

  console.info(
    JSON.stringify(
      {
        ok: true,
        adapter: process.env.ZERORE_DATABASE_ADAPTER ?? "local-json",
        workspaceId,
        runId,
        records: projection.dbRecords.length,
        summary: projection.summary,
        readableEvaluationRun: Boolean(persistedRun),
        listedObjectiveSignals: objectiveSignals.length,
      },
      null,
      2,
    ),
  );
}

function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}
