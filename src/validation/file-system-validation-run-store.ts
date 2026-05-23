/**
 * @fileoverview Filesystem-backed validation run store.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ValidationRunStore } from "@/validation/validation-run-store";
import type { ValidationRunIndexRow, ValidationRunSnapshot } from "@/validation/types";

const VALIDATION_RUN_ROOT = path.join("artifacts", "validation-runs");

/**
 * Filesystem implementation for validation runs.
 */
export class FileSystemValidationRunStore implements ValidationRunStore {
  /**
   * @inheritdoc
   */
  async save(snapshot: ValidationRunSnapshot): Promise<void> {
    const runDirectory = path.join(VALIDATION_RUN_ROOT, sanitizeValidationRunId(snapshot.validationRunId));
    await mkdir(runDirectory, { recursive: true });
    await Promise.all(
      snapshot.files.map((file) => writeFile(path.join(runDirectory, file.fileName), file.content, "utf8")),
    );
    await writeFile(path.join(runDirectory, "manifest.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  /**
   * @inheritdoc
   */
  async list(packageId?: string): Promise<ValidationRunIndexRow[]> {
    let names: string[] = [];
    try {
      names = await readdir(VALIDATION_RUN_ROOT);
    } catch {
      return [];
    }

    const rows: Array<ValidationRunIndexRow & { mtimeMs: number }> = [];
    for (const name of names) {
      const manifestPath = path.join(VALIDATION_RUN_ROOT, name, "manifest.json");
      try {
        const [raw, fileStat] = await Promise.all([readFile(manifestPath, "utf8"), stat(manifestPath)]);
        const parsed = normalizeValidationRunSnapshot(JSON.parse(raw) as ValidationRunSnapshot);
        if (packageId && parsed.packageId !== packageId) {
          continue;
        }
        rows.push({
          validationRunId: parsed.validationRunId,
          packageId: parsed.packageId,
          mode: parsed.mode,
          status: parsed.status,
          createdAt: parsed.createdAt,
          artifactDir: parsed.artifactDir,
          mtimeMs: fileStat.mtimeMs,
        });
      } catch {
        continue;
      }
    }

    rows.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return rows.map((row) => ({
      validationRunId: row.validationRunId,
      packageId: row.packageId,
      mode: row.mode,
      status: row.status,
      createdAt: row.createdAt,
      artifactDir: row.artifactDir,
    }));
  }

  /**
   * @inheritdoc
   */
  async read(validationRunId: string): Promise<ValidationRunSnapshot | null> {
    const manifestPath = path.join(VALIDATION_RUN_ROOT, sanitizeValidationRunId(validationRunId), "manifest.json");
    try {
      const raw = await readFile(manifestPath, "utf8");
      return normalizeValidationRunSnapshot(JSON.parse(raw) as ValidationRunSnapshot);
    } catch {
      return null;
    }
  }
}

/**
 * Sanitize validation run ids before they are used as directory names.
 *
 * @param validationRunId Raw validation run identifier.
 * @returns Safe directory name.
 */
export function sanitizeValidationRunId(validationRunId: string): string {
  return validationRunId.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "validation-run";
}

/**
 * Normalize one parsed validation snapshot for backward compatibility.
 *
 * @param snapshot Parsed manifest payload.
 * @returns Snapshot with defaulted fields.
 */
function normalizeValidationRunSnapshot(snapshot: ValidationRunSnapshot): ValidationRunSnapshot {
  return {
    ...snapshot,
    files: snapshot.files ?? [],
  };
}
