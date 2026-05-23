# ChangeLog

本文档用于持续记录项目变更日志。

---

## 2026-04-21

### 新增

- `src/eval-datasets/case-transcript-hash.ts`：topic 片段文本标准化 + `SHA-256` 生成 `normalizedTranscriptHash`。
- `src/eval-datasets/sample-batch.ts`：goodcase/badcase 分层随机抽样（可选 `seed`、批内按 transcript 哈希去重），不足量时写入 `warnings`。
- 最小 `eval-datasets` HTTP 层：
  - `GET/POST /api/eval-datasets/cases`
  - `GET /api/eval-datasets/cases/[caseId]`
  - `POST /api/eval-datasets/sample-batches`
  - `GET /api/eval-datasets/sample-batches/[sampleBatchId]`
- `src/schemas/eval-datasets.ts`：上述接口的 Zod 校验。
- `DatasetStore` 扩展：`getBaseline`、`getSampleBatch`；`FileSystemDatasetStore.createCase` 同步追加 `indexes/cases.csv`。
- `SampleBatchRecord` 扩展可选字段：`actualGoodcaseCount`、`actualBadcaseCount`、`warnings`。
- 工作台基线与在线评测联动：
  - `POST/GET /api/workbench-baselines/*` 将首页评估结果与 `rawRows` 写入 `mock-chatlog/baselines/`。
  - `POST /api/online-eval/replay`：HTTP 回放 assistant → 全量再评估，并返回基线对照载荷。
  - 首页 hero 增加「在线评测」入口；结果区支持「保存工作台基线」。
  - 新页面 `/online-eval`：基线选择、回复 API 基址、默认通道、多图对比与全量图表。
- 评估流水线抽取为 `src/pipeline/evaluateRun.ts` 供 `/api/evaluate` 与在线回放复用。
- `mock-chatlog/raw-data` 增补多份短对话 CSV 样例；临时抽样默认 good/bad 各 10（合计约 20，不足亦放行）。

## 2026-04-15

### 新增

- 完成 `Next.js + TypeScript` 项目初始化，并打通 `POST /api/ingest` 与 `POST /api/evaluate` 两条主链路。
- 新增四种格式 `CSV / JSON / TXT / MD` 的原始 chatlog 解析能力。
- 新增 `Raw -> Enriched -> ChartPayload` 三层数据链路。
- 新增 `SiliconFlow + Qwen/Qwen3.5-27B` 的 LLM 接入能力。
- 新增 `topic segment` 切分能力，采用“规则优先 + 长间隔 LLM 兜底”的混合方案。
- 新增 `segment` 级结构化情绪评分能力，采用“LLM 基准分 + 本地评分函数修正”的两段式设计。
- 新增隐式推断信号层，当前支持：
  - `interestDeclineRisk`
  - `understandingBarrierRisk`
  - `emotionRecoveryFailureRisk`
- 新增前端评估控制台，支持：
  - 文件上传
  - 标准化预览
  - 执行状态展示
  - 摘要卡片
  - 图表展示
  - 建议展示
  - 结果导出
- 新增 LLM 分阶段日志，支持在服务端日志中观察以下调用阶段：
  - `topic_continuity_review`
  - `segment_emotion_baseline`
  - `subjective_dimension_judge`
- 新增根目录 `DESIGN.md`，用于约束后续 UI 风格基线。
- 新增根目录 `\.env.example`，用于 GitHub 上传与环境变量模板说明。
- 新增根目录 `项目方案说明（PM版）.md`，用于 PM 侧完整理解项目方案。
- 新增根目录 `指标变量表.csv`，用于统一沉淀指标变量、中文名、含义、计算方法与关联指标。
- 新增 `eval-system-概述/1-评测集构建.md`，用于定义评测集构建、baseline、跑分方案与 success 指标。
- 新增 `eval-datasets/` 目录骨架，作为第一阶段文件系统版评测集存储结构。
- 新增评测集存储抽象层：
  - `src/eval-datasets/storage/dataset-store.ts`
  - `src/eval-datasets/storage/file-system-dataset-store.ts`
  - `src/eval-datasets/storage/types.ts`
  - `src/eval-datasets/storage/index.ts`
- 新增 `mock-customer-api/` 示例目录，提供：
  - 固定规则回包 API 示例
  - 直接调用 `SiliconFlow` 的客户侧 API 示例

### 变更

- 将主观评估能力从“简单 LLM 打分”升级为更稳定的结构化方案：
  - topic 先切段
  - segment 先评情绪
  - session 再评主观维度
- 将情绪分升级为 `0-100` 分制并保留 `1` 位小数。
- 调整 downstream 模块以适配新情绪口径，包括：
  - 信号层
  - 主观指标层
  - 图表层
  - 摘要层
  - 建议层
- 重构前端 UI，改为更偏“开发工具控制台”的暗色响应式工作台风格。
- 更新全局页面元信息、字体和暗色模式基线。
- 将环境变量读取逻辑改为：
  - 优先读取 `process.env`
  - 若缺失则回退读取根目录 `\.env.example`
- 将 `\.gitignore` 改为允许提交 `\.env.example`，继续忽略真实环境变量文件。
- 在评测集需求中补充：
  - 重复过滤机制
  - 目录结构设计
  - 热插拔存储设计
  - 临时评测集抽样方案
  - 客户 API 接入方案

### 修复

- 修复前端图表容器在 `Recharts ResponsiveContainer` 下出现的宽高为 `-1` 的问题：
  - 为容器补充显式高度
  - 增加 `minWidth` / `minHeight`
  - 修正图表卡片收缩行为
- 去掉页面底部多余的说明性文案。
- 去除未必要的字体预加载，减少控制台 `preload but not used` 警告。
- 修正 `\.env.example` 被 `\.gitignore` 中 `.env*` 误忽略的问题。

### 文档

- 更新 `README.md`，补齐当前实现进度、指标白名单、计算方法与公式说明。
- 更新 `执行规划.md`，同步当前阶段完成情况、模块分层与验收结论。
- 补充 PM 版项目说明文档，将核心英文指标补为“英文名（中文名）”。
- 新增 CSV 变量表，便于 PM / 运营 / 分析同学查阅。
- 新增评测集构建专项文档，明确：
  - topic 片段评分机制
  - `goodcase / badcase` 入库规则
  - baseline 方案
  - 前缀回放评测方案
  - success 指标定义

### 验证

- 已通过：
  - `npm run lint`
  - `npm run build`
- 已验证 LLM 在真实链路中的实际可用性：
  - `segment_emotion_baseline` 可正常调用
  - `subjective_dimension_judge` 可正常调用
- 已验证两个 `mock-customer-api` 示例脚本语法正确，可用于后续联调。
