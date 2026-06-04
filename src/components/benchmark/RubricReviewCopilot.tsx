/**
 * @fileoverview Rubric Review Copilot panel.
 *
 * Two modes:
 * 1. suggest_first — streams AI suggestions from /api/benchmarks/rubric-review
 * 2. walkthrough  — client-side metric-by-metric review (no backend call)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { BenchmarkRubricMetric, BenchmarkRubricSet } from "@/benchmark/types";
import styles from "./benchmarkConsole.module.css";

type ReviewEvent =
  | { type: "review_started"; message: string }
  | { type: "suggestion"; message: string; metricKey?: string; field?: string; oldValue?: unknown; newValue?: unknown }
  | { type: "metric_review"; metricKey: string; message: string; metric: BenchmarkRubricMetric }
  | { type: "awaiting_input"; message: string }
  | { type: "review_complete"; message: string }
  | { type: "error"; message: string }
  | { type: "done" };

type ReviewTurn =
  | { kind: "copilot"; text: string; metricKey?: string }
  | { kind: "user"; text: string };

export function RubricReviewCopilot(props: {
  rubric: BenchmarkRubricSet;
  requirementText: string;
  onHighlightMetric: (metricKey: string | null) => void;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<ReviewTurn[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [mode, setMode] = useState<"suggest_first" | "walkthrough">("suggest_first");
  const [walkthroughIdx, setWalkthroughIdx] = useState(0);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const allMetrics = props.rubric.modules.flatMap((m) => m.metrics);

  // Auto-scroll
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, running]);

  const startSuggestFirst = useCallback(() => {
    setRunning(true);
    setTurns([]);
    setCompleted(false);

    const source = new EventSource("/api/benchmarks/rubric-review", {
      method: "POST",
      body: JSON.stringify({
        rubric: props.rubric,
        requirementText: props.requirementText,
        reviewMode: "suggest_first",
      }),
    } as EventSourceInit);

    source.onmessage = (event) => {
      const data = JSON.parse(event.data) as ReviewEvent;
      if (data.type === "done") {
        setRunning(false);
        setCompleted(true);
        source.close();
        return;
      }

      if (data.type === "review_started") {
        setTurns((prev) => [...prev, { kind: "copilot", text: data.message }]);
      } else if (data.type === "suggestion") {
        setTurns((prev) => [
          ...prev,
          { kind: "copilot", text: data.message, metricKey: data.metricKey },
        ]);
        if (data.metricKey) {
          props.onHighlightMetric(data.metricKey);
        }
      } else if (data.type === "review_complete") {
        setTurns((prev) => [...prev, { kind: "copilot", text: data.message }]);
        setRunning(false);
        setCompleted(true);
      } else if (data.type === "error") {
        setTurns((prev) => [...prev, { kind: "copilot", text: `❌ ${data.message}` }]);
        setRunning(false);
      }
    };

    source.onerror = () => {
      setRunning(false);
      source.close();
    };
  }, [props.rubric, props.requirementText, props.onHighlightMetric]);

  const startWalkthrough = useCallback(() => {
    setRunning(false);
    setTurns([]);
    setCompleted(false);
    setWalkthroughIdx(0);
    presentWalkthroughMetric(0);
  }, []);

  function presentWalkthroughMetric(idx: number) {
    if (idx >= allMetrics.length) {
      setTurns((prev) => [
        ...prev,
        { kind: "copilot", text: "✅ 所有指标校验完成。请确认最终 rubric 后运行评测。" },
      ]);
      setCompleted(true);
      props.onHighlightMetric(null);
      return;
    }
    const metric = allMetrics[idx];
    if (!metric) return;
    setWalkthroughIdx(idx);
    setTurns((prev) => [
      ...prev,
      {
        kind: "copilot",
        text: `【${idx + 1}/${allMetrics.length}】${metric.displayName}\n\n能力维度: ${metric.capability}\n权重: ${metric.weight}\n评估器: ${metric.evaluatorType}\n分值范围: ${metric.scale.min}-${metric.scale.max}，通过阈值: ${metric.scale.passThreshold}\n\n说明: ${metric.description}\n\n请确认此指标是否合理。你可以:\n- 输入「确认」或「跳过」\n- 输入「修改权重为 X」\n- 直接输入其他反馈`,
        metricKey: metric.metricKey,
      },
    ]);
    props.onHighlightMetric(metric.metricKey);
  }

  function handleWalkthroughReply(text: string) {
    const metric = allMetrics[walkthroughIdx];
    if (!metric) return;

    const lower = text.toLowerCase().trim();
    if (lower.includes("确认") || lower.includes("ok") || lower.includes("对")) {
      setTurns((prev) => [
        ...prev,
        { kind: "copilot", text: `✅ "${metric.displayName}" 已确认。` },
      ]);
      presentWalkthroughMetric(walkthroughIdx + 1);
    } else if (lower.includes("跳过")) {
      setTurns((prev) => [
        ...prev,
        { kind: "copilot", text: `⏭ "${metric.displayName}" 已跳过。` },
      ]);
      presentWalkthroughMetric(walkthroughIdx + 1);
    } else {
      setTurns((prev) => [
        ...prev,
        { kind: "copilot", text: `收到反馈: "${text}"。已记录，继续下一个指标...` },
      ]);
      presentWalkthroughMetric(walkthroughIdx + 1);
    }
  }

  function send(text?: string) {
    const value = (text ?? input).trim();
    if (!value) return;
    setTurns((prev) => [...prev, { kind: "user", text: value }]);
    setInput("");

    if (mode === "walkthrough" && !completed) {
      handleWalkthroughReply(value);
    } else {
      setTimeout(() => {
        setTurns((prev) => [
          ...prev,
          { kind: "copilot", text: `收到: "${value}"。当前在 suggest_first 模式，请查看上方建议并手动在左侧 rubric 中调整。` },
        ]);
      }, 400);
    }
  }

  function handleStart() {
    if (mode === "suggest_first") {
      startSuggestFirst();
    } else {
      startWalkthrough();
    }
  }

  function handleRestart() {
    if (mode === "suggest_first") {
      startSuggestFirst();
    } else {
      startWalkthrough();
    }
  }

  return (
    <div className={styles.copilotReviewPanel}>
      <div className={styles.copilotReviewHeader}>
        <div>
          <h3>Copilot 校验</h3>
          <p>AI 辅助审核 rubric 指标</p>
        </div>
        <button className={styles.secondaryButton} onClick={props.onClose}>
          关闭
        </button>
      </div>

      <div className={styles.copilotReviewMode}>
        <label>
          <input
            type="radio"
            name="reviewMode"
            checked={mode === "suggest_first"}
            onChange={() => setMode("suggest_first")}
          />
          <span>先提建议</span>
        </label>
        <label>
          <input
            type="radio"
            name="reviewMode"
            checked={mode === "walkthrough"}
            onChange={() => setMode("walkthrough")}
          />
          <span>逐个审核</span>
        </label>
      </div>

      <div ref={transcriptRef} className={styles.copilotReviewTranscript}>
        {turns.length === 0 && !running && (
          <div className={styles.copilotReviewEmpty}>点击「开始校验」让 Copilot 审核当前 rubric。</div>
        )}
        {turns.map((turn, i) => (
          <div
            key={i}
            className={
              turn.kind === "user"
                ? styles.copilotReviewTurnUser
                : styles.copilotReviewTurnCopilot
            }
          >
            <strong>{turn.kind === "user" ? "你" : "Copilot"}</strong>
            <p>{turn.text}</p>
          </div>
        ))}
        {running && (
          <div className={styles.copilotReviewTurnCopilot}>
            <strong>Copilot</strong>
            <span className={styles.copilotReviewLoading}>思考中...</span>
          </div>
        )}
      </div>

      {completed && (
        <div className={styles.copilotReviewComplete}>✅ 校验完成</div>
      )}

      <div className={styles.copilotReviewInputRow}>
        {turns.length === 0 ? (
          <button className={styles.primaryButton} onClick={handleStart}>
            开始校验
          </button>
        ) : (
          <>
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="回复 Copilot..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  if (input.trim()) {
                    send();
                  }
                }
              }}
            />
            <button className={styles.primaryButton} onClick={() => send()}>
              发送
            </button>
            {!completed && (
              <button className={styles.secondaryButton} onClick={handleRestart} disabled={running}>
                {running ? "校验中..." : "重新校验"}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
