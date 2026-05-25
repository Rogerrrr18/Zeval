/**
 * 从 LLM 输出中截取 JSON 对象字符串并解析。
 * @param raw 模型原始输出。
 */
export function parseJsonObjectFromLlm(raw: string): unknown {
  const trimmed = raw.trim();
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("未找到 JSON 对象");
  }
  return JSON.parse(candidate.slice(start, end + 1)) as unknown;
}
