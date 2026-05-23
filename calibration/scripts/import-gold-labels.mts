import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as calibrationJsonl from "../../src/calibration/jsonl.ts";
import * as calibrationPaths from "../../src/calibration/paths.ts";
import * as goldSetScaffold from "../../src/calibration/goldSetScaffold.ts";
import type { GoldSetCaseRecord, GoldSetLabelDraftRecord } from "../../src/calibration/types.ts";

const calibrationJsonlApi = resolveInteropModule(calibrationJsonl);
const calibrationPathsApi = resolveInteropModule(calibrationPaths);
const goldSetScaffoldApi = resolveInteropModule(goldSetScaffold);

void main().catch((error) => {
  console.error("[gold:labels:import] failed", error);
  process.exitCode = 1;
});

/**
 * Import approved label drafts into canonical `labels.jsonl`.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const version = getFlagValue(args, "--version") ?? "v2";
  const allowEmpty = args.includes("--allow-empty");
  const casesPath = path.resolve(
    getFlagValue(args, "--cases") ?? calibrationPathsApi.resolveCalibrationPath("gold-sets", version, "cases.jsonl"),
  );
  const draftsDirectory = path.resolve(
    getFlagValue(args, "--drafts") ?? calibrationPathsApi.resolveCalibrationPath("gold-sets", version, "label-drafts"),
  );
  const labelsPath = path.resolve(
    getFlagValue(args, "--out") ?? calibrationPathsApi.resolveCalibrationPath("gold-sets", version, "labels.jsonl"),
  );
  const reportPath = path.resolve(
    getFlagValue(args, "--report") ?? calibrationPathsApi.resolveCalibrationPath("gold-sets", version, "import-report.md"),
  );

  const cases = await calibrationJsonlApi.readJsonlFile<GoldSetCaseRecord>(casesPath);
  const drafts = await readLabelDrafts(draftsDirectory);
  const result = goldSetScaffoldApi.importApprovedGoldSetLabels(cases, drafts);

  if (result.importedCount === 0 && !allowEmpty) {
    await writeFile(reportPath, goldSetScaffoldApi.renderGoldSetImportReport(result), "utf8");
    throw new Error(`没有可导入的 approved label draft。报告已写入：${reportPath}`);
  }

  await calibrationJsonlApi.writeJsonlFile(labelsPath, result.labels);
  await writeFile(reportPath, goldSetScaffoldApi.renderGoldSetImportReport(result), "utf8");
  console.info(
    `[gold:labels:import] version=${version} imported=${result.importedCount} skipped=${result.skippedCount} failed=${result.failedCount} labels=${labelsPath}`,
  );

  if (result.failedCount > 0) {
    process.exitCode = 1;
  }
}

/**
 * Read JSON and JSONL draft files from one directory.
 *
 * @param draftsDirectory Draft directory.
 * @returns Draft records.
 */
async function readLabelDrafts(draftsDirectory: string): Promise<GoldSetLabelDraftRecord[]> {
  const entries = await readdir(draftsDirectory, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".jsonl")))
    .map((entry) => path.join(draftsDirectory, entry.name))
    .sort((left, right) => left.localeCompare(right));

  const drafts: GoldSetLabelDraftRecord[] = [];
  for (const filePath of files) {
    const raw = await readFile(filePath, "utf8");
    if (filePath.endsWith(".jsonl")) {
      drafts.push(
        ...raw
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => JSON.parse(line) as GoldSetLabelDraftRecord),
      );
      continue;
    }
    drafts.push(JSON.parse(raw) as GoldSetLabelDraftRecord);
  }

  return drafts;
}

/**
 * Read one optional CLI flag value.
 *
 * @param args Raw CLI args.
 * @param flag Flag name.
 * @returns Flag value when present.
 */
function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

/**
 * Normalize tsx loader interop.
 *
 * @param module Imported module namespace.
 * @returns Stable module surface.
 */
function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}
