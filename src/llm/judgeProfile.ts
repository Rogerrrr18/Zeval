/**
 * @fileoverview Versioned Zeval judge profile shared by all LLM judge prompts.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ZevalJudgePromptStage =
  | "intent_sequence_extract"
  | "simuser_query_generate"
  | "intent_completion_judge"
  | "subjective_dimension_judge"
  | "goal_completion_judge"
  | "recovery_trace_strategy"
  | "extended_metric_judge";

export type ZevalJudgeGateConfig = {
  minGoldCases: number;
  maxJudgeRunErrorRate: number;
  maxOverallMae: number;
  minGoalStatusAccuracy: number;
  maxDimensionAverageDrift: number;
  maxGoalAverageDrift: number;
  maxRecoveryAverageDrift: number;
};

export type ZevalJudgeProfileSnapshot = {
  profileVersion: string;
  provider: "siliconflow";
  model: string;
  temperature: number;
  topP: number;
  maxTokens: number;
  promptVersions: Record<ZevalJudgePromptStage, string>;
  gate: ZevalJudgeGateConfig;
};

export const ZEVAL_JUDGE_PROFILE_VERSION = "zeval-judge-v2.0.0";
export const ZEVAL_INTENT_EXTRACT_TEMPERATURE = 0.3;
export const ZEVAL_INTENT_EXTRACT_SEED = 42;
export const ZEVAL_JUDGE_DEFAULT_MODEL = "Qwen/Qwen3.5-27B";
export const ZEVAL_JUDGE_TEMPERATURE = 0.2;
export const ZEVAL_JUDGE_TOP_P = 0.7;
export const ZEVAL_JUDGE_MAX_TOKENS = 1200;

export const ZEVAL_JUDGE_PROMPT_VERSIONS: Record<ZevalJudgePromptStage, string> = {
  intent_sequence_extract: "intent-sequence-extract-v2.0.0",
  simuser_query_generate: "simuser-query-generate-v2.0.0",
  intent_completion_judge: "intent-completion-judge-v2.0.0",
  subjective_dimension_judge: "subjective-dimension-v2.0.0",
  goal_completion_judge: "goal-completion-v2.0.0",
  recovery_trace_strategy: "recovery-trace-strategy-v2.0.0",
  extended_metric_judge: "extended-metric-v2.0.0",
};

export const ZEVAL_JUDGE_GATE_CONFIG: ZevalJudgeGateConfig = {
  minGoldCases: 4,
  maxJudgeRunErrorRate: 0,
  maxOverallMae: 1.8,
  minGoalStatusAccuracy: 0.25,
  maxDimensionAverageDrift: 0.4,
  maxGoalAverageDrift: 0.4,
  maxRecoveryAverageDrift: 0.4,
};

let cachedJudgeEnvFile: Record<string, string> | null = null;

/**
 * Build the runtime judge profile used for logging, calibration and CI gates.
 *
 * @returns Stable judge profile snapshot.
 */
export function getZevalJudgeProfileSnapshot(): ZevalJudgeProfileSnapshot {
  return {
    profileVersion: ZEVAL_JUDGE_PROFILE_VERSION,
    provider: "siliconflow",
    model: resolveZevalJudgeModel(),
    temperature: ZEVAL_JUDGE_TEMPERATURE,
    topP: ZEVAL_JUDGE_TOP_P,
    maxTokens: ZEVAL_JUDGE_MAX_TOKENS,
    promptVersions: ZEVAL_JUDGE_PROMPT_VERSIONS,
    gate: ZEVAL_JUDGE_GATE_CONFIG,
  };
}

/**
 * Resolve the configured judge model with Zeval aliases first and legacy aliases second.
 *
 * @returns Model name used by judge calls.
 */
export function resolveZevalJudgeModel(): string {
  const fileEnv = readJudgeEnvFile();
  return (
    process.env.ZEVAL_JUDGE_MODEL ??
    process.env.ZEVAL_LLM_MODEL ??
    process.env.SILICONFLOW_MODEL ??
    fileEnv.ZEVAL_JUDGE_MODEL ??
    fileEnv.ZEVAL_LLM_MODEL ??
    fileEnv.SILICONFLOW_MODEL ??
    ZEVAL_JUDGE_DEFAULT_MODEL
  );
}

/**
 * Resolve the prompt version for one judge stage.
 *
 * @param stage Judge prompt stage.
 * @returns Version string for the stage.
 */
export function getZevalJudgePromptVersion(stage: ZevalJudgePromptStage): string {
  return ZEVAL_JUDGE_PROMPT_VERSIONS[stage];
}

/**
 * Prefix a judge system prompt with immutable Zeval profile metadata.
 *
 * @param stage Judge prompt stage.
 * @param lines Existing prompt lines.
 * @returns Versioned system prompt.
 */
export function buildVersionedJudgeSystemPrompt(
  stage: ZevalJudgePromptStage,
  lines: string[],
): string {
  return [
    "你是 Zeval 的版本化 LLM Judge。",
    `judgeProfile=${ZEVAL_JUDGE_PROFILE_VERSION}`,
    `promptStage=${stage}`,
    `promptVersion=${getZevalJudgePromptVersion(stage)}`,
    "所有判断必须可审计：只基于输入证据，不要编造 evidence。",
    ...lines,
  ].join("\n");
}

/**
 * Map a request stage string back to a versioned judge prompt when possible.
 *
 * @param stage LLM request stage.
 * @returns Prompt version or null for non-judge calls.
 */
export function getPromptVersionForRequestStage(stage: string): string | null {
  if (stage.startsWith("extended-metric:")) {
    return getZevalJudgePromptVersion("extended_metric_judge");
  }
  if (isZevalJudgePromptStage(stage)) {
    return getZevalJudgePromptVersion(stage);
  }
  return null;
}

/**
 * Check whether a string is one of the known prompt stages.
 *
 * @param value Raw stage name.
 * @returns Whether the value is a prompt stage.
 */
function isZevalJudgePromptStage(value: string): value is ZevalJudgePromptStage {
  return (
    value === "intent_sequence_extract" ||
    value === "simuser_query_generate" ||
    value === "intent_completion_judge" ||
    value === "subjective_dimension_judge" ||
    value === "goal_completion_judge" ||
    value === "recovery_trace_strategy" ||
    value === "extended_metric_judge"
  );
}

/**
 * Read model aliases from the local .env file without requiring an API key.
 *
 * @returns Parsed environment key-value map.
 */
function readJudgeEnvFile(): Record<string, string> {
  if (cachedJudgeEnvFile) {
    return cachedJudgeEnvFile;
  }
  const envPath = path.join(/* turbopackIgnore: true */ process.cwd(), ".env");
  if (!existsSync(envPath)) {
    cachedJudgeEnvFile = {};
    return cachedJudgeEnvFile;
  }
  cachedJudgeEnvFile = parseSimpleEnvFile(readFileSync(envPath, "utf8"));
  return cachedJudgeEnvFile;
}

/**
 * Parse a small .env-style file into a key-value map.
 *
 * @param text Raw .env content.
 * @returns Parsed key-value map.
 */
function parseSimpleEnvFile(text: string): Record<string, string> {
  return text.split(/\r?\n/).reduce<Record<string, string>>((acc, line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return acc;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      return acc;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
    acc[key] = value;
    return acc;
  }, {});
}
