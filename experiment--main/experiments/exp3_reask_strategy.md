# Legacy Notice: exp3_reask_strategy

该文档已归档。

旧版聚焦全局 `max_reasks` 消融；新版主线改为：
- 每个意图使用历史 `turn_span_user_turns` 推导 `n_i`
- `B_i = ceil(alpha * n_i)`
- 预算按意图自适应，而不是全局固定

请优先阅读：`experiments/pilot_dynamic_intent.md`
