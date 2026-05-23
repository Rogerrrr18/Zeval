import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as calibrationAgreement from "../../src/calibration/agreement.ts";
import * as calibrationJsonl from "../../src/calibration/jsonl.ts";
import * as calibrationPaths from "../../src/calibration/paths.ts";
import type { JudgeRunRecord } from "../../src/calibration/types.ts";

const calibrationAgreementApi = resolveInteropModule(calibrationAgreement);
const calibrationJsonlApi = resolveInteropModule(calibrationJsonl);
const calibrationPathsApi = resolveInteropModule(calibrationPaths);

void main().catch((error) => {
  console.error("[calibration:drift] failed", error);
  process.exitCode = 1;
});

/**
 * Compare two judge-run files and emit one drift report.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const [defaultBaseline, defaultCandidate] = await findLatestJudgeRunPair();
  const baselinePath = path.resolve(getFlagValue(args, "--baseline") ?? defaultBaseline);
  const candidatePath = path.resolve(getFlagValue(args, "--candidate") ?? defaultCandidate);
  const baseline = await calibrationJsonlApi.readJsonlFile<JudgeRunRecord>(baselinePath);
  const candidate = await calibrationJsonlApi.readJsonlFile<JudgeRunRecord>(candidatePath);
  const report = calibrationAgreementApi.computeJudgeDriftReport(baseline, candidate);
  const outputPath = path.resolve(
    getFlagValue(args, "--out") ??
      calibrationPathsApi.resolveCalibrationPath(
        "reports",
        `${calibrationPathsApi.buildCalibrationDateStamp()}_${calibrationPathsApi.sanitizeCalibrationId(report.baselineJudgeId)}_vs_${calibrationPathsApi.sanitizeCalibrationId(report.candidateJudgeId)}.drift.md`,
      ),
  );

  await writeFile(outputPath, calibrationAgreementApi.renderJudgeDriftReport(report), "utf8");
  console.info(
    `[calibration:drift] baseline=${report.baselineJudgeId} candidate=${report.candidateJudgeId} output=${outputPath}`,
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
 * Pick the latest two judge-run JSONL files for drift comparison.
 *
 * @returns Baseline and candidate absolute paths.
 */
async function findLatestJudgeRunPair(): Promise<[string, string]> {
  const directory = calibrationPathsApi.resolveCalibrationPath("judge-runs");
  const files = await calibrationPathsApi.listCalibrationFiles(directory, ".jsonl");
  if (files.length < 2) {
    throw new Error("至少需要两个 judge-run 文件才能做 drift 对比。");
  }
  return [files[files.length - 2]!, files[files.length - 1]!];
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
