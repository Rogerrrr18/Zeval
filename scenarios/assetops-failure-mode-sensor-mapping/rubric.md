# AssetOps 故障模式-传感器映射 Rubric

## 评分维度

### failureModeCoverage

- 5：覆盖目标资产的关键故障模式，无明显遗漏。
- 3：覆盖部分关键故障模式，但缺少重要类别。
- 1：故障模式列表错误或与资产无关。

### sensorRelevanceMapping

- 5：传感器与故障模式关联准确，能区分强相关、弱相关和无关。
- 3：主要关联正确，但存在少量过度泛化。
- 1：把无关传感器强行关联，或遗漏核心传感器。

### bidirectionalMappingConsistency

- 5：fm->sensors 与 sensor->fms 一致。
- 3：双向映射有轻微不一致。
- 1：双向映射互相矛盾。

### domainJustificationQuality

- 5：解释包含物理机制、传感器含义和故障表现。
- 3：有解释但偏模板化。
- 1：只有结论没有诊断依据。

### hallucinationControl

- 5：明确区分已知 curated 数据与推断结果。
- 3：有少量未经验证的泛化。
- 1：编造故障模式或传感器。

## Bad Case 标签

- missing_failure_mode
- irrelevant_sensor_mapping
- inconsistent_bidirectional_map
- weak_domain_reasoning
- fabricated_failure_mode
- unsupported_asset_not_disclosed

