/**
 * SiliconFlow OpenAI 兼容 chat.completions 封装。
 */

import type { MergedSettings } from "@/lib/types";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatCompleteOptions = {
  settings: MergedSettings;
  messages: ChatMessage[];
  temperature?: number;
  /** 要求模型仅输出 JSON 时在 user 侧约束即可；此处用 response_format 若网关支持 */
  jsonMode?: boolean;
  stage?: string;
  /**
   * 为 true 时无视全局「开启思考」设置，请求体始终带 `enable_thinking: false`（抽取等低延迟场景）。
   * @defaultValue false
   */
  forceDisableThinking?: boolean;
};

/**
 * 调用 chat completions。
 * @param options 消息与温度等。
 * @returns assistant 文本内容。
 */
export async function siliconflowChatComplete(options: ChatCompleteOptions): Promise<string> {
  const { settings, messages, temperature = 0.3, jsonMode, stage, forceDisableThinking = false } = options;
  if (!settings.apiKey) {
    throw new Error("未配置 API Key：请在「实验设置」中保存，或设置环境变量 ZEVAL_JUDGE_API_KEY / ZEVAL_INTENT_EXPERIMENT_API_KEY");
  }
  const url = `${settings.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const body: Record<string, unknown> = {
    model: settings.model,
    messages,
    temperature,
  };
  /** 未显式开启思考时默认关闭，避免 Qwen 等模型隐式思考拖慢首包；抽取等路径可 force 关闭。 */
  const thinkingOff = forceDisableThinking || settings.enableThinking !== true;
  if (thinkingOff) {
    body.enable_thinking = false;
  }
  if (jsonMode) {
    body.response_format = { type: "json_object" };
  }
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
      ...(stage ? { "X-Eval-Stage": stage } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`SiliconFlow HTTP ${res.status}: ${t.slice(0, 500)}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content ?? "";
  if (!content && data.choices?.[0]?.message?.reasoning_content) {
    throw new Error("模型返回了 reasoning 而无 content；请将 ZEVAL_JUDGE_ENABLE_THINKING 设为 false");
  }
  return content;
}
