# AssetOps 振动诊断 Rubric

## 评分维度

### bearingFrequencyCalculationAccuracy

- 5：BPFO/BPFI/BSF/FTF 计算或调用正确，并说明单位 Hz。
- 3：公式或结果大体正确，但细节缺失。
- 1：频率计算错误或型号参数错误。

### spectralAnalysisCorrectness

- 5：正确执行 FFT/包络谱，并解释峰值、窗口、带通范围。
- 3：执行了分析但解释不完整。
- 1：分析方法错误或误读峰值。

### severityClassificationCorrectness

- 5：按 ISO 10816 正确分类 Zone A-D 和 machine group。
- 3：分类方向正确但阈值解释不足。
- 1：严重度分类错误。

### faultDiagnosisEvidenceQuality

- 5：故障判断由 1x/2x/3x、BPFO/BPFI、包络峰、RMS 等证据支持。
- 3：有部分证据但不完整。
- 1：只有结论，没有频谱证据。

### maintenanceRecommendationQuality

- 5：建议结合严重度、故障证据、保守性和风险。
- 3：建议合理但缺少权衡。
- 1：建议与诊断证据不一致。

## Bad Case 标签

- wrong_bearing_frequency
- wrong_iso_zone
- fft_misread
- envelope_analysis_missing
- unsupported_fault_claim
- unsafe_maintenance_recommendation

