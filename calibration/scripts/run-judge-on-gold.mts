import path from "node:path";
import * as calibrationJsonl from "../../src/calibration/jsonl.ts";
import * as judgeCalibration from "../../src/calibration/judgeCalibration.ts";
import * as calibrationPaths from "../../src/calibration/paths.ts";
import * as judgeProfile from "../../src/llm/judgeProfile.ts";
import type { GoldSetCaseRecord } from "../../src/calibration/types.ts";

const calibrationJsonlApi = resolveInteropModule(calibrationJsonl);
const judgeCalibrationApi = resolveInteropModule(judgeCalibration);
const calibrationPathsApi = resolveInteropModule(calibrationPaths);
const judgeProfileApi = resolveInteropModule(judgeProfile);

void main().catch((error) => {
  console.error("[calibration:judge] failed", error);
  process.exitCode = 1;
});

/**
 * Run the evaluation pipeline on the configured gold set and persist judge rows.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const useLlm = args.includes("--use-llm");
  const judgeId = getFlagValue(args, "--judge-id") ?? buildDefaultJudgeId(useLlm);
  const casesPath = path.resolve(
    getFlagValue(args, "--cases") ?? calibrationPathsApi.resolveCalibrationPath("gold-sets", "v1", "cases.jsonl"),
  );
  const outputPath = path.resolve(
    getFlagValue(args, "--out") ??
      calibrationPathsApi.resolveCalibrationPath(
        "judge-runs",
        `${calibrationPathsApi.buildCalibrationDateStamp()}_${calibrationPathsApi.sanitizeCalibrationId(judgeId)}.jsonl`,
      ),
  );
  const runIdPrefix = getFlagValue(args, "--run-id-prefix") ?? "calibration";
  const cases = await calibrationJsonlApi.readJsonlFile<GoldSetCaseRecord>(casesPath);
  const records = await judgeCalibrationApi.runJudgeOnGoldSet(cases, {
    judgeId,
    useLlm,
    runIdPrefix,
  });

  await calibrationJsonlApi.writeJsonlFile(outputPath, records);

  const failureCount = records.filter((item) => Boolean(item.error)).length;
  console.info(`[calibration:judge] cases=${cases.length} failures=${failureCount} output=${outputPath}`);
}

/**
 * Read one optional CLI flag value.
 *
 * @param args Raw CLI args.
 * @param flag Flag name, such as `--judge-id`.
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
 * Build a default judge identifier for local smoke runs.
 *
 * @param useLlm Whether the run enables the LLM judge.
 * @returns Stable judge id.
 */
function buildDefaultJudgeId(useLlm: boolean): string {
  if (!useLlm) {
    return "rule-local";
  }
  const profile = judgeProfileApi.getZevalJudgeProfileSnapshot();
  return `llm-${calibrationPathsApi.sanitizeCalibrationId(profile.profileVersion)}-${calibrationPathsApi.sanitizeCalibrationId(profile.model)}`;
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
