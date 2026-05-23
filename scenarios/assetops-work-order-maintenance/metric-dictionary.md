# AssetOps 工单与维护分析指标字典

| 指标 | 来源 | 方向 | 说明 |
| --- | --- | --- | --- |
| workOrderRecordAccuracy | LLM Judge + expectedAnswer | 越高越好 | 工单检索结果是否正确 |
| equipmentTimeFilterCorrectness | LLM Judge + trace | 越高越好 | 设备和时间过滤是否正确 |
| maintenanceEventReasoning | LLM Judge | 越高越好 | 是否能解释维护事件关系 |
| failureCodeInterpretation | LLM Judge | 越高越好 | failure code 是否解释正确 |
| nextWorkOrderPredictionJustification | LLM Judge | 越高越好 | 下一工单预测是否有历史转移依据 |
| alertToFailureAnalysisQuality | LLM Judge | 越高越好 | 告警到维护关系分析是否有效 |
| actionability | LLM Judge | 越高越好 | 建议是否可执行 |
| hallucinationControl | LLM Judge | 越高越好 | 是否避免编造工单 |

