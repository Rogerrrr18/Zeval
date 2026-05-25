/**
 * 抽取结果 ExtractionRoot 与表格编辑态之间的双向转换。
 */

import type { ExtractionRoot, HistoricalSpan, IntentItem, RefillItem } from "@/lib/types";

/** 意图序列表格行（单元格均为字符串便于受控输入）。 */
export type IntentFormRow = {
  intent_index: string;
  intent_text: string;
  turn_span_user_turns: string;
  example_queries_text: string;
  success_criteria: string;
  depends_text: string;
  span_start: string;
  span_end: string;
};

/** 可回填项表格行。 */
export type RefillFormRow = {
  refill_index: string;
  trigger_condition: string;
  refill_reference: string;
  key: string;
  source_turn_index: string;
  confidence: string;
  injection_text: string;
};

/**
 * 将后端抽取对象转为表单行。
 * @param root 校验通过的 ExtractionRoot。
 */
export function extractionRootToForm(root: ExtractionRoot): { intents: IntentFormRow[]; refills: RefillFormRow[] } {
  const intents = root.intent_sequence.map((it) => ({
    intent_index: String(it.intent_index),
    intent_text: it.intent_text,
    turn_span_user_turns: String(it.turn_span_user_turns),
    example_queries_text: it.example_user_queries.join("\n"),
    success_criteria: it.success_criteria,
    depends_text: it.depends_on.join(", "),
    span_start: it.historical_span !== undefined ? String(it.historical_span.start_turn_index) : "",
    span_end: it.historical_span !== undefined ? String(it.historical_span.end_turn_index) : "",
  }));
  const refills = (root.refillables ?? []).map((r) => ({
    refill_index: String(r.refill_index),
    trigger_condition: r.trigger_condition,
    refill_reference: r.refill_reference,
    key: r.key ?? "",
    source_turn_index: r.source_turn_index !== undefined ? String(r.source_turn_index) : "",
    confidence: r.confidence ?? "",
    injection_text: r.injection_text ?? "",
  }));
  return { intents, refills };
}

/**
 * 解析逗号分隔的依赖意图序号。
 * @param s 如 "0, 1" 或空。
 */
function parseDepends(s: string): number[] {
  if (!s.trim()) return [];
  return s
    .split(/[,，]/)
    .map((x) => Number.parseInt(x.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

/**
 * 解析历史轮次区间。
 * @param start 起始 turn 文本。
 * @param end 结束 turn 文本。
 */
function parseSpan(start: string, end: string): HistoricalSpan | undefined {
  const a = Number.parseInt(start.trim(), 10);
  const b = Number.parseInt(end.trim(), 10);
  if (Number.isFinite(a) && Number.isFinite(b)) {
    return { start_turn_index: a, end_turn_index: b };
  }
  return undefined;
}

/**
 * 将表单行合并为 ExtractionRoot（提交锁版前调用）。
 * @param schema_version Schema 版本字符串。
 * @param session_id 会话 id。
 * @param intents 意图表格行。
 * @param refills 回填表格行。
 */
export function formToExtractionRoot(
  schema_version: string,
  session_id: string,
  intents: IntentFormRow[],
  refills: RefillFormRow[],
): ExtractionRoot {
  const intent_sequence: IntentItem[] = intents.map((row) => {
    const intent_index = Number.parseInt(row.intent_index, 10);
    const turn_span_user_turns = Number.parseInt(row.turn_span_user_turns, 10);
    const queries = row.example_queries_text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const depends_on = parseDepends(row.depends_text);
    const historical_span = parseSpan(row.span_start, row.span_end);
    const item: IntentItem = {
      intent_index: Number.isFinite(intent_index) ? intent_index : 0,
      intent_text: row.intent_text.trim(),
      turn_span_user_turns: Number.isFinite(turn_span_user_turns) ? turn_span_user_turns : 0,
      example_user_queries: queries.length > 0 ? queries : ["(待补充)"],
      success_criteria: row.success_criteria.trim(),
      depends_on,
    };
    if (historical_span) item.historical_span = historical_span;
    return item;
  });

  const refillables: RefillItem[] = refills.map((row) => {
    const refill_index = Number.parseInt(row.refill_index, 10);
    const st = row.source_turn_index.trim();
    const source_turn_index = st === "" ? undefined : Number.parseInt(st, 10);
    const item: RefillItem = {
      refill_index: Number.isFinite(refill_index) ? refill_index : 0,
      trigger_condition: row.trigger_condition.trim(),
      refill_reference: row.refill_reference,
    };
    if (row.key.trim()) item.key = row.key.trim();
    if (st !== "" && Number.isFinite(source_turn_index)) item.source_turn_index = source_turn_index;
    const c = row.confidence.trim();
    if (c === "high" || c === "medium" || c === "low") item.confidence = c;
    if (row.injection_text.trim()) item.injection_text = row.injection_text.trim();
    return item;
  });

  return { schema_version, session_id, intent_sequence, refillables };
}

/**
 * 新增空白意图行（表格追加）。
 * @param fallbackIndex 默认 intent_index 显示值。
 */
export function emptyIntentFormRow(fallbackIndex: number): IntentFormRow {
  return {
    intent_index: String(fallbackIndex),
    intent_text: "",
    turn_span_user_turns: "1",
    example_queries_text: "",
    success_criteria: "",
    depends_text: "",
    span_start: "",
    span_end: "",
  };
}

/**
 * 新增空白回填行。
 * @param fallbackIndex 默认 refill_index 显示值。
 */
export function emptyRefillFormRow(fallbackIndex: number): RefillFormRow {
  return {
    refill_index: String(fallbackIndex),
    trigger_condition: "",
    refill_reference: "",
    key: "",
    source_turn_index: "",
    confidence: "",
    injection_text: "",
  };
}
