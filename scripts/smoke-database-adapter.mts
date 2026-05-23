import * as dbIndex from "../src/db/index.ts";
import { loadDotEnvFile } from "./load-env.mts";

const dbApi = resolveInteropModule(dbIndex);

void main().catch((error) => {
  console.error("[db:smoke] failed", error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  await loadDotEnvFile();

  const database = await dbApi.createZeroreDatabase();
  const now = new Date().toISOString();
  const workspaceId = process.env.DB_SMOKE_WORKSPACE_ID ?? "db-smoke";
  const type = "adapter_tests";
  const id = `adapter-smoke-${Date.now()}`;

  await database.upsert({
    id,
    projectId: workspaceId,
    type,
    payload: {
      ok: true,
      adapter: process.env.ZEVAL_DATABASE_ADAPTER ?? process.env.ZERORE_DATABASE_ADAPTER ?? "local-json",
      projectRef: process.env.SUPABASE_PROJECT_REF,
    },
    createdAt: now,
    updatedAt: now,
  });

  const record = await database.get(workspaceId, type, id);
  const records = await database.list(workspaceId, type);

  if (!record) {
    throw new Error(`Record was not readable after upsert: ${workspaceId}/${type}/${id}`);
  }

  console.info(
    JSON.stringify(
      {
        ok: true,
        adapter: process.env.ZEVAL_DATABASE_ADAPTER ?? process.env.ZERORE_DATABASE_ADAPTER ?? "local-json",
        workspaceId,
        type,
        id,
        listedRecords: records.length,
      },
      null,
      2,
    ),
  );
}

function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}
