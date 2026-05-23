# AssetOps 故障模式-传感器映射指标字典

| 指标 | 来源 | 方向 | 说明 |
| --- | --- | --- | --- |
| failureModeCoverage | LLM Judge | 越高越好 | 是否覆盖关键故障模式 |
| sensorRelevanceMapping | LLM Judge | 越高越好 | 故障模式与传感器关系是否准确 |
| bidirectionalMappingConsistency | LLM Judge + structured output | 越高越好 | 双向映射是否一致 |
| domainJustificationQuality | LLM Judge | 越高越好 | 是否有物理和诊断依据 |
| unsupportedAssetFallbackHandling | LLM Judge | 越高越好 | 未知资产是否合理降级 |
| hallucinationControl | LLM Judge | 越高越好 | 是否避免编造知识 |

