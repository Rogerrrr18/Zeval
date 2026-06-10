/**
 * Download CPsyCounD and export ~20 multi-turn sessions as Zeval CSV.
 */
import https from "node:https";
import fs from "node:fs";
import path from "node:path";

const SOURCE_URL =
  "https://huggingface.co/datasets/CAS-SIAT-XinHai/CPsyCoun/resolve/main/CPsyCounD.json";
const OUT_FILE = path.join("public", "sample-data", "companion-emotion-support-20sessions.csv");
/**
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
function download(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode && response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          const nextUrl = new URL(response.headers.location, url).toString();
          download(nextUrl).then(resolve).catch(reject);
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => resolve(Buffer.concat(chunks)));
        response.on("error", reject);
      })
      .on("error", reject);
  });
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeCsv(value) {
  return `"${value.replace(/"/g, '""')}"`;
}

const raw = await download(SOURCE_URL);
const data = JSON.parse(raw.toString("utf8"));
if (!Array.isArray(data)) {
  throw new Error("Unexpected CPsyCounD payload");
}

/**
 * @param {Record<string, unknown>} item
 * @returns {number}
 */
function countTurns(item) {
  const history = Array.isArray(item.history) ? item.history : [];
  let turns = history.length * 2;
  if (String(item.instruction ?? "").trim()) turns += 1;
  if (String(item.output ?? "").trim()) turns += 1;
  return turns;
}

/**
 * @param {Record<string, unknown>} item
 * @returns {string}
 */
function sessionText(item) {
  const history = Array.isArray(item.history) ? item.history : [];
  return [
    ...history.flatMap((pair) => (Array.isArray(pair) ? pair.map(String) : [])),
    String(item.instruction ?? ""),
    String(item.output ?? ""),
  ].join(" ");
}

/**
 * @param {Record<string, unknown>} item
 * @returns {number}
 */
function relevanceScore(item) {
  const text = sessionText(item);
  let score = 0;
  if (/孤独|失望|伤心|焦虑|失眠|婚姻|关系|陪伴|压力|情绪|失落|疲惫|空虚|分手|离婚|老公|丈夫|男朋友|职场|工作/.test(text)) {
    score += 4;
  }
  if (/女性|女生|成年|30岁|35岁|40岁|职场女性|妈妈|母亲/.test(text)) {
    score += 2;
  }
  if (/六岁|6岁|七岁|7岁|孩子|幼儿园|小学|未成年/.test(text)) {
    score -= 5;
  }
  if (countTurns(item) >= 12) score += 2;
  else if (countTurns(item) >= 8) score += 1;
  return score;
}

/** @type {Array<Record<string, unknown>>} */
const ranked = data
  .filter(isRecord)
  .map((item) => ({
    item,
    turns: countTurns(item),
    score: relevanceScore(item),
  }))
  .filter((entry) => entry.turns >= 8 && entry.score > 0)
  .sort((a, b) => b.score - a.score || b.turns - a.turns);

/** @type {Array<Record<string, unknown>>} */
const selected = ranked.slice(0, 20).map((entry) => entry.item);

const rows = ["sessionId,timestamp,role,content"];
const base = Date.parse("2026-05-01T20:00:00+08:00");

/**
 * @param {string} sessionId
 * @param {number} startTimestamp
 * @param {string} role
 * @param {string} content
 * @returns {{ row: string; nextTimestamp: number }}
 */
function pushTurn(sessionId, startTimestamp, role, content) {
  const normalized = content.replace(/\r?\n/g, " ").trim();
  if (!normalized) {
    return { row: "", nextTimestamp: startTimestamp };
  }
  const nextTimestamp = startTimestamp + 15_000 + Math.floor(Math.random() * 25_000);
  return {
    row: [sessionId, new Date(startTimestamp).toISOString(), role, escapeCsv(normalized)].join(","),
    nextTimestamp,
  };
}

selected.forEach((item, index) => {
  const sessionId = `companion_sess_${String(index + 1).padStart(2, "0")}`;
  let timestamp = base + index * 3_600_000;
  const history = Array.isArray(item.history) ? item.history : [];

  for (const pair of history) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    const userTurn = pushTurn(sessionId, timestamp, "user", String(pair[0] ?? ""));
    if (userTurn.row) {
      rows.push(userTurn.row);
      timestamp = userTurn.nextTimestamp;
    }
    const assistantTurn = pushTurn(sessionId, timestamp, "assistant", String(pair[1] ?? ""));
    if (assistantTurn.row) {
      rows.push(assistantTurn.row);
      timestamp = assistantTurn.nextTimestamp;
    }
  }

  const instruction = String(item.instruction ?? "").trim();
  if (instruction) {
    const userTurn = pushTurn(sessionId, timestamp, "user", instruction);
    if (userTurn.row) {
      rows.push(userTurn.row);
      timestamp = userTurn.nextTimestamp;
    }
  }

  const output = String(item.output ?? "").trim();
  if (output) {
    const assistantTurn = pushTurn(sessionId, timestamp, "assistant", output);
    if (assistantTurn.row) {
      rows.push(assistantTurn.row);
    }
  }
});

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, `${rows.join("\n")}\n`, "utf8");

console.log(`sessions=${selected.length}`);
console.log(`rows=${rows.length - 1}`);
console.log(`file=${OUT_FILE}`);
console.log(`avgTurns=${Math.round(selected.reduce((sum, item) => sum + countTurns(item), 0) / Math.max(selected.length, 1))}`);
