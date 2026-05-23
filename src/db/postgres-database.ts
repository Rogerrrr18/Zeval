/**
 * @fileoverview PostgreSQL adapter for the generic ZeroreDatabase contract.
 *
 * P1 重构：使用 projectId（uuid）替代 workspaceId 作为分区键。
 * 底层仍写入 zerore_records JSONB 桥接表，但主键改为 (project_id, type, id)。
 * 类型化表写入由 supabase-typed-database.ts 负责。
 */

import { Pool } from "pg";
import type { PoolConfig } from "pg";
import type { DbRecord, ZeroreDatabase } from "@/db";

type ZeroreRecordRow = {
  id: string;
  project_id: string;
  type: string;
  payload: unknown;
  created_at: Date | string;
  updated_at: Date | string;
};

/**
 * JSONB-backed Postgres adapter used as the storage bridge.
 */
export class PostgresDatabase implements ZeroreDatabase {
  private readonly pool: Pool;
  private ready: Promise<void> | null = null;

  constructor(config: PoolConfig) {
    this.pool = new Pool(config);
  }

  async upsert(record: DbRecord): Promise<void> {
    await runWithTransientDatabaseRetry(
      `upsert zerore_record ${record.projectId}/${record.type}/${record.id}`,
      async () => {
        await this.ensureReady();
        await this.pool.query(
          `
            insert into zerore_records (
              project_id,
              type,
              id,
              payload,
              created_at,
              updated_at
            )
            values ($1, $2, $3, $4::jsonb, $5, $6)
            on conflict (project_id, type, id)
            do update set
              payload = excluded.payload,
              updated_at = excluded.updated_at
          `,
          [
            record.projectId,
            record.type,
            record.id,
            JSON.stringify(record.payload),
            record.createdAt,
            record.updatedAt,
          ],
        );
      },
    );
  }

  async get(projectId: string, type: string, id: string): Promise<DbRecord | null> {
    const result = await runWithTransientDatabaseRetry(
      `get zerore_record ${projectId}/${type}/${id}`,
      async () => {
        await this.ensureReady();
        return this.pool.query<ZeroreRecordRow>(
          `
            select id, project_id, type, payload, created_at, updated_at
            from zerore_records
            where project_id = $1 and type = $2 and id = $3
            limit 1
          `,
          [projectId, type, id],
        );
      },
    );
    return result.rows[0] ? rowToDbRecord(result.rows[0]) : null;
  }

  async list(projectId: string, type: string): Promise<DbRecord[]> {
    const result = await runWithTransientDatabaseRetry(
      `list zerore_records ${projectId}/${type}`,
      async () => {
        await this.ensureReady();
        return this.pool.query<ZeroreRecordRow>(
          `
            select id, project_id, type, payload, created_at, updated_at
            from zerore_records
            where project_id = $1 and type = $2
            order by updated_at desc
          `,
          [projectId, type],
        );
      },
    );
    return result.rows.map(rowToDbRecord);
  }

  private ensureReady(): Promise<void> {
    this.ready ??= this.pool.query(BRIDGE_TABLE_SQL).then(() => undefined);
    this.ready = this.ready.catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }
}

/**
 * Create a Postgres database adapter from environment variables.
 *
 * @returns Postgres database adapter.
 */
export function createPostgresDatabaseFromEnv(): PostgresDatabase {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required when ZEVAL_DATABASE_ADAPTER=postgres.");
  }
  return new PostgresDatabase({
    connectionString,
    ssl: resolveSslConfig(connectionString),
    max: Number(process.env.ZEVAL_POSTGRES_POOL_MAX ?? process.env.ZERORE_POSTGRES_POOL_MAX ?? 5),
  });
}

function rowToDbRecord(row: ZeroreRecordRow): DbRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    payload: row.payload,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

function toIsoString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function resolveSslConfig(connectionString: string): PoolConfig["ssl"] {
  const sslMode = process.env.ZEVAL_POSTGRES_SSL ?? process.env.ZERORE_POSTGRES_SSL ?? "auto";
  if (sslMode === "disable") {
    return false;
  }
  if (sslMode === "require" || /supabase|neon|render|railway/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return undefined;
}

async function runWithTransientDatabaseRetry<T>(label: string, operation: () => Promise<T>): Promise<T> {
  const maxAttempts = Number(
    process.env.ZEVAL_POSTGRES_RETRY_ATTEMPTS ?? process.env.ZERORE_POSTGRES_RETRY_ATTEMPTS ?? 3,
  );
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientDatabaseError(error)) {
        throw error;
      }
      const delayMs = 150 * attempt;
      console.warn(
        `[DB] transient postgres error during ${label}; retrying ${attempt}/${maxAttempts - 1} in ${delayMs}ms: ${getErrorMessage(error)}`,
      );
      await delay(delayMs);
    }
  }

  throw lastError;
}

function isTransientDatabaseError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = getErrorMessage(error);
  return (
    [
      "08000", "08003", "08006", "57P01", "57P02", "53300",
      "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ENOTFOUND", "EAI_AGAIN",
    ].includes(code) ||
    /Connection terminated unexpectedly|Connection terminated|timeout|socket hang up/i.test(message)
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/**
 * P1 bridge table: JSONB storage keyed by (project_id, type, id).
 * Typed tables are written by supabase-typed-database.ts.
 */
const BRIDGE_TABLE_SQL = `
  create table if not exists zerore_records (
    project_id text not null default 'default',
    type text not null,
    id text not null,
    payload jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (project_id, type, id)
  );

  create index if not exists idx_zerore_records_project_type_updated
    on zerore_records(project_id, type, updated_at desc);
`;
