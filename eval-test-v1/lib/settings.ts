/**
 * 读取 process.env 与 data/local.settings.json 合并后的 SiliconFlow 配置。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { MergedSettings } from "@/lib/types";

const DATA_DIR = path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "local.settings.json");

type FileSettings = {
  ZEVAL_JUDGE_API_KEY?: string;
  ZEVAL_INTENT_EXPERIMENT_API_KEY?: string;
  ZEVAL_JUDGE_BASE_URL?: string;
  ZEVAL_JUDGE_MODEL?: string;
  ZEVAL_JUDGE_ENABLE_THINKING?: string | boolean;
};

/**
 * 确保 data 目录存在。
 */
function ensureDataDir(): void {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

/**
 * 从文件读取可选本地覆盖配置。
 * @returns 解析后的对象或空对象。
 */
function readFileSettings(): FileSettings {
  ensureDataDir();
  if (!existsSync(SETTINGS_FILE)) {
    return {};
  }
  try {
    return JSON.parse(readFileSync(SETTINGS_FILE, "utf8")) as FileSettings;
  } catch {
    return {};
  }
}

/**
 * 合并环境变量与本地设置，得到 SiliconFlow 调用参数。
 * @returns 合并后的配置；apiKey 可能为空字符串。
 */
export function getMergedSettings(): MergedSettings {
  const file = readFileSettings();
  const apiKey =
    file.ZEVAL_INTENT_EXPERIMENT_API_KEY ||
    file.ZEVAL_JUDGE_API_KEY ||
    process.env.ZEVAL_INTENT_EXPERIMENT_API_KEY ||
    process.env.ZEVAL_JUDGE_API_KEY ||
    "";
  const baseUrl =
    file.ZEVAL_JUDGE_BASE_URL || process.env.ZEVAL_JUDGE_BASE_URL || "https://api.siliconflow.cn/v1";
  const model = file.ZEVAL_JUDGE_MODEL || process.env.ZEVAL_JUDGE_MODEL || "Qwen/Qwen3.5-27B";
  const thinkingRaw = file.ZEVAL_JUDGE_ENABLE_THINKING ?? process.env.ZEVAL_JUDGE_ENABLE_THINKING;
  const enableThinking = String(thinkingRaw).toLowerCase() === "true";
  return { apiKey, baseUrl, model, enableThinking };
}

/**
 * 将前端提交的设置写入 local.settings.json（不落库密钥到 git）。
 * @param body 部分字段覆盖。
 */
export function saveLocalSettings(body: Partial<FileSettings>): void {
  ensureDataDir();
  const prev = readFileSettings();
  const next = { ...prev, ...body };
  writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf8");
}
