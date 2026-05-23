/**
 * @fileoverview Eval Copilot orchestrator: plan → tool_call → final loop.
 *
 * Strategy:
 *   - SiliconFlow returns JSON only (response_format=json_object).
 *   - We treat each model turn as a single JSON action of one of three shapes:
 *       { "type": "plan", "plan": ["step1", "step2", ...] }
 *       { "type": "tool_call", "tool": "<name>", "args": { ... } }
 *       { "type": "final", "message": "...", "next_actions": [{ "label": "...", "skill": "<name>", "args": {...} }] }
 *   - The orchestrator dispatches tool calls, appends results back to the
 *     LLM context, and keeps looping until the model emits "final" or hits
 *     the iteration cap.
 *
 * The full event stream (plan / tool_call / tool_result / final / error) is
 * collected and returned so the frontend can render an animated transcript.
 */

import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import { SKILL_REGISTRY, renderSkillManifest, type SkillContext, type SkillResult } from "@/copilot/skills";

/**
 * Inputs from the frontend.
 */
export type CopilotInput = {
  /** Conversation history; each turn is { role, content }. */
  messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  /** Pre-attached payload (e.g. uploaded rawRows) the user wants the agent to use. */
  attachments?: {
    rawRows?: unknown[];
    scenarioId?: string;
    sourceFileName?: string;
  };
  /** Workspace id (auth) */
  workspaceId?: string;
};

/**
 * Discriminated union of stream events.
 */
export type CopilotEvent =
  | { type: "plan"; plan: string[] }
  | { type: "tool_call"; tool: string; args: unknown; iteration: number }
  | { type: "tool_result"; tool: string; ok: boolean; summary: string; data?: unknown; iteration: number }
  | {
      type: "final";
      message: string;
      next_actions?: Array<{ label: string; skill?: string; args?: unknown }>;
    }
  | { type: "error"; message: string };

const MAX_ITERATIONS = 6;

/**
 * Build the system prompt for the planner.
 *
 * @returns System prompt string.
 */
function buildSystemPrompt(): string {
  return `你是 Zeval 的 Chat agent —— 一个能调度评测工具的 AI agent。
你的目标：理解用户对话日志评测需求，规划步骤，调用合适的 skill，最终给出可读的叙事 + 可点击的下一步动作。

可用 skill 清单：
${renderSkillManifest()}

# 输出协议（重要）
你每次回复都必须只输出一个 JSON 对象，且只能是以下三种 type 之一：

1. 规划阶段：
{"type": "plan", "plan": ["第一步：...", "第二步：..."]}

2. 工具调用阶段：
{"type": "tool_call", "tool": "<skill 名>", "args": { ... 参数 ... }}

3. 收尾阶段（叙事 + 推荐下一步动作）：
{
  "type": "final",
  "message": "<面向用户的中文叙述，指出关键发现>",
  "next_actions": [
    {"label": "生成调优包", "skill": "build_remediation", "args": {}},
    {"label": "保存为基线", "skill": "save_baseline", "args": {}}
  ]
}

# 调度规则
- 只能调用上面列出的 skill，不要发明新名字
- 如果用户只是普通聊天、问产品/用法/能力，直接输出 type=final，不要调用工具
- 如果用户附带了 rawRows，第一步通常调 run_evaluate
- run_evaluate 之后建议调 summarize_findings 看 top 风险，再决定是否 build_remediation
- 不要重复调同一个 skill，除非参数明显不同
- 最多 ${MAX_ITERATIONS} 轮，必须以 type=final 结束

# 语气
对 PM/CEO 友好：避免 "trace/judge/threshold" 这类术语，改说 "评估、风险、调优包"。`;
}

/**
 * Format a skill result for the LLM (compact, summary-only — never raw blobs).
 *
 * @param toolName Skill name.
 * @param result Skill result.
 * @returns A short message to inject as `assistant`/`user` follow-up.
 */
function formatToolResultForLlm(toolName: string, result: SkillResult): string {
  return JSON.stringify({
    skill_result: toolName,
    ok: result.ok,
    summary: result.summary,
    error: result.error,
  });
}

/**
 * Run the orchestration loop and emit a stream of events via the callback.
 *
 * @param input Copilot input.
 * @param emit Per-event callback (used by the API route to stream).
 * @returns Final state for unit tests / non-streaming callers.
 */
