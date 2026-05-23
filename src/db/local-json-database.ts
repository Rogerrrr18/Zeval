/**
 * @fileoverview Local JSON database adapter used before Postgres migration.
 *
 * P1 重构：使用 projectId 替代 workspaceId 进行目录分区。
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DbRecord, ZeroreDatabase } from "@/db";

const LOCAL_DB_BASE_DIR = process.env.ZEVAL_LOCAL_DB_DIR ?? path.join(process.cwd(), ".zeval-db");

/**
 * JSON-backed database adapter with project-level partitioning.
 */
export class LocalJsonDatabase implements ZeroreDatabase {
  async upsert(record: DbRecord): Promise<void> {
    const filePath = this.resolveRecordPath(record.projectId, record.type, record.id);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  }

  async get(projectId: string, type: string, id: string): Promise<DbRecord | null> {
    try {
      return JSON.parse(
        await readFile(this.resolveRecordPath(projectId, type, id), "utf8"),
      ) as DbRecord;
    } catch {
      return null;
    }
  }

  async list(projectId: string, type: string): Promise<DbRecord[]> {
    const directory = path.join(LOCAL_DB_BASE_DIR, safeSegment(projectId), safeSegment(type));
    let names: string[] = [];
    try {
      names = await readdir(directory);
    } catch {
      return [];
    }
    const records: DbRecord[] = [];
    for (const name of names.filter((item) => item.endsWith(".json"))) {
      try {
        records.push(
          JSON.parse(await readFile(path.join(directory, name), "utf8")) as DbRecord,
        );
      } catch {
        continue;
      }
    }
    return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  private resolveRecordPath(projectId: string, type: string, id: string): string {
    const safeId = safeSegment(id);
    return path.join(LOCAL_DB_BASE_DIR, safeSegment(projectId), safeSegment(type), `${safeId}.json`);
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "unknown";
}
