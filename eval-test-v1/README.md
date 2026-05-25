# 意图指针动态评测 POC（eval-test-v1）

与《基于意图指针的动态评测效果实验方案》v1.0 对齐的最小可运行实现：`npm run dev` 后打开 http://localhost:3100 。

## CSV 输入（已冻结）

- **版本：** `v1.0-csv-multiwoz`  
- **权威样例：** `public/multiwoz_samples_10.csv`（10 条对话）  
- **中文对照样例：** `public/multiwoz_samples_10_zh-CN.csv`（同上结构与条数，`utterance`/`services` 中文化，技术列保持英文以便对照）  
- **字段说明：** `docs/CSV_INPUT_FROZEN_V1.md`（与方案文档 §2.2 一致）  
- **兼容：** 表头含 `session_id, turn_index, role, content` 的 legacy CSV（如 `public/sample-sessions.csv`）仍可用于本地冒烟；正式试验以冻结格式为准。

读入后工程内映射：`dialogue_id` → `session_id`（保留 `.json` 后缀）；`turn_num` → `turn_index`；`USER`/`SYSTEM` → `user`/`assistant`；`utterance` → `content`。

## 页面操作顺序（作用域说明）

- **导入 CSV**：一次写入**全部** session 到后端；不会自动为每条跑模型。  
- **下拉框**：之后所有「运行抽取 / 校验并锁版 / 运行动态评测」只针对**当前选中的这一条** session；**不会**批量抽取或批量评测其余 session。  
- **推荐顺序**：设置 API → 导入 CSV → 选 session → **运行抽取**（仅当前条）→ 改表 → 在「动态评测对话」卡片内 **运行动态评测**（将当前表格作为抽取结果提交，可不锁版）→（可选）**校验并锁版** 以便下次复现或离线读取。  
- **换一条**：重新选 session，再对**新选中**的那条从「抽取」或「读取锁版」开始（切换 session 会清空表格、对话区与结果区，避免串数据）。  

首页「操作顺序与作用域」卡片中有动态「下一步建议」。

## 功能

- 上传 **CSV**（冻结 MultiWOZ 列或 legacy 四列）或页面加载内置样例  
- **抽取**：按 Schema 调用 SiliconFlow，得到 `intent_sequence` + `refillables`（MultiWOZ 源可在 transcript 后附加 CSV_AUX 块，**基线 B 不使用该块**）  
- **编辑 / 锁版（可选）**：将表格写入 `data/locked/{session_id}.json` 以便持久化；动态评测也可直接使用当前表格而不必先锁版。  
- **动态评测**：SimUser + 待测 Agent + Judge（三分类），轮次预算 `B_i = ceil(2 * n_i)`  
- **基线 B**：对原始对白 transcript 单次 LLM 结构化打分（与 D 同四维 0–1）  
- **雷达图**：B vs D 四维对比  
- **设置**：API Key / Base URL / Model 可经页面保存到 `data/local.settings.json`（勿提交仓库）

## 环境

复制 `zerore-eval-system-main/.env.example` 中的 SiliconFlow 变量到本目录 `.env.local`，或使用页面「实验设置」保存（会写入 `data/local.settings.json`）。

推荐变量：

- `ZEVAL_JUDGE_BASE_URL=https://api.siliconflow.cn/v1`
- `ZEVAL_JUDGE_MODEL=Qwen/Qwen3.5-27B`
- `ZEVAL_JUDGE_ENABLE_THINKING=false`
- `ZEVAL_JUDGE_API_KEY` 或 `ZEVAL_INTENT_EXPERIMENT_API_KEY`

## 命令

```bash
cd eval-test-v1
npm install
npm run dev
```

详细方案见同目录下 `方案文档/基于意图指针的动态评测效果实验方案.md`。

