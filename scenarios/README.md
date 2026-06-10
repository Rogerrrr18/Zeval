# Scenarios

这里存放面向业务的场景模板文档。

当前阶段：
- 先提供 `toB-customer-support/` 的首场景模板
- YAML 主要用于作者阅读、评审和后续 onboarding
- 运行时当前仍以内置模板注册表为准，后续再接 YAML loader

## 当前模板索引

| Scenario | 用途 |
| --- | --- |
| `toB-customer-support` | ToB 客服 Agent 质量评估 |

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

运行时注册逻辑见 `src/scenarios/index.ts`。
