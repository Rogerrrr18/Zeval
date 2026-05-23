import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as calibrationAgreement from "../../src/calibration/agreement.ts";
import * as calibrationJsonl from "../../src/calibration/jsonl.ts";
import * as calibrationPaths from "../../src/calibration/paths.ts";
import type { GoldSetLabelRecord, JudgeRunRecord } from "../../src/calibration/types.ts";

const calibrationAgreementApi = resolveInteropModule(calibrationAgreement);
const calibrationJsonlApi = resolveInteropModule(calibrationJsonl);
const calibrationPathsApi = resolveInteropModule(calibrationPaths);

void main().catch((error) => {
  console.error("[calibration:agreement] failed", error);
  process.exitCode = 1;
});

/**
 * Compute one agreement report between human labels and one judge-run file.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const labelsPath = path.resolve(
    getFlagValue(args, "--labels") ?? calibrationPathsApi.resolveCalibrationPath("gold-sets", "v1", "labels.jsonl"),
  );
  const judgeRunPath = path.resolve(getFlagValue(args, "--judge-run") ?? (await findLatestJudgeRunPath()));
  const labels = await calibrationJsonlApi.readJsonlFile<GoldSetLabelRecord>(labelsPath);
  const predictions = await calibrationJsonlApi.readJsonlFile<JudgeRunRecord>(judgeRunPath);
  const report = calibrationAgreementApi.computeAgreementReport(labels, predictions);
  const outputPath = path.resolve(
    getFlagValue(args, "--out") ??
      calibrationPathsApi.resolveCalibrationPath(
        "reports",
        `${calibrationPathsApi.buildCalibrationDateStamp()}_${calibrationPathsApi.sanitizeCalibrationId(report.judgeId)}.agreement.md`,
      ),
  );

  await writeFile(outputPath, calibrationAgreementApi.renderAgreementReport(report), "utf8");
  console.info(
    `[calibration:agreement] judge=${report.judgeId} samples=${report.overall.sampleCount} output=${outputPath}`,
  );
}

/**
 * Read one optional CLI flag value.
 *
 * @param args Raw CLI args.
 * @param flag Flag name.
 * @returns The next token when present.
 */
function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

/**
 * Pick the latest judge-run JSONL file from the calibration workspace.
 *
 * @returns Absolute path to the latest run file.
 */
async function findLatestJudgeRunPath(): Promise<string> {
  const directory = calibrationPathsApi.resolveCalibrationPath("judge-runs");
  const files = await calibrationPathsApi.listCalibrationFiles(directory, ".jsonl");
  const latest = files[files.length - 1];
  if (!latest) {
    throw new Error("未找到 judge-run 文件，请先执行 npm run calibration:judge。");
  }
  return latest;
}

/**
 * Normalize tsx loader interop so scripts can consume either named exports
 * or a CJS-style `default` wrapper without branching everywhere.
 *
 * @param module Imported module namespace.
 * @returns Stable callable module surface.
 */
function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}
