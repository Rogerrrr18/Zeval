# 通用对话 · 升级风险 调优包

## 什么时候使用
当 Zeval run `copilot_1779761168221` 暴露出以下问题时使用本 skill：
- 会话已经进入投诉 / 转人工风险区，需要优先压降升级触发。
- 用户主任务没有完成，session 结束在失败态。
- 对话出现理解障碍，agent 的表达方式对用户不够友好。

## 修复策略
- 优先级：P0
- 优先修改层：prompt, policy, orchestration
- 先修复覆盖面最大的失败标签，再处理单点异常。
- 不做无关重构；所有改动都要能被 reference/acceptance-gate.yaml 验证。

## 关键 bad case
- 第 7 轮后目标未达成：如果又出问题我会投诉到底：severity=1.00，tags=escalation_keyword, goal_failed, understanding_barrier，建议=优先把失败 session 编译为 remediation spec，并补一键回放验证。

## 目标指标
- 目标达成率: 0 -> 0.7 (提高)
- 重复提问率: 0 -> 0.05 (降低)
- 共情得分: 3 -> 4 (提高)
- 升级触发率: 1 -> 0.9 (降低)

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