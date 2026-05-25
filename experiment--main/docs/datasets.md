# 开源多轮客服对话数据集汇总

> 整理时间：2026年5月13日 | 筛选标准：≥5轮/会话，客服/任务导向领域

---

## 1. MultiWOZ 2.2

| 项目 | 详情 |
|------|------|
| **全称** | Multi-Domain Wizard-of-Oz |
| **语言** | 英语 |
| **领域** | 多领域任务型对话（景点/酒店/餐厅/交通/医院/警察/银行等） |
| **统计数据** | 约 **10,438** 个对话，总计约 **143,048** 轮 |
| **平均轮次** | **~13.7 轮/会话** |
| **下载地址** | https://github.com/budzianowski/multiwoz |
| **直接下载** | https://github.com/budzianowski/multiwoz/tree/master/data/MultiWOZ_2.2 |
| **文件大小** | 约 50MB（含标注） |
| **许可证** | MIT License |
| **下载方式** | Git clone 或直接下载 ZIP |

**特点：** 最广泛使用的多领域任务型对话基准数据集。包含对话状态跟踪（DST）的完整标注（belief state、系统动作、用户动作）。v2.2 修正了大量标注错误。

---

## 2. Taskmaster-1 / Taskmaster-2 / Taskmaster-3

| 项目 | 详情 |
|------|------|
| **全称** | Google Taskmaster |
| **语言** | 英语 |
| **领域** | 客服/任务型（订餐、电影票、航班、酒店、体育、购物等） |
| **统计数据** | TM-1: ~13,215 对话；TM-2: ~17,289 对话；TM-3: ~23,757 对话；**合计约 55,000** 对话 |
| **平均轮次** | TM-1: ~5-6轮；TM-2: ~7-8轮；TM-3: ~6-7轮 |
| **下载地址** | https://github.com/google-research-datasets/Taskmaster |
| **直接下载** | https://github.com/google-research-datasets/Taskmaster/tree/master/TM-1-2020 |
| **文件大小** | 全部约 200MB（JSON 格式） |
| **许可证** | CC BY 4.0 |
| **下载方式** | Git clone / wget |

**特点：** 采用两种采集方式——TM-1 为两人对话模拟（wizard-of-oz），TM-2 为单人自对话（self-dialogue）。覆盖 7 个领域。

---

## 3. Schema-Guided Dialogue (SGD)

| 项目 | 详情 |
|------|------|
| **全称** | Google Schema-Guided Dialogue |
| **语言** | 英语 |
| **领域** | 多领域（26个服务：银行、航班、酒店、餐厅、电影等） |
| **统计数据** | 训练集 ~16,142、验证 ~2,482、测试 ~4,201，总计约 **22,825** 对话 |
| **平均轮次** | **~20 轮/会话**（最长可达 40+ 轮） |
| **下载地址** | https://github.com/google-research-datasets/dstc8-schema-guided-dialogue |
| **直接下载** | https://github.com/google-research-datasets/dstc8-schema-guided-dialogue |
| **文件大小** | 约 500MB（含完整 schema） |
| **许可证** | CC BY-SA 4.0 |
| **下载方式** | Git clone / 官方提供 train/dev/test 三个 JSON 文件 |

**特点：** 26 个服务，每个服务有独立的 schema 定义（intent、slot）。零样本迁移学习的核心基准。服务大多模拟客服场景。

---

## 4. JDDC（京东对话语料库）

| 项目 | 详情 |
|------|------|
| **全称** | JD Dialogue Corpus |
| **语言** | 中文 |
| **领域** | 电商客服（商品咨询、售后、物流、价格等） |
| **统计数据** | 约 **102万+** 对话（v2.0 公开版约 40 万高质量对话） |
| **平均轮次** | **~15-20 轮/会话** |
| **下载地址** | https://github.com/jd-aig/JDDC |
| **直接下载** | https://jddc.jd.com/ （需注册） |
| **文件大小** | 约 2GB+ |
| **许可证** | 仅限学术研究（非商用） |
| **下载方式** | GitHub 提交申请或官网注册下载 |

**特点：** 最大的中文任务型对话数据集之一。来源为真实京东客服聊天记录（已脱敏）。支持对话生成、意图识别、情感分析等任务。

---

## 5. CCPE（Coached Conversational Preference Elicitation）

| 项目 | 详情 |
|------|------|
| **全称** | Coached Conversational Preference Elicitation |
| **语言** | 英语 |
| **领域** | 客服推荐（电影推荐偏好引导） |
| **统计数据** | 约 **502** 对话，总计约 **12,000** 轮 |
| **平均轮次** | **~23.9 轮/会话** |
| **下载地址** | https://github.com/google-research-datasets/ccpe |
| **直接下载** | https://github.com/google-research-datasets/ccpe |
| **文件大小** | 约 15MB |
| **许可证** | CC BY 4.0 |
| **下载方式** | Git clone |

