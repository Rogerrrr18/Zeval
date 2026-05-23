# AssetOps 时间序列预测与异常检测指标字典

| 指标 | 来源 | 方向 | 说明 |
| --- | --- | --- | --- |
| taskSelectionCorrectness | LLM Judge + trace | 越高越好 | TSFM/TSAD 工具选择是否正确 |
| datasetParameterCorrectness | LLM Judge + trace | 越高越好 | 数据路径、时间列、目标列等参数是否正确 |
| outputArtifactTraceability | LLM Judge + artifact | 越高越好 | 结果是否可追溯到文件或指标 |
| anomalyInterpretationQuality | LLM Judge | 越高越好 | 是否正确解释异常和维护风险 |
| metricReportingCompleteness | LLM Judge + artifact | 越高越好 | 是否报告必要指标 |
| uncertaintyDisclosure | LLM Judge | 越高越好 | 是否披露模型限制和不确定性 |
| hallucinationControl | LLM Judge | 越高越好 | 是否避免编造预测结果 |

