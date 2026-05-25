/**
 * 解析实验用 CSV（UTF-8）。
 * 支持首期冻结格式 MultiWOZ 衍生列（见 docs/CSV_INPUT_FROZEN_V1.md）与 legacy 最小列兼容。
 */

import { parse } from "csv-parse/sync";
import type { CsvRow, SessionBundle } from "@/lib/types";

/** eval-test-v1 首期冻结：与 public/multiwoz_samples_10.csv 表头一致。 */
export const FROZEN_MULTIWOZ_V1_HEADERS = [
  "dialogue_id",
  "services",
  "turn_num",
  "speaker",
  "utterance",
  "active_intents",
  "slot_values",
] as const;

const LEGACY_REQUIRED = ["session_id", "turn_index", "role", "content"];

/**
 * 判断是否为首期冻结的 MultiWOZ 衍生表头。
 * @param headers 首行解析得到的列名列表。
 */
export function isFrozenMultiwozV1Headers(headers: string[]): boolean {
  const set = new Set(headers.map((h) => h.trim()));
  return FROZEN_MULTIWOZ_V1_HEADERS.every((k) => set.has(k));
}

/**
 * 判断是否 legacy 最小列表头。
 * @param headers 列名列表。
 */
export function isLegacyMinimalHeaders(headers: string[]): boolean {
  const set = new Set(headers.map((h) => h.trim()));
  return LEGACY_REQUIRED.every((k) => set.has(k));
}

/**
 * 将 speaker 映射为内部角色（MultiWOZ：USER / SYSTEM）。
 * @param raw CSV 中的 speaker 字段。
 */
function mapMultiwozSpeaker(raw: string): CsvRow["role"] {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "USER") return "user";
  if (s === "SYSTEM") return "assistant";
  throw new Error(`MultiWOZ CSV 非法 speaker: ${raw}（仅允许 USER、SYSTEM）`);
}

/**
 * 解析 legacy 最小列 CSV。
 * @param records 已按列解析的记录。
 */
function parseLegacyRecords(records: Record<string, string>[]): SessionBundle[] {
  const bySession = new Map<string, CsvRow[]>();
  for (const r of records) {
    const session_id = String(r.session_id ?? "").trim();
    if (!session_id) continue;
    const turn_index = Number.parseInt(String(r.turn_index), 10);
    const role = String(r.role ?? "").trim().toLowerCase() as CsvRow["role"];
    const content = String(r.content ?? "");
    if (role !== "user" && role !== "assistant") {
      throw new Error(`非法 role: ${r.role}`);
    }
    if (!Number.isFinite(turn_index)) {
      throw new Error(`非法 turn_index: ${r.turn_index}`);
    }
    const row: CsvRow = {
      session_id,
      turn_index,
      role,
      content,
      timestamp: r.timestamp ? String(r.timestamp) : undefined,
      source_format: "legacy_minimal",
    };
    if (!bySession.has(session_id)) bySession.set(session_id, []);
    bySession.get(session_id)!.push(row);
  }
  return finalizeBundles(bySession);
}

/**
 * 解析冻结 MultiWOZ v1 列 CSV。
 * @param records 已按列解析的记录。
 */
function parseMultiwozV1Records(records: Record<string, string>[]): SessionBundle[] {
  const bySession = new Map<string, CsvRow[]>();
  for (const r of records) {
    const session_id = String(r.dialogue_id ?? "").trim();
    if (!session_id) continue;
    const turn_index = Number.parseInt(String(r.turn_num), 10);
    const role = mapMultiwozSpeaker(String(r.speaker ?? ""));
    const content = String(r.utterance ?? "").trim();
    if (!content) {
      throw new Error(`dialogue_id=${session_id} turn_num=${r.turn_num} utterance 为空`);
    }
    if (!Number.isFinite(turn_index) || turn_index < 0) {
      throw new Error(`非法 turn_num: ${r.turn_num}`);
    }
    const row: CsvRow = {
      session_id,
      turn_index,
      role,
      content,
      source_format: "multiwoz_v1",
      services: String(r.services ?? "").trim() || undefined,
      active_intents: String(r.active_intents ?? "").trim() || undefined,
      slot_values: String(r.slot_values ?? "").trim() || undefined,
    };
    if (!bySession.has(session_id)) bySession.set(session_id, []);
    bySession.get(session_id)!.push(row);
  }
  return finalizeBundles(bySession);
}

