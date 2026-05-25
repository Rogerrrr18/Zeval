import { siliconflowChatComplete } from "@/lib/siliconflow";
import { parseJsonObjectFromLlm } from "@/lib/json";
import { validateExtraction } from "@/lib/validate-extraction";
import type { ExtractionRoot, MergedSettings } from "@/lib/types";
import { rowsToTranscript } from "@/lib/csv";
import type { CsvRow } from "@/lib/types";

import { EXTRACTION_SCHEMA_VERSION } from "@/lib/extraction-constants";

const SCHEMA_VERSION = EXTRACTION_SCHEMA_VERSION;

/**
 * 从历史 span 内取第一条真实 user 话，作为该意图首轮固定 query。
 */
function firstUserQueryInSpan(rows: CsvRow[], start: number, end: number): string | null {
  const row = rows.find((r) => r.role === "user" && r.turn_index >= start && r.turn_index <= end);
  return row?.content.trim() || null;
}

/**
 * 将抽取结果与原始 session 对齐，避免 LLM 每次改写首轮 query 导致动态评测开场漂移。
 */
function stabilizeExtractionWithRows(extraction: ExtractionRoot, rows: CsvRow[]): ExtractionRoot {
  extraction.intent_sequence = extraction.intent_sequence.map((intent) => {
    const span = intent.historical_span;
    if (!span) return intent;
    const fixedFirst = firstUserQueryInSpan(rows, span.start_turn_index, span.end_turn_index);
    if (!fixedFirst) return intent;
    const rest = intent.example_user_queries.filter((q) => q.trim() && q.trim() !== fixedFirst);
    return {
      ...intent,
      example_user_queries: [fixedFirst, ...rest],
    };
  });
  return extraction;
}

/**
 * 对单个 session 调用一次模型，抽取意图序列与可回填项。
 * @param settings SiliconFlow 配置。
 * @param sessionId 会话 id。
 * @param rows 已排序 CSV 行。
 */
export async function runExtractionOnce(
  settings: MergedSettings,
  sessionId: string,
  rows: CsvRow[],
): Promise<{ extraction: ExtractionRoot; raw: string }> {
  const transcript = rowsToTranscript(rows, { includeMultiwozMeta: true });
  const system = [
    "你是对话分析工具，只输出一个 JSON 对象，不要 markdown，不要解释。",
    "JSON 必须符合以下顶层结构：",
    `schema_version: 固定字符串 "${SCHEMA_VERSION}"`,
    "session_id: 字符串",
    "intent_sequence: 数组，每项含 intent_index(整数), intent_text, turn_span_user_turns(整数,该意图在历史中对应的用户发起轮数),",
    "example_user_queries(字符串数组至少1条), success_criteria, depends_on(整数数组可为空), historical_span 可选 {start_turn_index,end_turn_index}",
    "refillables: 数组，每项含 refill_index(整数), trigger_condition, refill_reference；可选 key, source_turn_index, confidence(high|medium|low), injection_text",
    "若无可回填事实，refillables 可为空数组。",
  ].join("\n");

  const user = [
    `session_id=${sessionId}`,
    "以下为完整对话，请抽取意图序列与可回填项：",
    transcript,
  ].join("\n\n");

  let lastErr: Error | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await siliconflowChatComplete({
        settings,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.25,
        jsonMode: true,
        stage: "intent-extract",
        forceDisableThinking: true,
      });
      const parsed = parseJsonObjectFromLlm(raw);
      const v = validateExtraction(parsed);
      if (!v.ok) {
        throw new Error(`Schema 校验失败: ${v.errors}`);
      }
      const extraction = parsed as ExtractionRoot;
      extraction.schema_version = SCHEMA_VERSION;
      extraction.session_id = sessionId;
      return { extraction: stabilizeExtractionWithRows(extraction, rows), raw };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw lastErr ?? new Error("抽取失败");
}
