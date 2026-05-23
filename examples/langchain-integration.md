# LangChain 集成示例

把任何 LangChain 链路接入 ZERORE，让生产 trace 自动流入 ZERORE 做评估。

```ts
import { ChatOpenAI } from "@langchain/openai";
import { langchainCallbackToOtel } from "@zerore/sdk/adapters/langchain";

const callback = langchainCallbackToOtel({
  ingestUrl: process.env.ZERORE_INGEST_URL!,
  apiKey: process.env.ZERORE_API_KEY,
  sessionId: "user_42_session_8",
  evaluateInline: true, // 实时评估
});

const model = new ChatOpenAI({
  modelName: "gpt-4o-mini",
  callbacks: [callback],
});

await model.invoke([{ role: "user", content: "退款流程是怎样的？" }]);
```

ZERORE 会自动：
1. 把 LangChain RunTree 转成 OTel GenAI trace
2. 提取 chat / retrieval / tool spans 作为 evaluable inputs
3. 跑 evaluate + 7 个扩展指标（faithfulness、answerRelevancy 等）
4. 命中 bad case 时自动产生候选调优包

## 验证

```bash
curl http://localhost:3010/api/traces/ingest?limit=10
```
