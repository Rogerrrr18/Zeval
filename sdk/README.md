## @zerore/sdk

ZERORE 评估 SDK — 让任意 TypeScript / Node.js / 框架的 AI 应用一行代码接入 ZERORE 的质量闭环。

### 安装

```bash
npm install @zerore/sdk
```

### 快速开始

```ts
import { ZeroreClient } from "@zerore/sdk";

const zerore = new ZeroreClient({
  baseUrl: "http://localhost:3010",
  apiKey: process.env.ZERORE_API_KEY,
});

// 1. evaluate
const result = await zerore.evaluate({
  rawRows: [
    { sessionId: "s1", timestamp: "2026-04-18T10:00:00+08:00", role: "user", content: "退款怎么操作？" },
    { sessionId: "s1", timestamp: "2026-04-18T10:00:30+08:00", role: "assistant", content: "我先帮你登记..." },
  ],
  scenarioId: "toB-customer-support",
  useLlm: true,
  extendedInputs: {
    retrievalContexts: [
      {
        query: "退款怎么操作？",
        response: "我先帮你登记...",
        contexts: ["未拆封七天内可申请退款，需提供订单号"],
      },
    ],
  },
});
console.log(result.extendedMetrics?.faithfulness);

// 2. ingest trace from production agent
await zerore.ingestTrace([trace], { evaluateInline: true });

// 3. synthesize evaluation cases
const cases = await zerore.synthesize({
  scenarioDescription: "ToB 客服 Agent，处理升级风险",
  targetFailureModes: ["升级触发", "目标未达成"],
  count: 10,
});
```

### LangChain 集成

```ts
import { langchainCallbackToOtel } from "@zerore/sdk/adapters/langchain";
import { ChatOpenAI } from "@langchain/openai";

const callback = langchainCallbackToOtel({
  ingestUrl: "http://localhost:3010/api/traces/ingest",
  evaluateInline: true,
});

const model = new ChatOpenAI({ callbacks: [callback] });
```

### OpenAI Agents 集成

```ts
import { convertOpenAIAgentRunToTrace } from "@zerore/sdk/adapters/openai";

const trace = convertOpenAIAgentRunToTrace(run, { sessionId: "abc" });
await zerore.ingestTrace([trace]);
```

### CLI

```bash
ZERORE_BASE_URL=http://localhost:3010 npx zerore evaluate --file conversation.csv --scenario toB-customer-support
ZERORE_BASE_URL=http://localhost:3010 npx zerore synthesize --scenario "ToB 客服" --count 10
ZERORE_BASE_URL=http://localhost:3010 npx zerore ingest --file trace.json --evaluate
```
