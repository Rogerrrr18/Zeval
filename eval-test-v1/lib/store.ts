import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SessionBundle } from "@/lib/types";
import type { ExtractionRoot } from "@/lib/types";

const DATA = path.join(process.cwd(), "data");
const SESSIONS = path.join(DATA, "sessions.json");
const LOCK_DIR = path.join(DATA, "locked");
const RESULTS = path.join(DATA, "results");

function ensureDirs() {
  if (!existsSync(DATA)) mkdirSync(DATA, { recursive: true });
  if (!existsSync(LOCK_DIR)) mkdirSync(LOCK_DIR, { recursive: true });
  if (!existsSync(RESULTS)) mkdirSync(RESULTS, { recursive: true });
}

export type SessionsPayload = { sessions: SessionBundle[] };

/**
 * 读取已上传的 sessions 快照。
 */
export function readSessionsFile(): SessionsPayload | null {
  ensureDirs();
  if (!existsSync(SESSIONS)) return null;
  return JSON.parse(readFileSync(SESSIONS, "utf8")) as SessionsPayload;
}

/**
 * 写入 sessions 快照。
 * @param payload 会话列表。
 */
export function writeSessionsFile(payload: SessionsPayload): void {
  ensureDirs();
  writeFileSync(SESSIONS, JSON.stringify(payload, null, 2), "utf8");
}

/**
 * 锁版文件路径。
 * @param sessionId 会话 id。
 */
export function lockedPath(sessionId: string): string {
  ensureDirs();
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(LOCK_DIR, `${safe}.json`);
}

/**
 * 读取锁版 JSON。
 * @param sessionId 会话 id。
 */
export function readLocked(sessionId: string): ExtractionRoot | null {
  const p = lockedPath(sessionId);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8")) as ExtractionRoot;
}

/**
 * 写入锁版 JSON。
 * @param sessionId 会话 id。
 * @param data 抽取根对象。
 */
export function writeLocked(sessionId: string, data: ExtractionRoot): void {
  ensureDirs();
  writeFileSync(lockedPath(sessionId), JSON.stringify(data, null, 2), "utf8");
}

/**
 * 写入评测结果。
 * @param sessionId 会话 id。
 * @param data 任意可 JSON 序列化对象。
 */
export function writeEvalResult(sessionId: string, data: unknown): void {
  ensureDirs();
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  writeFileSync(path.join(RESULTS, `${safe}.json`), JSON.stringify(data, null, 2), "utf8");
}