export async function runCopilotTurn(
  input: CopilotInput,
  emit: (event: CopilotEvent) => void,
): Promise<{ events: CopilotEvent[] }> {
  const events: CopilotEvent[] = [];
  const push = (e: CopilotEvent) => {
    events.push(e);
    emit(e);
  };

  const ctx: SkillContext = { scratch: {}, workspaceId: input.workspaceId };

  // Pre-load attachments into scratch so skills can reference them by convention.
  if (input.attachments?.rawRows?.length) {
    ctx.scratch.attachedRawRows = input.attachments.rawRows;
  }
  if (input.attachments?.scenarioId) {
    ctx.scratch.attachedScenarioId = input.attachments.scenarioId;
  }
  if (input.attachments?.sourceFileName) {
    ctx.scratch.attachedFileName = input.attachments.sourceFileName;
  }

  const systemPrompt = buildSystemPrompt();
  const llmHistory: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
    { role: "system", content: systemPrompt },
  ];

  // Inject conversation history.
  for (const m of input.messages) {
    llmHistory.push({ role: m.role === "system" ? "user" : m.role, content: m.content });
  }

  // Inject attachment hint as a user message so the planner knows what's available.
  if (input.attachments?.rawRows?.length) {
    llmHistory.push({
      role: "user",
      content: `[附件] 已上传 rawRows ${input.attachments.rawRows.length} 条，调 run_evaluate 时可直接传 rawRows: <use scratch.attachedRawRows>。${
        input.attachments.scenarioId ? `场景: ${input.attachments.scenarioId}` : ""
      }`,
    });
  }

  for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration += 1) {
    let raw: string;
    try {
      raw = await requestSiliconFlowChatCompletion(llmHistory, {
        stage: `copilot:plan:iter-${iteration}`,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      push({ type: "error", message: `LLM 调用失败：${msg}` });
      return { events };
    }

    const action = parseJsonObjectFromLlmOutput(raw);
    if (!action || typeof action !== "object") {
      push({ type: "error", message: "LLM 返回不是合法 JSON，已停止。" });
      return { events };
    }
    const a = action as Record<string, unknown>;
    llmHistory.push({ role: "assistant", content: JSON.stringify(a) });

    if (a.type === "plan") {
      const plan = Array.isArray(a.plan) ? (a.plan as unknown[]).map((s) => String(s)).slice(0, 8) : [];
      push({ type: "plan", plan });
      // After a plan, immediately solicit the first tool call.
      llmHistory.push({
        role: "user",
        content: "请按计划开始第一步，输出 tool_call。",
      });
      continue;
    }

    if (a.type === "tool_call") {
      const tool = String(a.tool ?? "");
      let args: unknown = a.args ?? {};
      const skill = SKILL_REGISTRY[tool];
      if (!skill) {
        const msg = `未知 skill: ${tool}`;
        push({ type: "tool_result", tool, ok: false, summary: msg, iteration });
        llmHistory.push({ role: "user", content: formatToolResultForLlm(tool, { ok: false, summary: msg }) });
        continue;
      }

      // Resolve the convention that "rawRows must come from scratch" — if the LLM
      // emits a placeholder string referring to scratch, swap in the actual rows.
      args = resolveScratchReferences(args, ctx);
      if (tool === "run_evaluate" && !ctx.scratch.attachedRawRows) {
        push({
          type: "final",
          message:
            "我还没拿到这周客服对话日志，所以不能直接评估真实表现。请先附加 CSV / JSON 日志，或点击内置示例日志跑一遍 Demo。",
          next_actions: [],
        });
        return { events };
      }

      push({ type: "tool_call", tool, args, iteration });

      let result: SkillResult;
      try {
        result = await skill.execute(args, ctx);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        result = { ok: false, summary: `执行失败：${msg}`, error: msg };
      }
      push({
        type: "tool_result",
        tool,
        ok: result.ok,
        summary: result.summary,
        data: result.data,
        iteration,
      });
      llmHistory.push({ role: "user", content: formatToolResultForLlm(tool, result) });
      continue;
    }

    if (a.type === "final") {
      const message = String(a.message ?? "");
      const next_actions = Array.isArray(a.next_actions)
        ? (a.next_actions as unknown[]).slice(0, 4).map((item) => {
            const r = (item as Record<string, unknown>) ?? {};
            return {
              label: String(r.label ?? "下一步"),
              skill: typeof r.skill === "string" ? r.skill : undefined,
              args: r.args ?? undefined,
            };
          })
        : [];
      push({ type: "final", message, next_actions });
      return { events };
    }

    const fallbackMessage = coerceFinalMessage(a);
    if (fallbackMessage) {
      push({ type: "final", message: fallbackMessage, next_actions: [] });
      return { events };
    }

    push({
      type: "final",
      message: "我没能识别这次回复格式。你可以直接问我产品/评估相关问题，或附加日志让我跑一次客服表现评估。",
      next_actions: [],
    });
    return { events };
  }

  push({ type: "error", message: "已达到最大迭代次数，未能给出 final。" });
  return { events };
}

/**
 * Coerce protocol-adjacent model output into a final chat message.
 * @param action Parsed JSON object from the model.
 * @returns User-facing message when available.
 */
function coerceFinalMessage(action: Record<string, unknown>): string | null {
  const candidates = [action.message, action.answer, action.content, action.response, action.text];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

/**
 * Replace any string field equal to a `<use scratch.XXX>` placeholder with the
 * actual scratch value so the LLM doesn't have to ferry large blobs through JSON.
 *
 * @param args Raw args from the LLM tool call.
 * @param ctx Skill context.
 * @returns Args with scratch references resolved.
 */
function resolveScratchReferences(args: unknown, ctx: SkillContext): unknown {
  if (!args || typeof args !== "object") return args;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args as Record<string, unknown>)) {
    if (typeof v === "string") {
      const m = /^<use\s+scratch\.([a-zA-Z0-9_]+)>$/.exec(v.trim());
      if (m && ctx.scratch[m[1]] !== undefined) {
        out[k] = ctx.scratch[m[1]];
        continue;
      }
    }
    // Auto-fill: if k is rawRows and missing/empty, use attached rawRows.
    if (k === "rawRows" && (!Array.isArray(v) || v.length === 0) && ctx.scratch.attachedRawRows) {
      out[k] = ctx.scratch.attachedRawRows as unknown[];
      continue;
    }
    out[k] = v as unknown;
  }
  // Ensure rawRows fallback even if LLM omitted it entirely.
  if (!("rawRows" in out) && ctx.scratch.attachedRawRows) {
    out.rawRows = ctx.scratch.attachedRawRows as unknown[];
  }
  return out;
}
