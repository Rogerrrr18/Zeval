"use client";

import {
  emptyIntentFormRow,
  emptyRefillFormRow,
  extractionRootToForm,
  formToExtractionRoot,
  type IntentFormRow,
  type RefillFormRow,
} from "@/lib/extraction-form";
import { EXTRACTION_SCHEMA_VERSION } from "@/lib/extraction-constants";
import styles from "@/app/experiment.module.css";

type Props = {
  selected: string | null;
  busy: boolean;
  /** 当前 session 已成功写入或读取服务端锁版（可选，持久化复现）。 */
  serverLockReady?: boolean;
  /** 抽取请求进行中（用于按钮文案等）。 */
  extracting?: boolean;
  /** 表格是否只读（锁定编辑）。 */
  editorLocked: boolean;
  onToggleEditorLock: () => void;
  intentRows: IntentFormRow[];
  refillRows: RefillFormRow[];
  setIntentRows: React.Dispatch<React.SetStateAction<IntentFormRow[]>>;
  setRefillRows: React.Dispatch<React.SetStateAction<RefillFormRow[]>>;
  onRunExtract: () => Promise<void>;
  onRunReExtract: () => Promise<void>;
  onLoadLocked: () => Promise<void>;
  onRunLock: () => Promise<void>;
  showJsonDebug: boolean;
  onToggleJsonDebug: () => void;
};

/**
 * 意图序列与可回填项的表格编辑、抽取 / 读锁版 /（可选）服务端锁版；动态评测入口在下方「动态评测对话」卡片内。
 */
