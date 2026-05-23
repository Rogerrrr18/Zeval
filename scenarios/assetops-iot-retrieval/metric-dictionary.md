# AssetOps IoT 数据检索指标字典

| 指标 | 来源 | 方向 | 说明 |
| --- | --- | --- | --- |
| taskCompletion | LLM Judge | 越高越好 | 是否完成用户请求 |
| dataRetrievalAccuracy | LLM Judge + expectedAnswer | 越高越好 | 检索结果是否正确 |
| entityGroundingAccuracy | LLM Judge | 越高越好 | site/asset/sensor 是否识别正确 |
| parameterBindingAccuracy | LLM Judge + trace | 越高越好 | 工具参数是否绑定正确 |
| temporalFilterCorrectness | LLM Judge + trace | 越高越好 | 时间过滤是否正确 |
| toolSequenceCorrectness | LLM Judge + trace | 越高越好 | 是否按合理顺序调用工具 |
| hallucinationControl | LLM Judge | 越高越好 | 是否避免编造资产数据 |

