/**
 * @fileoverview `zeval evaluate <file>` — run the full evaluation pipeline on a chatlog file.
 *
 * Usage:
 *   zeval evaluate ./chatlog.csv
 *   zeval evaluate ./chatlog.json --format json --no-llm
 *   zeval evaluate ./chatlog.csv --run-id my-run-001 --persist --harvest
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { Command } from "commander";
import { harvestBadCasesToDataset } from "@/eval-datasets/harvest-badcases";
import { createDatasetStore } from "@/eval-datasets/storage";
import { persistEvaluateResult } from "@/persistence/evaluateResultStore";
import { parseByFormat, inferFormatFromFileName } from "@/parsers";
import { redactRawRows } from "@/pii/redaction";
import { runEvaluatePipeline } from "@/pipeline/evaluateRun";
import type { UploadFormat } from "@/types/pipeline";
import { c, ok, warn, err, header, kv, table, createSpinner } from "@/cli/display";

interface EvaluateOptions {
  runId?: string;
  format?: string;
  llm: boolean;
  persist: boolean;
  harvest: boolean;
  baselineVersion: string;
  projectId?: string;
}

export function registerEvaluateCommand(program: Command): void {
  program
    .command("evaluate <file>")
    .alias("eval")
    .description("Run the full evaluation pipeline on a chatlog file")
    .option("--run-id <id>",              "Custom run ID (auto-generated when omitted)")
    .option("--format <fmt>",             "File format: csv | json | jsonl | txt | md")
    .option("--no-llm",                   "Skip LLM judge — fast mode, objective metrics only")
    .option("--persist",                  "Save evaluate result to eval-runs/ (default: on)", true)
    .option("--no-persist",               "Skip saving the result artifact")
    .option("--harvest",                  "Auto-harvest bad cases into the dataset pool after evaluation")
    .option("--baseline-version <ver>",   "Baseline version tag for harvested cases", "cli")
    .option("--project-id <id>",          "Project ID (overrides ZEVAL_PROJECT_ID env var)")
    .action(async (file: string, opts: EvaluateOptions) => {
      header("Zeval Evaluate");
      kv("file", file);
      kv("useLlm", String(opts.llm));
      kv("persist", String(opts.persist));
      if (opts.harvest) kv("auto-harvest", "true");

      // ── 1. Read file ─────────────────────────────────────────────────────────
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch {
        err(`Cannot read file: ${file}`);
        process.exit(1);
      }

      // ── 2. Parse ─────────────────────────────────────────────────────────────
      const fileName = basename(file);
      const format = (opts.format ?? inferFormatFromFileName(fileName)) as UploadFormat;
      const rawRows = parseByFormat(text, format, fileName);

      if (rawRows.length === 0) {
        err("No rows parsed — check the file format or column names (sessionId, role, content required).");
        process.exit(1);
      }

      const { rows, report } = redactRawRows(rawRows);
      if (report.redactedFields > 0) {
        warn(`PII redacted: ${report.redactedFields} fields (${report.categories.join(", ")})`);
      }

      const sessions = new Set(rows.map((r) => r.sessionId)).size;
      console.log();
      kv("format", format);
      kv("rows", rows.length);
      kv("sessions", sessions);
      console.log();

      // ── 3. Run pipeline ───────────────────────────────────────────────────────
      const runId = opts.runId ?? `run_${Date.now()}`;
      kv("run-id", runId);
      console.log();

      const spinner = createSpinner("Running evaluation pipeline…");
      let lastStage = "";

      const result = await runEvaluatePipeline(rows, {
        runId,
        useLlm: opts.llm,
        persistArtifact: false,
        onProgress: (event) => {
          if (event.stage !== lastStage) {
            lastStage = event.stage;
            spinner.update(`${event.message ?? event.stage}…`);
          }
        },
      }).catch((e: unknown) => {
        spinner.fail(`Pipeline error: ${(e as Error).message}`);
        process.exit(1);
      });

      spinner.succeed(`Evaluation complete`);

      // ── 4. Print results ──────────────────────────────────────────────────────
      header("Results");
      const obj  = result.objectiveMetrics;
      const subj = result.subjectiveMetrics;

      table([
        ["sessions",            result.meta.sessions],
        ["messages",            result.meta.messages],
        ["bad cases detected",  result.badCaseAssets?.length ?? 0],
        [""],
        ["─── Objective ─────────────────────────────────", ""],
        ["avg response gap (s)",  obj.avgResponseGapSec?.toFixed(2) ?? "—"],
        ["user repeat rate",      `${((obj.userQuestionRepeatRate ?? 0) * 100).toFixed(1)}%`],
        ["agent resolution rate", `${((obj.agentResolutionSignalRate ?? 0) * 100).toFixed(1)}%`],
        ["escalation hit rate",   `${((obj.escalationKeywordHitRate ?? 0) * 100).toFixed(1)}%`],
        [""],
        ["─── Subjective ────────────────────────────────", ""],
        ["dimensions evaluated",  subj?.dimensions?.length ?? 0],
        ["implicit signals",      subj?.signals?.length ?? 0],
        ["goal completions",      subj?.goalCompletions?.length ?? 0],
        [""],
        ["warnings",              result.meta.warnings.length],
      ]);

      for (const w of result.meta.warnings) warn(w);

      // ── 5. Persist artifact ───────────────────────────────────────────────────
      if (opts.persist) {
        console.log();
        const s2 = createSpinner("Saving result artifact…");
        const savedPath = await persistEvaluateResult(result).catch(() => null);
        if (savedPath) {
          s2.succeed(`Saved → ${savedPath}`);
        } else {
          s2.fail("Failed to persist result");
        }
      }

      // ── 6. Auto-harvest ───────────────────────────────────────────────────────
      if (opts.harvest) {
        console.log();
        header("Auto-Harvest");
        const s3 = createSpinner("Running five-channel admission pipeline…");
        const store = createDatasetStore();
        const admission = await harvestBadCasesToDataset({
          store,
          evaluate: result,
          baselineVersion: opts.baselineVersion,
          allowNearDuplicate: false,
          tnSampleRate: 0.05,
          humanSamplingRate: 1.0,
        }).catch((e: unknown) => {
          s3.fail(`Harvest error: ${(e as Error).message}`);
          process.exit(1);
        });

        s3.succeed("Harvest complete");

        const LABELS: Record<string, string> = {
          auto_tp:          "TP (true positive)",
          auto_fn:          "FN (missed bad case)",
          auto_tn:          "TN (gold positive)",
          auto_uncertainty: "Uncertainty",
          auto_disagreement:"Disagreement",
        };

        kv("total accepted",       admission.savedCaseIds.length);
        kv("skipped (duplicates)", admission.skippedDuplicates);
        for (const [src, n] of Object.entries(admission.acceptedBySource ?? {})) {
          if ((n ?? 0) > 0) kv(`  ${LABELS[src] ?? src}`, n!);
        }
      }

      console.log();
      ok(`Done. Run ID: ${c.bold(runId)}`);
      console.log(`  ${c.dim("Next: ")} zeval runs show ${runId}`);
      if (opts.persist && !opts.harvest) {
        console.log(`  ${c.dim("Or:  ")} zeval harvest --run-id ${runId}`);
      }
      console.log();
    });
}
