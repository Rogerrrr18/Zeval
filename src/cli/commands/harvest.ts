/**
 * @fileoverview `zeval harvest` — admit bad cases from a saved evaluate run.
 *
 * Usage:
 *   zeval harvest --run-id run_1748965432
 *   zeval harvest --run-id run_xxx --baseline-version v1.2 --near-duplicate
 *   zeval harvest --run-id run_xxx --tn-sample-rate 0.1 --capability-dimension intent_understanding
 */

import type { Command } from "commander";
import { harvestBadCasesToDataset } from "@/eval-datasets/harvest-badcases";
import { createDatasetStore } from "@/eval-datasets/storage";
import { readPersistedEvaluateResult } from "@/persistence/evaluateResultStore";
import { c, ok, err, header, kv, warn, createSpinner } from "@/cli/display";

const CHANNEL_LABELS: Record<string, string> = {
  auto_tp:           "TP (true positive bad case)",
  auto_fn:           "FN (missed detection)",
  auto_tn:           "TN (gold positive)",
  auto_uncertainty:  "Uncertainty / boundary case",
  auto_disagreement: "Disagreement across judges",
};

interface HarvestOptions {
  runId: string;
  baselineVersion: string;
  nearDuplicate: boolean;
  tnSampleRate: string;
  humanSamplingRate: string;
  capabilityDimension?: string;
}

export function registerHarvestCommand(program: Command): void {
  program
    .command("harvest")
    .description("Admit bad cases from a saved evaluate run into the dataset pool")
    .requiredOption("--run-id <id>",              "Run ID of the saved evaluate result")
    .option("--baseline-version <ver>",           "Baseline version tag stamped on admitted cases", "cli")
    .option("--near-duplicate",                   "Allow near-duplicate cases (default: reject)", false)
    .option("--tn-sample-rate <rate>",            "TN channel random-sampling rate 0–1 (default: 0.05)", "0.05")
    .option("--human-sampling-rate <rate>",       "Fraction of TP/TN requiring human review 0–1 (default: 1.0)", "1.0")
    .option("--capability-dimension <dim>",       "Capability dimension tag applied to all admitted cases")
    .action(async (opts: HarvestOptions) => {
      header("Zeval Harvest");
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
      kv("sessions",   evaluate.meta.sessions);
      kv("bad cases",  evaluate.badCaseAssets?.length ?? 0);
      console.log();

      // ── 2. Run five-channel admission pipeline ────────────────────────────────
      const spinner2 = createSpinner("Running five-channel admission pipeline…");
      const store = createDatasetStore();

      const admission = await harvestBadCasesToDataset({
        store,
        evaluate,
        baselineVersion:      opts.baselineVersion,
        allowNearDuplicate:   opts.nearDuplicate,
        tnSampleRate:         parseFloat(opts.tnSampleRate),
        humanSamplingRate:    parseFloat(opts.humanSamplingRate),
        capabilityDimension:  opts.capabilityDimension,
      }).catch((e: unknown) => {
        spinner2.fail(`Admission pipeline error: ${(e as Error).message}`);
        process.exit(1);
      });

      spinner2.succeed("Admission pipeline complete");

      // ── 3. Print results ──────────────────────────────────────────────────────
      header("Admission Results");
      kv("total accepted",       admission.savedCount);
      kv("skipped (duplicates)", admission.skippedCount);
      if ((admission.humanReviewQueueCount ?? 0) > 0) {
        kv("queued for human review", admission.humanReviewQueueCount!);
      }

      const bySource = admission.acceptedBySource ?? {};
      const hasBreakdown = Object.values(bySource).some((n) => (n ?? 0) > 0);
      if (hasBreakdown) {
        console.log();
        for (const [src, n] of Object.entries(bySource)) {
          if ((n ?? 0) > 0) {
            kv(`  ${CHANNEL_LABELS[src] ?? src}`, n!);
          }
        }
      }

      if (admission.savedCount === 0) {
        console.log();
        warn("No cases admitted — all candidates may be duplicates or filtered out.");
      }

      console.log();
      ok(`Harvest complete. ${c.bold(String(admission.savedCount))} case(s) added to the pool.`);
      console.log(`  ${c.dim("Next: ")} zeval package --run-id ${opts.runId}`);
      console.log();
    });
}
