# rem_20260424_22dcf8

## 概览
- 生成时间：2026-04-24T04:10:11.307Z
- 来源 Run：smoke_e2e_1777003811264
- 场景：ToB 客服 Agent
- 优先级：P0
- 选中 bad case：1
- 建议优先修改层：prompt, policy

## 问题摘要
- 会话已经进入投诉 / 转人工风险区，需要优先压降升级触发。
- 用户主任务没有完成，session 结束在失败态。
- 一次解决率 已跌到 at_risk（47%）。

## 目标指标
- 目标达成率: 0 -> 0.7 (提高)。失败案例显示用户主任务没有闭环，必须先把任务完成态拉回安全线。
- 升级触发率: 1 -> 0.9 (降低)。用户已进入投诉/转人工语境，需先降低升级触发。
- ToB 客服 Agent KPI 均分: 0.5456 -> 0.75 (提高)。业务 KPI 已经进入低位，需要同时关注业务侧结果而不是只看通用对话分。

## 关键证据
### 第 7 轮后目标未达成：如果又出问题我会投诉到底
- tags: escalation_keyword, goal_failed
- severity: 0.56
- suggested_action: 优先把失败 session 编译为 remediation spec，并补一键回放验证。
- [turn 7] [user] 如果又出问题我会投诉到底

## 约束条件
- 不要降低现有安全拒答质量。
- 不要让平均响应时延恶化超过 20%。
- 不要破坏当前已支持的业务场景与回放链路。
- 投诉与转人工路径要保留可追踪的 SLA 与兜底话术。
- 优先保证用户主任务闭环，不要用冗长解释替代动作完成。

## Agent Handoff
- 将本目录下的 `remediation-spec.yaml`、`badcases.jsonl`、`acceptance-gate.yaml` 一起交给 Claude Code / Codex。
- 优先从 edit_scope 指定的层开始改，不要无关重构。
- 完成后必须先跑 replay，再跑固定 sample batch；任何 guard 退化都不算通过。

## 验收摘要
- replay.min_win_rate = 0.65
- offline_eval.max_regressions = 0