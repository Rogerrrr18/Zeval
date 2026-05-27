#!/usr/bin/env node
/**
 * @fileoverview Zeval CLI shim.
 *
 * Runs src/cli/index.ts via tsx so the package works without a separate
 * compilation step — both in development (npm link / npx) and in production
 * when tsx is available as a dependency.
 */

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const entry = resolve(__dirname, "../src/cli/index.ts");

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", entry, ...process.argv.slice(2)],
  { stdio: "inherit", env: process.env },
);

process.exit(result.status ?? 0);
