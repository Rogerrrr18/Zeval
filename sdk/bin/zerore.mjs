#!/usr/bin/env node
/**
 * @fileoverview ZERORE CLI — minimal command surface for evaluate / synthesize / ingest.
 *
 * Examples:
 *   zerore evaluate --file conversation.csv --scenario toB-customer-support
 *   zerore synthesize --scenario "ToB 客服" --count 10
 *   zerore ingest --file trace.json
 */

import { readFile } from "node:fs/promises";
import process from "node:process";

const BASE_URL = process.env.ZERORE_BASE_URL || "http://127.0.0.1:3010";
const API_KEY = process.env.ZERORE_API_KEY || "";

const args = process.argv.slice(2);
const command = args[0];
const flags = parseFlags(args.slice(1));

/**
 * Parse simple --flag value pairs.
 *
 * @param {string[]} input Raw argv slice.
 * @returns {Record<string, string|boolean>}
 */
function parseFlags(input) {
  const out = {};
  for (let i = 0; i < input.length; i += 1) {
    const token = input[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = input[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

/**
 * POST a JSON body to the ZERORE backend.
 *
 * @param {string} path API path.
 * @param {unknown} body JSON body.
 * @returns {Promise<unknown>}
 */
async function postJson(path, body) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(API_KEY ? { authorization: `Bearer ${API_KEY}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${path} -> ${response.status}\n${text.slice(0, 400)}`);
  }
  return JSON.parse(text);
}

/**
 * Naive 4-column CSV parser (sessionId, timestamp, role, content).
 *
 * @param {string} csv CSV text.
 * @returns {Array<{sessionId:string,timestamp:string,role:string,content:string}>}
 */
function parseCsv(csv) {
  const [, ...lines] = csv.trim().split(/\r?\n/);
  return lines.map((line) => {
    const parts = line.split(",");
    const [sessionId, timestamp, role] = parts.slice(0, 3).map((s) => s.trim());
    const content = parts.slice(3).join(",");
    return { sessionId, timestamp, role, content };
  });
}

if (command === "evaluate") {
  const file = flags.file;
  if (!file) {
    console.error("usage: zerore evaluate --file <csv>");
    process.exit(1);
  }
  const csv = await readFile(String(file), "utf8");
  const rawRows = parseCsv(csv);
  const result = await postJson("/api/evaluate", {
    rawRows,
    runId: flags.runId || `cli_${Date.now()}`,
    scenarioId: flags.scenario,
    useLlm: Boolean(flags.useLlm),
  });
  console.log(JSON.stringify({
    runId: result.runId,
    badCases: result.badCaseAssets?.length ?? 0,
    scenarioScore: result.scenarioEvaluation?.averageScore,
    extendedMetrics: result.extendedMetrics,
    warnings: result.meta?.warnings ?? [],
  }, null, 2));
} else if (command === "synthesize") {
  const result = await postJson("/api/eval-datasets/synthesize", {
    scenarioDescription: String(flags.scenario || "通用客服 Agent"),
    count: Number(flags.count || 5),
    targetFailureModes: typeof flags.failureModes === "string" ? String(flags.failureModes).split(",") : undefined,
  });
  console.log(JSON.stringify(result, null, 2));
} else if (command === "ingest") {
  const file = flags.file;
  if (!file) {
    console.error("usage: zerore ingest --file <trace.json>");
    process.exit(1);
  }
  const text = await readFile(String(file), "utf8");
  const trace = JSON.parse(text);
  const traces = Array.isArray(trace) ? trace : [trace];
  const result = await postJson("/api/traces/ingest", {
    traces,
    evaluateInline: Boolean(flags.evaluate),
    useLlm: Boolean(flags.useLlm),
  });
  console.log(JSON.stringify(result, null, 2));
} else {
  console.error(`Usage:
  zerore evaluate --file <csv> [--scenario <id>] [--useLlm]
  zerore synthesize --scenario "<desc>" --count <n> [--failureModes a,b,c]
  zerore ingest --file <trace.json> [--evaluate] [--useLlm]

Env:
  ZERORE_BASE_URL  default http://127.0.0.1:3010
  ZERORE_API_KEY   optional`);
  process.exit(1);
}
