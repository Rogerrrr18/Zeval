# AssetOps 振动诊断指标字典

| 指标 | 来源 | 方向 | 说明 |
| --- | --- | --- | --- |
| signalAcquisitionAccuracy | LLM Judge + trace | 越高越好 | 是否正确获取振动信号 |
| bearingFrequencyCalculationAccuracy | LLM Judge/公式校验 | 越高越好 | 轴承特征频率是否正确 |
| spectralAnalysisCorrectness | LLM Judge + artifact | 越高越好 | FFT/包络谱分析是否正确 |
| severityClassificationCorrectness | LLM Judge/阈值 | 越高越好 | ISO 10816 分类是否正确 |
| faultDiagnosisEvidenceQuality | LLM Judge | 越高越好 | 故障结论是否有频谱证据 |
| maintenanceRecommendationQuality | LLM Judge | 越高越好 | 维护建议是否合理 |
| uncertaintyDisclosure | LLM Judge | 越高越好 | 是否说明限制和保守性 |
| hallucinationControl | LLM Judge | 越高越好 | 是否避免编造信号或峰值 |

