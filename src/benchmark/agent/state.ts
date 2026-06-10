/**
 * @fileoverview Agent 状态管理
 *
 * 模仿 Hermes 的 state 设计，提供：
 * - 可序列化的状态快照
 * - 事务式状态更新
 * - 从任意状态恢复的断点续传
 */

import type { AgentPhase, AgentState, AgentTurn } from "./types";

/**
 * 创建一个全新的 Agent 状态
 */
export function createAgentState(runId: string, maxTurns = 30): AgentState {
  const now = new Date().toISOString();
  return {
    stateId: `state_${runId}`,
    runId,
    phase: "idle",
    currentTurn: 0,
    maxTurns,
    turns: [],
    memory: {},
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * 从序列化快照恢复状态
 */
export function hydrateAgentState(snapshot: unknown): AgentState | undefined {
  if (!snapshot || typeof snapshot !== "object") return undefined;
  const s = snapshot as Record<string, unknown>;

  if (
    typeof s.stateId === "string" &&
    typeof s.runId === "string" &&
    typeof s.currentTurn === "number" &&
    typeof s.maxTurns === "number" &&
    Array.isArray(s.turns)
  ) {
    return {
      ...s,
      phase: (s.phase as AgentPhase) ?? "idle",
      memory: (s.memory as Record<string, unknown>) ?? {},
      createdAt: String(s.createdAt),
      updatedAt: String(s.updatedAt),
    } as AgentState;
  }
  return undefined;
}

/**
 * 将状态序列化为 JSON 字符串
 */
export function serializeAgentState(state: AgentState): string {
  return JSON.stringify(state, null, 2);
}

/**
 * 切换阶段，返回新状态
 */
export function transitionPhase(state: AgentState, phase: AgentPhase): AgentState {
  return {
    ...state,
    phase,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 开始新的一轮
 */
export function startTurn(state: AgentState, messages: AgentTurn["messages"]): AgentState {
  const turnId = state.currentTurn + 1;
  const turn: AgentTurn = {
    turnId,
    phase: state.phase,
    messages,
    timestamp: new Date().toISOString(),
    durationMs: 0,
  };

  return {
    ...state,
    currentTurn: turnId,
    turns: [...state.turns, turn],
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 结束当前轮，记录耗时
 */
export function endTurn(state: AgentState, toolCalls?: AgentTurn["toolCalls"], toolResults?: AgentTurn["toolResults"]): AgentState {
  const lastTurn = state.turns[state.turns.length - 1];
  if (!lastTurn) return state;

  const started = new Date(lastTurn.timestamp).getTime();
  const durationMs = Date.now() - started;

  const updatedTurns = [...state.turns];
  updatedTurns[updatedTurns.length - 1] = {
    ...lastTurn,
    durationMs,
    toolCalls,
    toolResults,
  };

  return {
    ...state,
    turns: updatedTurns,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 在内存中存储键值
 */
export function setMemory<K extends string>(
  state: AgentState,
  key: K,
  value: unknown,
): AgentState {
  return {
    ...state,
    memory: { ...state.memory, [key]: value },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * 从内存中读取键值
 */
export function getMemory<T = unknown>(state: AgentState, key: string): T | undefined {
  return state.memory[key] as T | undefined;
}

/**
 * 检查是否达到最大轮数
 */
export function isMaxTurnsReached(state: AgentState): boolean {
  return state.currentTurn >= state.maxTurns;
}

/**
 * 获取当前轮的对话历史（用于传给 LLM）
 */
export function buildMessageHistory(state: AgentState): AgentTurn["messages"] {
  const messages: AgentTurn["messages"] = [];
  for (const turn of state.turns) {
    messages.push(...turn.messages);
    if (turn.toolCalls) {
      for (const tc of turn.toolCalls) {
        messages.push({
          role: "assistant",
          content: `<tool_call>\n{"id": "${tc.id}", "name": "${tc.name}", "arguments": ${JSON.stringify(tc.arguments)}}\n</tool_call>`,
        });
      }
    }
    if (turn.toolResults) {
      for (const tr of turn.toolResults) {
        messages.push({
          role: "tool",
          tool_call_id: tr.tool_call_id,
          name: tr.name,
          content: JSON.stringify(tr.status === "success" ? tr.result : { error: tr.error }),
        });
      }
    }
  }
  return messages;
}

/**
 * AgentStateManager 类 — 提供面向对象的状态管理
 */
export class AgentStateManager {
  private state: AgentState;

  constructor(runId: string, maxTurns = 30) {
    this.state = createAgentState(runId, maxTurns);
  }

  getState(): AgentState {
    return this.state;
  }

  getSnapshot(): AgentState {
    return JSON.parse(serializeAgentState(this.state));
  }

  transition(phase: AgentPhase): this {
    this.state = transitionPhase(this.state, phase);
    return this;
  }

  startTurn(messages: AgentTurn["messages"]): this {
    this.state = startTurn(this.state, messages);
    return this;
  }

  endTurn(toolCalls?: AgentTurn["toolCalls"], toolResults?: AgentTurn["toolResults"]): this {
    this.state = endTurn(this.state, toolCalls, toolResults);
    return this;
  }

  setMemory(key: string, value: unknown): this {
    this.state = setMemory(this.state, key, value);
    return this;
  }

  getMemory<T = unknown>(key: string): T | undefined {
    return getMemory<T>(this.state, key);
  }

  isMaxTurnsReached(): boolean {
    return isMaxTurnsReached(this.state);
  }

  buildHistory(): AgentTurn["messages"] {
    return buildMessageHistory(this.state);
  }

  restore(snapshot: unknown): boolean {
    const hydrated = hydrateAgentState(snapshot);
    if (hydrated) {
      this.state = hydrated;
      return true;
    }
    return false;
  }
}
