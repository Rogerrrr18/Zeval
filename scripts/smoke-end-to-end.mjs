/**
 * End-to-end smoke: raw CSV -> evaluate -> save baseline -> remediation package -> replay + offline validation -> agent run.
 * Requires: next dev on 127.0.0.1:3010, mock customer api on 127.0.0.1:4200.
 */
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const BASE = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3010";
const RAW_CSV = process.env.SMOKE_RAW_CSV || "mock-chatlog/raw-data/support-refund-short.csv";
const SCENARIO_ID = process.env.SMOKE_SCENARIO_ID || "toB-customer-support";
const CUSTOMER_ID = process.env.SMOKE_CUSTOMER_ID || "smoke_e2e";
const REPLY_API = process.env.SMOKE_REPLY_API || "http://127.0.0.1:4100";
const DEFAULT_ONBOARDING_ANSWERS = {
  primary_channel: "Web chat",
  has_human_handoff: "yes, escalation_keyword indicates handoff risk",
  resolution_field: "not present in raw CSV",
};

/** Call fetch and throw on non-2xx with body text. */
async function fetchJson(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init?.method || "GET"} ${url} -> ${response.status}\n${text}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Parse 4-column CSV (sessionId, timestamp, role, content). */
function parseCsv(csv) {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const cols = header.split(",").map((s) => s.trim());
  return lines.map((line) => {
    // simple parser: 4 columns, content may contain no commas in our fixtures
    const parts = line.split(",");
    const [sessionId, timestamp, role] = parts.slice(0, 3).map((s) => s.trim());
    const content = parts.slice(3).join(",");
    const row = { sessionId, timestamp, role, content };
    if (cols.length !== 4) throw new Error(`unexpected header: ${header}`);
    return row;
  });
}

async function main() {
  const csvPath = path.resolve(process.cwd(), RAW_CSV);
  const csv = await readFile(csvPath, "utf8");
  const rawRows = parseCsv(csv);
  console.log(`[smoke] rawRows=${rawRows.length} scenario=${SCENARIO_ID}`);

  // 1. evaluate
  const runSlug = path.basename(RAW_CSV, path.extname(RAW_CSV)).replace(/[^a-z0-9_-]+/gi, "-");
  const runId = `smoke_e2e_${runSlug}_${Date.now()}_${randomBytes(2).toString("hex")}`;
  const evaluate = await fetchJson(`${BASE}/api/evaluate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      rawRows,
      runId,
      scenarioId: SCENARIO_ID,
      scenarioContext: {
        onboardingAnswers: DEFAULT_ONBOARDING_ANSWERS,
      },
      useLlm: false,
    }),
  });
  console.log(`[smoke] evaluate runId=${evaluate.runId} warnings=${evaluate.meta.warnings.length} badCases=${evaluate.badCaseAssets?.length ?? 0} scenarioScore=${evaluate.scenarioEvaluation?.averageScore?.toFixed(4)}`);

  // 2. save baseline
  const baselineResp = await fetchJson(`${BASE}/api/workbench-baselines`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      customerId: CUSTOMER_ID,
      sourceFileName: path.basename(RAW_CSV),
      label: "smoke e2e baseline",
      evaluate,
      rawRows,
    }),
  });
  console.log(`[smoke] baseline saved customerId=${baselineResp.customerId} runId=${baselineResp.runId}`);

  // 3. remediation package
  const selectedCaseKeys = (evaluate.badCaseAssets || []).map((c) => c.caseKey).slice(0, 3);
  const pkgResp = await fetchJson(`${BASE}/api/remediation-packages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceFileName: path.basename(RAW_CSV),
      baselineCustomerId: CUSTOMER_ID,
      selectedCaseKeys,
      evaluate: {
        runId: evaluate.runId,
        objectiveMetrics: evaluate.objectiveMetrics,
        subjectiveMetrics: evaluate.subjectiveMetrics,
        scenarioEvaluation: evaluate.scenarioEvaluation,
        badCaseAssets: evaluate.badCaseAssets,
        suggestions: evaluate.suggestions,
      },
    }),
  });
  if (pkgResp.skipped) {
    console.log(`[smoke] package skipped reason=${pkgResp.reason} message=${pkgResp.message}`);
    console.log("[smoke] SUMMARY");
    console.log(JSON.stringify({
      evaluate: { runId: evaluate.runId, scenarioScore: evaluate.scenarioEvaluation?.averageScore, badCases: 0 },
      package: { skipped: true, reason: pkgResp.reason },
    }, null, 2));
    return;
  }
  const pkg = pkgResp.package;
  console.log(`[smoke] package=${pkg.packageId} priority=${pkg.priority} selectedCases=${pkg.selectedCaseCount} files=${pkg.files.length}`);

  // 4. replay validation
  const replayResp = await fetchJson(`${BASE}/api/validation-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      packageId: pkg.packageId,
      mode: "replay",
      baselineCustomerId: CUSTOMER_ID,
      replyApiBaseUrl: REPLY_API,
      useLlm: false,
      replyTimeoutMs: 20000,
    }),
  });
  const replay = replayResp.validationRun;
  console.log(`[smoke] replay validationRun=${replay.validationRunId} status=${replay.status} winRate=${replay.summary.winRate} replayedRows=${replay.summary.replayedRowCount}`);

  // 5. offline eval
  const offlineResp = await fetchJson(`${BASE}/api/validation-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      packageId: pkg.packageId,
      mode: "offline_eval",
      replyApiBaseUrl: REPLY_API,
      useLlm: false,
      replyTimeoutMs: 20000,
    }),
  });
  const offline = offlineResp.validationRun;
  console.log(`[smoke] offline validationRun=${offline.validationRunId} status=${offline.status} executed=${offline.summary.executedCases}/${offline.summary.totalCases} improved=${offline.summary.improvedCases} regressed=${offline.summary.regressedCases}`);

  // 6. agent run
  const agentResp = await fetchJson(`${BASE}/api/agent-runs`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      packageId: pkg.packageId,
      channel: "prompt",
      status: "draft",
      title: "Smoke E2E Agent Run",
      summary: "agent run created from smoke-end-to-end script",
      content: "Verify full loop execution from raw CSV.",
      notes: "",
      replayValidationRunId: replay.validationRunId,
      offlineValidationRunId: offline.validationRunId,
    }),
  });
  const agentRun = agentResp.agentRun;
  console.log(`[smoke] agentRun=${agentRun.agentRunId} channel=${agentRun.channel} status=${agentRun.status}`);

  console.log("\n[smoke] SUMMARY");
  console.log(JSON.stringify({
    evaluate: { runId: evaluate.runId, scenarioScore: evaluate.scenarioEvaluation?.averageScore, badCases: evaluate.badCaseAssets?.length ?? 0 },
    package: { packageId: pkg.packageId, priority: pkg.priority, artifactDir: pkg.artifactDir },
    replay: { id: replay.validationRunId, status: replay.status, winRate: replay.summary.winRate },
    offline: { id: offline.validationRunId, status: offline.status, regressed: offline.summary.regressedCases },
    agentRun: { id: agentRun.agentRunId, status: agentRun.status },
  }, null, 2));
}

main().catch((err) => {
  console.error("[smoke] FAILED", err);
  process.exit(1);
});
