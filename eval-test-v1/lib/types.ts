/**
 * 抽取结果与评测相关的共享类型。
 */

export type ChatRole = "user" | "assistant" | "system";

/** CSV 来源：首期冻结 MultiWOZ 衍生；`legacy_minimal` 为开发用最小列兼容。 */
export type CsvSourceFormat = "multiwoz_v1" | "legacy_minimal";

export type CsvRow = {
  session_id: string;
  turn_index: number;
  role: ChatRole;
  content: string;
  timestamp?: string;
  /** 行来源格式，便于 transcript 辅助块与审计。 */
  source_format?: CsvSourceFormat;
  /** MultiWOZ 冻结列：本行涉及领域（`|` 分隔）。 */
  services?: string;
  /** MultiWOZ 冻结列：活跃意图串（`|` 分隔），可为空。 */
  active_intents?: string;
  /** MultiWOZ 冻结列：槽位串（`|` 分段），可为空。 */
  slot_values?: string;
};

export type SessionBundle = {
  session_id: string;
  rows: CsvRow[];
};

export type HistoricalSpan = {
  start_turn_index: number;
  end_turn_index: number;
};

export type IntentItem = {
  intent_index: number;
  intent_text: string;
  turn_span_user_turns: number;
  example_user_queries: string[];
  success_criteria: string;
  depends_on: number[];
  historical_span?: HistoricalSpan;
};

export type RefillItem = {
  refill_index: number;
  trigger_condition: string;
  refill_reference: string;
  key?: string;
  source_turn_index?: number;
  confidence?: "high" | "medium" | "low";
  injection_text?: string;
};

/**
 * 与 Schema 对齐的抽取根对象。
 */
export type ExtractionRoot = {
  schema_version: string;
  session_id: string;
  intent_sequence: IntentItem[];
  refillables: RefillItem[];
  schema_lock_revision?: number;
};

export type JudgeLabel = "SATISFIED" | "NOT_SATISFIED" | "DEVIATION";

export type EvalTurnLog = {
  step: number;
  intent_index: number;
  c_i: number;
  B_i: number;
  user_message: string;
  assistant_message: string;
  judge: JudgeLabel;
  rationale: string;
  evidence_quote: string;
};

export type SessionMetrics = {
  intent_completion_rate: number;
  followup_efficiency: number;
  deviation_rate: number;
  turn_efficiency: number;
  /** 原始 CSV 中该 session 的 user 轮次数 */
  T_hist: number;
  /** 动态评测实际 user 条数（= 评测轮次） */
  T_eval: number;
  satisfied_intents: number;
  total_intents: number;
  deviation_rounds: number;
  total_rounds: number;
  followup_count: number;
};

export type MergedSettings = {
  apiKey: string;
  baseUrl: string;
  model: string;
  enableThinking: boolean;
};
