# 扩展指标使用示例

ZERORE 现已对齐 DeepEval 的 7 个核心指标族（10 个具体指标）：

| 指标 | 类别 | 何时用 |
|---|---|---|
| `faithfulness` | RAG | 回复是否忠实于检索内容 |
| `hallucination` | RAG | 是否包含 context 不支持的捏造 |
| `answerRelevancy` | 通用 | 回复与 query 的相关性 |
| `contextualRelevancy` | RAG | 检索内容与 query 的相关性 |
| `toolCorrectness` | Agentic | 工具调用是否选对、参数是否正确 |
| `knowledgeRetention` | MultiTurn | 多轮中事实是否被保持 |
| `toxicity` | Safety | 回复是否有害 |
| `bias` | Safety | 是否含群体偏见 |
| `roleAdherence` | RolePlay | 是否保持人设 |
| `taskCompletion` | Agentic | 任务是否完成 |

## 一次评估调用所有适用指标

```bash
curl -X POST http://localhost:3010/api/evaluate \
  -H 'content-type: application/json' \
  -d '{
    "rawRows": [...],
    "scenarioId": "toB-customer-support",
    "useLlm": true,
    "extendedInputs": {
      "retrievalContexts": [
        {
          "query": "未拆封商品如何退款？",
          "response": "未拆封商品 7 天内可全额退款",
          "contexts": ["未拆封商品 7 天内可全额退款，需提供订单号"]
        }
      ],
      "toolCalls": [
        {
          "sessionId": "s1",
          "turnIndex": 2,
          "toolName": "create_refund_ticket",
          "arguments": { "orderId": "SF882910" },
          "expectedToolName": "create_refund_ticket",
          "succeeded": true
        }
      ],
      "retentionFacts": [
        {
          "factId": "f1",
          "introducedAtTurn": 0,
          "factText": "订单号 SF882910"
        }
      ]
    }
  }'
```

返回中会有 `extendedMetrics`：

```json
{
  "extendedMetrics": {
    "faithfulness": { "score": 0.95, "passed": true, "reason": "...", "evidence": ["..."] },
    "answerRelevancy": { "score": 0.88, "passed": true },
    "toolCorrectness": { "score": 1.0, "passed": true },
    "knowledgeRetention": { "score": 1.0, "passed": true },
    "toxicity": { "score": 1.0, "passed": true },
    "bias": { "score": 1.0, "passed": true },
    "hallucination": { "score": 0.92, "passed": true },
    "contextualRelevancy": { "score": 0.85, "passed": true },
    "roleAdherence": null,
    "taskCompletion": { "score": 0.9, "passed": true }
  }
}
```

未提供对应输入的指标会返回 `null`，不会影响其他指标。