export function ExtractionEditor(props: Props) {
  const {
    selected,
    busy,
    editorLocked,
    onToggleEditorLock,
    intentRows,
    refillRows,
    setIntentRows,
    setRefillRows,
    onRunExtract,
    onRunReExtract,
    onLoadLocked,
    onRunLock,
    extracting = false,
    serverLockReady = false,
    showJsonDebug,
    onToggleJsonDebug,
  } = props;

  const disabled = !selected || busy || editorLocked;
  const softDisabled = !selected || busy;

  const updateIntent = (i: number, patch: Partial<IntentFormRow>) => {
    setIntentRows((prev) => prev.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  };

  const updateRefill = (i: number, patch: Partial<RefillFormRow>) => {
    setRefillRows((prev) => prev.map((row, j) => (j === i ? { ...row, ...patch } : row)));
  };

  let jsonPreview = "";
  if (selected && intentRows.length > 0) {
    try {
      const root = formToExtractionRoot(EXTRACTION_SCHEMA_VERSION, selected, intentRows, refillRows);
      jsonPreview = JSON.stringify(root, null, 2);
    } catch {
      jsonPreview = "// 当前表格字段无法合成合法 JSON，请检查数字列与 confidence";
    }
  }

  return (
    <div>
      {selected ? (
        <p className="muted" style={{ margin: "0 0 10px" }}>
          <strong>作用域</strong>：<code>{selected}</code>
          {serverLockReady ? (
            <span className={styles.badge} style={{ marginLeft: 10 }}>
              已绑定抽取结果（后续抽取将复用）
            </span>
          ) : null}
        </p>
      ) : (
        <p className="muted" style={{ margin: "0 0 10px" }}>
          未选择 session 时无法抽取或评测。
        </p>
      )}
      <div className={styles.toolbar}>
        <button
          type="button"
          disabled={softDisabled}
          title="首次会调用模型抽取并绑定到该 session；若已绑定则直接读取绑定结果，保证可复现。"
          onClick={() => void onRunExtract()}
        >
          {extracting ? "抽取/读取中…" : "抽取/读取绑定结果"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={softDisabled}
          title="强制重新调用模型生成新抽取结果；只填入表格，不会覆盖已绑定版本，需点击「保存绑定结果」后才生效。"
          onClick={() => void onRunReExtract()}
        >
          重新抽取（不覆盖）
        </button>
        <button
          type="button"
          className="secondary"
          disabled={softDisabled}
          title="从磁盘读取该 session 已绑定的抽取 JSON 到表格（若从未抽取会报错）。"
          onClick={() => void onLoadLocked()}
        >
          读取绑定结果
        </button>
        <button
          type="button"
          disabled={!selected || busy || intentRows.length === 0}
          title="把当前表格校验后写入该 session 的绑定文件；用于人工修订后覆盖绑定版本。"
          onClick={() => void onRunLock()}
        >
          保存绑定结果（服务端）
        </button>
        <button type="button" className="secondary" disabled={!selected || busy} title="仅锁定/解锁表格是否可编辑，与服务器锁版文件无关。" onClick={onToggleEditorLock}>
          {editorLocked ? "解锁表格编辑" : "锁定表格编辑"}
        </button>
        <button type="button" className="secondary" title="查看将用于锁版与动态评测请求的 JSON 结构。" onClick={onToggleJsonDebug}>
          {showJsonDebug ? "隐藏 JSON" : "显示 JSON"}
        </button>
        {editorLocked ? <span className={styles.badgeWarn}>表格已锁定（UI）</span> : <span className={styles.badge}>表格可编辑</span>}
      </div>
      <p className="muted" style={{ margin: "0 0 12px" }}>
        首次抽取会自动绑定到当前 session；后续点击抽取会复用绑定结果，避免同一会话重复抽取导致意图与可回填项不复现。
      </p>
      <p className={styles.monoHint}>示例用户话：每行一条；依赖意图：逗号分隔整数；历史范围：起止 turn 各填一格。首条示例用户话会优先固定为历史原始 user query。</p>
      <div className={styles.editTableWrap}>
        <table className={styles.editTable}>
          <thead>
            <tr>
              <th>#</th>
              <th>意图序号</th>
              <th>意图文本</th>
              <th>历史用户轮数</th>
              <th>示例用户话</th>
              <th>达成标准</th>
              <th>依赖意图</th>
              <th>历史起始轮</th>
              <th>历史结束轮</th>
            </tr>
          </thead>
          <tbody>
            {intentRows.map((row, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    value={row.intent_index}
                    onChange={(e) => updateIntent(i, { intent_index: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    value={row.intent_text}
                    onChange={(e) => updateIntent(i, { intent_text: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    value={row.turn_span_user_turns}
                    onChange={(e) => updateIntent(i, { turn_span_user_turns: e.target.value })}
                  />
                </td>
                <td>
                  <textarea
                    className={styles.cellTextarea}
                    disabled={disabled}
                    value={row.example_queries_text}
                    onChange={(e) => updateIntent(i, { example_queries_text: e.target.value })}
                  />
                </td>
                <td>
                  <textarea
                    className={styles.cellTextarea}
                    disabled={disabled}
                    value={row.success_criteria}
                    onChange={(e) => updateIntent(i, { success_criteria: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    value={row.depends_text}
                    onChange={(e) => updateIntent(i, { depends_text: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    value={row.span_start}
                    onChange={(e) => updateIntent(i, { span_start: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    value={row.span_end}
                    onChange={(e) => updateIntent(i, { span_end: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() => setIntentRows((prev) => [...prev, emptyIntentFormRow(prev.length)])}
        >
          添加意图行
        </button>
      </div>

      <h3 className={styles.subTitle}>可回填项</h3>
      <div className={styles.editTableWrap}>
        <table className={styles.editTable}>
          <thead>
            <tr>
              <th>#</th>
              <th>回填序号</th>
              <th>触发条件</th>
              <th>事实引用</th>
              <th>key</th>
              <th>来源轮次</th>
              <th>置信度</th>
              <th>注入文本</th>
            </tr>
          </thead>
          <tbody>
            {refillRows.map((row, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    value={row.refill_index}
                    onChange={(e) => updateRefill(i, { refill_index: e.target.value })}
                  />
                </td>
                <td>
                  <textarea
                    className={styles.cellTextarea}
                    disabled={disabled}
                    value={row.trigger_condition}
                    onChange={(e) => updateRefill(i, { trigger_condition: e.target.value })}
                  />
                </td>
                <td>
                  <textarea
                    className={styles.cellTextarea}
                    disabled={disabled}
                    value={row.refill_reference}
                    onChange={(e) => updateRefill(i, { refill_reference: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    value={row.key}
                    onChange={(e) => updateRefill(i, { key: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    value={row.source_turn_index}
                    onChange={(e) => updateRefill(i, { source_turn_index: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    className={styles.cellInput}
                    disabled={disabled}
                    placeholder="high|medium|low"
                    value={row.confidence}
                    onChange={(e) => updateRefill(i, { confidence: e.target.value })}
                  />
                </td>
                <td>
                  <textarea
                    className={styles.cellTextarea}
                    disabled={disabled}
                    value={row.injection_text}
                    onChange={(e) => updateRefill(i, { injection_text: e.target.value })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button
          type="button"
          className="secondary"
          disabled={disabled}
          onClick={() => setRefillRows((prev) => [...prev, emptyRefillFormRow(prev.length)])}
        >
          添加回填行
        </button>
      </div>

      {showJsonDebug ? (
        <>
          <h3 className={styles.subTitle}>JSON 调试（绑定结果与评测请求仍使用该结构）</h3>
          <pre style={{ maxHeight: 240, overflow: "auto", fontSize: 11, padding: 12, background: "#0c1218", borderRadius: 8 }}>{jsonPreview}</pre>
        </>
      ) : null}
    </div>
  );
}

/** 将抽取结果写入表格状态（父组件在 fetch 成功后调用）。 */
export function applyExtractionToForm(
  setIntentRows: React.Dispatch<React.SetStateAction<IntentFormRow[]>>,
  setRefillRows: React.Dispatch<React.SetStateAction<RefillFormRow[]>>,
  root: import("@/lib/types").ExtractionRoot,
): void {
  const { intents, refills } = extractionRootToForm(root);
  setIntentRows(intents);
  setRefillRows(refills);
}
