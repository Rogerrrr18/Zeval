/**
 * @fileoverview Tool Call 解析器
 *
 * 模仿 Hermes 的 <tool_call> XML 格式解析：
 * <tool_call>
 *   {"id": "call_1", "name": "evaluate_metric", "arguments": {"caseId": "123", "metricKey": "decision_accuracy"}}
 * </tool_call>
 *
 * 支持：
 * - 单个 tool_call
 * - 多个 tool_call（并行工具调用）
 * - JSON 容错（缺失引号、多余逗号等）
 */

import type { AgentToolCall } from "./types";

type ParseResult = {
  toolCalls: AgentToolCall[];
  remainingText: string;
  hasToolCalls: boolean;
};

/**
 * 从 assistant 输出中解析 tool calls
 */
export function parseToolCalls(text: string): ParseResult {
  const trimmed = text.trim();

  // 匹配 <tool_call>...JSON...</tool_call>
  const singlePattern = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  const matches: RegExpExecArray[] = [];
  let m: RegExpExecArray | null;

  while ((m = singlePattern.exec(trimmed)) !== null) {
    matches.push(m);
  }

  if (matches.length === 0) {
    return { toolCalls: [], remainingText: trimmed, hasToolCalls: false };
  }

  const toolCalls: AgentToolCall[] = [];
  let remainingText = trimmed;

  for (const match of matches) {
    const jsonText = match[1].trim();
    const parsed = parseToolCallJson(jsonText);
    if (parsed) {
      toolCalls.push(parsed);
      // 从 remainingText 中移除已解析的 tool_call
      remainingText = remainingText.replace(match[0], "").trim();
    }
  }

  return {
    toolCalls,
    remainingText: remainingText.replace(/\n{2,}/g, "\n").trim(),
    hasToolCalls: toolCalls.length > 0,
  };
}

function parseToolCallJson(jsonText: string): AgentToolCall | undefined {
  try {
    // 先尝试直接 JSON.parse
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
    return normalizeToolCall(parsed);
  } catch {
    // 容错处理：尝试修复常见 JSON 错误
    return tryRepairAndParse(jsonText);
  }
}

function normalizeToolCall(parsed: Record<string, unknown>): AgentToolCall | undefined {
  const id = String(parsed.id ?? parsed.tool_call_id ?? `call_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`);

  // 安全地读取嵌套的 function.name
  let toolName = "";
  if (typeof parsed.name === "string") {
    toolName = parsed.name;
  } else if (
    parsed.function !== null &&
    parsed.function !== undefined &&
    typeof parsed.function === "object"
  ) {
    const fn = parsed.function as Record<string, unknown>;
    if (typeof fn.name === "string") {
      toolName = fn.name;
    }
  }

  // 安全地读取参数
  let args: Record<string, unknown> = {};
  if (parsed.arguments !== undefined && typeof parsed.arguments === "object") {
    args = parsed.arguments as Record<string, unknown>;
  } else if (parsed.args !== undefined && typeof parsed.args === "object") {
    args = parsed.args as Record<string, unknown>;
  } else if (parsed.parameters !== undefined && typeof parsed.parameters === "object") {
    args = parsed.parameters as Record<string, unknown>;
  }

  if (!toolName) return undefined;

  return { id, name: toolName, arguments: args };
}

function tryRepairAndParse(jsonText: string): AgentToolCall | undefined {
  // 修复 1: 单引号转双引号
  let repaired = jsonText.replace(/'/g, '"');

  // 修复 2: 移除尾部逗号
  repaired = repaired.replace(/,\s*([}\]])/g, "$1");

  // 修复 3: 给未加引号的 key 加引号（简单场景）
  repaired = repaired.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, '$1"$2"$3');

  try {
    const parsed = JSON.parse(repaired) as Record<string, unknown>;
    return normalizeToolCall(parsed);
  } catch {
    // 修复 4: 尝试提取 name 和 arguments
    return extractByRegex(jsonText);
  }
}

function extractByRegex(text: string): AgentToolCall | undefined {
  const nameMatch = text.match(/"name"\s*:\s*"([^"]+)"/);
  const idMatch = text.match(/"id"\s*:\s*"([^"]+)"/);
  const argsMatch = text.match(/"arguments"\s*:\s*(\{[\s\S]*\})/);

  if (!nameMatch) return undefined;

  let args: Record<string, unknown> = {};
  if (argsMatch) {
    try {
      args = JSON.parse(argsMatch[1]) as Record<string, unknown>;
    } catch {
      // 忽略
    }
  }

  return {
    id: idMatch?.[1] ?? `call_${Date.now()}`,
    name: nameMatch[1],
    arguments: args,
  };
}

/**
 * 将 tool calls 序列化为 XML 格式（用于 prompt 模板）
 */
export function serializeToolCalls(toolCalls: AgentToolCall[]): string {
  return toolCalls
    .map(
      (tc) =>
        `<tool_call>\n${JSON.stringify({ id: tc.id, name: tc.name, arguments: tc.arguments }, null, 2)}\n</tool_call>`,
    )
    .join("\n");
}

/**
 * 生成 tool 结果消息
 */
export function serializeToolResult(toolCallId: string, name: string, result: unknown): string {
  return `<tool_result>\n{"tool_call_id": "${toolCallId}", "name": "${name}", "result": ${JSON.stringify(result)}}\n</tool_result>`;
}
