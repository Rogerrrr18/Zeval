/**
 * @fileoverview LLM-driven synthesis console (DeepEval Synthesizer 对齐).
 *
 * Lets users describe a scenario + failure modes and have the backend LLM
 * generate evaluation conversations. Results are shown inline and can be
 * persisted as cases.
 */

"use client";

import { useState } from "react";
import { AppShell } from "@/components/shell";
import styles from "./synthesizeConsole.module.css";

type SynthConversation = {
  caseId: string;
  scenarioTag?: string;
  failureMode?: string;
  planCellId?: string;
  evolutionOperators?: string[];
  rarityScore?: number;
  qualityScore?: number;
  qualityNotes?: string[];
  expectedBehavior?: string;
  difficultyHint?: string;
  rawRows: Array<{ role: string; content: string; timestamp?: string; sessionId?: string }>;
};

type SynthesisPlanCell = {
  planCellId: string;
  failureMode: string | null;
  persona: string;
  difficultyHint: string;
  targetCount: number;
  evolutionOperators: string[];
  rarityScore: number;
  expectedBehaviorFocus: string;
};

type SynthesisPlan = {
  strategy: string;
  totalTargetCount: number;
  cells: SynthesisPlanCell[];
  notes: string[];
};

type QualityReport = {
  accepted: number;
  rejected: number;
  diagnostics: Array<{
    caseId: string;
    accepted: boolean;
    score: number;
    reasons: string[];
    planCellId?: string;
  }>;
};

type PersistenceReport = {
  savedCaseIds: string[];
  skipped: Array<{ caseId: string; reason: string; matchedCaseId?: string }>;
};

const PRESETS = [
  {
    label: "ToB 客服 · 升级风险",
    scenarioDescription: "ToB 售后客服 Agent，处理订单退款、升级触发、目标未达成场景",
    targetFailureModes: ["升级触发", "目标未达成", "工具调用错参"],
  },
  {
    label: "RAG 知识库",
    scenarioDescription: "企业知识库 RAG Agent，回答政策类问题",
    targetFailureModes: ["幻觉", "context 不忠实", "答非所问"],
  },
  {
    label: "Agent 工具调用",
    scenarioDescription: "Function-calling Agent，需要正确选择并参数化工具",
    targetFailureModes: ["调错工具", "参数缺失", "无限循环"],
  },
];

const STRATEGY_LABELS: Record<"balanced" | "long_tail" | "regression", string> = {
  long_tail: "长尾优先",
  balanced: "平衡覆盖",
  regression: "回归集",
};

/**
 * Render the synthesize console.
 *
 * @returns The console element.
 */
