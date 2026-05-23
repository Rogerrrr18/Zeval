# AssetOps 多 Agent 端到端编排指标字典

| 指标 | 来源 | 方向 | 说明 |
| --- | --- | --- | --- |
| planningCompleteness | LLM Judge + plan | 越高越好 | 计划是否覆盖必要步骤 |
| agentSequenceCorrectness | LLM Judge + trace | 越高越好 | Agent/工具顺序是否正确 |
| toolSelectionCorrectness | LLM Judge + trace | 越高越好 | 工具选择是否合理 |
| parameterBindingAccuracy | LLM Judge + trace | 越高越好 | 跨步骤参数是否正确传递 |
| evidenceChainCompleteness | LLM Judge + trace | 越高越好 | 结论是否可追溯 |
| resultSynthesisQuality | LLM Judge | 越高越好 | 是否综合多源结果 |
| recoveryFromToolFailure | LLM Judge + trace | 越高越好 | 工具失败时是否合理恢复 |
| hallucinationControl | LLM Judge | 越高越好 | 是否避免编造跨域结论 |

