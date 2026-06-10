/**
 * @fileoverview `zeval runs` subcommands — list and inspect saved evaluate runs.
 *
 * Usage:
 *   zeval runs list
 *   zeval runs list --limit 10 --project-id my-project
 *   zeval runs show run_1748965432
 */

import type { Command } from "commander";
import {
  listPersistedEvaluateRuns,
  readPersistedEvaluateResult,
} from "@/persistence/evaluateResultStore";
import { c, err, header, table, warn, ok } from "@/cli/display";

export function registerRunsCommand(program: Command): void {
  const runs = program
    .command("runs")
    .description("List and inspect saved evaluate runs");

  // ── zeval runs list ─────────────────────────────────────────────────────────
  runs
    .command("list")
    .alias("ls")
    .description("List saved evaluate runs, newest first")
    .option("--limit <n>",       "Maximum number of runs to display", "20")
    .option("--project-id <id>", "Filter by project ID")
    .action(async (opts: { limit: string; projectId?: string }) => {
      const rows = await listPersistedEvaluateRuns(
        Math.max(1, parseInt(opts.limit, 10)),
        opts.projectId,
      );

      if (rows.length === 0) {
        warn("No saved runs found. Start with:");
        console.log(`  ${c.bold("zeval evaluate ./chatlog.csv")}`);
        return;
      }

      header(`Evaluate Runs (${rows.length})`);
      console.log();

      // Column widths
      const W_ID  = 32;
      const W_TS  = 20;
      const W_SES =  9;
      const W_MSG = 10;
      const W_WARN= 8;

      const hdr = [
        "Run ID".padEnd(W_ID),
        "Generated At".padEnd(W_TS),
        "Sessions".padEnd(W_SES),
        "Messages".padEnd(W_MSG),
        "Warnings",
      ].join("  ");

      console.log(`  ${c.dim(hdr)}`);
      console.log(`  ${c.dim("─".repeat(hdr.length))}`);

      for (const row of rows) {
        const warnStr = row.warningCount > 0
          ? c.yellow(String(row.warningCount).padEnd(W_WARN))
          : c.dim("0".padEnd(W_WARN));

        const line = [
          c.cyan(row.runId.padEnd(W_ID)),
          row.generatedAt.slice(0, 19).replace("T", " ").padEnd(W_TS),
          String(row.sessions).padEnd(W_SES),
          String(row.messages).padEnd(W_MSG),
          warnStr,
        ].join("  ");

        console.log("  " + line);
      }

      console.log();
      console.log(`  ${c.dim("Tip:")} zeval runs show <run-id>  to inspect a run`);
      console.log();
    });

  // ── zeval runs show <run-id> ────────────────────────────────────────────────
  runs
    .command("show <run-id>")
    .description("Print full details of a saved evaluate run")
    .action(async (runId: string) => {
      const result = await readPersistedEvaluateResult(runId);

      if (!result) {
        err(`Run not found: ${runId}`);
        process.exit(1);
      }

      const obj  = result.objectiveMetrics;
      const subj = result.subjectiveMetrics;

      header(`Run: ${runId}`);
      table([
        ["run ID",    result.runId],
        ["generated", result.meta.generatedAt.slice(0, 19).replace("T", " ")],
        ["sessions",  result.meta.sessions],
        ["messages",  result.meta.messages],
        ["warnings",  result.meta.warnings.length],
        [""],
        ["─── Objective Metrics ─────────────────────", ""],
        ["avg response gap (s)",  obj.avgResponseGapSec?.toFixed(2) ?? "—"],
        ["user repeat rate",      `${((obj.userQuestionRepeatRate ?? 0) * 100).toFixed(1)}%`],
        ["agent resolution rate", `${((obj.agentResolutionSignalRate ?? 0) * 100).toFixed(1)}%`],
        ["escalation hit rate",   `${((obj.escalationKeywordHitRate ?? 0) * 100).toFixed(1)}%`],
        [""],
        ["─── Subjective Metrics ────────────────────", ""],
        ["dimensions",       subj?.dimensions?.length ?? 0],
        ["implicit signals", subj?.signals?.length ?? 0],
        ["goal completions", subj?.goalCompletions?.length ?? 0],
        ["recovery traces",  subj?.recoveryTraces?.length ?? 0],
        [""],
        ["─── Bad Cases ─────────────────────────────", ""],
        ["detected", result.badCaseAssets?.length ?? 0],
      ]);

      if (result.meta.warnings.length > 0) {
        header("Warnings");
        for (const w of result.meta.warnings) {
          console.log(`  ${c.yellow("⚠")} ${w}`);
        }
      }

      const badCases = result.badCaseAssets ?? [];
      if (badCases.length > 0) {
        header(`Bad Cases${badCases.length > 5 ? ` (showing 5 of ${badCases.length})` : ""}`);
        for (const bc of badCases.slice(0, 5)) {
          console.log(`  ${c.cyan(bc.caseKey)} — ${bc.title}`);
          console.log(`    ${c.dim("severity:")} ${bc.severityScore?.toFixed(2) ?? "—"}  ${c.dim("session:")} ${bc.sessionId}`);
        }
      }

      if ((subj?.dimensions?.length ?? 0) > 0) {
        header("Subjective Dimensions");
        const dims = (subj?.dimensions ?? []).slice(0, 6);
        // Scores may be on any scale (0-1, 0-5, etc.) — normalise against max.
        const maxScore = Math.max(...dims.map((d) => d.score), 1);
        for (const d of dims) {
          const filled = Math.round((d.score / maxScore) * 12);
          const bar = "█".repeat(filled).padEnd(12, "░");
          console.log(`  ${c.dim(d.dimension.padEnd(24))} ${c.cyan(bar)} ${d.score.toFixed(2)}`);
        }
      }

      console.log();
      ok(`Run summary complete: ${c.bold(runId)}`);
      console.log(`  ${c.dim("Next:")} zeval harvest --run-id ${runId}`);
      console.log(`  ${c.dim("Or:  ")} zeval package --run-id ${runId}`);
      console.log();
    });
}
