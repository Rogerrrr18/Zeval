# 基于意图指针的动态评测效果实验（Pilot）

这是一个按 **新方案 v1.0** 重构后的仓库：

> **单臂动态回放 + 原始 session 基线 B 对比 + locked schema assets + refillables 注入**

当前仓库不再以旧的 `exp1~exp5` 研究矩阵为主线，而是先聚焦一个更可落地的工程化 pilot：

- 从 CSV / MultiWOZ session 读入历史对话
- 一次抽取出 `intent_sequence + refillables`
- 允许人工修订并锁版为 `*_locked.json`
- 只消费 locked assets 跑动态评测
- 产出：
  - 原始 session 基线 **B**
  - 动态回放结果 **D**
  - `run_log.jsonl`
  - `metrics_summary.json`
  - `radar.svg`

---

## 1. 当前实验主线

### 目标
验证以下闭环能否稳定工作：

```text
CSV / Session
→ schema 化抽取
→ locked asset
→ 动态回放（意图指针 + 预算 + refillables）
→ B / D 指标对比
→ 雷达图与日志审计
```

### 首期冻结决策
- **单臂动态回放**，不再把 fixed/free 作为首要主线
- 对照使用 **原始 session 基线 B**，不是多 replay 机制大乱斗
- Judge 为三分类：
  - `SATISFIED`
  - `NOT_SATISFIED`
  - `DEVIATION`
- 允许先抽取、再人工修订、再锁版
- 优先支持本地可复现；外部 LLM 调用为可选增强

---

## 2. 目录结构

```text
├── extract_session.schema.json          # 锁定 Schema
├── src/
│   ├── pilot_types.py                   # Pilot 核心数据结构
│   ├── session_asset_extractor.py       # session → draft/locked asset
│   ├── pilot_runner.py                  # B/D 评测、日志、雷达输出
│   ├── run_experiment.py                # 新版主入口
│   ├── intent_extractor.py              # legacy
│   ├── replay_evaluator.py              # legacy
│   ├── sim_user.py                      # legacy
│   └── judge.py                         # legacy
├── experiments/
│   ├── pilot_dynamic_intent.md          # 新主方案说明
│   ├── exp1_intent_extraction.md        # legacy 归档说明
│   ├── exp2_replay_comparison.md        # legacy 归档说明
│   ├── exp3_reask_strategy.md           # legacy 归档说明
│   ├── exp4_scoring_sensitivity.md      # legacy 归档说明
│   └── exp5_cross_dataset.md            # legacy 归档说明
└── results/
```

---

## 3. 输入数据

当前默认支持：

### A. turn-level CSV
建议最小列集：
- `session_id` / `dialogue_id`
- `turn_index` / `turn_num`
- `role` / `speaker`
- `content` / `utterance`
- `timestamp`（可选）

### B. MultiWOZ JSON/JSONL
如果 `data/multiwoz/` 下存在原始 MultiWOZ 文件，也会自动读取。

---

## 4. 运行方式

### 4.1 完整跑通 pilot

```bash
python src/run_experiment.py \
  --dataset multiwoz \
  --data-dir . \
  --sessions 10 \
  --output-dir results/pilot
```

### 4.2 只做 schema 抽取与锁版草稿

```bash
python src/run_experiment.py \
  --dataset multiwoz \
  --data-dir . \
  --sessions 10 \
  --step extract \
  --output-dir results/pilot
```

---

## 5. 输出内容

运行后会生成：

- `assets/{session_id}.draft.json`
- `assets/{session_id}_locked.json`
- `draft_assets_*.json`
- `run_log_*.jsonl`
- `metrics_summary_*.json`
- `radar_*.svg`

其中：

### `draft.json`
首轮自动抽取结果，允许人工修订。

### `*_locked.json`
锁版后的正式资产。后续动态评测只消费这个文件。

### `metrics_summary`
包含：
- per-session baseline B metrics
- per-session dynamic D metrics
- B vs D 的 summary 与 delta

### `radar.svg`
将以下维度映射到同一雷达图：
- Intent Completion
- Low Followup
- Low Deviation
- Turn Efficiency
- Composite

---

## 6. 环境变量（可选）

如果你要接 SiliconFlow / OpenAI 兼容网关，可设置：

```bash
export ZEVAL_JUDGE_BASE_URL="https://api.siliconflow.cn/v1"
export ZEVAL_JUDGE_MODEL="Qwen/Qwen3.5-27B"
export ZEVAL_JUDGE_ENABLE_THINKING="false"
export ZEVAL_INTENT_EXPERIMENT_API_KEY="..."
```

回退顺序：
- `ZEVAL_INTENT_EXPERIMENT_API_KEY`
- `ZEVAL_JUDGE_API_KEY`
- `OPENAI_API_KEY`

未配置时，仓库会走 **本地 heuristic fallback**，仍可跑通 pipeline。

---

## 7. 当前方法论边界

这版仓库刻意偏向 **pilot / 工程试跑**，不是最终研究版：

- 先验证 pipeline、schema、locked asset、日志审计、B/D 对比是否成立
- 暂不把跨数据集、复杂消融、显著性检验作为主线
- 旧 `exp1~exp5` 保留为 **legacy 归档**，避免混淆当前方向

如果后续要继续升级，推荐顺序是：

1. 人工修订一批 locked assets
2. 提升 Judge 与 extractor 的人工一致性
3. 接真实待测 Agent 通道
4. 再重建更严谨的 method-eval / product-eval

---

## 8. 一句话定位

这个仓库现在的定位不是：

> “证明动态意图回放在研究上全面优于所有方法”

而是：

> **“先把意图指针动态评测这条工程链路做成一个可信、可审计、可解释的 pilot。”**
