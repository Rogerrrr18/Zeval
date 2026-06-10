/**
 * @fileoverview Run benchmark module unit tests and write structured logs.
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const timestamp = new Date();
const stamp = timestamp.toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const logRoot = join(root, ".zeval-db", "test-logs", "summary");

const testFiles = [
  "src/benchmark/rerank.test.ts",
  "src/benchmark/admission-policy-learner.test.ts",
  "src/benchmark/admission-scorer.test.ts",
  "src/benchmark/admission-feature-extractor.test.ts",
  "src/benchmark/evaluators.test.ts",
  "src/benchmark/companion-transcript-judge.test.ts",
];

const modules: Record<string, { passed: number; failed: number; log: string }> = {};
let overallPass = true;

for (const file of testFiles) {
  const moduleName = file.includes("rerank")
    ? "rerank"
    : file.includes("learner")
      ? "policy-learn"
      : file.includes("scorer")
        ? "policy-score"
        : "rubric";
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", file],
    { cwd: root, encoding: "utf8" },
  );
  const passed = (result.stdout?.match(/\nok \d+/g) ?? []).length;
  const failed = (result.stdout?.match(/\nnot ok \d+/g) ?? []).length;
  const pass = result.status === 0;
  if (!pass) overallPass = false;

  const moduleDir = join(root, ".zeval-db", "test-logs", `module-${moduleName === "rubric" ? "1-rubric" : moduleName === "rerank" ? "2-rerank" : "3-policy"}`);
  mkdirSync(moduleDir, { recursive: true });
  const logName = `${stamp}-${moduleName}.json`;
  const logPath = join(moduleDir, logName);
  writeFileSync(
    logPath,
    JSON.stringify(
      {
        module: moduleName,
        file,
        timestamp: timestamp.toISOString(),
        exitCode: result.status,
        stdout: result.stdout,
        stderr: result.stderr,
        passed,
        failed,
      },
      null,
      2,
    ),
    "utf8",
  );
  modules[moduleName] = { passed, failed, log: logPath.replace(/\\/g, "/") };
}

mkdirSync(logRoot, { recursive: true });
const summaryPath = join(logRoot, `${stamp.slice(0, 8)}-benchmark-modules.json`);
writeFileSync(
  summaryPath,
  JSON.stringify(
    {
      timestamp: timestamp.toISOString(),
      modules,
      overallPass,
    },
    null,
    2,
  ),
  "utf8",
);

console.log(`Wrote summary: ${summaryPath}`);
process.exit(overallPass ? 0 : 1);
