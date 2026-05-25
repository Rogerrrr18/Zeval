# eval-test-v1 · CSV 输入字段冻结说明

**冻结版本：** `v1.0-csv-multiwoz`  
**权威样例：** 仓库内 `public/multiwoz_samples_10.csv`（10 条 `dialogue_id`，UTF-8，RFC 4180 风格引号）  
**中文对照（便于阅读）：** `public/multiwoz_samples_10_zh-CN.csv` — 与英文版**相同表头、相同 `dialogue_id` / `turn_num` / `active_intents` / `slot_values`**；`services` 译为中文领域名，`utterance` 译为中文对白。解析规则与 §1 一致，可作演示导入。  
**适用范围：** 仅 `eval-test-v1/` 目录下 POC；与《基于意图指针的动态评测效果实验方案》§2 对齐。

## 1. 首期冻结列（顺序与表头拼写固定）

| 列名 | 必填 | 类型 / 约定 | 说明 |
|------|------|-------------|------|
| `dialogue_id` | 是 | 字符串 | 会话唯一标识；样例中为 `*.json` 文件名，**原样保留**（含后缀） |
| `services` | 否 | 字符串 | 领域标签，**单元格可为空**；若有值则多值用 **竖线 `\|`** 连接，如 `restaurant\|taxi\|hotel` |
| `turn_num` | 是 | 非负整数 | 行内轮次编号，**同一 `dialogue_id` 内单调递增、无重复**；与工程内 `turn_index` 一一对应 |
| `speaker` | 是 | `USER` / `SYSTEM`（大小写敏感） | 映射为工程角色：`USER`→`user`，`SYSTEM`→`assistant` |
| `utterance` | 是 | 字符串 | 该轮文本；可含英文逗号，必要时用双引号包裹整字段 |
| `active_intents` | 否 | 字符串 | 可为空；多意图用 **竖线 `\|`** 连接 |
| `slot_values` | 否 | 字符串 | 可为空；槽位串，多段用 **竖线 `\|`** 分隔；值内若含逗号，整段可用双引号包裹（见样例行 40） |

## 2. 工程侧规范化

- **session_id** ≡ `dialogue_id`（不剥离 `.json`）。  
- **turn_index** ≡ `turn_num`。  
- **role / content** ≡ 上表映射后的 `speaker` / `utterance`。  
- **元数据透传：** `services`（可为空）、`active_intents`、`slot_values` 写入 `data/sessions.json` 内各行可选字段，供抽取阶段附加「CSV_AUX」块使用；**基线 B** 仅用对白正文，不注入上述列，避免标签泄漏。

## 3. 兼容格式（非冻结、仅自测）

表头含 `session_id`, `turn_index`, `role`, `content` 的最小 CSV 仍可由解析器识别（`role` 为 `user`/`assistant`）。正式试验与报告以 **§1 冻结列** 为准。

## 4. 数据质量门禁（与方案一致）

- 每个 `dialogue_id` 至少 **2** 条 `speaker=USER` 行。  
- 每会话内 `turn_num` 升序可排序；解析后校验无重复。  
- 无空 `utterance`（trim 后）。
