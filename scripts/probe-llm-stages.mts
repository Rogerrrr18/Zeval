import http from "node:http";
import type { AddressInfo } from "node:net";
import { readFile } from "node:fs/promises";
import type { RawChatlogRow } from "@/types/pipeline";

type ProbeResult = {
  name: string;
  ok: boolean;
  detail?: unknown;
  error?: string;
};

/**
 * Run one named probe and collect a compact result.
 * @param name Probe name.
 * @param fn Probe callback.
 * @returns Probe result.
 */
async function runProbe(name: string, fn: () => Promise<unknown>): Promise<ProbeResult> {
  try {
    const detail = await fn();
    return { name, ok: true, detail };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Parse the small repo fixture CSV format.
 * @param text CSV text with sessionId,timestamp,role,content columns.
 * @returns Raw rows.
 */
function parseFixtureCsv(text: string): RawChatlogRow[] {
  const [, ...lines] = text.trim().split(/\r?\n/);
  return lines.map((line) => {
    const parts = line.split(",");
    return {
      sessionId: parts[0]?.trim() ?? "probe",
      timestamp: parts[1]?.trim() ?? new Date().toISOString(),
      role: normalizeRole(parts[2]?.trim()),
      content: parts.slice(3).join(",").trim(),
    };
  });
}

/**
 * Normalize a raw role from fixture text.
 * @param role Raw role.
 * @returns Chat role.
 */
function normalizeRole(role: string | undefined): RawChatlogRow["role"] {
  return role === "assistant" || role === "system" ? role : "user";
}

/**
 * Build rows that force goal-completion LLM fallback.
 * @returns Raw rows.
 */
function buildGoalLlmRows(): RawChatlogRow[] {
  return [
    row("goal_probe", 0, "user", "我想申请退款，但不知道流程。"),
    row("goal_probe", 1, "assistant", "你可以在订单页面看一下相关入口。"),
    row("goal_probe", 2, "user", "入口在哪里？我没有找到。"),
    row("goal_probe", 3, "assistant", "一般在订单详情页会有售后按钮。"),
  ];
}

/**
 * Build rows that force recovery-trace LLM strategy summarization.
 * @returns Raw rows.
 */
function buildRecoveryRows(): RawChatlogRow[] {
  return [
    row("recovery_probe", 0, "user", "我想退货退款。"),
    row("recovery_probe", 1, "assistant", "你可以看看订单。"),
    row("recovery_probe", 2, "user", "没明白，你是说我该点哪里？"),
    row("recovery_probe", 3, "assistant", "抱歉我刚刚没有说明清楚。我先确认一下：你是想退货并申请退款，对吗？可以进入订单详情，点击售后，再选择退货退款。"),
    row("recovery_probe", 4, "user", "明白了，谢谢。"),
  ];
}

/**
 * Build one raw row with stable timestamp.
 * @param sessionId Session id.
 * @param turnIndex Turn index.
 * @param role Chat role.
 * @param content Message content.
 * @returns Raw chat row.
 */
function row(sessionId: string, turnIndex: number, role: RawChatlogRow["role"], content: string): RawChatlogRow {
  return {
    sessionId,
    timestamp: new Date(Date.UTC(2026, 3, 18, 2, turnIndex, 0)).toISOString(),
    role,
    content,
  };
}

/**
 * Start a tiny local agent endpoint for SimUser replay.
 * @returns Endpoint URL and close callback.
 */
async function startAgentEndpoint(): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((request, response) => {
    if (request.method !== "POST") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "not found" }));
      return;
    }
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ content: "可以。退款流程是进入订单详情，点击售后，选择退货退款；提交后通常 3-5 个工作日到账。" }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))),
  };
}

/**
 * Load a repo module through tsx, handling its CommonJS-shaped default wrapper.
 * @param specifier Module specifier.
 * @returns Module exports.
 */
async function loadModule<TModule>(specifier: string): Promise<TModule> {
  const mod = await import(specifier);
  return (mod.default ?? mod) as TModule;
}

const results: ProbeResult[] = [];
const { runCopilotTurn } = await loadModule<typeof import("@/copilot/orchestrator")>("@/copilot/orchestrator");
const { buildDataMappingPlan } = await loadModule<typeof import("@/data-onboarding/detector")>(
  "@/data-onboarding/detector",
);
const { reviewDataMappingPlanWithLlm } = await loadModule<typeof import("@/data-onboarding/llm")>(
  "@/data-onboarding/llm",
);
const { buildExtendedMetrics } = await loadModule<typeof import("@/pipeline/extendedMetrics")>(
  "@/pipeline/extendedMetrics",
);
const { enrichRows } = await loadModule<typeof import("@/pipeline/enrich")>("@/pipeline/enrich");
const { extractIntentSequences } = await loadModule<typeof import("@/pipeline/intentExtract")>(
  "@/pipeline/intentExtract",
);
const { runSimUserReplay } = await loadModule<typeof import("@/pipeline/simUser")>("@/pipeline/simUser");
const { buildSubjectiveMetrics } = await loadModule<typeof import("@/pipeline/subjectiveMetrics")>(
  "@/pipeline/subjectiveMetrics",
);
const { synthesizeConversations } = await loadModule<typeof import("@/synthesis/synthesizer")>(
  "@/synthesis/synthesizer",
);
const fixtureCsv = await readFile("mock-chatlog/raw-data/support-refund-short.csv", "utf8");
const fixtureRows = parseFixtureCsv(fixtureCsv);
const fixtureEnriched = enrichRows(fixtureRows).enrichedRows;

