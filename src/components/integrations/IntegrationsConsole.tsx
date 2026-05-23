/**
 * @fileoverview Integrations console — surfaces SDK, CLI, framework adapter snippets,
 * REST API basics, and a link to the OpenAPI spec.
 */

"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell";
import styles from "./integrationsConsole.module.css";

type Snippet = {
  id: string;
  label: string;
  language: string;
  description: string;
  code: string;
};

const SNIPPETS: Snippet[] = [
  {
    id: "sdk-evaluate",
    label: "Node SDK · evaluate",
    language: "ts",
    description: "把会话日志直接交给 Zeval 评估，返回 baseline + extendedMetrics。",
    code: `import { ZevalClient } from "@zeval/sdk";

const zeval = new ZevalClient({
  baseUrl: "http://localhost:3010",
  apiKey: process.env.ZEVAL_API_KEY,
});

const result = await zeval.evaluate({
  rawRows: [
    { sessionId: "s1", role: "user", content: "退款怎么操作？", timestamp: "..." },
    { sessionId: "s1", role: "assistant", content: "我先帮你登记...", timestamp: "..." },
  ],
  scenarioId: "toB-customer-support",
  useLlm: true,
  extendedInputs: {
    retrievalContexts: [{ query: "退款", response: "...", contexts: ["..."] }],
  },
});
console.log(result.extendedMetrics?.faithfulness);`,
  },
  {
    id: "langchain",
    label: "LangChain · Callback",
    language: "ts",
    description: "把任意 LangChain 链路接入 Zeval，自动转 OTel trace 实时上报。",
    code: `import { ChatOpenAI } from "@langchain/openai";
import { langchainCallbackToOtel } from "@zeval/sdk/adapters/langchain";

const callback = langchainCallbackToOtel({
  ingestUrl: "http://localhost:3010/api/traces/ingest",
  apiKey: process.env.ZEVAL_API_KEY,
  sessionId: "user_42_session_8",
  evaluateInline: true,
});

const model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  callbacks: [callback],
});

await model.invoke([{ role: "user", content: "退款流程？" }]);`,
  },
  {
    id: "openai-agents",
    label: "OpenAI Agents SDK",
    language: "ts",
    description: "在 OpenAI Agents 的 run hook 里把 Run 转成 trace 上报。",
    code: `import { ZevalClient, convertOpenAIAgentRunToTrace } from "@zeval/sdk";

const zeval = new ZevalClient({ baseUrl: "http://localhost:3010" });

const run = await client.runs.retrieve(threadId, runId);
const trace = convertOpenAIAgentRunToTrace(run, { sessionId: threadId });

await zeval.ingestTrace([trace], {
  evaluateInline: true,
  scenarioId: "toB-customer-support",
});`,
  },
  {
    id: "cli",
    label: "CLI · npx zeval",
    language: "bash",
    description: "命令行直接评估 / 合成 / 接入 trace，适合 CI 与离线流水线。",
    code: `# evaluate a CSV
ZEVAL_BASE_URL=http://localhost:3010 \\
  npx zeval evaluate --file conversation.csv --scenario toB-customer-support

# synthesize 10 cases
ZEVAL_BASE_URL=http://localhost:3010 \\
  npx zeval synthesize --scenario "ToB 客服" --count 10

# ingest a trace
ZEVAL_BASE_URL=http://localhost:3010 \\
  npx zeval ingest --file trace.json --evaluate`,
  },
  {
    id: "rest-evaluate",
    label: "REST · /api/evaluate",
    language: "bash",
    description: "无 SDK 也能用，直接 curl POST。所有 endpoint 见 /api/docs。",
    code: `curl -X POST http://localhost:3010/api/evaluate \\
  -H "content-type: application/json" \\
  -H "x-zeval-api-key: $ZEVAL_API_KEY" \\
  -d '{
    "rawRows": [...],
    "scenarioId": "toB-customer-support",
    "useLlm": true,
    "extendedInputs": {
      "retrievalContexts": [...],
      "toolCalls": [...]
    }
  }'`,
  },
  {
    id: "rest-trace",
    label: "REST · /api/traces/ingest",
    language: "bash",
    description: "上报 OTel GenAI trace（任意 agent 框架适配）。",
    code: `curl -X POST http://localhost:3010/api/traces/ingest \\
  -H "content-type: application/json" \\
  -d '{
    "traces": [{
      "traceId": "t_001",
      "sessionId": "s_001",
      "spans": [
        {
          "spanId": "sp1",
          "kind": "chat",
          "name": "chat gpt-4o",
          "startTime": "...",
          "endTime": "...",
          "input": { "messages": [...] },
          "output": { "choices": [...] }
        }
      ]
    }],
    "evaluateInline": true,
    "scenarioId": "toB-customer-support"
  }'`,
  },
];