export function SynthesizeConsole() {
  const [scenarioDescription, setScenarioDescription] = useState(PRESETS[0].scenarioDescription);
  const [failureModesText, setFailureModesText] = useState(PRESETS[0].targetFailureModes.join("、"));
  const [count, setCount] = useState(5);
  const [strategy, setStrategy] = useState<"balanced" | "long_tail" | "regression">("long_tail");
  const [styleHint, setStyleHint] = useState("");
  const [anchorCasesText, setAnchorCasesText] = useState("");
  const [qualityGate, setQualityGate] = useState(true);
  const [persistAsCases, setPersistAsCases] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [results, setResults] = useState<SynthConversation[]>([]);
  const [plan, setPlan] = useState<SynthesisPlan | null>(null);
  const [qualityReport, setQualityReport] = useState<QualityReport | null>(null);
  const [persistence, setPersistence] = useState<PersistenceReport | null>(null);

  const applyPreset = (i: number) => {
    setScenarioDescription(PRESETS[i].scenarioDescription);
    setFailureModesText(PRESETS[i].targetFailureModes.join("、"));
  };

  const submit = async () => {
    setRunning(true);
    setError(null);
    setWarnings([]);
    setResults([]);
    setPlan(null);
    setQualityReport(null);
    setPersistence(null);
    try {
      const targetFailureModes = failureModesText
        .split(/[、,\n]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const anchorCases = anchorCasesText
        .split(/\n---+\n|\n\n+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await fetch("/api/eval-datasets/synthesize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scenarioDescription,
          targetFailureModes,
          count,
          strategy,
          styleHint: styleHint || undefined,
          anchorCases,
          qualityGate,
          persistAsCases,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "合成失败");
      setResults(data.conversations || []);
      setWarnings(data.warnings || []);
      setPlan(data.plan || null);
      setQualityReport(data.qualityReport || null);
      setPersistence(data.persistence || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const acceptedCount = qualityReport?.accepted ?? 0;
  const rejectedCount = qualityReport?.rejected ?? 0;
  const savedCount = persistence?.savedCaseIds.length ?? 0;
  const skippedPersistCount = persistence?.skipped.length ?? 0;
  const plannedCount = plan?.totalTargetCount ?? count;

  return (
    <AppShell>
      <div className={styles.layout}>
        <header className={styles.header}>
          <h1 className={styles.title}>长尾评测集生成器</h1>
          <p className={styles.sub}>
            先规划覆盖桶，再生成对话样本，并通过质量门禁沉淀到回归数据集。
          </p>
        </header>

        <div className={styles.grid}>
          <section className={styles.form}>
            <h2 className={styles.formTitle}>1. 选择预设</h2>
            <div className={styles.presets}>
              {PRESETS.map((p, i) => (
                <button key={i} className={styles.preset} onClick={() => applyPreset(i)}>
                  {p.label}
                </button>
              ))}
            </div>

            <h2 className={styles.formTitle}>2. 场景描述</h2>
            <textarea
              className={styles.textarea}
              rows={3}
              value={scenarioDescription}
              onChange={(e) => setScenarioDescription(e.target.value)}
              placeholder="例如：ToB 客服 Agent，处理升级风险..."
            />

            <h2 className={styles.formTitle}>3. 目标失败模式（用 、 / 逗号 / 换行 分隔）</h2>
            <textarea
              className={styles.textarea}
              rows={2}
              value={failureModesText}
              onChange={(e) => setFailureModesText(e.target.value)}
              placeholder="升级触发、目标未达成"
            />

            <h2 className={styles.formTitle}>4. 合成策略</h2>
            <div className={styles.segmented}>
              <button
                type="button"
                className={strategy === "long_tail" ? styles.segmentActive : styles.segment}
                onClick={() => setStrategy("long_tail")}
              >
                长尾优先
              </button>
              <button
                type="button"
                className={strategy === "balanced" ? styles.segmentActive : styles.segment}
                onClick={() => setStrategy("balanced")}
              >
                平衡覆盖
              </button>
              <button
                type="button"
                className={strategy === "regression" ? styles.segmentActive : styles.segment}
                onClick={() => setStrategy("regression")}
              >
                回归集
              </button>
            </div>

            <div className={styles.row}>
              <label className={styles.field}>
                <span>样本数量（1-50）</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                />
              </label>
              <label className={styles.field}>
                <span>风格提示（可选）</span>
                <input
                  type="text"
                  value={styleHint}
                  onChange={(e) => setStyleHint(e.target.value)}
                  placeholder="如：客户语气强硬、夹杂俚语"
                />
              </label>
            </div>

            <h2 className={styles.formTitle}>5. Anchor case（可选，多个用空行或 --- 分隔）</h2>
            <textarea
              className={styles.textarea}
              rows={4}
              value={anchorCasesText}
              onChange={(e) => setAnchorCasesText(e.target.value)}
              placeholder="粘贴真实 bad case 片段，用于长尾扩增，不会要求模型照抄。"
            />

            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={qualityGate}
                onChange={(e) => setQualityGate(e.target.checked)}
              />
              启用质量门禁：过滤重复、短文本、未命中覆盖计划的样本
            </label>

            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={persistAsCases}
                onChange={(e) => setPersistAsCases(e.target.checked)}
              />
              同时落库到 eval-datasets/cases
            </label>

            <button onClick={submit} disabled={running} className={styles.submit}>
              {running ? "合成中…（约 10-30s）" : "生成长尾样本"}
            </button>

            {error ? <div className={styles.error}>错误：{error}</div> : null}
            {warnings.length > 0 ? (
              <div className={styles.warn}>
                <strong>提示：</strong>
                <ul>{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              </div>
            ) : null}
          </section>

          <section className={styles.results}>
            <div className={styles.resultHeader}>
              <div>
                <h2 className={styles.resultTitle}>合成结果</h2>
                <p>{STRATEGY_LABELS[strategy]} · 计划 {plannedCount} 条 · 返回 {results.length} 条</p>
              </div>
              <span className={running ? styles.statusRunning : styles.statusIdle}>
                {running ? "running" : results.length > 0 ? "ready" : "idle"}
              </span>
            </div>

            <div className={styles.summaryStrip}>
              <div className={styles.summaryItem}>
                <span>覆盖桶</span>
                <strong>{plan?.cells.length ?? "-"}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>门禁通过</span>
                <strong>{qualityReport ? acceptedCount : "-"}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>过滤</span>
                <strong>{qualityReport ? rejectedCount : "-"}</strong>
              </div>
              <div className={styles.summaryItem}>
                <span>落库</span>
                <strong>{persistence ? `${savedCount}/${savedCount + skippedPersistCount}` : "-"}</strong>
              </div>
            </div>

            {plan ? (
              <section className={styles.resultSection}>
                <div className={styles.sectionHead}>
                  <strong>覆盖计划</strong>
                  <span>{plan.strategy} · {plan.totalTargetCount} cells</span>
                </div>
                <div className={styles.planCells}>
                  {plan.cells.slice(0, 8).map((cell) => (
                    <div key={cell.planCellId} className={styles.planCell}>
                      <code>{cell.planCellId}</code>
                      <span>{cell.failureMode ?? "正向对照"}</span>
                      <small>{cell.difficultyHint} · rarity {cell.rarityScore}</small>
                      <small>{cell.evolutionOperators.join(" / ")}</small>
                    </div>
                  ))}
                </div>
                {plan.cells.length > 8 ? <div className={styles.moreHint}>仅展示前 8 个覆盖桶</div> : null}
              </section>
            ) : null}
            {qualityReport ? (
              <section className={styles.resultSection}>
                <div className={styles.sectionHead}>
                  <strong>质量门禁</strong>
                  <span>通过 {qualityReport.accepted} · 过滤 {qualityReport.rejected}</span>
                </div>
                <div className={styles.qualityRows}>
                  {qualityReport.diagnostics.slice(0, 6).map((item) => (
                    <div key={`${item.caseId}-${item.planCellId ?? "none"}`} className={styles.qualityRow}>
                      <code>{item.caseId}</code>
                      <span className={item.accepted ? styles.pass : styles.reject}>
                        {item.accepted ? "pass" : "reject"} {item.score}
                      </span>
                      <small>{item.reasons.join("；")}</small>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {persistence ? (
              <section className={styles.resultSection}>
                <div className={styles.sectionHead}>
                  <strong>落库结果</strong>
                  <span>保存 {persistence.savedCaseIds.length} · 跳过 {persistence.skipped.length}</span>
                </div>
                {persistence.savedCaseIds.length > 0 ? (
                  <small>{persistence.savedCaseIds.join("、")}</small>
                ) : null}
              </section>
            ) : null}
            {results.length === 0 ? (
              <div className={styles.empty}>
                提交左侧表单生成样本。需要 SiliconFlow API Key 配置在服务端
                <code>SILICONFLOW_API_KEY</code>。
              </div>
            ) : (
              <div className={styles.cases}>
                {results.map((c) => (
                  <article key={c.caseId} className={styles.case}>
                    <div className={styles.caseHead}>
                      <code>{c.caseId}</code>
                      {c.failureMode ? <span className={styles.tag}>{c.failureMode}</span> : null}
                      {c.difficultyHint ? <span className={styles.diff}>{c.difficultyHint}</span> : null}
                      {c.planCellId ? <span className={styles.planTag}>{c.planCellId}</span> : null}
                      {typeof c.qualityScore === "number" ? (
                        <span className={styles.score}>quality {c.qualityScore}</span>
                      ) : null}
                    </div>
                    {c.evolutionOperators?.length ? (
                      <div className={styles.metaLine}>演化：{c.evolutionOperators.join(" / ")}</div>
                    ) : null}
                    {c.expectedBehavior ? (
                      <div className={styles.expected}>
                        <strong>期望行为：</strong> {c.expectedBehavior}
                      </div>
                    ) : null}
                    <ol className={styles.turns}>
                      {c.rawRows.map((r, i) => (
                        <li key={i} className={styles[`role_${r.role}`] || styles.role_user}>
                          <span className={styles.roleLabel}>{r.role}</span>
                          <span>{r.content}</span>
                        </li>
                      ))}
                    </ol>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </AppShell>
  );
}
