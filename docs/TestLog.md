# TestLog — 章伟伟三块模块单测与日志方案

更新日期：2026-06-10  
负责人：章伟伟  
关联文档：[zhangweiwei-work-plan.html](./zhangweiwei-work-plan.html) · [admission-pool-strategy.html](./admission-pool-strategy.html)

---

## 0. 实现进度（TDD 推进中）

| 模块 | 状态 | 已实现文件 | 单测 / smoke | 外部依赖 |
|------|------|------------|--------------|----------|
| 二 · ReRank | ✅ 完成 | `rerank.ts` · `runner.ts` | M2-01～06 全过 | Roger 写入 `judgeVariance` 后调 penalty |
| 三 · Policy | ✅ 完成 | learner/scorer/extractor/store/holdout · API · `admit-cases` 打通 | M3-01～10 全过 · `smoke:admission-policy` | Roger 方差写入后调 uncertainty |
| 一 · Rubric | ✅ 完成 | `rubric-judge.ts` · `transcript-benchmark.ts` · `companion-transcript-judge.ts` · `generic-run.ts` | M1-01～06 · M1-E2E 全过 · `smoke:benchmark-rubric` | 线上 LLM judge 需单独验收 |

**运行命令（已启用）：**

```powershell
npm run test:benchmark
npm run test:benchmark:log
npm run smoke:benchmark-rubric
npm run smoke:admission-policy
npm run smoke:benchmark-fullflow
```

**环境与约定：**

1. 跑数门禁默认 ≥3 指标（`ZEVAL_BENCHMARK_MIN_METRICS`）；生成侧建议 ≥6（`RECOMMENDED_APPROVED_METRICS`）。
2. transcript 模式：`ZEVAL_BENCHMARK_EVAL_MODE=transcript`；全量 20 session：`ZEVAL_BENCHMARK_MAX_CASES=20`。
3. `judgeVariance` 字段已预留，待 Roger 三模型评测器写入后再调 ReRank/Policy penalty。

---

## 1. 背景与目标

Roger 的「评测结果两级标签 UI」尚未接入前，以下三块需通过**单测 + 结构化日志**验证有效性，不依赖浏览器手工点选：

| 模块 | 核心问题 | 无 UI 时如何证明有效 |
|------|----------|----------------------|
| 一 · Rubric 评分表单 | 是否产出多档分、是否阻塞虚高 | 纯函数 + mock judge 输出 |
| 二 · ReRank | good case 是否有高低 tier | 固定 metric 向量 → 断言 Q 分与百分位 |
| 三 · Policy 引擎 | 标定能否学成规则、新样本判定是否正确 | mock 100 条标定 → 生成 policy → 对 holdout 断言 |

---

## 2. 测试技术选型

项目当前无 `vitest` / `jest`，已有惯例为 `node --import tsx scripts/smoke-*.mts`。

**推荐（MVP）：**

