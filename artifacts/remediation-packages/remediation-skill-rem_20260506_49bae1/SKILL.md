# 通用对话 · goal_partial 调优包

## 什么时候使用
当 Zeval run `run_1778047856944` 暴露出以下问题时使用本 skill：
- 用户目标只部分达成，仍需额外追问或人工补救。
- 用户情绪显著下探，当前回复无法稳住体验。
- 用户主任务没有完成，session 结束在失败态。
- 失败出现后没有被有效修复，体验在低谷停留过久。

## 修复策略
- 优先级：P0
- 优先修改层：prompt, orchestration
- 先修复覆盖面最大的失败标签，再处理单点异常。
- 不做无关重构；所有改动都要能被 reference/acceptance-gate.yaml 验证。

## 关键 bad case
- 第 1 轮后目标未达成：I'm on a budget and I a…：severity=0.86，tags=emotion_drop, goal_failed, recovery_failed，建议=优先把失败 session 编译为 remediation spec，并补一键回放验证。
- 第 5 轮后目标未达成：Find a place in Vallejo…：severity=0.34，tags=goal_failed，建议=优先把失败 session 编译为 remediation spec，并补一键回放验证。
- 第 24 轮出现失败信号：Unfortunately, I was un…：severity=0.34，tags=emotion_drop, goal_partial，建议=将该片段沉淀到 bad case 池，并纳入下一轮 sample batch 与回放对比。

## 目标指标
- 目标达成率: 0.8594 -> 1 (提高)
- 恢复成功率: 0.5 -> 0.7 (提高)
- 情绪恢复能力: 3 -> 4 (提高)

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