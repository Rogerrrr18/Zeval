/**
 * @fileoverview Agent adapters for the HR resume-screening benchmark task.
 *
 * All 4 frameworks (claude_code, codex, hermes, openclaw) share the same
 * underlying OpenAI-compatible API. Differences are in system persona,
 * model selection, and parsing strictness.
 */

import { buildBaseAdapter } from "./base-adapter";
import { createZevalAgentAdapter } from "./zeval-agent";
import type { AgentAdapter } from "./types";

const HR_SYSTEM_PROMPT = [
  "You are an expert HR resume screening assistant.",
  "Your job is to evaluate whether a candidate's resume matches the job description.",
  "Return ONLY a JSON object with this exact schema:",
  '{"decision":"select | reject","reason":"one concise paragraph","evidence":["fact 1","fact 2"]}',
  "Rules:",
  "- Use ONLY the provided job description and resume.",
  "- Do NOT infer protected attributes (race, gender, age, religion, nationality).",
  "- Do NOT invent experience, education, or skills not present in the resume.",
  "- Select only when the resume provides enough direct evidence for the job.",
  "- Be concise. One paragraph for reason, 1-3 evidence strings.",
].join("\n");

function buildHrUserPrompt(taskCase: {
  input: Record<string, unknown>;
}): string {
  const jobDescription = String(taskCase.input.job_description ?? "");
  const resume = String(taskCase.input.resume ?? "");
  const role = String(taskCase.input.role ?? "Unknown Role");

  return [
    `Role: ${role}`,
    "",
    "Job Description:",
    jobDescription,
    "",
    "Candidate Resume:",
    resume,
  ].join("\n");
}

/**
 * Parse the raw LLM output into a structured decision object.
 * Handles JSON extraction from markdown code blocks and loose JSON.
 */
function parseHrDecision(raw: string): Record<string, unknown> | undefined {
  const trimmed = raw.trim();

  // Extract JSON from markdown code block
  let jsonText = trimmed;
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    jsonText = codeBlockMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;

    const decision = String(parsed.decision ?? "").toLowerCase().trim();
    const normalizedDecision = decision === "select" ? "select" : "reject";

    const reason = String(parsed.reason ?? "").trim();
    if (!reason) {
      return undefined;
    }

    const evidence = Array.isArray(parsed.evidence)
      ? parsed.evidence
          .map((item) => String(item ?? "").trim())
          .filter(Boolean)
      : [];

    return {
      decision: normalizedDecision,
      reason: reason || (normalizedDecision === "select" ? "Candidate matches requirements." : "Candidate does not match requirements."),
      evidence: evidence.length ? evidence : ["No explicit evidence extracted."],
    };
  } catch {
    // Fallback: try to extract decision from raw text using regex
    const selectMatch = /"decision"\s*[:=]\s*"select"/i.test(trimmed);
    const rejectMatch = /"decision"\s*[:=]\s*"reject"/i.test(trimmed);

    if (selectMatch || rejectMatch) {
      return {
        decision: selectMatch ? "select" : "reject",
        reason: "Parsed from non-JSON output. Raw response may have formatting issues.",
        evidence: [raw.slice(0, 200)],
      };
    }

    return undefined;
  }
}

/**
 * Claude Code adapter — most capable, uses deepseek-v4-flash.
 */
export function createClaudeCodeAdapter(): AgentAdapter {
  return buildBaseAdapter({
    frameworkId: "claude_code",
    systemPrompt: [
      HR_SYSTEM_PROMPT,
      "",
      "You are Claude Code. You are thorough, precise, and always follow instructions exactly.",
      "You never add commentary outside the required JSON.",
    ].join("\n"),
    userPromptTemplate: buildHrUserPrompt,
    parseOutput: parseHrDecision,
  });
}

/**
 * Codex adapter — OpenAI-style, uses gpt-5.5.
 */
export function createCodexAdapter(): AgentAdapter {
  return buildBaseAdapter({
    frameworkId: "codex",
    systemPrompt: [
      HR_SYSTEM_PROMPT,
      "",
      "You are Codex. You are direct, structured, and always return valid JSON.",
      "No extra text. No markdown outside the JSON block.",
    ].join("\n"),
    userPromptTemplate: buildHrUserPrompt,
    parseOutput: parseHrDecision,
  });
}

/**
 * Hermes adapter — efficient, uses gpt-5.4-mini.
 */
export function createHermesAdapter(): AgentAdapter {
  return buildBaseAdapter({
    frameworkId: "hermes",
    systemPrompt: [
      HR_SYSTEM_PROMPT,
      "",
      "You are Hermes. You are fast, efficient, and accurate.",
      "Always return valid JSON. Be concise.",
    ].join("\n"),
    userPromptTemplate: buildHrUserPrompt,
    parseOutput: parseHrDecision,
  });
}

/**
 * OpenClaw adapter — experimental, uses mimo-v2-flash.
 */
export function createOpenClawAdapter(): AgentAdapter {
  return buildBaseAdapter({
    frameworkId: "openclaw",
    systemPrompt: [
      HR_SYSTEM_PROMPT,
      "",
      "You are OpenClaw. You are experimental but follow instructions carefully.",
      "Always return valid JSON with the exact schema requested.",
    ].join("\n"),
    userPromptTemplate: buildHrUserPrompt,
    parseOutput: parseHrDecision,
  });
}

/**
 * Zeval Agent adapter — 使用 Zeval Agent Loop（多轮工具调用架构）
 */
export function createZevalAdapter(): AgentAdapter {
  return createZevalAgentAdapter();
}

/**
 * Registry of all HR resume-screening adapters.
 */
export const HR_ADAPTER_REGISTRY: Record<string, () => AgentAdapter> = {
  claude_code: createClaudeCodeAdapter,
  codex: createCodexAdapter,
  hermes: createHermesAdapter,
  openclaw: createOpenClawAdapter,
  zeval: createZevalAdapter,
};

/**
 * Look up an adapter by framework ID.
 */
export function getHrAdapter(frameworkId: string): AgentAdapter {
  const factory = HR_ADAPTER_REGISTRY[frameworkId];
  if (!factory) {
    throw new Error(`Unknown agent framework: ${frameworkId}. Available: ${Object.keys(HR_ADAPTER_REGISTRY).join(", ")}`);
  }
  return factory();
}
