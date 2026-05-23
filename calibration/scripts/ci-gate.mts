import { writeFile } from "node:fs/promises";
import path from "node:path";
import * as calibrationJsonl from "../../src/calibration/jsonl.ts";
import * as calibrationPaths from "../../src/calibration/paths.ts";
import * as judgeGate from "../../src/calibration/judgeGate.ts";
import type { GoldSetLabelRecord, JudgeRunRecord } from "../../src/calibration/types.ts";

const calibrationJsonlApi = resolveInteropModule(calibrationJsonl);
const calibrationPathsApi = resolveInteropModule(calibrationPaths);
const judgeGateApi = resolveInteropModule(judgeGate);

void main().catch((error) => {
  console.error("[calibration:ci] failed", error);
  process.exitCode = 1;
});

/**
 * Run the Zeval judge CI gate against a gold set and the latest judge output.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const labelsPath = path.resolve(
    getFlagValue(args, "--labels") ?? calibrationPathsApi.resolveCalibrationPath("gold-sets", "v1", "labels.jsonl"),
  );
  const judgeRunPath = path.resolve(getFlagValue(args, "--judge-run") ?? (await findLatestJudgeRunPath()));
  const baselinePath = getFlagValue(args, "--baseline");
  const candidatePath = getFlagValue(args, "--candidate");
  const [defaultBaseline, defaultCandidate] =
    !baselinePath && !candidatePath ? await findLatestJudgeRunPairOrNull() : [null, null];

  const labels = await calibrationJsonlApi.readJsonlFile<GoldSetLabelRecord>(labelsPath);
  const predictions = await calibrationJsonlApi.readJsonlFile<JudgeRunRecord>(judgeRunPath);
  const baseline = baselinePath || defaultBaseline
    ? await calibrationJsonlApi.readJsonlFile<JudgeRunRecord>(path.resolve(baselinePath ?? defaultBaseline!))
    : undefined;
  const candidate = candidatePath || defaultCandidate
    ? await calibrationJsonlApi.readJsonlFile<JudgeRunRecord>(path.resolve(candidatePath ?? defaultCandidate!))
    : undefined;

  const report = judgeGateApi.evaluateJudgeCiGate({
    labels,
    predictions,
    baseline,
    candidate,
  });
  const outputPath = path.resolve(
    getFlagValue(args, "--out") ??
      calibrationPathsApi.resolveCalibrationPath(
        "reports",
        `${calibrationPathsApi.buildCalibrationDateStamp()}_${calibrationPathsApi.sanitizeCalibrationId(report.judgeId)}.ci-gate.md`,
      ),
  );
  await writeFile(outputPath, judgeGateApi.renderJudgeCiGateReport(report), "utf8");
  console.info(`[calibration:ci] result=${report.passed ? "passed" : "failed"} output=${outputPath}`);
  if (!report.passed) {
    process.exitCode = 1;
  }
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
 * Pick the latest two judge-run files when available.
 *
 * @returns Baseline/candidate paths or nulls when drift cannot be computed.
 */
async function findLatestJudgeRunPairOrNull(): Promise<[string | null, string | null]> {
  const directory = calibrationPathsApi.resolveCalibrationPath("judge-runs");
  const files = await calibrationPathsApi.listCalibrationFiles(directory, ".jsonl");
  if (files.length < 2) {
    return [null, null];
  }
  return [files[files.length - 2]!, files[files.length - 1]!];
}

/**
 * Normalize tsx loader interop so scripts can consume either named exports
 * or a CJS-style default wrapper without branching everywhere.
 *
 * @param module Imported module namespace.
 * @returns Stable callable module surface.
 */
function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}