- 框架：Node 内置 [`node:test`](https://nodejs.org/api/test.html) + `node:assert`
- 运行：`node --import tsx --test src/benchmark/**/*.test.ts`
- 与现有 smoke 脚本并存；后续可再统一迁 vitest

**已在 `package.json` 启用：**

```json
"test:benchmark": "node --import tsx --test src/benchmark/rerank.test.ts ...",
"test:benchmark:log": "node --import tsx scripts/run-benchmark-tests-with-log.mts"
```

`run-benchmark-tests-with-log.mts`：逐文件跑 `node:test`，写入 `.zeval-db/test-logs/module-*` 与 `summary/`。

---

## 3. 目录规划

```text
src/benchmark/
  __fixtures__/                    # 测试夹具
    rubric-companion-min.json      # ✅ 6 指标 companion rubric
    metric-results-mock.json       # ✅ 8 session × 6 指标（smoke 生成）
    human-labels-mock-100.json     # ✅ 100 条人工标定
    policy-golden-v1.json          # ✅ policy 回归快照
  evaluators.test.ts
  rerank.test.ts
  admission-feature-extractor.test.ts
  admission-policy-learner.test.ts
  admission-scorer.test.ts

.zeval-db/test-logs/
  module1-rubric/
  module2-rerank/
  module3-policy/
  summary/                         # 每次全量跑的汇总 JSON
```

---

## 4. 模块一：Rubric / 评测器单测

### 4.1 被测函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `evaluateExactMatch` | `evaluators.ts` | 空 expected 须 `blocked` |
| `evaluateLlmJudge` | `evaluators.ts` | mock judge 返回多档分 |
| `normalizeScore` | `evaluators.ts` | 0–5 → 0–100%，保留档位 |
| `validateRubricMetricCount` | 新建或 `rubric-review.ts` | 指标数 < 6 警告/拒绝 |

### 4.2 用例清单

| ID | 用例名 | 输入 | 期望 |
|----|--------|------|------|
| M1-01 | exact_match 双空阻塞 | expected=undefined, actual=undefined | `status: blocked`，score≠max |
| M1-02 | exact_match 正常匹配 | expected="A", actual="A" | score=max |
| M1-03 | llm_judge 多档分 | mock 返回 score=3 | normalizedScore=60（scale 1–5） |
| M1-04 | llm_judge 禁止默认满分 | mock 返回 score=5 但 evidence 空 | 可配置降级或 blocked |
| M1-05 | rubric 指标数门禁 | approvedMetrics.length=2 | 抛出；length=3 通过 |
| M1-06 | 分数分布非退化 | fixture 8 cases 混合分 | `stdDev(normalizedScore) > 5` |

### 4.3 Mock LLM Judge 约定

```typescript
const mockJudge: BenchmarkLlmJudge = async ({ metric }) => ({
  score: 3,
  reason: "mock",
  evidence: ["excerpt-1"],
  confidence: 0.72,
});
```

真实 LLM 不进单测；集成验证走 `npm run smoke:benchmark-rubric`（companion CSV + 启发式 transcript judge）。

### 4.4 日志记录字段（module1）

```json
{
  "module": "rubric",
  "runId": "test_20260610_001",
  "timestamp": "2026-06-10T10:00:00+08:00",
  "cases": [
    { "id": "M1-01", "pass": true, "detail": "blocked as expected" }
  ],
  "summary": { "total": 6, "passed": 6, "failed": 0 },
  "metrics": {
    "scoreStdDev": 18.4,
    "blockedCount": 2,
    "uniqueScores": [1, 3, 5]
  }
}
```

---

## 5. 模块二：ReRank 单测

### 5.1 被测函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `computeQualityScore` | `rerank.ts` | Q 分公式 |
| `assignQualityTiers` | `rerank.ts` | gold/silver/borderline |
| `rankCasesByMetric` | `rerank.ts` | 单指标纵向排序 |
| `computeQualityPercentile` | `rerank.ts` | run 内百分位 |

### 5.2 Q 分公式（与 work-plan 一致）

```text
Q = Σ ( w_cap · w_metric · norm(score) · confidence )
    − λ₁ · judgeVariancePenalty
    − λ₂ · metricDisagreementPenalty
```

默认：`λ₁ = 0.15`，`λ₂ = 0.10`；`judgeVariance > 0.35` 时 penalty=1。

### 5.3 Tier 切分标准

在**同一 run 的 passed cases** 内按 Q 分降序：

| tier | 百分位区间 | 会议口径 |
|------|------------|----------|
| `gold` | [0, 25%) | top good case |
| `silver` | [25%, 70%) | 中等 |
| `borderline` | [70%, 100%] | 边缘，建议人工 |

边界：`rankInRun / N < 0.25` → gold（含并列时按 submissionId 稳定排序）。

### 5.4 用例清单

| ID | 用例名 | 输入 | 期望 |
|----|--------|------|------|
| M2-01 | Q 分单调性 | case A 全高分 / case B 全低分 | Q(A) > Q(B) |
| M2-02 | 方差 penalty | 同均分，A 方差 0.1 / B 方差 0.5 | Q(A) > Q(B) |
| M2-03 | tier 三段 | 8 passed cases 已知 Q | 2 gold / 3 silver / 3 borderline（N=8 时约 2/3/3） |
| M2-04 | top 25% 为 gold | N=20 | gold 数量 = 5 |
| M2-05 | 单指标排序 | rankByMetric("task_success") | 顺序与 task_success 分一致 |
| M2-06 | 全同分退化 | 所有 Q 相同 | 全部 borderline 或按 submissionId 均匀切 tier（需明确策略并单测锁定） |

### 5.5 日志记录字段（module2）

```json
{
  "module": "rerank",
  "runId": "test_20260610_002",
  "inputCaseCount": 8,
  "passedCount": 8,
  "qScore": { "min": 0.42, "max": 0.91, "mean": 0.68, "stdDev": 0.14 },
  "tierCounts": { "gold": 2, "silver": 3, "borderline": 3 },
  "cases": [
    {
      "caseId": "case_001",
      "qualityScore": 0.91,
      "qualityTier": "gold",
      "rankInRun": 1,
      "metricVector": { "task_success": 0.8, "empathy": 1.0 }
    }
  ]
}
```

---

## 6. 模块三：Policy 生成与判定单测

### 6.1 被测函数

| 函数 | 文件 | 说明 |
|------|------|------|
| `extractAdmissionFeatures` | `admission-feature-extractor.ts` | session×channel 特征 |
| `learnAdmissionPolicy` | `admission-policy-learner.ts` | 标定 → Policy JSON |
| `scoreAdmission` | `admission-scorer.ts` | 特征 + policy → 判定 |
| `percentile` / `median` | `admission-policy-learner.ts` | 统计工具函数 |

### 6.2 生成引擎标准（PolicyLearner）

**输入：** `LabelRow[]`（≥100 条，覆盖至少 3 个 channel）

**每条 LabelRow：**

```typescript
{
  sessionId: string;
  channel: string;           // ch_task_completion 等
  metricKey: string;
  decision: "accepted" | "rejected" | "needs_evidence";
  autoScore: number;         // 0–5
  confidence: number;        // 0–1
  qualityScore?: number;     // reRank 后 0–1
  qualityTier?: string;
  autoPassed: boolean;       // 评测器原始 pass
}
```

**分组：**

- `acceptSet` = decision === `accepted`
- `rejectSet` = decision === `rejected`
- `needs_evidence` 不参与 accept/reject 规则拟合

**拟合（每 channel，样本不足 8 则仅产出 uncertainty 规则）：**

```text
scoreGte      = P20(acceptSet.autoScore)
scoreLte      = P80(rejectSet.autoScore)
confidenceGte = median(acceptSet.confidence)
qualityPctGte = P30(acceptSet.qualityScore)   // 若有

uncertaintyRules:
  - scoreBetween: [scoreLte, scoreGte]  当 scoreLte < scoreGte
  - confidenceLt: confidenceGte
  - judgeVarianceGt: 0.35

agreementRate = count(humanPassed === autoPassed) / N
sampleRateForHuman = clamp(1 - agreementRate, 0.10, 0.50)
```

**输出：** `AdmissionPolicy`（含 `policyId`、`generatedAt`、`labelCount`、`channels`、`stats`）

### 6.3 判定引擎标准（AdmissionScorer）

**决策优先级（固定，单测必须覆盖）：**

```text
1. 若 ∃ rejectRule 命中 → { decision: "reject", source: null }
2. 否则若 ∀ acceptRule 命中 → { decision: "accept", source: "auto_tn"|goodcase }
3. 否则若 ∃ uncertaintyRule 命中 → { decision: "human", source: "auto_uncertainty" }
4. 否则 → { decision: "human" }   // 默认兜底
```

**规则命中定义：**

| 规则 | 条件 |
|------|------|
| `scoreGte` | `feature.autoScore >= rule.scoreGte` |
| `scoreLte` | `feature.autoScore <= rule.scoreLte` |
| `confidenceGte` | `feature.confidence >= rule.confidenceGte` |
| `confidenceLt` | `feature.confidence < rule.confidenceLt` |
| `qualityPercentileGte` | `feature.qualityPercentile >= rule.qualityPercentileGte` |
| `scoreBetween` | `rule.low <= feature.autoScore <= rule.high` |
| `judgeVarianceGt` | `feature.judgeVariance > rule.judgeVarianceGt` |

**acceptRules 之间为 AND**；rejectRules / uncertaintyRules 之间为 OR。

### 6.4 用例清单

| ID | 用例名 | 输入 | 期望 |
|----|--------|------|------|
| M3-01 | 分位数计算 | [1,2,3,4,5] P20/P80 | 可对照手算或 golden 值 |
| M3-02 | 100 标定生成 policy | `human-labels-mock-100.json` | 每 channel 有 acceptRules；`labelCount=100` |
| M3-03 | 生成可复现 | 同输入跑两次 | policy 除 `generatedAt` 外一致 |
| M3-04 | reject 优先 | 同时命中 accept+reject 规则 | `decision=reject` |
| M3-05 | accept 全满足 | 高分高置信 | `decision=accept` |
| M3-06 | 灰区进 human | score 在 scoreBetween 内 | `decision=human` |
| M3-07 | 低置信进 human | confidence < confidenceGte | `decision=human` |
| M3-08 | 无规则覆盖 | 特征极端但无匹配 | `decision=human`（兜底） |
| M3-09 | holdout 一致率 | 100 标定 80/20 划分 | holdout 上 agreement ≥ 70% |
| M3-10 | sampleRate 计算 | agreementRate=0.81 | sampleRateForHuman≈0.19 |

### 6.5 Mock 100 条标定生成建议

用脚本从 `metric-results-mock.json` 派生，保证：

- 3 个 channel 各 ≥ 25 条 accept、≥ 10 条 reject
- `autoScore` 在 accept/reject 组有可分离分布（accept 均值 > reject 均值）
- 固定 `seed=42` 可复现

存放：`src/benchmark/__fixtures__/human-labels-mock-100.json`

### 6.6 日志记录字段（module3）

**生成阶段：**

```json
{
  "module": "policy-learn",
  "runId": "test_20260610_003",
  "labelCount": 100,
  "channels": {
    "ch_task_completion": {
      "acceptN": 42,
      "rejectN": 18,
      "fitted": {
        "scoreGte": 3.2,
        "scoreLte": 2.1,
        "confidenceGte": 0.68,
        "agreementRate": 0.79,
        "sampleRateForHuman": 0.21
      }
    }
  },
  "policyPath": ".zeval-db/admission-policies/default.json",
  "policyVersion": "admission-policy-v1"
}
```

**判定阶段（逐条）：**

```json
{
  "module": "policy-score",
  "runId": "test_20260610_003",
  "policyVersion": "admission-policy-v1",
  "samples": [
    {
      "sessionId": "companion_pos_001",
      "channel": "ch_task_completion",
      "features": { "autoScore": 4.2, "confidence": 0.8, "qualityPercentile": 0.72 },
      "matchedRules": ["scoreGte", "confidenceGte"],
      "decision": "accept",
      "expected": "accept",
      "pass": true
    }
  ],
  "summary": { "total": 20, "accept": 12, "reject": 3, "human": 5, "accuracy": 0.85 }
}
```

---

## 7. 日志规范

### 7.1 路径与命名

```text
.zeval-db/test-logs/{module}/{YYYYMMDD}-{HHmmss}-{shortRunId}.json
.zeval-db/test-logs/summary/{YYYYMMDD}-benchmark-modules.json
```

示例：

```text
.zeval-db/test-logs/module3-policy/20260610-143022-m3hold.json
```

### 7.2 汇总文件（每次全量跑追加一条）

```json
{
  "timestamp": "2026-06-10T14:30:22+08:00",
  "gitSha": "abc1234",
  "modules": {
    "rubric": { "passed": 6, "failed": 0, "log": "module1-rubric/20260610-143020-m1.json" },
    "rerank": { "passed": 6, "failed": 0, "log": "module2-rerank/20260610-143021-m2.json" },
    "policy": { "passed": 10, "failed": 0, "log": "module3-policy/20260610-143022-m3.json" }
  },
  "overallPass": true
}
```

### 7.3 与 TestLog.md 的运行记录（人工追加）

每次本地验证通过后，在本文档 **§9 运行记录** 追加一行，便于与 Roger 对齐、会议复盘。

---

## 8. 运行方式

### 8.1 仅跑单测（实现后）

```powershell
cd d:\AI_project\Zeval_2.0
npm run test:benchmark
```

### 8.2 单测 + 写日志（实现 wrapper 后）

```powershell
npm run test:benchmark:log
```

### 8.3 模块三快速手测（实现 learner 后，无需 UI）

```powershell
npm run smoke:admission-policy
```

脚本已实现：读取 mock 标定 → learn → 写入 `.zeval-db/admission-policies/smoke-default.json` → holdout 一致率摘要。

---

## 9. 运行记录

| 日期 | 执行人 | 范围 | 结果 | 日志路径 | 备注 |
|------|--------|------|------|----------|------|
| 2026-06-10 | 章伟伟 | 模块一～三单测 | **19/19 通过** | `.zeval-db/test-logs/summary/20260610-benchmark-modules.json` | TDD 首轮：rerank + policy + evaluators 阻塞 |
| 2026-06-10 | 章伟伟 | 模块一+三推进 | **24/24 通过** | `.zeval-db/test-logs/summary/20260610-benchmark-modules.json` | 默认门禁 3；M1-04/06；policy API/store/holdout；transcript 模式 |
| 2026-06-10 | 章伟伟 | 三块收尾 | **27/27 通过** + 2 smoke | `.zeval-db/test-logs/summary/20260610-benchmark-modules.json` | companion E2E pos 98.5 vs neg 25；admit-cases policy；fixtures 补齐 |
| 2026-06-10 | 章伟伟 | 真实 API 全流程 | **pass** | `.zeval-db/test-logs/fullflow-real-api/20260610-092229-fullflow-real-api.json` | 4×3 真实 judge；policy store；autofind cache；见 `v2.2-merge-changelog.md` |

---

## 10. 验收门槛（无 UI 版）

三块同时满足方可进入与 Roger UI 联调：

| 模块 | 门槛 |
|------|------|
| 一 | 全部 M1-xx + M1-E2E 通过；`uniqueScores` 含 1/3/5；pos 均分 − neg 均分 ≥ 15% |
| 二 | 全部 M2-xx 通过；Q 分 stdDev > 0.1；gold 占比 ≈ 25%（±1 case） |
| 三 | 全部 M3-xx 通过；holdout agreement ≥ 70%；reject 优先级用例 M3-04 必须通过 |

---

## 11. 后续：UI 接入后的补充测试

| 项 | 方式 |
|----|------|
| 人工标定写入 | Roger UI 操作 → 对比 `humanReviewRecords` 与 mock schema |
| Policy 生成按钮 | E2E 或 API 测试 `POST /api/benchmarks/admission-policy/generate` |
| 端到端 | `companion-autofind-20sessions.csv` 全链路跑一轮 + 抽样 10 条人工核对 |

UI 就绪前，**以本章单测 + 日志为唯一验收依据**。
