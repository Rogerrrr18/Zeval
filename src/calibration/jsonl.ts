/**
 * @fileoverview JSONL helpers for calibration assets.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Read one JSONL file into typed rows.
 *
 * @param filePath Absolute or relative file path.
 * @returns Parsed rows.
 */
export async function readJsonlFile<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}

/**
 * Write typed rows into one JSONL file.
 *
 * @param filePath Target path.
 * @param rows JSON-serializable rows.
 */
export async function writeJsonlFile<T>(filePath: string, rows: T[]): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const payload = rows.map((row) => JSON.stringify(row)).join("\n");
  await writeFile(filePath, payload.length > 0 ? `${payload}\n` : "", "utf8");
}