const FEATURES = [
  { icon: "📊", title: "10 项 DeepEval 指标", desc: "faithfulness / hallucination / answerRelevancy / contextualRelevancy / toolCorrectness / knowledgeRetention / toxicity / bias / roleAdherence / taskCompletion" },
  { icon: "📈", title: "历史 baseline 趋势叠加", desc: "同一客户多次评估自动形成情绪、目标达成、bad case 与业务 KPI 趋势" },
  { icon: "🤖", title: "LLM 合成", desc: "DeepEval Synthesizer 等价物，自动批量生成评测样本" },
  { icon: "🛠️", title: "调优包", desc: "命中 bad case 自动产出 Claude Code / Codex 可读的 Skill 文件夹" },
  { icon: "🔁", title: "基线回放", desc: "validation-runs 对照实验，确保改进不回退" },
  { icon: "📦", title: "OpenAPI 自描述", desc: "GET /api/docs 拿到完整 OpenAPI 3.0 spec" },
];

/**
 * Render the integrations page with copyable snippets.
 *
 * @returns The console element.
 */
export function IntegrationsConsole() {
  const [activeId, setActiveId] = useState(SNIPPETS[0].id);
  const [copied, setCopied] = useState<string | null>(null);

  const active = SNIPPETS.find((s) => s.id === activeId) || SNIPPETS[0];

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(active.id);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      /* noop */
    }
  };

  return (
    <AppShell>
      <div className={styles.layout}>
        <header className={styles.header}>
          <h1 className={styles.title}>集成与 SDK</h1>
          <p className={styles.sub}>
            一行代码把任意 AI 应用接入 Zeval。SDK / CLI / LangChain / OpenAI Agents / REST 全支持。
          </p>
        </header>

        <section className={styles.features}>
          {FEATURES.map((f) => (
            <article key={f.title} className={styles.feature}>
              <div className={styles.featureIcon}>{f.icon}</div>
              <div>
                <strong>{f.title}</strong>
                <p>{f.desc}</p>
              </div>
            </article>
          ))}
        </section>

        <section className={styles.installCard}>
          <strong>安装</strong>
          <code className={styles.installCmd}>npm install @zeval/sdk</code>
          <a href="/api/docs" className={styles.docsLink} target="_blank" rel="noreferrer">
            查看 OpenAPI 规格 →
          </a>
        </section>

        <section className={styles.snippetCard}>
          <nav className={styles.tabs}>
            {SNIPPETS.map((s) => (
              <button
                key={s.id}
                className={`${styles.tab} ${activeId === s.id ? styles.tabActive : ""}`}
                onClick={() => setActiveId(s.id)}
              >
                {s.label}
              </button>
            ))}
          </nav>

          <div className={styles.snippetBody}>
            <div className={styles.snippetMeta}>
              <p>{active.description}</p>
              <button onClick={() => void copy(active.code)} className={styles.copyBtn}>
                {copied === active.id ? "✓ 已复制" : "复制"}
              </button>
            </div>
            <pre className={styles.code} data-lang={active.language}>
              <code>{active.code}</code>
            </pre>
          </div>
        </section>
      </div>
    </AppShell>
  );
}
