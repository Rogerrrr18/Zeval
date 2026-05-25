import { siliconflowChatComplete } from "@/lib/siliconflow";
import { parseJsonObjectFromLlm } from "@/lib/json";
import type { MergedSettings } from "@/lib/types";
import { rowsToTranscript } from "@/lib/csv";
import type { CsvRow } from "@/lib/types";

export type BaselineVector = {
  intent_completion_rate: number;
  followup_efficiency: number;
  deviation_rate: number;
  turn_efficiency: number;
};

/**
 * 对原始 session transcript 做一次结构化打分，作为雷达基线 B（0–1）。
 * @param settings 模型配置。
 * @param rows 原始行。
 */
export async function computeBaselineVector(
  settings: MergedSettings,
  rows: CsvRow[],
): Promise<BaselineVector> {
  const transcript = rowsToTranscript(rows);
  const system = [
    "你是评测员，只输出 JSON，不要 markdown。",
    "根据以下「原始多轮对话」估计四个 0 到 1 的标量（1 为最好，除 deviation_rate 外越高越好；deviation_rate 越高表示对话越偏离用户意图/越混乱）：",
    "intent_completion_rate: 用户意图在对话结束时被满足的程度",
    "followup_efficiency: 用户是否少重复、少追问（高表示追问负担低）",
    "deviation_rate: 助手是否跑题/答非所问（高表示偏离严重，与实验动态臂「偏离率」语义对齐为「问题严重程度」）",
    "turn_efficiency: 用较少轮次完成任务的效率（高表示更省轮）",
    '输出格式: {"intent_completion_rate":0.8,"followup_efficiency":0.7,"deviation_rate":0.2,"turn_efficiency":0.75}',
  ].join("\n");

  const raw = await siliconflowChatComplete({
    settings,
    messages: [
      { role: "system", content: system },
      { role: "user", content: transcript },
    ],
    temperature: 0,
    jsonMode: true,
    stage: "baseline-radar",
  });
  const obj = parseJsonObjectFromLlm(raw) as Record<string, unknown>;
  const clamp = (n: unknown) => Math.max(0, Math.min(1, typeof n === "number" && Number.isFinite(n) ? n : Number(n) || 0));
  return {
    intent_completion_rate: clamp(obj.intent_completion_rate),
    followup_efficiency: clamp(obj.followup_efficiency),
    deviation_rate: clamp(obj.deviation_rate),
    turn_efficiency: clamp(obj.turn_efficiency),
  };
}
