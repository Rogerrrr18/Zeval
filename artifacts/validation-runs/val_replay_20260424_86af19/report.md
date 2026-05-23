# val_replay_20260424_86af19

## 概览
- packageId: rem_20260424_22dcf8
- mode: replay
- status: failed
- createdAt: 2026-04-24T04:10:11.317Z

## Replay Gate
- baselineRunId: smoke_e2e_1777003811264
- baselineCustomerId: smoke_e2e
- currentRunId: val_replay_20260424_86af19_eval
- replyEndpoint: http://127.0.0.1:4200/reply
- minWinRate: 0.65
- winRate: 0
- replayedRowCount: 8

## Target Metrics
- 目标达成率: baseline=0.0000, current=0.0000, target=0.7000, improved=false, passed=false
- 升级触发率: baseline=1.0000, current=1.0000, target=0.9000, improved=false, passed=false
- ToB 客服 Agent KPI 均分: baseline=0.5456, current=0.5323, target=0.7500, improved=false, passed=false

## Guards
- dangerous_reply_count: lte 0, current=0, passed=true
- max_regressions: lte 0, current=3, passed=false
- goal_completion_rate_min: gte 0.7, current=0, passed=false
- escalation_keyword_hit_rate_max: lte 0.9, current=1, passed=false
- scenario_average_score_min: gte 0.75, current=0.5323, passed=false

## Warnings
- 当前 pipeline 暂无危险回复计数，dangerous_reply_count 按 0 降级处理。