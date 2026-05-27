/**
 * @fileoverview Zeval CLI — headless AI conversation quality evaluation.
 *
 * Commands:
 *   zeval evaluate <file>            Run evaluation pipeline on a chatlog file
 *   zeval harvest --run-id <id>      Harvest bad cases into the dataset pool
 *   zeval package --run-id <id>      Build a remediation package
 *   zeval runs list                  List saved evaluate runs
 *   zeval runs show <run-id>         Inspect a saved evaluate run
 *
 * Quick start:
 *   npm run zeval -- evaluate ./chatlog.csv
 *   npm run zeval -- runs list
 */

import { Command } from "commander";
import { c } from "@/cli/display";
import { registerEvaluateCommand } from "@/cli/commands/evaluate";
import { registerHarvestCommand } from "@/cli/commands/harvest";
import { registerPackageCommand } from "@/cli/commands/package";
import { registerRunsCommand } from "@/cli/commands/runs";

const program = new Command();

program
  .name("zeval")
  .description(
    `${c.bold(c.cyan("Zeval"))} — AI conversation quality evaluation CLI\n` +
    `  ${c.dim("Evaluate chatlogs, harvest bad cases, build remediation packages.")}`,
  )
  .version("2.1.0", "-v, --version", "Print version and exit");

registerEvaluateCommand(program);
registerHarvestCommand(program);
registerPackageCommand(program);
registerRunsCommand(program);

program.parse(process.argv);
