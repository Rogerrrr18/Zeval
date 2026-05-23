import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read SiliconFlow config from process.env first, then project root env files.
 * @returns {{ apiKey?: string, baseUrl: string, model: string }}
 */
export function readSiliconFlowConfig() {
  const rootDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const rootEnv = readEnvFile(path.join(rootDirectory, ".env"));
  const localEnv = readEnvFile(path.join(rootDirectory, ".env.local"));
  const exampleEnv = readEnvFile(path.join(rootDirectory, ".env.example"));

  return {
    apiKey:
      process.env.SILICONFLOW_API_KEY ||
      process.env.ZEVAL_JUDGE_API_KEY ||
      process.env.ZEVAL_LLM_API_KEY ||
      rootEnv.SILICONFLOW_API_KEY ||
      rootEnv.ZEVAL_JUDGE_API_KEY ||
      rootEnv.ZEVAL_LLM_API_KEY ||
      localEnv.SILICONFLOW_API_KEY ||
      exampleEnv.SILICONFLOW_API_KEY,
    baseUrl:
      process.env.SILICONFLOW_BASE_URL ||
      process.env.ZEVAL_JUDGE_BASE_URL ||
      process.env.ZEVAL_LLM_BASE_URL ||
      rootEnv.SILICONFLOW_BASE_URL ||
      rootEnv.ZEVAL_JUDGE_BASE_URL ||
      rootEnv.ZEVAL_LLM_BASE_URL ||
      localEnv.SILICONFLOW_BASE_URL ||
      exampleEnv.SILICONFLOW_BASE_URL ||
      "https://api.siliconflow.cn/v1",
    model:
      process.env.SILICONFLOW_MODEL ||
      process.env.ZEVAL_JUDGE_MODEL ||
      process.env.ZEVAL_LLM_MODEL ||
      rootEnv.SILICONFLOW_MODEL ||
      rootEnv.ZEVAL_JUDGE_MODEL ||
      rootEnv.ZEVAL_LLM_MODEL ||
      localEnv.SILICONFLOW_MODEL ||
      exampleEnv.SILICONFLOW_MODEL ||
      "Qwen/Qwen3.5-27B",
    fallbackModels: parseCsvEnv(
      process.env.SILICONFLOW_FALLBACK_MODELS ||
        process.env.ZEVAL_JUDGE_FALLBACK_MODELS ||
        process.env.ZEVAL_LLM_FALLBACK_MODELS ||
        rootEnv.SILICONFLOW_FALLBACK_MODELS ||
        rootEnv.ZEVAL_JUDGE_FALLBACK_MODELS ||
        rootEnv.ZEVAL_LLM_FALLBACK_MODELS ||
        "",
    ),
    flattenSystemPrompt: parseBooleanEnv(
      process.env.SILICONFLOW_FLATTEN_SYSTEM_PROMPT ||
        process.env.ZEVAL_JUDGE_FLATTEN_SYSTEM_PROMPT ||
        process.env.ZEVAL_LLM_FLATTEN_SYSTEM_PROMPT ||
        rootEnv.SILICONFLOW_FLATTEN_SYSTEM_PROMPT ||
        rootEnv.ZEVAL_JUDGE_FLATTEN_SYSTEM_PROMPT ||
        rootEnv.ZEVAL_LLM_FLATTEN_SYSTEM_PROMPT,
    ),
  };
}

/**
 * Parse comma-separated env values.
 * @param {string} value Raw env value.
 * @returns {string[]} Non-empty values.
 */
function parseCsvEnv(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Parse a boolean-like env value.
 * @param {string | undefined} value Raw env value.
 * @returns {boolean}
 */
function parseBooleanEnv(value) {
  return /^(1|true|yes)$/i.test(String(value || "").trim());
}

/**
 * Read a simple env file.
 * @param {string} filePath File path.
 * @returns {Record<string, string>}
 */
function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  return fs
    .readFileSync(filePath, "utf8")
    .split(/\r?\n/)
    .reduce((accumulator, line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) {
        return accumulator;
      }

      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex <= 0) {
        return accumulator;
      }

      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");
      accumulator[key] = value;
      return accumulator;
    }, {});
}
