/**
 * @fileoverview Filesystem-backed remediation package store.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { RemediationPackageStore } from "@/remediation/package-store";
import type { RemediationPackageIndexRow, RemediationPackageSnapshot } from "@/remediation/types";

const REMEDIATION_ROOT = path.join("artifacts", "remediation-packages");

/**
 * Filesystem implementation for remediation packages.
 */
export class FileSystemRemediationPackageStore implements RemediationPackageStore {
  /**
   * @inheritdoc
   */
  async save(snapshot: RemediationPackageSnapshot): Promise<void> {
    const packageDirectory = path.join(REMEDIATION_ROOT, sanitizePackageId(snapshot.packageId));
    const skillDirectory = snapshot.skillBundle
      ? path.join(REMEDIATION_ROOT, sanitizePackageId(snapshot.skillBundle.folderName))
      : packageDirectory;
    const referenceDirectory = path.join(skillDirectory, "reference");
    await mkdir(referenceDirectory, { recursive: true });

    if (snapshot.skillBundle) {
      await Promise.all(
        snapshot.skillBundle.files.map((file) =>
          writeFile(path.join(REMEDIATION_ROOT, path.relative(REMEDIATION_ROOT, file.relativePath)), file.content, "utf8"),
        ),
      );
    } else {
      await Promise.all(
        snapshot.files.map((file) =>
          writeFile(path.join(packageDirectory, file.fileName), file.content, "utf8"),
        ),
      );
    }
    await mkdir(packageDirectory, { recursive: true });
    await writeFile(path.join(packageDirectory, "manifest.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    if (skillDirectory !== packageDirectory) {
      await writeFile(path.join(skillDirectory, "manifest.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
    }
  }

  /**
   * @inheritdoc
   */
  async list(): Promise<RemediationPackageIndexRow[]> {
    let names: string[] = [];
    try {
      names = await readdir(REMEDIATION_ROOT);
    } catch {
      return [];
    }

    const rows: Array<RemediationPackageIndexRow & { mtimeMs: number }> = [];
    for (const name of names) {
      const manifestPath = path.join(REMEDIATION_ROOT, name, "manifest.json");
      try {
        const [raw, fileStat] = await Promise.all([readFile(manifestPath, "utf8"), stat(manifestPath)]);
        const parsed = JSON.parse(raw) as RemediationPackageSnapshot;
        rows.push({
          packageId: parsed.packageId,
          createdAt: parsed.createdAt,
          runId: parsed.runId,
          title: parsed.title,
          priority: parsed.priority,
          scenarioId: parsed.scenarioId,
          selectedCaseCount: parsed.selectedCaseCount,
          artifactDir: parsed.artifactDir,
          skillFolder: parsed.skillFolder,
          mtimeMs: fileStat.mtimeMs,
        });
      } catch {
        continue;
      }
    }

    rows.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const deduped = new Map<string, RemediationPackageIndexRow & { mtimeMs: number }>();
    for (const row of rows) {
      if (!deduped.has(row.packageId)) {
        deduped.set(row.packageId, row);
      }
    }
    return [...deduped.values()].map((row) => ({
      packageId: row.packageId,
      createdAt: row.createdAt,
      runId: row.runId,
      title: row.title,
      priority: row.priority,
      scenarioId: row.scenarioId,
      selectedCaseCount: row.selectedCaseCount,
      artifactDir: row.artifactDir,
      skillFolder: row.skillFolder,
    }));
  }

  /**
   * @inheritdoc
   */
  async read(packageId: string): Promise<RemediationPackageSnapshot | null> {
    const manifestPath = path.join(REMEDIATION_ROOT, sanitizePackageId(packageId), "manifest.json");
    try {
      const raw = await readFile(manifestPath, "utf8");
      return JSON.parse(raw) as RemediationPackageSnapshot;
    } catch {
      return null;
    }
  }
}

/**
 * Sanitize package ids before they are used as directory names.
 *
 * @param packageId Raw package identifier.
 * @returns Safe directory name.
 */
export function sanitizePackageId(packageId: string): string {
  return packageId.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "remediation-package";
}
