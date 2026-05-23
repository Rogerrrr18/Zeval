/**
 * @fileoverview Minimal database abstraction for the P1 typed-record storage layer.
 *
 * P1 重构：移除 workspaceId（旧命名），改用 projectId（uuid string）。
 */

export type DbRecord = {
  id: string;
  projectId: string;
  type: string;
  payload: unknown;
  createdAt: string;
  updatedAt: string;
};

export type DbDataScope = {
  projectId?: string;
};

export interface ZeroreDatabase {
  upsert(record: DbRecord): Promise<void>;
  get(projectId: string, type: string, id: string): Promise<DbRecord | null>;
  list(projectId: string, type: string): Promise<DbRecord[]>;
}

export type ZeroreDatabaseAdapter = "local-json" | "postgres";

/**
 * Create the active database adapter.
 *
 * Defaults to local JSON so development stays dependency-free. Set
 * `ZEVAL_DATABASE_ADAPTER=postgres` with `DATABASE_URL` to write through the
 * Postgres bridge adapter. `ZERORE_DATABASE_ADAPTER` remains a deprecated alias.
 *
 * @returns Database adapter.
 */
export async function createZeroreDatabase(): Promise<ZeroreDatabase> {
  const adapter = resolveDatabaseAdapter();
  if (adapter === "postgres") {
    const { createPostgresDatabaseFromEnv } = await import("@/db/postgres-database");
    return createPostgresDatabaseFromEnv();
  }
  const { LocalJsonDatabase } = await import("@/db/local-json-database");
  return new LocalJsonDatabase();
}

function resolveDatabaseAdapter(): ZeroreDatabaseAdapter {
  const adapter = process.env.ZEVAL_DATABASE_ADAPTER ?? process.env.ZERORE_DATABASE_ADAPTER ?? "local-json";
  if (adapter === "postgres" || adapter === "local-json") {
    return adapter;
  }
  throw new Error(`Unsupported ZEVAL_DATABASE_ADAPTER: ${adapter}`);
}
