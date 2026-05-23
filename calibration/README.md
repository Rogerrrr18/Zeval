# Calibration

这一层用于做 `judge calibration / agreement / drift`。

当前仓库先提供一套可运行的 smoke skeleton：
- `gold-sets/v1/`：最小 gold set 与人工标签
- `judge-runs/`：每次 judge 跑完后的原始 JSONL
- `reports/`：agreement / drift 的 markdown 报告
- `scripts/`：运行 judge、计算一致性、检测漂移

建议的本地流程：

```bash
npm run calibration:judge
npm run calibration:agreement
npm run calibration:judge -- --judge-id rule-local-candidate
npm run calibration:drift
```

当前 `v1` 只是 P0 冒烟集，不是最终 gold set。
`v2` 起先走可审核的标注脚手架：

```bash
npm run gold:v2:scaffold -- --assignees alice,bob --reviewers lead
# 填写 calibration/gold-sets/v2/label-drafts/*.json，并将审核通过项设为 approved
npm run gold:v2:import
npm run gold:v2:coverage
npm run calibration:judge -- --cases calibration/gold-sets/v2/cases.jsonl
npm run calibration:agreement -- --labels calibration/gold-sets/v2/labels.jsonl
```

导入脚本只会把 `reviewStatus=approved` 且证据、分数、reviewer 信息完整的 draft 写入 `labels.jsonl`。
覆盖报告会输出 `coverage-report.md`，用于追踪 80 条候选目标、approved label 缺口、scene/tag 覆盖和标注分工。

后续要按补充方案扩到更高覆盖度，并补齐：
- 更大的 bad case 覆盖面
- CI 回归门禁
- judge registry / 横评