results.push(await runProbe("data_onboarding_mapping_review", async () => {
  const plan = buildDataMappingPlan({ text: fixtureCsv, fileName: "support-refund-short.csv", format: "csv" });
  const review = await reviewDataMappingPlanWithLlm(plan, fixtureCsv);
  return { confidence: review.confidence, warnings: review.warnings?.length ?? 0 };
}));

results.push(await runProbe("goal_completion_judge", async () => {
  const rows = enrichRows(buildGoalLlmRows()).enrichedRows;
  const subjective = await buildSubjectiveMetrics(rows, true, "probe_goal", { judgeRequired: true });
  return subjective.goalCompletions.map((item) => ({ sessionId: item.sessionId, status: item.status, source: item.source }));
}));

results.push(await runProbe("subjective_dimension_judge", async () => {
  const subjective = await buildSubjectiveMetrics(fixtureEnriched, true, "probe_subjective", { judgeRequired: true });
  return { status: subjective.status, dimensions: subjective.dimensions.map((item) => item.dimension) };
}));

results.push(await runProbe("recovery_trace_strategy", async () => {
  const rows = enrichRows(buildRecoveryRows()).enrichedRows;
  const subjective = await buildSubjectiveMetrics(rows, true, "probe_recovery", { judgeRequired: true });
  return subjective.recoveryTraces.map((item) => ({
    sessionId: item.sessionId,
    status: item.status,
    source: item.repairStrategySource,
  }));
}));

results.push(await runProbe("intent_sequence_extract_and_simuser", async () => {
  const intents = await extractIntentSequences(fixtureEnriched, true, "probe_intent");
  const first = intents[0];
  if (!first || first.intentSequence.length === 0) {
    throw new Error("intent extraction returned empty result");
  }
  const agent = await startAgentEndpoint();
  try {
    const replay = await runSimUserReplay(
      [{ ...first, intentSequence: first.intentSequence.slice(0, 1) }],
      fixtureEnriched,
      true,
      { agentApiEndpoint: agent.url, runId: "probe_simuser" },
    );
    return replay.flat().map((item) => ({ intentIndex: item.intentIndex, label: item.judgeLabel, events: item.events }));
  } finally {
    await agent.close();
  }
}));

results.push(await runProbe("extended_metric_judge", async () => {
  const bundle = await buildExtendedMetrics({
    useLlm: true,
    runId: "probe_extended",
    retrievalContexts: [
      {
        sessionId: "extended_probe",
        query: "退款多久到账？",
        contexts: ["未发货订单取消后，退款通常在 3-5 个工作日内原路返回。"],
        response: "退款通常会在 3-5 个工作日内原路返回。",
      },
    ],
    retentionFacts: [{ factId: "f1", introducedAtTurn: 0, factText: "用户希望退款原路返回" }],
    roleProfile: {
      roleName: "客服助手",
      characterDescription: "清晰、共情、直接给出可执行步骤",
      prohibitedBehaviors: ["推诿", "说教"],
    },
    toolCalls: [
      {
        sessionId: "extended_probe",
        turnIndex: 1,
        toolName: "refund_lookup",
        expectedToolName: "refund_lookup",
        arguments: { orderId: "o1" },
        expectedArguments: { orderId: "o1" },
        succeeded: true,
      },
    ],
  });
  return Object.fromEntries(
    Object.entries(bundle)
      .filter(([, value]) => Boolean(value))
      .map(([key, value]) => [key, { source: value?.source, score: value?.score }]),
  );
}));

results.push(await runProbe("synthesize", async () => {
  const result = await synthesizeConversations({
    scenarioDescription: "ToB 客服 Agent，处理退款咨询",
    targetFailureModes: ["目标未达成"],
    count: 1,
    strategy: "balanced",
    turnRange: { min: 2, max: 3 },
    qualityGate: false,
    runId: "probe_synthesize",
  });
  return { conversations: result.conversations.length, warnings: result.warnings.length };
}));

results.push(await runProbe("copilot_plan", async () => {
  const events: unknown[] = [];
  const result = await runCopilotTurn(
    { messages: [{ role: "user", content: "请简单介绍一下你能做什么。" }] },
    (event) => events.push(event),
  );
  return { eventTypes: result.events.map((event) => event.type), emitted: events.length };
}));

console.log(JSON.stringify({ ok: results.every((item) => item.ok), results }, null, 2));

if (results.some((item) => !item.ok)) {
  process.exitCode = 1;
}