/**
 * 分组排序、校验 user 轮次与 turn 唯一性。
 * @param bySession 按 session_id 累积的行。
 */
function finalizeBundles(bySession: Map<string, CsvRow[]>): SessionBundle[] {
  const bundles: SessionBundle[] = [];
  for (const [session_id, rows] of bySession) {
    rows.sort((a, b) => a.turn_index - b.turn_index);
    const turns = rows.map((x) => x.turn_index);
    const uniq = new Set(turns);
    if (uniq.size !== turns.length) {
      throw new Error(`session ${session_id} 内 turn_index/turn_num 重复`);
    }
    const userCount = rows.filter((x) => x.role === "user").length;
    if (userCount < 2) {
      throw new Error(`session ${session_id} 的 user 轮次少于 2，当前为 ${userCount}`);
    }
    bundles.push({ session_id, rows });
  }
  bundles.sort((a, b) => a.session_id.localeCompare(b.session_id));
  return bundles;
}

/**
 * 将 CSV 文本解析为按 session 分组的行（自动识别冻结 MultiWOZ v1 或 legacy 最小列）。
 * @param csvText 原始文本。
 * @returns session 列表。
 */
export function parseSessionsCsv(csvText: string): SessionBundle[] {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    throw new Error("CSV 无数据行");
  }
  const headers = Object.keys(records[0]);
  if (isFrozenMultiwozV1Headers(headers)) {
    return parseMultiwozV1Records(records);
  }
  if (isLegacyMinimalHeaders(headers)) {
    for (const h of LEGACY_REQUIRED) {
      if (!headers.includes(h)) {
        throw new Error(`CSV 缺少必填列: ${h}，当前列: ${headers.join(", ")}`);
      }
    }
    return parseLegacyRecords(records);
  }
  throw new Error(
    `无法识别 CSV 格式。请使用首期冻结表头: ${FROZEN_MULTIWOZ_V1_HEADERS.join(", ")}；或 legacy: ${LEGACY_REQUIRED.join(", ")}。当前列: ${headers.join(", ")}`,
  );
}

export type TranscriptOptions = {
  /**
   * 为抽取模型附加 MultiWOZ 行级元数据块（基线 B 不应开启，避免金标泄漏）。
   * @defaultValue false
   */
  includeMultiwozMeta?: boolean;
};

/**
 * 将 session 行渲染为评测用 transcript 文本。
 * @param rows 已排序行。
 * @param opts 可选：为 MultiWOZ 源附加 CSV_AUX 块供抽取使用。
 */
export function rowsToTranscript(rows: CsvRow[], opts?: TranscriptOptions): string {
  const dialogue = rows.map((r) => `[turn ${r.turn_index}] [${r.role}] ${r.content}`).join("\n");
  if (!opts?.includeMultiwozMeta) return dialogue;
  const hasMw = rows.some((r) => r.source_format === "multiwoz_v1");
  if (!hasMw) return dialogue;
  const auxLines = rows.map((r) => {
    const svc = r.services ?? "";
    const ai = r.active_intents ?? "";
    const sv = r.slot_values ?? "";
    return `[turn ${r.turn_index}] services=${svc} | active_intents=${ai} | slot_values=${sv}`;
  });
  return [
    dialogue,
    "",
    "--- CSV_AUX_MULTIWOZ_V1（仅作意图/槽位抽取辅助，非对白正文）---",
    ...auxLines,
    "--- END_CSV_AUX ---",
  ].join("\n");
}

/**
 * 统计 user 轮次数。
 * @param rows 会话行。
 */
export function countUserTurns(rows: CsvRow[]): number {
  return rows.filter((r) => r.role === "user").length;
}
