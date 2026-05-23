# AssetOps 时间序列预测与异常检测 Rubric

## 评分维度

### taskSelectionCorrectness

- 5：正确选择 forecasting、fine-tuning、TSAD 或 integrated TSAD。
- 3：任务方向正确，但工具选择不是最优。
- 1：选择错误任务类型。

### datasetParameterCorrectness

- 5：dataset_path、timestamp_column、target_columns、horizon 等参数正确。
- 3：主要参数正确，但缺少可选配置或解释。
- 1：关键参数错误，导致执行无效。

### outputArtifactTraceability

- 5：输出结果能追溯到 JSON/CSV artifact、指标或路径。
- 3：提到产物但路径、指标或字段不完整。
- 1：没有可验证产物。

### anomalyInterpretationQuality

- 5：能解释异常区间、传感器含义、维护风险。
- 3：能指出异常但解释较弱。
- 1：只贴结果或误读异常。

### uncertaintyDisclosure

- 5：说明误报、置信度、数据不足或模型限制。
- 3：简单提醒不确定性。
- 1：把预测结果包装成确定事实。

## Bad Case 标签

- wrong_tsfm_task
- wrong_dataset_parameter
- missing_artifact
- unsupported_forecast_claim
- anomaly_misinterpretation
- no_uncertainty_disclosure

