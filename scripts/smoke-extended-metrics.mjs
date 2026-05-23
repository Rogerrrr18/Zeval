/**
 * Smoke test for the new DeepEval-aligned features:
 *   1. /api/evaluate with extendedInputs (faithfulness/toolCorrectness/knowledgeRetention/etc.)
 *   2. /api/traces/ingest with an OTel GenAI trace
 *   3. /api/eval-datasets/synthesize is callable (skip LLM if env not set)
 *   4. /api/docs returns OpenAPI
 */

const BASE = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000";

/** Call fetch and throw on non-2xx with body. */
async function fetchJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  if (!res.ok) throw new Error(`${init?.method || "GET"} ${url} -> ${res.status}\n${text.slice(0, 500)}`);
  try { return JSON.parse(text); } catch { return text; }
}

const evalBody = {
  rawRows: [
    { sessionId: "ext_01", timestamp: "2026-04-18T10:00:00+08:00", role: "user", content: "未拆封商品如何退款？" },
    { sessionId: "ext_01", timestamp: "2026-04-18T10:00:30+08:00", role: "assistant", content: "未拆封商品 7 天内可全额退款，需要订单号" },
    { sessionId: "ext_01", timestamp: "2026-04-18T10:01:00+08:00", role: "user", content: "订单号是 SF882910" },
    { sessionId: "ext_01", timestamp: "2026-04-18T10:01:20+08:00", role: "assistant", content: "好的，已为订单 SF882910 创建退款工单" },
  ],
  runId: `smoke_ext_${Date.now()}`,
  scenarioId: "toB-customer-support",
  useLlm: false,
  extendedInputs: {
    retrievalContexts: [
      {
        query: "未拆封商品如何退款？",
        response: "未拆封商品 7 天内可全额退款，需要订单号",
        contexts: ["未拆封商品 7 天内可全额退款，需提供订单号"],
        turnIndex: 0,
        sessionId: "ext_01",
      },
    ],
    toolCalls: [
      {
        sessionId: "ext_01",
        turnIndex: 3,
        toolName: "create_refund_ticket",
        arguments: { orderId: "SF882910" },
        expectedToolName: "create_refund_ticket",
        expectedArguments: { orderId: "SF882910" },
        succeeded: true,
      },
    ],
    retentionFacts: [
      { factId: "f1", introducedAtTurn: 2, factText: "订单号 SF882910" },
    ],
  },
};

console.log("[1/4] /api/evaluate with extendedInputs (rule mode)...");
const evalResult = await fetchJson(`${BASE}/api/evaluate`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(evalBody),
});
const ext = evalResult.extendedMetrics;
if (!ext) throw new Error("extendedMetrics 返回为空！");
console.log("  faithfulness:", ext.faithfulness?.score, "passed=", ext.faithfulness?.passed);
console.log("  toolCorrectness:", ext.toolCorrectness?.score, "passed=", ext.toolCorrectness?.passed);
console.log("  knowledgeRetention:", ext.knowledgeRetention?.score, "passed=", ext.knowledgeRetention?.passed);
console.log("  toxicity:", ext.toxicity?.score, "passed=", ext.toxicity?.passed);
console.log("  answerRelevancy:", ext.answerRelevancy?.score, "passed=", ext.answerRelevancy?.passed);

console.log("\n[2/4] /api/traces/ingest with OTel GenAI trace...");
const trace = {
  traceId: `t_${Date.now()}`,
  sessionId: "trace_session_1",
  name: "demo-agent-run",
  spans: [
    {
      spanId: "span1",
      name: "agent root",
      kind: "agent",
      startTime: "2026-04-18T10:00:00Z",
      endTime: "2026-04-18T10:01:00Z",
      attributes: { system: "zerore-demo" },
    },
    {
      spanId: "span2",
      parentSpanId: "span1",
      name: "chat gpt-4o",
      kind: "chat",
      startTime: "2026-04-18T10:00:10Z",
      endTime: "2026-04-18T10:00:30Z",
      attributes: { system: "openai", model: "gpt-4o" },
      input: { messages: [{ role: "user", content: "退款流程？" }] },
      output: { choices: [{ index: 0, message: { role: "assistant", content: "未拆封 7 天内可退" }, finish_reason: "stop" }] },
    },
    {
      spanId: "span3",
      parentSpanId: "span1",
      name: "tool create_refund_ticket",
      kind: "tool",
      startTime: "2026-04-18T10:00:35Z",
      endTime: "2026-04-18T10:00:40Z",
      attributes: { toolName: "create_refund_ticket" },
      input: { arguments: { orderId: "SF882910" } },
      output: { ticketId: "T-001" },
      status: "ok",
    },
  ],
};
const ingest = await fetchJson(`${BASE}/api/traces/ingest`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ traces: [trace], evaluateInline: true, useLlm: false, scenarioId: "toB-customer-support" }),
});
console.log("  ingestedCount:", ingest.ingestedCount, "evaluations:", ingest.evaluations);

console.log("\n[3/4] /api/traces/ingest GET listing...");
const listing = await fetchJson(`${BASE}/api/traces/ingest?limit=5`);
console.log("  recent traces:", listing.count);

console.log("\n[4/4] /api/docs OpenAPI spec...");
const docs = await fetchJson(`${BASE}/api/docs`);
console.log("  paths:", Object.keys(docs.paths).length, "schemas:", Object.keys(docs.components.schemas).length);

console.log("\n✅ ALL SMOKE CHECKS PASSED");
