/**
 * @fileoverview Shared calibration path and file-discovery helpers.
 */

import { readdir } from "node:fs/promises";
import path from "node:path";

/**
 * Resolve one path inside the repo-local calibration workspace.
 *
 * @param segments Path segments under `calibration/`.
 * @returns Absolute path.
 */
export function resolveCalibrationPath(...segments: string[]): string {
  return path.join(process.cwd(), "calibration", ...segments);
}

/**
 * Build a stable YYYY-MM-DD date stamp for file naming.
 *
 * @param value Optional source date.
 * @returns File-safe date stamp.
 */
export function buildCalibrationDateStamp(value: Date = new Date()): string {
  return value.toISOString().slice(0, 10);
}

/**
 * Sanitize one identifier for calibration artifacts and reports.
 *
 * @param value Raw identifier.
 * @returns File-safe identifier.
 */
export function sanitizeCalibrationId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "unnamed";
}

/**
 * List files with one suffix inside a calibration directory.
 *
 * @param directory Absolute directory path.
 * @param suffix File suffix to keep.
 * @returns Absolute file paths sorted lexicographically.
 */
export async function listCalibrationFiles(directory: string, suffix: string): Promise<string[]> {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => path.join(directory, entry.name))
      .sort((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}
