# OpenAI Agents SDK 集成示例

```ts
import { ZeroreClient, convertOpenAIAgentRunToTrace } from "@zerore/sdk";

const zerore = new ZeroreClient({ baseUrl: "http://localhost:3010" });

// 在你的 agent run hook 里：
const run = await openaiAgentsClient.runs.retrieve(threadId, runId);
const trace = convertOpenAIAgentRunToTrace(run, {
  sessionId: threadId,
});

await zerore.ingestTrace([trace], { evaluateInline: true, scenarioId: "toB-customer-support" });
```

适用场景：
- 工具调用密集型 agent → toolCorrectness 自动评估
- 多轮对话保持事实记忆 → knowledgeRetention 评估
- 角色扮演场景 → roleAdherence 评估
