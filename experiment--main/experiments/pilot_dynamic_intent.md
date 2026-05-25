# Pilot：基于意图指针的动态评测

## 目标
以工程可落地为主，验证以下流水线：

1. 历史 session 读入
2. 单次抽取 `intent_sequence + refillables`
3. 人工可修订并锁版为 `*_locked.json`
4. 用 locked asset 跑动态回放
5. 输出原始基线 `B` 与动态结果 `D` 的可解释对比

## 为什么替代旧 5 实验主线
旧版 `exp1~exp5` 更像研究矩阵，但当前实现与命名不完全一致，容易产生“实验故事大于实现”的问题。

Pilot 版本先回答三个更实际的问题：
- Schema 能否稳定抽取并锁版？
- 动态回放能否稳定结束，不拖死？
- 输出结果是否能被人理解和审计？

## 关键设计

### 1) locked asset
动态回放只消费 `*_locked.json`，避免“边抽取边评测”造成漂移。

### 2) 单意图预算
- `n_i = turn_span_user_turns`
- `B_i = ceil(alpha * n_i)`
- 默认 `alpha = 2`
- `n_i = 0` 时使用 `B_min = 3`

### 3) Judge 三分类
- `SATISFIED`
- `NOT_SATISFIED`
- `DEVIATION`

### 4) refillables 注入
把历史中已闭环事实变成 system/developer 前缀，减少“重复执行任务”带来的干扰。

## 输出
- draft assets
- locked assets
- run_log.jsonl
- metrics_summary.json
- B vs D radar.svg