**特点：** 聚焦于客服推荐场景中的偏好引导（preference elicitation）。对话中客服（coach）引导用户发现并提出偏好。高质量人工标注。

---

## 6. MultiDoGO

| 项目 | 详情 |
|------|------|
| **全称** | Multi-Domain Goal-Oriented Dialogues |
| **语言** | 英语 |
| **领域** | 客服（航班预订、酒店预订、餐饮、社交聊天等 6 领域） |
| **统计数据** | 约 **68,975** 对话（含单领域 ~54,000 + 多领域 ~15,000） |
| **平均轮次** | **~7-10 轮/会话**（多领域对话更长） |
| **下载地址** | https://github.com/awslabs/multi-dogo |
| **直接下载** | https://github.com/awslabs/multi-dogo（data/ 目录） |
| **文件大小** | 约 300MB |
| **许可证** | CC BY-NC-SA 4.0 |
| **下载方式** | Git clone / AWS S3 直链 |

**特点：** AWS 发布的大规模目标导向对话数据集。覆盖单领域和多领域客服场景。使用众包方式采集，标注了完整对话结构。

---

## 7. ABCD（Action-Based Conversations Dataset）

| 项目 | 详情 |
|------|------|
| **全称** | Action-Based Conversations Dataset |
| **语言** | 英语 |
| **领域** | 客服代理（多任务客服模拟：查询、退款、预订等 30+ 意图） |
| **统计数据** | 约 **10,042** 对话（含 ~8,034 训练 + ~1,004 验证 + ~1,004 测试） |
| **平均轮次** | **~17-22 轮/会话** |
| **下载地址** | https://github.com/asappresearch/abcd |
| **直接下载** | https://github.com/asappresearch/abcd |
| **文件大小** | 约 200MB |
| **许可证** | CC BY-NC 4.0 |
| **下载方式** | Git clone |

**特点：** 模拟客服中心场景（customer service），每个对话伴随一系列 API action。对话较长（平均 17+ 轮），包含 agent 查询知识库、更新订单、退款等实际操作。

---

## 8. KdConv（中文多领域知识驱动对话）

| 项目 | 详情 |
|------|------|
| **全称** | Knowledge-driven Conversation |
| **语言** | 中文 |
| **领域** | 客服/咨询（电影、音乐、旅游 3 领域） |
| **统计数据** | 约 **4,500** 对话，总计约 **86,000** 轮 |
| **平均轮次** | **~19 轮/会话** |
| **下载地址** | https://github.com/thu-coai/KdConv |
| **直接下载** | https://github.com/thu-coai/KdConv |
| **文件大小** | 约 80MB |
| **许可证** | Apache 2.0 |
| **下载方式** | Git clone |

**特点：** 清华大学发布的中文知识驱动多轮对话数据集。每个对话基于一个知识图谱三元组展开，对话围绕知识条目进行深入讨论，类似于知识客服场景。

---

## 综合对比一览

| 数据集 | 语言 | 对话数 | 平均轮次 | 领域 | 许可证 | 大小 |
|--------|------|--------|----------|------|--------|------|
| **MultiWOZ 2.2** | EN | 10,438 | ~13.7 | 多领域 | MIT | ~50MB |
| **Taskmaster** | EN | 55,261 | ~6-8 | 多领域 | CC BY 4.0 | ~200MB |
| **SGD** | EN | 22,825 | ~20 | 26 服务 | CC BY-SA 4.0 | ~500MB |
| **JDDC** | ZH | 40万+ | ~15-20 | 电商客服 | 学术 | ~2GB |
| **CCPE** | EN | 502 | ~23.9 | 电影推荐 | CC BY 4.0 | ~15MB |
| **MultiDoGO** | EN | 68,975 | ~7-10 | 6 领域 | CC BY-NC-SA | ~300MB |
| **ABCD** | EN | 10,042 | ~17-22 | 客服中心 | CC BY-NC 4.0 | ~200MB |
| **KdConv** | ZH | 4,500 | ~19 | 知识咨询 | Apache 2.0 | ~80MB |

---

## 推荐优先级（客服微调场景）

1. **MultiWOZ 2.2** - 最经典，生态最完善，工具链多
2. **SGD** - 轮次长，领域广，零样本迁移研究
3. **ABCD** - 最接近真实客服中心场景
4. **JDDC** - 中文电商客服首选
5. **Taskmaster** - 数据量大，易于获取
