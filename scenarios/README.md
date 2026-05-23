# Scenarios

这里存放面向业务的场景模板文档。

当前阶段：
- 先提供 `toB-customer-support/` 的首场景模板
- 已补充 AssetOpsBench 相关 scenario skill 模板，用于测试工业资产运维 Agent 数据
- YAML 主要用于作者阅读、评审和后续 onboarding
- 运行时当前仍以内置模板注册表为准，后续再接 YAML loader

## 当前模板索引

| Scenario | 用途 |
| --- | --- |
| `toB-customer-support` | ToB 客服 Agent 质量评估 |
| `assetops-iot-retrieval` | AssetOpsBench sites/assets/sensors/history 类 IoT 数据检索 |
| `assetops-failure-mode-sensor-mapping` | 故障模式与传感器相关性映射 |
| `assetops-tsfm-anomaly-forecast` | 时间序列预测、fine-tuning、异常检测 |
| `assetops-work-order-maintenance` | 工单检索、故障码分析、维护事件分析 |
| `assetops-vibration-diagnostics` | FFT、包络谱、轴承频率、ISO 10816、振动诊断 |
| `assetops-end-to-end-orchestration` | 跨 IoT/FMSR/TSFM/WO/Vibration 的多 Agent 端到端编排 |

## Scenario Skill 方向

后续每个 scenario 都应被视为一个可版本化的评估 skill，而不是一组写死在通用 pipeline 里的 KPI。

建议结构：

```txt
scenarios/<scenario-id>/
  scenario-template.yaml
  rubric.md
  judge-prompts.md
  metric-dictionary.md
  examples/
    good.jsonl
    bad.jsonl
    borderline.jsonl
  calibration/
    gold-labels.jsonl
    agreement-report.md
```

设计细节见 `eval-system-概述/6-Scenario技能化评估框架.md`。
