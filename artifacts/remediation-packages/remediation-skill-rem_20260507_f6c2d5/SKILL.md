# 通用对话 · goal_partial 调优包

## 什么时候使用
当 Zeval run `run_1778146403778` 暴露出以下问题时使用本 skill：
- 用户目标只部分达成，仍需额外追问或人工补救。
- 用户重复追问同一件事，说明回答没有直接命中核心问题。

## 修复策略
- 优先级：P2
- 优先修改层：prompt, orchestration
- 先修复覆盖面最大的失败标签，再处理单点异常。
- 不做无关重构；所有改动都要能被 reference/acceptance-gate.yaml 验证。

## 关键 bad case
- 第 8 轮出现失败信号：I found another restaur…：severity=0.20，tags=goal_partial，建议=将该片段沉淀到 bad case 池，并纳入下一轮 sample batch 与回放对比。
- 第 12 轮出现失败信号：Sorry the reservation w…：severity=0.20，tags=goal_partial，建议=将该片段沉淀到 bad case 池，并纳入下一轮 sample batch 与回放对比。
- 第 7 轮出现失败信号：Any other suggestions?：severity=0.18，tags=question_repeat，建议=把策略改为先直接回答问题，再扩展背景，避免用户重复追问。

## 目标指标
- 目标达成率: 0.8333 -> 0.9833 (提高)
- 重复提问率: 0.1081 -> 0.05 (降低)
- 共情得分: 3 -> 4 (提高)

## 验收标准
- Replay win rate >= 0.65
- Offline eval max regressions <= 0
- `reference/badcases.jsonl` 中的关键样例不再触发同类失败。
- 如果修改 prompt/policy/orchestration/code，必须在提交说明里写清楚影响范围。

## Reference
- `reference/issue-brief.md`：完整问题说明与证据。
- `reference/badcases.jsonl`：机器可读 bad case。
- `reference/remediation-spec.yaml`：修复范围、约束与目标指标。
- `reference/acceptance-gate.yaml`：验收门禁。