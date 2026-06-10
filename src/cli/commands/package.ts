/**
 * @fileoverview `zeval package` — build a remediation package from a saved evaluate run.
 *
 * Usage:
 *   zeval package --run-id run_1748965432
 *   zeval package --run-id run_xxx --case-keys bc_001,bc_002
 *   zeval package --run-id run_xxx --baseline-customer-id customer_abc
 */

import type { Command } from "commander";
import { readPersistedEvaluateResult } from "@/persistence/evaluateResultStore";
import { buildRemediationPackage, createRemediationPackageStore } from "@/remediation";
import { c, ok, err, header, kv, warn, createSpinner } from "@/cli/display";

interface PackageOptions {
  runId: string;
  caseKeys?: string;
  baselineCustomerId?: string;
}

export function registerPackageCommand(program: Command): void {
  program
    .command("package")
    .alias("pkg")
    .description("Build a remediation package from a saved evaluate run")
    .requiredOption("--run-id <id>",                  "Run ID of the saved evaluate result")
    .option("--case-keys <keys>",                     "Comma-separated bad case keys to include (default: all)")
    .option("--baseline-customer-id <id>",            "Baseline customer ID for the acceptance gate")
    .action(async (opts: PackageOptions) => {
      header("Zeval Package");
      kv("run-id", opts.runId);

      // ── 1. Load saved evaluate result ─────────────────────────────────────────
      const spinner = createSpinner("Loading saved evaluate result…");
      const evaluate = await readPersistedEvaluateResult(opts.runId).catch(() => null);

      if (!evaluate) {
        spinner.fail(`Run not found: ${opts.runId}`);
        err(`No artifact for "${opts.runId}". Run ${c.bold("zeval runs list")} to see available runs.`);
        process.exit(1);
      }

      spinner.succeed(`Loaded run: ${opts.runId}`);
      kv("bad cases available", evaluate.badCaseAssets?.length ?? 0);
      console.log();

      // ── 2. Resolve selected case keys ─────────────────────────────────────────
      const allCaseKeys  = (evaluate.badCaseAssets ?? []).map((bc) => bc.caseKey);
      const selectedKeys = opts.caseKeys
        ? opts.caseKeys.split(",").map((k) => k.trim()).filter(Boolean)
        : allCaseKeys;

      if (selectedKeys.length === 0) {
        warn("No bad cases found in this run — nothing to package.");
        process.exit(0);
      }

      kv("cases selected", selectedKeys.length);
      console.log();

      // ── 3. Build package ──────────────────────────────────────────────────────
      const spinner2 = createSpinner("Building remediation package…");

      const buildResult = await Promise.resolve(
        buildRemediationPackage({
          sourceFileName:       `run_${opts.runId}`,
          baselineCustomerId:   opts.baselineCustomerId,
          selectedCaseKeys:     selectedKeys,
          evaluate: {
            runId:              evaluate.runId,
            objectiveMetrics:   evaluate.objectiveMetrics,
            subjectiveMetrics:  evaluate.subjectiveMetrics,
            scenarioEvaluation: evaluate.scenarioEvaluation ?? null,
            badCaseAssets:      evaluate.badCaseAssets ?? [],
            suggestions:        evaluate.suggestions ?? [],
          },
        }),
      ).catch((e: unknown) => {
        spinner2.fail(`Build error: ${(e as Error).message}`);
        process.exit(1);
      });

      if (buildResult.skipped) {
        spinner2.fail("Package skipped");
        warn(buildResult.message);
        process.exit(0);
      }

      // ── 4. Persist package ────────────────────────────────────────────────────
      const packageStore = createRemediationPackageStore();
      await packageStore.save(buildResult.package).catch((e: unknown) => {
        spinner2.fail(`Save error: ${(e as Error).message}`);
        process.exit(1);
      });

      spinner2.succeed(`Package built: ${buildResult.package.packageId}`);

      // ── 5. Print summary ──────────────────────────────────────────────────────
      const snap = buildResult.package;
      header("Package Summary");
      kv("package ID",      snap.packageId);
      kv("title",           snap.title);
      kv("priority",        snap.priority);
      kv("cases included",  snap.selectedCaseCount);
      kv("edit scope",      snap.editScope.join(", ") || "—");
      kv("output dir",      `artifacts/remediation-packages/${snap.packageId}/`);

      if (snap.targetMetrics.length > 0) {
        console.log();
        for (const tm of snap.targetMetrics) {
          kv(`  target: ${tm.metricId}`, `${tm.currentValue.toFixed(2)} → >${tm.targetValue.toFixed(2)}`);
        }
      }

      console.log();
      ok(`Remediation package ready: ${c.bold(snap.packageId)}`);
      console.log(`  ${c.dim("Artifacts:")} artifacts/remediation-packages/${snap.packageId}/`);
      console.log();
    });
}
