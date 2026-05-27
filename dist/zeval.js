#!/usr/bin/env node
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/db/postgres-database.ts
var postgres_database_exports = {};
__export(postgres_database_exports, {
  PostgresDatabase: () => PostgresDatabase,
  createPostgresDatabaseFromEnv: () => createPostgresDatabaseFromEnv
});
function createPostgresDatabaseFromEnv() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required when ZEVAL_DATABASE_ADAPTER=postgres.");
  }
  return new PostgresDatabase({
    connectionString,
    ssl: resolveSslConfig(connectionString),
    max: Number(process.env.ZEVAL_POSTGRES_POOL_MAX ?? process.env.ZERORE_POSTGRES_POOL_MAX ?? 5)
  });
}
function rowToDbRecord(row) {
  return {
    id: row.id,
    projectId: row.project_id,
    type: row.type,
    payload: row.payload,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at)
  };
}
function toIsoString(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}
function resolveSslConfig(connectionString) {
  const sslMode = process.env.ZEVAL_POSTGRES_SSL ?? process.env.ZERORE_POSTGRES_SSL ?? "auto";
  if (sslMode === "disable") {
    return false;
  }
  if (sslMode === "require" || /supabase|neon|render|railway/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }
  return void 0;
}
async function runWithTransientDatabaseRetry(label, operation) {
  const maxAttempts = Number(
    process.env.ZEVAL_POSTGRES_RETRY_ATTEMPTS ?? process.env.ZERORE_POSTGRES_RETRY_ATTEMPTS ?? 3
  );
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts || !isTransientDatabaseError(error)) {
        throw error;
      }
      const delayMs = 150 * attempt;
      console.warn(
        `[DB] transient postgres error during ${label}; retrying ${attempt}/${maxAttempts - 1} in ${delayMs}ms: ${getErrorMessage(error)}`
      );
      await delay(delayMs);
    }
  }
  throw lastError;
}
function isTransientDatabaseError(error) {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const message = getErrorMessage(error);
  return [
    "08000",
    "08003",
    "08006",
    "57P01",
    "57P02",
    "53300",
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN"
  ].includes(code) || /Connection terminated unexpectedly|Connection terminated|timeout|socket hang up/i.test(message);
}
function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
var import_pg, PostgresDatabase, BRIDGE_TABLE_SQL;
var init_postgres_database = __esm({
  "src/db/postgres-database.ts"() {
    "use strict";
    import_pg = require("pg");
    PostgresDatabase = class {
      constructor(config) {
        this.ready = null;
        this.pool = new import_pg.Pool(config);
      }
      async upsert(record) {
        await runWithTransientDatabaseRetry(
          `upsert zerore_record ${record.projectId}/${record.type}/${record.id}`,
          async () => {
            await this.ensureReady();
            await this.pool.query(
              `
            insert into zerore_records (
              project_id,
              type,
              id,
              payload,
              created_at,
              updated_at
            )
            values ($1, $2, $3, $4::jsonb, $5, $6)
            on conflict (project_id, type, id)
            do update set
              payload = excluded.payload,
              updated_at = excluded.updated_at
          `,
              [
                record.projectId,
                record.type,
                record.id,
                JSON.stringify(record.payload),
                record.createdAt,
                record.updatedAt
              ]
            );
          }
        );
      }
      async get(projectId, type, id) {
        const result2 = await runWithTransientDatabaseRetry(
          `get zerore_record ${projectId}/${type}/${id}`,
          async () => {
            await this.ensureReady();
            return this.pool.query(
              `
            select id, project_id, type, payload, created_at, updated_at
            from zerore_records
            where project_id = $1 and type = $2 and id = $3
            limit 1
          `,
              [projectId, type, id]
            );
          }
        );
        return result2.rows[0] ? rowToDbRecord(result2.rows[0]) : null;
      }
      async list(projectId, type) {
        const result2 = await runWithTransientDatabaseRetry(
          `list zerore_records ${projectId}/${type}`,
          async () => {
            await this.ensureReady();
            return this.pool.query(
              `
            select id, project_id, type, payload, created_at, updated_at
            from zerore_records
            where project_id = $1 and type = $2
            order by updated_at desc
          `,
              [projectId, type]
            );
          }
        );
        return result2.rows.map(rowToDbRecord);
      }
      ensureReady() {
        this.ready ??= this.pool.query(BRIDGE_TABLE_SQL).then(() => void 0);
        this.ready = this.ready.catch((error) => {
          this.ready = null;
          throw error;
        });
        return this.ready;
      }
    };
    BRIDGE_TABLE_SQL = `
  create table if not exists zerore_records (
    project_id text not null default 'default',
    type text not null,
    id text not null,
    payload jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (project_id, type, id)
  );

  create index if not exists idx_zerore_records_project_type_updated
    on zerore_records(project_id, type, updated_at desc);
`;
  }
});

// src/db/local-json-database.ts
var local_json_database_exports = {};
__export(local_json_database_exports, {
  LocalJsonDatabase: () => LocalJsonDatabase
});
function safeSegment(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").toLowerCase() || "unknown";
}
var import_promises, import_node_path, LOCAL_DB_BASE_DIR, LocalJsonDatabase;
var init_local_json_database = __esm({
  "src/db/local-json-database.ts"() {
    "use strict";
    import_promises = require("fs/promises");
    import_node_path = __toESM(require("path"));
    LOCAL_DB_BASE_DIR = process.env.ZEVAL_LOCAL_DB_DIR ?? import_node_path.default.join(process.cwd(), ".zeval-db");
    LocalJsonDatabase = class {
      async upsert(record) {
        const filePath = this.resolveRecordPath(record.projectId, record.type, record.id);
        await (0, import_promises.mkdir)(import_node_path.default.dirname(filePath), { recursive: true });
        await (0, import_promises.writeFile)(filePath, `${JSON.stringify(record, null, 2)}
`, "utf8");
      }
      async get(projectId, type, id) {
        try {
          return JSON.parse(
            await (0, import_promises.readFile)(this.resolveRecordPath(projectId, type, id), "utf8")
          );
        } catch {
          return null;
        }
      }
      async list(projectId, type) {
        const directory = import_node_path.default.join(LOCAL_DB_BASE_DIR, safeSegment(projectId), safeSegment(type));
        let names = [];
        try {
          names = await (0, import_promises.readdir)(directory);
        } catch {
          return [];
        }
        const records = [];
        for (const name of names.filter((item) => item.endsWith(".json"))) {
          try {
            records.push(
              JSON.parse(await (0, import_promises.readFile)(import_node_path.default.join(directory, name), "utf8"))
            );
          } catch {
            continue;
          }
        }
        return records.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
      }
      resolveRecordPath(projectId, type, id) {
        const safeId = safeSegment(id);
        return import_node_path.default.join(LOCAL_DB_BASE_DIR, safeSegment(projectId), safeSegment(type), `${safeId}.json`);
      }
    };
  }
});

// src/cli/index.ts
var import_commander = require("commander");

// src/cli/display.ts
var ESC = "\x1B";
var R = `${ESC}[0m`;
var c = {
  green: (s) => `${ESC}[32m${s}${R}`,
  red: (s) => `${ESC}[31m${s}${R}`,
  yellow: (s) => `${ESC}[33m${s}${R}`,
  cyan: (s) => `${ESC}[36m${s}${R}`,
  blue: (s) => `${ESC}[34m${s}${R}`,
  magenta: (s) => `${ESC}[35m${s}${R}`,
  bold: (s) => `${ESC}[1m${s}${R}`,
  dim: (s) => `${ESC}[2m${s}${R}`
};
function ok(msg) {
  console.log(`${c.green("\u2713")} ${msg}`);
}
function warn(msg) {
  console.warn(`${c.yellow("\u26A0")} ${msg}`);
}
function err(msg) {
  console.error(`${c.red("\u2717")} ${msg}`);
}
function header(title) {
  console.log(`
${c.bold(c.cyan(title))}`);
}
function kv(key, value) {
  console.log(`  ${c.dim(`${key}:`)} ${value}`);
}
function table(rows, padKeyTo = 30) {
  for (const [key, value] of rows) {
    if (key === "") {
      console.log();
      continue;
    }
    const isRule = key.startsWith("\u2500");
    if (isRule) {
      console.log(`  ${c.dim(key)}`);
      continue;
    }
    console.log(`  ${c.dim(key.padEnd(padKeyTo))} ${value}`);
  }
}
var FRAMES = ["\u280B", "\u2819", "\u2839", "\u2838", "\u283C", "\u2834", "\u2826", "\u2827", "\u2807", "\u280F"];
function createSpinner(initialLabel) {
  let label = initialLabel;
  let frame = 0;
  const isTTY = Boolean(process.stdout.isTTY);
  if (!isTTY) {
    process.stdout.write(`  \u2026 ${label}
`);
    return {
      succeed(msg) {
        console.log(`  \u2713 ${msg}`);
      },
      fail(msg) {
        console.error(`  \u2717 ${msg}`);
      },
      update(l) {
        label = l;
      }
    };
  }
  const interval = setInterval(() => {
    process.stdout.write(`\r${c.cyan(FRAMES[frame++ % FRAMES.length])} ${label}  `);
  }, 80);
  return {
    succeed(msg) {
      clearInterval(interval);
      process.stdout.write(`\r${c.green("\u2713")} ${msg}                    
`);
    },
    fail(msg) {
      clearInterval(interval);
      process.stdout.write(`\r${c.red("\u2717")} ${msg}                    
`);
    },
    update(l) {
      label = l;
    }
  };
}

// src/cli/commands/evaluate.ts
var import_promises6 = require("fs/promises");
var import_node_path9 = require("path");

// src/eval-datasets/admission/pipeline.ts
var import_node_crypto2 = require("crypto");

// src/eval-datasets/case-transcript-hash.ts
var import_node_crypto = require("crypto");
function normalizeTranscriptForHash(raw) {
  const collapsed = raw.normalize("NFKC").replace(/\r\n/g, "\n").replace(/[\u0009\u000A\u000B\u000C\u000D\u0020\u0085\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/g, " ").trim().toLowerCase();
  return collapsed.replace(/[，。！？、；：“”‘’（）【】《》.,!?;:'"()[\]<>_-]/g, "");
}
function computeNormalizedTranscriptHash(rawTranscript) {
  const normalized = normalizeTranscriptForHash(rawTranscript);
  return (0, import_node_crypto.createHash)("sha256").update(normalized, "utf8").digest("hex");
}
function tokenizeNormalized(normalized) {
  const tokens = normalized.split(/\s+/).filter(Boolean);
  return new Set(tokens);
}
function jaccardTranscriptSimilarity(a, b) {
  const setA = tokenizeNormalized(normalizeTranscriptForHash(a));
  const setB = tokenizeNormalized(normalizeTranscriptForHash(b));
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return intersection / union;
}

// src/badcase/dedupe.ts
var JACCARD_NEAR_DUP_THRESHOLD = 0.85;
function findBadCaseDuplicate(candidate, existingCases) {
  const exact = existingCases.find((item) => item.normalizedTranscriptHash === candidate.normalizedTranscriptHash);
  if (exact) {
    return {
      isDuplicate: true,
      layer: "l1_exact_hash",
      matchedCaseId: exact.caseId,
      similarityScore: 1
    };
  }
  if (candidate.featureSnapshot.textEmbedding.length > 0) {
    const semantic = findBestSemanticMatch(candidate.featureSnapshot, existingCases);
    if (semantic && semantic.similarityScore >= 0.95) {
      return {
        isDuplicate: true,
        layer: "l2_semantic",
        matchedCaseId: semantic.caseId,
        similarityScore: semantic.similarityScore
      };
    }
  } else if (candidate.transcript) {
    const jaccard = findBestJaccardMatch(candidate.transcript, existingCases);
    if (jaccard) {
      return {
        isDuplicate: true,
        layer: "l2_semantic",
        matchedCaseId: jaccard.caseId,
        similarityScore: jaccard.similarityScore
      };
    }
  }
  const structural = findBestStructuralMatch(candidate.featureSnapshot, existingCases);
  if (structural && structural.metricDistance <= 0.1 && structural.tagDistance === 0) {
    return {
      isDuplicate: true,
      layer: "l3_structural",
      matchedCaseId: structural.caseId,
      metricDistance: structural.metricDistance,
      tagDistance: structural.tagDistance
    };
  }
  return {
    isDuplicate: false,
    layer: "none"
  };
}
function cosineSimilarity(left, right) {
  const dimension = Math.max(left.length, right.length);
  if (dimension === 0) {
    return 0;
  }
  let numerator = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < dimension; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    numerator += leftValue * rightValue;
    leftNorm += leftValue * leftValue;
    rightNorm += rightValue * rightValue;
  }
  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }
  return numerator / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}
function metricVectorDistance(left, right) {
  const keys = [.../* @__PURE__ */ new Set([...left.metricKeys, ...right.metricKeys])];
  const leftMap = new Map(left.metricKeys.map((key, index) => [key, left.metricVector[index] ?? 0]));
  const rightMap = new Map(right.metricKeys.map((key, index) => [key, right.metricVector[index] ?? 0]));
  const distance = Math.sqrt(
    keys.reduce((sum, key) => {
      const delta = (leftMap.get(key) ?? 0) - (rightMap.get(key) ?? 0);
      return sum + delta * delta;
    }, 0)
  );
  return Number((distance / Math.max(1, Math.sqrt(keys.length))).toFixed(4));
}
function tagVectorDistance(left, right) {
  const keys = [.../* @__PURE__ */ new Set([...left.tagKeys, ...right.tagKeys])];
  if (keys.length === 0) {
    return 0;
  }
  const leftSet = new Set(left.tagKeys.filter((_, index) => left.tagVector[index] === 1));
  const rightSet = new Set(right.tagKeys.filter((_, index) => right.tagVector[index] === 1));
  const mismatches = keys.filter((key) => leftSet.has(key) !== rightSet.has(key)).length;
  return Number((mismatches / keys.length).toFixed(4));
}
function findBestJaccardMatch(transcript, existingCases) {
  let best = null;
  for (const item of existingCases) {
    if (!item.transcript) continue;
    const score = Number(jaccardTranscriptSimilarity(transcript, item.transcript).toFixed(4));
    if (score >= JACCARD_NEAR_DUP_THRESHOLD && (!best || score > best.similarityScore)) {
      best = { caseId: item.caseId, similarityScore: score };
    }
  }
  return best;
}
function findBestSemanticMatch(candidate, existingCases) {
  let best = null;
  existingCases.forEach((item) => {
    if (!item.featureSnapshot) {
      return;
    }
    const similarityScore = Number(
      cosineSimilarity(candidate.textEmbedding, item.featureSnapshot.textEmbedding).toFixed(4)
    );
    if (!best || similarityScore > best.similarityScore) {
      best = { caseId: item.caseId, similarityScore };
    }
  });
  return best;
}
function findBestStructuralMatch(candidate, existingCases) {
  let best = null;
  existingCases.forEach((item) => {
    if (!item.featureSnapshot) {
      return;
    }
    const metricDistance = metricVectorDistance(candidate, item.featureSnapshot);
    const tagDistance = tagVectorDistance(candidate, item.featureSnapshot);
    if (!best || metricDistance + tagDistance < best.metricDistance + best.tagDistance) {
      best = { caseId: item.caseId, metricDistance, tagDistance };
    }
  });
  return best;
}

// src/badcase/feature.ts
var METRIC_KEYS = [
  "severity_score",
  "turn_count_norm",
  "low_emotion_rate",
  "avg_response_gap_norm",
  "topic_switch_rate_norm",
  "question_repeat_risk",
  "escalation_hit",
  "goal_failure_risk",
  "recovery_failure_risk",
  "understanding_barrier_risk",
  "emotion_recovery_failure_risk",
  "off_topic_badness",
  "empathy_gap",
  "preachiness_gap",
  "business_risk"
];
function buildBadCaseFeatureSnapshot(evaluate, assetIndex) {
  const asset = evaluate.badCaseAssets[assetIndex];
  const sessionRows = evaluate.enrichedRows.filter((row) => row.sessionId === asset.sessionId);
  const userRows = sessionRows.filter((row) => row.role === "user");
  const gapRows = sessionRows.map((row) => row.responseGapSec).filter((gap) => typeof gap === "number");
  const repeatedQuestions = findRepeatedQuestionCount(userRows.map((row) => row.content));
  const avgGap = gapRows.length > 0 ? gapRows.reduce((sum, gap) => sum + gap, 0) / gapRows.length : 0;
  const sessionTopicSwitches = 0;
  const goalCompletion = evaluate.subjectiveMetrics.goalCompletions.find((item) => item.sessionId === asset.sessionId);
  const recoveryTrace = evaluate.subjectiveMetrics.recoveryTraces.find((item) => item.sessionId === asset.sessionId);
  const understandingSignal = evaluate.subjectiveMetrics.signals.find(
    (item) => item.signalKey === "understandingBarrierRisk" && item.evidenceTurnRange.startsWith(`${asset.sessionId}:`)
  )?.score ?? 0;
  const recoverySignal = 0;
  const empathyScore = evaluate.subjectiveMetrics.dimensions.find((item) => item.dimension === "\u5171\u60C5\u7A0B\u5EA6")?.score ?? 3;
  const offTopicScore = evaluate.subjectiveMetrics.dimensions.find((item) => item.dimension === "\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669")?.score ?? 3;
  const preachinessScore = evaluate.subjectiveMetrics.dimensions.find((item) => item.dimension === "\u8BF4\u6559\u611F/\u538B\u8FEB\u611F")?.score ?? 3;
  const businessRisk = evaluate.scenarioEvaluation ? 1 - evaluate.scenarioEvaluation.averageScore : 0.5;
  const metricValues = /* @__PURE__ */ new Map([
    ["severity_score", asset.severityScore],
    ["turn_count_norm", clamp01(sessionRows.length / 20)],
    ["low_emotion_rate", 0],
    ["avg_response_gap_norm", clamp01(avgGap / 120)],
    ["topic_switch_rate_norm", clamp01(Math.max(0, sessionTopicSwitches) / 3)],
    ["question_repeat_risk", clamp01(repeatedQuestions / Math.max(1, userRows.length))],
    ["escalation_hit", asset.tags.includes("escalation_keyword") ? 1 : 0],
    ["goal_failure_risk", mapGoalStatusToRisk(goalCompletion?.status)],
    ["recovery_failure_risk", mapRecoveryStatusToRisk(recoveryTrace?.status)],
    ["understanding_barrier_risk", clamp01(understandingSignal)],
    ["emotion_recovery_failure_risk", clamp01(recoverySignal)],
    ["off_topic_badness", clamp01(1 - offTopicScore / 5)],
    ["empathy_gap", clamp01(1 - empathyScore / 5)],
    ["preachiness_gap", clamp01(1 - preachinessScore / 5)],
    ["business_risk", clamp01(businessRisk)]
  ]);
  const tagKeys = buildTagKeys(evaluate, assetIndex);
  const metricVector = METRIC_KEYS.map((key) => metricValues.get(key) ?? 0);
  const tagVector = tagKeys.map(() => 1);
  const textEmbedding = buildLexicalHashEmbedding(
    asset.evidence.length > 0 ? asset.evidence.map((item) => item.content).join("\n") : asset.transcript,
    64
  );
  return {
    version: "badcase_feature_v1",
    metricKeys: [...METRIC_KEYS],
    metricVector,
    tagKeys,
    tagVector,
    textEmbedding,
    embeddingModel: "lexical_hash_v1"
  };
}
function buildTagKeys(evaluate, assetIndex) {
  const asset = evaluate.badCaseAssets[assetIndex];
  const keys = asset.tags.map((tag) => `failure:${tag}`);
  if (evaluate.scenarioEvaluation) {
    keys.push(`scenario:${evaluate.scenarioEvaluation.scenarioId}`);
    evaluate.scenarioEvaluation.kpis.filter((item) => item.status !== "healthy").forEach((item) => {
      keys.push(`kpi:${item.id}:${item.status}`);
    });
  }
  return [...new Set(keys)].sort();
}
function buildLexicalHashEmbedding(text, dimensions) {
  const vector = new Array(dimensions).fill(0);
  const tokens = tokenize(text);
  tokens.forEach((token) => {
    const index = hashToken(token, dimensions);
    vector[index] += 1;
  });
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    return vector;
  }
  return vector.map((value) => Number((value / norm).toFixed(6)));
}
function mapGoalStatusToRisk(status) {
  if (status === "failed") {
    return 1;
  }
  if (status === "partial") {
    return 0.6;
  }
  if (status === "unclear") {
    return 0.35;
  }
  return 0;
}
function mapRecoveryStatusToRisk(status) {
  if (status === "failed") {
    return 1;
  }
  if (status === "completed") {
    return 0.2;
  }
  return 0;
}
function findRepeatedQuestionCount(questions) {
  const counts = /* @__PURE__ */ new Map();
  questions.forEach((question) => {
    const normalized = question.replace(/[？?，,。.!！\s]/g, "").slice(0, 18);
    if (!normalized) {
      return;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  });
  return [...counts.values()].reduce((sum, count) => sum + (count >= 2 ? count - 1 : 0), 0);
}
function tokenize(text) {
  const normalized = text.normalize("NFKC").toLowerCase().replace(/[\r\n\t]+/g, " ").replace(/[，。！？、；：“”‘’（）【】《》.,!?;:'"()[\]<>/_-]/g, " ").trim();
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (parts.length > 0) {
    return parts.flatMap((part) => part.length <= 2 ? [part] : buildCharacterNgrams(part, 2));
  }
  return buildCharacterNgrams(normalized, 2);
}
function buildCharacterNgrams(value, n) {
  if (value.length <= n) {
    return value ? [value] : [];
  }
  const grams = [];
  for (let index = 0; index <= value.length - n; index += 1) {
    grams.push(value.slice(index, index + n));
  }
  return grams;
}
function hashToken(token, dimensions) {
  let hash = 2166136261;
  for (let index = 0; index < token.length; index += 1) {
    hash ^= token.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % dimensions;
}
function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

// src/pipeline/keywords/negative-zh.ts
var NEGATIVE_ZH_KEYWORDS = [
  { keyword: "\u9519\u4E86", level: "strong", weight: 0.34 },
  { keyword: "\u4E0D\u5BF9", level: "strong", weight: 0.32 },
  { keyword: "\u4E0D\u662F", level: "medium", weight: 0.22 },
  { keyword: "\u4E0D\u884C", level: "strong", weight: 0.32 },
  { keyword: "\u91CD\u6765", level: "strong", weight: 0.32 },
  { keyword: "\u6362\u4E00\u4E2A", level: "medium", weight: 0.24 },
  { keyword: "\u6CA1\u7528", level: "strong", weight: 0.32 },
  { keyword: "\u65E0\u6548", level: "strong", weight: 0.32 },
  { keyword: "\u7B54\u975E\u6240\u95EE", level: "strong", weight: 0.36 },
  { keyword: "\u6CA1\u56DE\u7B54", level: "strong", weight: 0.32 },
  { keyword: "\u6CA1\u89E3\u51B3", level: "strong", weight: 0.34 },
  { keyword: "\u542C\u4E0D\u61C2", level: "medium", weight: 0.24 },
  { keyword: "\u770B\u4E0D\u61C2", level: "medium", weight: 0.22 },
  { keyword: "\u6CA1\u660E\u767D", level: "medium", weight: 0.24 },
  { keyword: "\u4EC0\u4E48\u610F\u601D", level: "medium", weight: 0.22 },
  { keyword: "\u592A\u6162", level: "medium", weight: 0.24 },
  { keyword: "\u7B49\u592A\u4E45", level: "medium", weight: 0.24 },
  { keyword: "\u53CD\u590D", level: "medium", weight: 0.22 },
  { keyword: "\u91CD\u590D", level: "medium", weight: 0.2 },
  { keyword: "\u9EBB\u70E6", level: "weak", weight: 0.14 },
  { keyword: "\u70E6", level: "weak", weight: 0.14 },
  { keyword: "\u5D29\u6E83", level: "strong", weight: 0.36 },
  { keyword: "\u751F\u6C14", level: "medium", weight: 0.24 },
  { keyword: "\u6295\u8BC9", level: "strong", weight: 0.38 },
  { keyword: "\u8F6C\u4EBA\u5DE5", level: "strong", weight: 0.36 },
  { keyword: "\u627E\u4E3B\u7BA1", level: "strong", weight: 0.34 },
  { keyword: "\u5BA2\u670D\u4E0D\u884C", level: "strong", weight: 0.34 },
  { keyword: "\u522B\u6577\u884D", level: "medium", weight: 0.26 },
  { keyword: "\u522B\u7ED5", level: "medium", weight: 0.22 },
  { keyword: "\u522B\u5E9F\u8BDD", level: "medium", weight: 0.24 },
  { keyword: "\u6CA1\u6709\u5E2E\u52A9", level: "strong", weight: 0.32 },
  { keyword: "\u4E0D\u6EE1\u610F", level: "strong", weight: 0.32 }
];
function findNegativeKeyword(content) {
  return NEGATIVE_ZH_KEYWORDS.find((entry) => content.includes(entry.keyword)) ?? null;
}

// src/eval-datasets/admission/rules.ts
var DEFAULT_ADMISSION_RULES = {
  // TP
  goal_failed: { severity: "high", enabled: true },
  low_empathy: { severity: "medium", enabled: true },
  off_topic_high: { severity: "medium", enabled: true },
  preachy_high: { severity: "medium", enabled: true },
  interest_decline: { severity: "medium", enabled: true },
  understanding_barrier: { severity: "medium", enabled: true },
  recovery_failure: { severity: "high", enabled: true },
  high_dropoff: { severity: "low", enabled: true },
  // FN
  fn_dropoff_negative_tail: { severity: "medium", enabled: true },
  fn_repeated_question: { severity: "medium", enabled: true },
  fn_length_collapse: { severity: "medium", enabled: true },
  fn_consecutive_short: { severity: "low", enabled: true },
  // TN
  goal_achieved_high_score: { severity: "low", enabled: true },
  clean_session_sampled: { severity: "low", enabled: true },
  // Uncertainty
  judge_uncertainty: { severity: "medium", enabled: true }
};
function getDimensionScore(dimensions, name) {
  return dimensions.find((d) => d.dimension === name)?.score ?? 3;
}
function topSeverity(rules) {
  if (rules.some((r) => r.severity === "high")) return "high";
  if (rules.some((r) => r.severity === "medium")) return "medium";
  return "low";
}
function normaliseQuestion(content) {
  return content.replace(/[？?，,。.!！\s]/g, "").toLowerCase().slice(0, 20);
}
function evaluateTPRules(asset, sessionSignals, empathyScore, offTopicScore, preachyScore, llmAvailable) {
  const rules = [];
  const def = DEFAULT_ADMISSION_RULES;
  if (def.goal_failed.enabled && (asset.tags.includes("goal_failed") || asset.tags.includes("goal_partial"))) {
    rules.push({ key: "goal_failed", severity: def.goal_failed.severity });
  }
  if (llmAvailable) {
    if (def.low_empathy.enabled && empathyScore <= 2) {
      rules.push({ key: "low_empathy", severity: def.low_empathy.severity });
    }
    if (def.off_topic_high.enabled && offTopicScore <= 2) {
      rules.push({ key: "off_topic_high", severity: def.off_topic_high.severity });
    }
    if (def.preachy_high.enabled && preachyScore <= 2) {
      rules.push({ key: "preachy_high", severity: def.preachy_high.severity });
    }
  }
  if (def.interest_decline.enabled && sessionSignals.some(
    (s) => s.signalKey === "interestDeclineRisk" && (s.severity === "medium" || s.severity === "high")
  )) {
    rules.push({ key: "interest_decline", severity: def.interest_decline.severity });
  }
  if (def.understanding_barrier.enabled && (asset.tags.includes("understanding_barrier") || sessionSignals.some(
    (s) => s.signalKey === "understandingBarrierRisk" && (s.severity === "medium" || s.severity === "high")
  ))) {
    rules.push({ key: "understanding_barrier", severity: def.understanding_barrier.severity });
  }
  if (def.recovery_failure.enabled && asset.tags.includes("recovery_failed")) {
    rules.push({ key: "recovery_failure", severity: def.recovery_failure.severity });
  }
  if (def.high_dropoff.enabled && (asset.tags.includes("escalation_keyword") || asset.tags.includes("question_repeat"))) {
    rules.push({ key: "high_dropoff", severity: def.high_dropoff.severity });
  }
  return rules;
}
function evaluateFNRules(rows) {
  const rules = [];
  const userRows = rows.filter((r) => r.role === "user");
  const def = DEFAULT_ADMISSION_RULES;
  if (def.fn_dropoff_negative_tail.enabled && userRows.length >= 2) {
    const lastThree = userRows.slice(-3);
    const negCount = lastThree.filter((r) => findNegativeKeyword(r.content) !== null).length;
    const lastRow = rows[rows.length - 1];
    if (negCount >= 2 && lastRow?.role === "user") {
      rules.push({ key: "fn_dropoff_negative_tail", severity: def.fn_dropoff_negative_tail.severity });
    }
  }
  if (def.fn_repeated_question.enabled) {
    const counts = /* @__PURE__ */ new Map();
    userRows.forEach((r) => {
      const key = normaliseQuestion(r.content);
      if (key.length >= 3) counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    if ([...counts.values()].some((c2) => c2 >= 2)) {
      rules.push({ key: "fn_repeated_question", severity: def.fn_repeated_question.severity });
    }
  }
  if (def.fn_length_collapse.enabled && rows.length >= 6 && userRows.length >= 4) {
    const half = Math.floor(userRows.length / 2);
    const front = userRows.slice(0, half);
    const back = userRows.slice(half);
    const avgFront = front.reduce((s, r) => s + r.content.length, 0) / front.length;
    const avgBack = back.reduce((s, r) => s + r.content.length, 0) / back.length;
    if (avgFront > 0 && avgBack < avgFront * 0.6) {
      rules.push({ key: "fn_length_collapse", severity: def.fn_length_collapse.severity });
    }
  }
  if (def.fn_consecutive_short.enabled && userRows.length >= 3) {
    const lastThreeUser = userRows.slice(-3);
    const lastRow = rows[rows.length - 1];
    if (lastThreeUser.every((r) => r.content.trim().length <= 5) && lastRow?.role === "user") {
      rules.push({ key: "fn_consecutive_short", severity: def.fn_consecutive_short.severity });
    }
  }
  return rules;
}
function evaluateTNRules(goalCompletion, empathyScore, llmAvailable, sampleRate) {
  const def = DEFAULT_ADMISSION_RULES;
  if (def.goal_achieved_high_score.enabled && llmAvailable && goalCompletion?.status === "achieved" && (goalCompletion.confidence ?? 0) > 0.6 && empathyScore >= 4) {
    return [{ key: "goal_achieved_high_score", severity: def.goal_achieved_high_score.severity }];
  }
  if (def.clean_session_sampled.enabled && Math.random() < sampleRate) {
    return [{ key: "clean_session_sampled", severity: def.clean_session_sampled.severity }];
  }
  return [];
}
function evaluateUncertaintyRule(goalCompletion, dimensions) {
  if (!DEFAULT_ADMISSION_RULES.judge_uncertainty.enabled) return false;
  const lo = parseFloat(process.env.ZEVAL_UNCERTAINTY_CONF_LO ?? "0.4");
  const hi = parseFloat(process.env.ZEVAL_UNCERTAINTY_CONF_HI ?? "0.6");
  const gcConf = goalCompletion?.confidence ?? 1;
  if (gcConf >= lo && gcConf <= hi) return true;
  return dimensions.some((d) => d.confidence >= lo && d.confidence <= hi);
}

// src/eval-datasets/admission/pipeline.ts
async function runAdmissionPipeline(params) {
  const tnSampleRateDefault = Number(
    process.env.ZEVAL_ADMISSION_TN_SAMPLE_RATE ?? ""
  ) || 0.05;
  const humanSamplingRateDefault = Number(
    process.env.ZEVAL_ADMISSION_HUMAN_SAMPLING_RATE ?? ""
  ) || 1;
  const {
    store,
    evaluate,
    tnSampleRate = tnSampleRateDefault,
    allowNearDuplicate = false,
    baselineVersion = evaluate.runId,
    humanSamplingRate = humanSamplingRateDefault,
    capabilityDimension
  } = params;
  const existingCases = await store.listCases();
  const candidates = buildAdmissionCandidates(evaluate, tnSampleRate);
  const savedCaseIds = [];
  const acceptedBySource = {};
  const skips = [];
  let pendingReviewCount = 0;
  let humanReviewQueueCount = 0;
  for (const candidate of candidates) {
    const dupeResult = checkCandidateDuplicate(candidate, evaluate, existingCases);
    if (dupeResult.isDuplicate) {
      const reason = dupeResult.reason;
      if (reason === "false_positive_match") {
        skips.push({
          candidateId: candidate.candidateId,
          sessionId: candidate.sessionId,
          channel: candidate.channel,
          reason,
          matchedCaseId: dupeResult.matchedCaseId,
          skippedRules: candidate.triggeredRules
        });
        continue;
      }
      if (reason === "exact_hash") {
        skips.push({
          candidateId: candidate.candidateId,
          sessionId: candidate.sessionId,
          channel: candidate.channel,
          reason,
          matchedCaseId: dupeResult.matchedCaseId,
          skippedRules: candidate.triggeredRules
        });
        continue;
      }
      if (reason === "near_duplicate" && !allowNearDuplicate) {
        skips.push({
          candidateId: candidate.candidateId,
          sessionId: candidate.sessionId,
          channel: candidate.channel,
          reason,
          matchedCaseId: dupeResult.matchedCaseId,
          skippedRules: candidate.triggeredRules
        });
        continue;
      }
    }
    const humanReviewRequired = decideSamplingForHumanReview(candidate, humanSamplingRate);
    const caseId = allocateCaseId(candidate.caseSetType);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const record = {
      caseId,
      caseSetType: candidate.caseSetType,
      source: candidate.channel,
      sessionId: candidate.sessionId,
      topicSegmentId: candidate.sessionId,
      topicLabel: buildTopicLabel(candidate),
      topicSummary: "",
      normalizedTranscriptHash: candidate.normalizedTranscriptHash,
      baselineVersion,
      baselineCaseScore: candidate.caseSetType === "badcase" ? severityToBaselineScore(candidate.severity) : 0.9,
      tags: candidate.snapshot.tags,
      transcript: candidate.transcript,
      autoSignals: candidate.triggeredRules.map((r) => ({ ruleKey: r.key, severity: r.severity })),
      // All cases enter at "auto_captured". Pool membership is determined by
      // isPoolActiveCase(): only "human_reviewed" and above are pool-active.
      // humanReviewRequired in metadata is the authoritative flag for the UI
      // review queue — it gates whether the case can advance to human_reviewed.
      reviewStatus: "auto_captured",
      ...capabilityDimension ? { capabilityDimension } : {},
      metadata: {
        humanReviewRequired,
        // Record the queue timestamp so the UI can sort / alert on stale cases.
        ...humanReviewRequired ? { humanReviewQueuedAt: now } : {}
      },
      createdAt: now,
      updatedAt: now
    };
    await store.createCase(record);
    savedCaseIds.push(caseId);
    acceptedBySource[candidate.channel] = (acceptedBySource[candidate.channel] ?? 0) + 1;
    if (candidate.reviewStatus === "pending_review") pendingReviewCount++;
    if (humanReviewRequired) humanReviewQueueCount++;
    existingCases.push(record);
  }
  const skippedDuplicates = skips.filter(
    (s) => s.reason === "exact_hash" || s.reason === "near_duplicate"
  ).length;
  const skippedFalsePositive = skips.filter((s) => s.reason === "false_positive_match").length;
  return {
    savedCaseIds,
    acceptedBySource,
    pendingReviewCount,
    humanReviewQueueCount,
    skippedDuplicates,
    skippedFalsePositive,
    skips,
    auditSummary: {
      evaluationRunId: evaluate.runId,
      candidateTotal: candidates.length,
      accepted: savedCaseIds.length,
      skipped: skips.length,
      humanReviewQueued: humanReviewQueueCount
    }
  };
}
function buildAdmissionCandidates(evaluate, tnSampleRate) {
  const sessions = groupRowsBySession(evaluate.enrichedRows);
  const badCaseSessionIds = new Set(evaluate.badCaseAssets.map((a) => a.sessionId));
  const llmAvailable = evaluate.subjectiveMetrics.status === "ready";
  const empathyScore = getDimensionScore(evaluate.subjectiveMetrics.dimensions, "\u5171\u60C5\u7A0B\u5EA6");
  const offTopicScore = getDimensionScore(evaluate.subjectiveMetrics.dimensions, "\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669");
  const preachyScore = getDimensionScore(evaluate.subjectiveMetrics.dimensions, "\u8BF4\u6559\u611F/\u538B\u8FEB\u611F");
  const candidates = [];
  for (const [sessionId, rows] of sessions.entries()) {
    const transcript = rows.map((r) => `[turn ${r.turnIndex}] [${r.role}] ${r.content}`).join("\n");
    const normalizedTranscriptHash = computeNormalizedTranscriptHash(transcript);
    const goalCompletion = evaluate.subjectiveMetrics.goalCompletions.find(
      (g) => g.sessionId === sessionId
    );
    const sessionSignals = evaluate.subjectiveMetrics.signals.filter(
      (s) => s.evidenceTurnRange.startsWith(`${sessionId}:`)
    );
    if (badCaseSessionIds.has(sessionId)) {
      const asset = evaluate.badCaseAssets.find((a) => a.sessionId === sessionId);
      const tpRules = evaluateTPRules(
        asset,
        sessionSignals,
        empathyScore,
        offTopicScore,
        preachyScore,
        llmAvailable
      );
      if (tpRules.length > 0) {
        candidates.push({
          candidateId: allocateCandidateId(),
          sessionId,
          channel: "auto_tp",
          caseSetType: "badcase",
          triggeredRules: tpRules,
          severity: topSeverity(tpRules),
          normalizedTranscriptHash,
          transcript,
          reviewStatus: "auto_admitted",
          snapshot: {
            tags: [...asset.tags],
            goalStatus: goalCompletion?.status,
            signalKeys: sessionSignals.map((s) => s.signalKey)
          }
        });
      }
      if (llmAvailable && evaluateUncertaintyRule(goalCompletion, evaluate.subjectiveMetrics.dimensions)) {
        candidates.push({
          candidateId: allocateCandidateId(),
          sessionId,
          channel: "auto_uncertainty",
          caseSetType: "badcase",
          triggeredRules: [{ key: "judge_uncertainty", severity: "medium" }],
          severity: "medium",
          normalizedTranscriptHash,
          transcript,
          reviewStatus: "pending_review",
          snapshot: {
            tags: [...asset.tags],
            goalStatus: goalCompletion?.status,
            signalKeys: sessionSignals.map((s) => s.signalKey)
          }
        });
      }
    } else {
      const fnRules = evaluateFNRules(rows);
      if (fnRules.length > 0) {
        candidates.push({
          candidateId: allocateCandidateId(),
          sessionId,
          channel: "auto_fn",
          caseSetType: "badcase",
          triggeredRules: fnRules,
          severity: topSeverity(fnRules),
          normalizedTranscriptHash,
          transcript,
          reviewStatus: "pending_review",
          snapshot: {
            tags: [],
            goalStatus: goalCompletion?.status,
            signalKeys: sessionSignals.map((s) => s.signalKey)
          }
        });
      }
      const tnRules = evaluateTNRules(
        goalCompletion,
        empathyScore,
        llmAvailable,
        tnSampleRate
      );
      if (tnRules.length > 0) {
        candidates.push({
          candidateId: allocateCandidateId(),
          sessionId,
          channel: "auto_tn",
          caseSetType: "goodcase",
          triggeredRules: tnRules,
          severity: "low",
          normalizedTranscriptHash,
          transcript,
          reviewStatus: "auto_admitted",
          snapshot: {
            tags: [],
            goalStatus: goalCompletion?.status,
            signalKeys: []
          }
        });
      }
    }
  }
  return candidates;
}
function checkCandidateDuplicate(candidate, evaluate, existingCases) {
  const fpMatch = existingCases.find(
    (c2) => c2.sessionId === candidate.sessionId && c2.metadata?.false_positive === true
  );
  if (fpMatch) {
    return { isDuplicate: true, reason: "false_positive_match", matchedCaseId: fpMatch.caseId };
  }
  const exactMatch = existingCases.find(
    (c2) => c2.normalizedTranscriptHash === candidate.normalizedTranscriptHash
  );
  if (exactMatch) {
    return { isDuplicate: true, reason: "exact_hash", matchedCaseId: exactMatch.caseId };
  }
  if (candidate.channel === "auto_tp") {
    const assetIndex = evaluate.badCaseAssets.findIndex(
      (a) => a.sessionId === candidate.sessionId
    );
    if (assetIndex >= 0) {
      const featureSnapshot = buildBadCaseFeatureSnapshot(evaluate, assetIndex);
      const decision = findBadCaseDuplicate(
        {
          normalizedTranscriptHash: candidate.normalizedTranscriptHash,
          featureSnapshot,
          // Supply transcript so findBadCaseDuplicate can fall back to Jaccard
          // when textEmbedding is empty (no embedding model configured).
          transcript: candidate.transcript
        },
        existingCases
      );
      if (decision.isDuplicate && decision.layer !== "l1_exact_hash") {
        return { isDuplicate: true, reason: "near_duplicate", matchedCaseId: decision.matchedCaseId };
      }
    }
  } else {
    const JACCARD_THRESHOLD = 0.85;
    let bestJaccardCase = null;
    for (const existing of existingCases) {
      if (!existing.transcript) continue;
      const score = jaccardTranscriptSimilarity(candidate.transcript, existing.transcript);
      if (score >= JACCARD_THRESHOLD && (!bestJaccardCase || score > bestJaccardCase.score)) {
        bestJaccardCase = { caseId: existing.caseId, score };
      }
    }
    if (bestJaccardCase) {
      return { isDuplicate: true, reason: "near_duplicate", matchedCaseId: bestJaccardCase.caseId };
    }
  }
  return { isDuplicate: false };
}
function decideSamplingForHumanReview(candidate, samplingRate) {
  if (candidate.channel === "auto_fn" || candidate.channel === "auto_uncertainty") {
    return true;
  }
  const rate2 = Math.max(0, Math.min(1, samplingRate));
  return Math.random() < rate2;
}
function groupRowsBySession(rows) {
  const map = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!map.has(row.sessionId)) map.set(row.sessionId, []);
    map.get(row.sessionId).push(row);
  }
  return map;
}
function allocateCandidateId() {
  return `ca_${Date.now()}_${(0, import_node_crypto2.randomBytes)(3).toString("hex")}`;
}
function allocateCaseId(caseSetType) {
  const prefix = caseSetType === "goodcase" ? "gc" : "bc";
  return `${prefix}_${Date.now()}_${(0, import_node_crypto2.randomBytes)(3).toString("hex")}`;
}
function severityToBaselineScore(severity) {
  if (severity === "high") return 0.2;
  if (severity === "medium") return 0.4;
  return 0.6;
}
function buildTopicLabel(candidate) {
  if (candidate.channel === "auto_tn") return "golden_positive";
  const primaryRule = candidate.triggeredRules[0]?.key ?? "unknown";
  return `${candidate.channel}:${primaryRule}`;
}

// src/eval-datasets/harvest-badcases.ts
async function harvestBadCasesToDataset(params) {
  return runAdmissionPipeline({
    store: params.store,
    evaluate: params.evaluate,
    baselineVersion: params.baselineVersion,
    allowNearDuplicate: params.allowNearDuplicate,
    tnSampleRate: params.tnSampleRate,
    humanSamplingRate: params.humanSamplingRate,
    capabilityDimension: params.capabilityDimension
  });
}

// src/db/index.ts
async function createZeroreDatabase() {
  const adapter = resolveDatabaseAdapter();
  if (adapter === "postgres") {
    const { createPostgresDatabaseFromEnv: createPostgresDatabaseFromEnv2 } = await Promise.resolve().then(() => (init_postgres_database(), postgres_database_exports));
    return createPostgresDatabaseFromEnv2();
  }
  const { LocalJsonDatabase: LocalJsonDatabase2 } = await Promise.resolve().then(() => (init_local_json_database(), local_json_database_exports));
  return new LocalJsonDatabase2();
}
function resolveDatabaseAdapter() {
  const adapter = process.env.ZEVAL_DATABASE_ADAPTER ?? process.env.ZERORE_DATABASE_ADAPTER ?? "local-json";
  if (adapter === "postgres" || adapter === "local-json") {
    return adapter;
  }
  throw new Error(`Unsupported ZEVAL_DATABASE_ADAPTER: ${adapter}`);
}

// src/eval-datasets/storage/database-dataset-store.ts
var DATASET_CASE_TYPE = "dataset_cases";
var DATASET_BASELINE_TYPE = "dataset_baselines";
var DATASET_RUN_RESULT_TYPE = "dataset_run_results";
var DATASET_SAMPLE_BATCH_TYPE = "dataset_sample_batches";
var DatabaseDatasetStore = class {
  constructor(workspaceId) {
    this.database = null;
    this.workspaceId = workspaceId ?? "default";
  }
  async createCase(record) {
    await this.upsert(DATASET_CASE_TYPE, record.caseId, record, record.createdAt, record.updatedAt);
  }
  async updateCase(record) {
    const existing = await this.getCaseById(record.caseId);
    if (!existing) {
      throw new Error(`\u672A\u627E\u5230 dataset case: ${record.caseId}`);
    }
    await this.upsert(DATASET_CASE_TYPE, record.caseId, record, existing.createdAt, record.updatedAt);
  }
  async saveBaseline(record) {
    const caseRecord = await this.getCaseById(record.caseId);
    if (!caseRecord) {
      throw new Error(`\u672A\u627E\u5230 dataset case: ${record.caseId}`);
    }
    await this.upsert(DATASET_BASELINE_TYPE, record.caseId, record, record.baselineGeneratedAt, record.baselineGeneratedAt);
  }
  async getBaseline(caseId) {
    const record = await (await this.getDatabase()).get(this.workspaceId, DATASET_BASELINE_TYPE, caseId);
    return record?.payload ? record.payload : null;
  }
  async getCaseById(caseId) {
    const record = await (await this.getDatabase()).get(this.workspaceId, DATASET_CASE_TYPE, caseId);
    return record?.payload ? record.payload : null;
  }
  async listCases(caseSetType) {
    const records = await (await this.getDatabase()).list(this.workspaceId, DATASET_CASE_TYPE);
    return records.map((record) => record.payload).filter((record) => !caseSetType || record.caseSetType === caseSetType).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }
  async checkDuplicate(input) {
    const cases = await this.listCases();
    const exact = cases.find((item) => item.normalizedTranscriptHash === input.normalizedTranscriptHash);
    if (exact) {
      return {
        isDuplicate: true,
        reason: "exact_hash",
        matchedCaseId: exact.caseId,
        similarityScore: 1
      };
    }
    const nearMatch = cases.find((item) => {
      const topicMatched = item.topicLabel === input.topicLabel;
      const scoreGap = Math.abs(item.baselineCaseScore - input.baselineCaseScore);
      return topicMatched && scoreGap <= 2;
    });
    if (nearMatch) {
      return {
        isDuplicate: true,
        reason: "near_duplicate",
        matchedCaseId: nearMatch.caseId,
        similarityScore: 0.84
      };
    }
    return {
      isDuplicate: false,
      reason: "none"
    };
  }
  async saveRunResult(record) {
    const id = stableRecordId(record.runId, record.sampleBatchId, record.caseId);
    await this.upsert(DATASET_RUN_RESULT_TYPE, id, record, record.createdAt, record.createdAt);
  }
  async saveSampleBatch(record) {
    await this.upsert(DATASET_SAMPLE_BATCH_TYPE, record.sampleBatchId, record, record.createdAt, record.createdAt);
  }
  async getSampleBatch(sampleBatchId) {
    const record = await (await this.getDatabase()).get(this.workspaceId, DATASET_SAMPLE_BATCH_TYPE, sampleBatchId);
    return record?.payload ? record.payload : null;
  }
  async listSampleBatches() {
    const records = await (await this.getDatabase()).list(this.workspaceId, DATASET_SAMPLE_BATCH_TYPE);
    return records.map((record) => record.payload).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }
  async upsert(type, id, payload, createdAt, updatedAt) {
    await (await this.getDatabase()).upsert({
      id,
      projectId: this.workspaceId,
      type,
      payload,
      createdAt,
      updatedAt
    });
  }
  getDatabase() {
    this.database ??= createZeroreDatabase();
    return this.database;
  }
};
function stableRecordId(...parts) {
  return parts.join("_").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

// src/eval-datasets/storage/file-system-dataset-store.ts
var import_promises2 = require("fs/promises");
var import_node_path3 = __toESM(require("path"));

// src/workspaces/paths.ts
var import_node_path2 = __toESM(require("path"));

// src/auth/context.ts
function sanitizeContextId(value) {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "default";
}

// src/workspaces/paths.ts
function resolveWorkspacePath(workspaceId, ...segments) {
  return import_node_path2.default.join("workspaces", sanitizeContextId(workspaceId), ...segments);
}
function maybeWorkspacePath(workspaceId, legacyPath) {
  const workspaceStorage = process.env.ZEVAL_WORKSPACE_STORAGE ?? process.env.ZERORE_WORKSPACE_STORAGE;
  if (workspaceStorage !== "enabled" || !workspaceId) {
    return legacyPath;
  }
  return resolveWorkspacePath(workspaceId, legacyPath);
}

// src/eval-datasets/storage/file-system-dataset-store.ts
var DATASET_ROOT = "eval-datasets";
var FileSystemDatasetStore = class {
  constructor(workspaceId) {
    this.rootDirectory = maybeWorkspacePath(workspaceId, DATASET_ROOT);
  }
  /**
   * @inheritdoc
   */
  async createCase(record) {
    const caseDirectory = this.getCaseDirectory(record.caseSetType, record.caseId);
    await (0, import_promises2.mkdir)(caseDirectory, { recursive: true });
    await writeJsonFile(import_node_path3.default.join(caseDirectory, "case.json"), record);
    await appendCasesIndexRow(this.rootDirectory, record);
    await updateCaseSetManifest(this.rootDirectory, record.caseSetType);
  }
  /**
   * @inheritdoc
   */
  async updateCase(record) {
    const existing = await this.getCaseById(record.caseId);
    if (!existing) {
      throw new Error(`\u672A\u627E\u5230 dataset case: ${record.caseId}`);
    }
    await writeJsonFile(import_node_path3.default.join(this.getCaseDirectory(existing.caseSetType, record.caseId), "case.json"), record);
  }
  /**
   * @inheritdoc
   */
  async saveBaseline(record) {
    const caseRecord = await this.getCaseById(record.caseId);
    if (!caseRecord) {
      throw new Error(`\u672A\u627E\u5230 dataset case: ${record.caseId}`);
    }
    await writeJsonFile(import_node_path3.default.join(this.getCaseDirectory(caseRecord.caseSetType, record.caseId), "baseline.json"), record);
  }
  /**
   * @inheritdoc
   */
  async getBaseline(caseId) {
    const caseRecord = await this.getCaseById(caseId);
    if (!caseRecord) {
      return null;
    }
    const filePath = import_node_path3.default.join(this.getCaseDirectory(caseRecord.caseSetType, caseId), "baseline.json");
    try {
      return await readJsonFile(filePath);
    } catch {
      return null;
    }
  }
  /**
   * @inheritdoc
   */
  async getCaseById(caseId) {
    for (const caseSetType of ["goodcase", "badcase"]) {
      const filePath = import_node_path3.default.join(this.getCaseDirectory(caseSetType, caseId), "case.json");
      try {
        return await readJsonFile(filePath);
      } catch {
        continue;
      }
    }
    return null;
  }
  /**
   * @inheritdoc
   */
  async listCases(caseSetType) {
    const targetSets = caseSetType ? [caseSetType] : ["goodcase", "badcase"];
    const cases = [];
    for (const currentSet of targetSets) {
      const casesDirectory = import_node_path3.default.join(this.rootDirectory, currentSet, "cases");
      try {
        const directoryItems = await (0, import_promises2.readdir)(casesDirectory, { withFileTypes: true });
        for (const item of directoryItems) {
          if (!item.isDirectory()) {
            continue;
          }
          const filePath = import_node_path3.default.join(casesDirectory, item.name, "case.json");
          try {
            cases.push(await readJsonFile(filePath));
          } catch {
            continue;
          }
        }
      } catch {
        continue;
      }
    }
    return cases;
  }
  /**
   * @inheritdoc
   */
  async checkDuplicate(input) {
    const cases = await this.listCases();
    const exact = cases.find((item) => item.normalizedTranscriptHash === input.normalizedTranscriptHash);
    if (exact) {
      return {
        isDuplicate: true,
        reason: "exact_hash",
        matchedCaseId: exact.caseId,
        similarityScore: 1
      };
    }
    const nearMatch = cases.find((item) => {
      const topicMatched = item.topicLabel === input.topicLabel;
      const scoreGap = Math.abs(item.baselineCaseScore - input.baselineCaseScore);
      return topicMatched && scoreGap <= 2;
    });
    if (nearMatch) {
      return {
        isDuplicate: true,
        reason: "near_duplicate",
        matchedCaseId: nearMatch.caseId,
        similarityScore: 0.84
      };
    }
    return {
      isDuplicate: false,
      reason: "none"
    };
  }
  /**
   * @inheritdoc
   */
  async saveRunResult(record) {
    const runDirectory = import_node_path3.default.join(this.rootDirectory, "runs", record.runId);
    await (0, import_promises2.mkdir)(runDirectory, { recursive: true });
    const line = `${JSON.stringify(record)}
`;
    const filePath = import_node_path3.default.join(runDirectory, "case-results.jsonl");
    await appendTextFile(filePath, line);
  }
  /**
   * @inheritdoc
   */
  async saveSampleBatch(record) {
    const samplesDirectory = import_node_path3.default.join(this.rootDirectory, "samples");
    await (0, import_promises2.mkdir)(samplesDirectory, { recursive: true });
    await writeJsonFile(import_node_path3.default.join(samplesDirectory, `${record.sampleBatchId}.json`), record);
  }
  /**
   * @inheritdoc
   */
  async getSampleBatch(sampleBatchId) {
    const filePath = import_node_path3.default.join(this.rootDirectory, "samples", `${sampleBatchId}.json`);
    try {
      return await readJsonFile(filePath);
    } catch {
      return null;
    }
  }
  /**
   * @inheritdoc
   */
  async listSampleBatches() {
    const samplesDirectory = import_node_path3.default.join(this.rootDirectory, "samples");
    let names = [];
    try {
      names = await (0, import_promises2.readdir)(samplesDirectory);
    } catch {
      return [];
    }
    const rows = [];
    for (const fileName of names.filter((name) => name.endsWith(".json"))) {
      const filePath = import_node_path3.default.join(samplesDirectory, fileName);
      try {
        const [raw, fileStat] = await Promise.all([(0, import_promises2.readFile)(filePath, "utf8"), (0, import_promises2.stat)(filePath)]);
        rows.push({
          ...JSON.parse(raw),
          mtimeMs: fileStat.mtimeMs
        });
      } catch {
        continue;
      }
    }
    rows.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return rows.map((row) => {
      const { mtimeMs, ...record } = row;
      void mtimeMs;
      return record;
    });
  }
  /**
   * Get one case directory from set type and case ID.
   * @param caseSetType Dataset set type.
   * @param caseId Dataset case ID.
   * @returns Case directory path.
   */
  getCaseDirectory(caseSetType, caseId) {
    return import_node_path3.default.join(this.rootDirectory, caseSetType, "cases", caseId);
  }
};
async function readJsonFile(filePath) {
  return JSON.parse(await (0, import_promises2.readFile)(filePath, "utf8"));
}
async function writeJsonFile(filePath, payload) {
  await (0, import_promises2.mkdir)(import_node_path3.default.dirname(filePath), { recursive: true });
  await (0, import_promises2.writeFile)(filePath, `${JSON.stringify(payload, null, 2)}
`, "utf8");
}
async function appendTextFile(filePath, content) {
  await (0, import_promises2.mkdir)(import_node_path3.default.dirname(filePath), { recursive: true });
  let current = "";
  try {
    current = await (0, import_promises2.readFile)(filePath, "utf8");
  } catch {
    current = "";
  }
  await (0, import_promises2.writeFile)(filePath, `${current}${content}`, "utf8");
}
var CASES_INDEX_HEADER = "caseId,caseSetType,topicLabel,baselineCaseScore,baselineVersion,duplicateGroupKey,createdAt\n";
async function appendCasesIndexRow(rootDirectory, record) {
  const indexPath = import_node_path3.default.join(rootDirectory, "indexes", "cases.csv");
  await (0, import_promises2.mkdir)(import_node_path3.default.dirname(indexPath), { recursive: true });
  const row = [
    csvEscapeCell(record.caseId),
    csvEscapeCell(record.caseSetType),
    csvEscapeCell(record.topicLabel),
    String(record.baselineCaseScore),
    csvEscapeCell(record.baselineVersion),
    csvEscapeCell(record.duplicateGroupKey ?? ""),
    csvEscapeCell(record.createdAt)
  ].join(",") + "\n";
  let existing = "";
  try {
    existing = await (0, import_promises2.readFile)(indexPath, "utf8");
  } catch {
    existing = "";
  }
  if (!existing.trim()) {
    await (0, import_promises2.writeFile)(indexPath, CASES_INDEX_HEADER + row, "utf8");
    return;
  }
  await appendTextFile(indexPath, row);
}
function csvEscapeCell(value) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
async function updateCaseSetManifest(rootDirectory, caseSetType) {
  const manifestPath = import_node_path3.default.join(rootDirectory, caseSetType, "manifest.json");
  const casesDirectory = import_node_path3.default.join(rootDirectory, caseSetType, "cases");
  let caseCount = 0;
  try {
    const items = await (0, import_promises2.readdir)(casesDirectory, { withFileTypes: true });
    caseCount = items.filter((item) => item.isDirectory()).length;
  } catch {
    caseCount = 0;
  }
  let current = {};
  try {
    current = await readJsonFile(manifestPath);
  } catch {
    current = {};
  }
  await writeJsonFile(manifestPath, {
    caseSetType,
    description: current.description ?? defaultCaseSetDescription(caseSetType),
    ...current,
    caseCount,
    updatedAt: (/* @__PURE__ */ new Date()).toISOString()
  });
}
function defaultCaseSetDescription(caseSetType) {
  if (caseSetType === "goodcase") {
    return "\u9AD8\u8D28\u91CF\u6848\u4F8B\u96C6\u5408\uFF0C\u7528\u4E8E\u56DE\u5F52\u4FDD\u6301\u7387\u9A8C\u8BC1\u3002";
  }
  return "\u4F4E\u8D28\u91CF\u6848\u4F8B\u96C6\u5408\uFF0C\u7528\u4E8E\u4FEE\u590D\u7387\u548C\u98CE\u9669\u4E0B\u964D\u9A8C\u8BC1\u3002";
}

// src/eval-datasets/storage/index.ts
function createDatasetStore(options) {
  const provider = (process.env.DATASET_STORE_PROVIDER ?? "filesystem").trim().toLowerCase();
  if (provider === "database") {
    return new DatabaseDatasetStore(options?.workspaceId);
  }
  if (provider !== "filesystem") {
    throw new Error(`\u6682\u4E0D\u652F\u6301\u7684 dataset store provider: ${provider}`);
  }
  return new FileSystemDatasetStore(options?.workspaceId);
}

// src/persistence/evaluateResultStore.ts
var import_promises3 = require("fs/promises");
var import_node_path4 = __toESM(require("path"));
var EVALUATE_RUNS_ROOT = "eval-runs";
async function persistEvaluateResult(response) {
  const runId = sanitizeRunId(response.runId);
  const runDirectory = import_node_path4.default.join(EVALUATE_RUNS_ROOT, runId);
  const outputPath = import_node_path4.default.join(runDirectory, "evaluate.json");
  response.meta.savedEvaluatePath = outputPath;
  await (0, import_promises3.mkdir)(runDirectory, { recursive: true });
  await (0, import_promises3.writeFile)(outputPath, `${JSON.stringify(response, null, 2)}
`, "utf8");
  return outputPath;
}
async function readPersistedEvaluateResult(runId) {
  const outputPath = import_node_path4.default.join(EVALUATE_RUNS_ROOT, sanitizeRunId(runId), "evaluate.json");
  try {
    const raw = await (0, import_promises3.readFile)(outputPath, "utf8");
    const response = JSON.parse(raw);
    response.meta.savedEvaluatePath = response.meta.savedEvaluatePath ?? outputPath;
    return response;
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return null;
    }
    throw error;
  }
}
async function listPersistedEvaluateRuns(limit, projectId) {
  let entries;
  try {
    entries = await (0, import_promises3.readdir)(EVALUATE_RUNS_ROOT, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return [];
    }
    throw error;
  }
  const rows = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const outputPath = import_node_path4.default.join(EVALUATE_RUNS_ROOT, entry.name, "evaluate.json");
    try {
      const raw = await (0, import_promises3.readFile)(outputPath, "utf8");
      const response = JSON.parse(raw);
      if (projectId) {
        const runProjectId = response.meta.projectId ?? response.meta.workspaceId ?? "default";
        if (runProjectId !== projectId) {
          continue;
        }
      }
      const fileStat = await (0, import_promises3.stat)(outputPath);
      rows.push(projectEvaluateRunIndexRow(response, outputPath, fileStat.mtime.toISOString()));
    } catch (error) {
      if (!isNodeErrorCode(error, "ENOENT")) {
        console.warn(`[EVALUATE_RUN_STORE] index read failed path=${outputPath}`, error);
      }
    }
  }
  return rows.sort((left, right) => Date.parse(right.generatedAt) - Date.parse(left.generatedAt)).slice(0, Math.max(1, limit));
}
function projectEvaluateRunIndexRow(response, savedEvaluatePath, updatedAt) {
  return {
    runId: response.runId,
    generatedAt: response.meta.generatedAt,
    updatedAt,
    sessions: response.meta.sessions,
    messages: response.meta.messages,
    savedEvaluatePath: response.meta.savedEvaluatePath ?? savedEvaluatePath,
    scenarioId: response.scenarioEvaluation?.scenarioId,
    scenarioLabel: response.scenarioEvaluation?.displayName,
    warningCount: response.meta.warnings.length
  };
}
function sanitizeRunId(value) {
  return value.replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/^-+|-+$/g, "") || `run-${Date.now()}`;
}
function isNodeErrorCode(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

// src/lib/csv.ts
function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}

// src/parsers/csvParser.ts
var ALLOWED_ROLES = /* @__PURE__ */ new Set(["user", "assistant", "system"]);
function parseCsvRows(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }
  const header2 = splitCsvLine(lines[0]).map((cell) => cell.trim());
  const sessionIdIndex = header2.indexOf("sessionId");
  const timestampIndex = header2.indexOf("timestamp");
  const roleIndex = header2.indexOf("role");
  const contentIndex = header2.indexOf("content");
  if ([sessionIdIndex, timestampIndex, roleIndex, contentIndex].some((index) => index < 0)) {
    return [];
  }
  return lines.slice(1).flatMap((line) => {
    const cells = splitCsvLine(line);
    const role = String(cells[roleIndex] ?? "").toLowerCase();
    if (!ALLOWED_ROLES.has(role)) {
      return [];
    }
    return [
      {
        sessionId: String(cells[sessionIdIndex] ?? "unknown"),
        timestamp: String(cells[timestampIndex] ?? ""),
        role,
        content: String(cells[contentIndex] ?? "")
      }
    ];
  });
}

// src/parsers/jsonParser.ts
var ALLOWED_ROLES2 = /* @__PURE__ */ new Set(["user", "assistant", "system"]);
function parseJsonRows(text) {
  const parsed = parseJsonOrJsonl(text);
  const sgdDialogues = getSgdDialogues(parsed);
  if (sgdDialogues.length > 0) {
    return parseSgdDialogues(sgdDialogues);
  }
  const arrayData = Array.isArray(parsed) ? parsed : typeof parsed === "object" && parsed !== null && "messages" in parsed ? parsed.messages : [];
  return arrayData.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item;
    const role = String(record.role ?? "").toLowerCase();
    if (!ALLOWED_ROLES2.has(role)) {
      return [];
    }
    return [
      {
        sessionId: String(record.sessionId ?? "json_session_001"),
        timestamp: String(record.timestamp ?? new Date(Date.now() + index * 1e3).toISOString()),
        role,
        content: String(record.content ?? "")
      }
    ];
  });
}
function parseJsonOrJsonl(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    const records = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line));
    if (records.length === 0) {
      throw error;
    }
    return records;
  }
}
function isSgdDialogueArray(value) {
  return Array.isArray(value) && value.some(
    (item) => typeof item === "object" && item !== null && "dialogue_id" in item && "turns" in item && Array.isArray(item.turns)
  );
}
function getSgdDialogues(value) {
  if (isSgdDialogueArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && !Array.isArray(value) && Array.isArray(value.dialogues)) {
    return value.dialogues.filter(isSgdDialogue);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (isSgdDialogue(item)) {
        return [item];
      }
      if (item && typeof item === "object" && Array.isArray(item.dialogues)) {
        return item.dialogues.filter(isSgdDialogue);
      }
      return [];
    });
  }
  return [];
}
function isSgdDialogue(value) {
  return typeof value === "object" && value !== null && "dialogue_id" in value && "turns" in value && Array.isArray(value.turns);
}
function parseSgdDialogues(dialogues) {
  return dialogues.flatMap((dialogue, dialogueIndex) => {
    const sessionId = String(dialogue.dialogue_id ?? `sgd_dialogue_${dialogueIndex + 1}`);
    const turns = Array.isArray(dialogue.turns) ? dialogue.turns : [];
    return turns.flatMap((turn, turnIndex) => {
      const role = mapSgdSpeakerToRole(turn.speaker);
      const content = typeof turn.utterance === "string" ? turn.utterance.trim() : "";
      if (!role || !content) {
        return [];
      }
      return [
        {
          sessionId,
          timestamp: buildSyntheticTimestamp(dialogueIndex, turnIndex),
          role,
          content
        }
      ];
    });
  });
}
function mapSgdSpeakerToRole(speaker) {
  const normalized = String(speaker ?? "").toUpperCase();
  if (normalized === "USER") {
    return "user";
  }
  if (normalized === "SYSTEM") {
    return "assistant";
  }
  return null;
}
function buildSyntheticTimestamp(dialogueIndex, turnIndex) {
  return new Date(Date.UTC(2020, 0, 1 + dialogueIndex, 0, 0, turnIndex)).toISOString();
}

// src/parsers/textParser.ts
function parseTextRows(text, format, fileName) {
  let sessionId = `${fileName.replace(/\.[^.]+$/, "")}_session`;
  const rows = [];
  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }
    if (line.startsWith("## session:") || line.startsWith("[session:")) {
      sessionId = line.replace("## session:", "").replace("[session:", "").replace("]", "").trim();
      return;
    }
    const withTimestamp = line.match(
      /^\[?(\d{4}-\d{2}-\d{2}T[\d:.+-]+)\]?\s*(user|assistant|system)[:：]\s*(.+)$/i
    ) ?? null;
    if (withTimestamp) {
      rows.push({
        sessionId,
        timestamp: withTimestamp[1],
        role: withTimestamp[2].toLowerCase(),
        content: withTimestamp[3]
      });
      return;
    }
    const withoutTimestamp = line.match(/^(user|assistant|system)[:：]\s*(.+)$/i);
    if (withoutTimestamp) {
      rows.push({
        sessionId,
        timestamp: new Date(Date.now() + index * 1e3).toISOString(),
        role: withoutTimestamp[1].toLowerCase(),
        content: withoutTimestamp[2]
      });
    }
  });
  if (rows.length > 0) {
    return rows;
  }
  if (format === "md") {
    return [];
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((content, index) => ({
    sessionId,
    timestamp: new Date(Date.now() + index * 1e3).toISOString(),
    role: index % 2 === 0 ? "user" : "assistant",
    content
  }));
}

// src/parsers/index.ts
function inferFormatFromFileName(fileName) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (extension === "csv" || extension === "json" || extension === "jsonl" || extension === "txt" || extension === "md") {
    return extension;
  }
  return "txt";
}
function parseByFormat(text, format, fileName) {
  if (format === "csv") {
    return parseCsvRows(text);
  }
  if (format === "json" || format === "jsonl") {
    return parseJsonRows(text);
  }
  return parseTextRows(text, format, fileName);
}

// src/pii/redaction.ts
var PII_PATTERNS = [
  {
    category: "email",
    pattern: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    replacement: "[REDACTED_EMAIL]"
  },
  {
    category: "phone",
    pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g,
    replacement: "[REDACTED_PHONE]"
  },
  {
    category: "id_card",
    pattern: /(?<!\d)\d{17}[\dXx](?!\d)/g,
    replacement: "[REDACTED_ID]"
  },
  {
    category: "bank_card",
    pattern: /(?<!\d)(?:\d[ -]?){15,19}(?!\d)/g,
    replacement: "[REDACTED_CARD]"
  },
  {
    category: "order_id",
    pattern: /(?:订单号|order(?:\s*id)?|单号)[:：\s-]*[A-Z0-9_-]{5,}/gi,
    replacement: "[REDACTED_ORDER]"
  }
];
function redactRawRows(rows) {
  const enabled = process.env.PII_REDACTION_ENABLED !== "false";
  if (!enabled) {
    return {
      rows,
      report: { enabled: false, redactedRows: 0, redactedFields: 0, categories: [] }
    };
  }
  let redactedRows = 0;
  let redactedFields = 0;
  const categories = /* @__PURE__ */ new Set();
  const nextRows = rows.map((row) => {
    const redacted = redactText(row.content);
    if (redacted.text !== row.content) {
      redactedRows += 1;
      redactedFields += redacted.count;
      redacted.categories.forEach((item) => categories.add(item));
    }
    return { ...row, content: redacted.text };
  });
  return {
    rows: nextRows,
    report: {
      enabled: true,
      redactedRows,
      redactedFields,
      categories: [...categories].sort()
    }
  };
}
function redactText(value) {
  let text = value;
  let count = 0;
  const categories = /* @__PURE__ */ new Set();
  for (const item of PII_PATTERNS) {
    text = text.replace(item.pattern, () => {
      count += 1;
      categories.add(item.category);
      return item.replacement;
    });
  }
  return { text, count, categories: [...categories] };
}

// src/pipeline/evaluateRun.ts
var import_promises5 = require("fs/promises");
var import_node_path8 = __toESM(require("path"));

// src/pipeline/badCaseHarvest.ts
function harvestBadCases(rows, _metrics, signals) {
  const grouped = groupRowsBySession2(rows);
  return [...grouped.entries()].map(([sessionId, sessionRows]) => harvestSession(sessionId, sessionRows, signals)).filter((item) => item !== null).sort((left, right) => right.severity - left.severity);
}
function harvestSession(sessionId, rows, signals) {
  const badCaseSignals = [];
  let severity = 0;
  for (const row of rows) {
    if (row.role !== "user") continue;
    const match = findNegativeKeyword(row.content);
    if (match) {
      badCaseSignals.push({ kind: "negative_keyword", keyword: match.keyword, turnIndex: row.turnIndex });
      severity += match.weight;
    }
  }
  const maxGap = Math.max(...rows.map((row) => row.responseGapSec ?? 0), 0);
  if (maxGap >= 60) {
    badCaseSignals.push({ kind: "metric", metric: "responseGap", value: maxGap });
    severity += 0.18;
  }
  if (rows.length <= 2 && badCaseSignals.some((s) => s.kind === "negative_keyword")) {
    badCaseSignals.push({ kind: "metric", metric: "shortTurns", value: rows.length });
    severity += 0.12;
  }
  for (const signal of signals) {
    if (signal.severity === "high" && signal.evidenceTurnRange.startsWith(`${sessionId}:`)) {
      badCaseSignals.push({ kind: "implicit_signal", signalId: signal.signalKey });
      severity += 0.14;
    }
  }
  if (badCaseSignals.length === 0) return null;
  return {
    sessionId,
    severity: Math.min(1, Number(severity.toFixed(4))),
    signals: badCaseSignals
  };
}
function groupRowsBySession2(rows) {
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId).push(row);
  }
  return grouped;
}

// src/pipeline/badCases.ts
function buildBadCaseAssets(rows, objectiveMetrics, subjectiveMetrics, options) {
  const grouped = groupRowsBySession3(rows);
  const harvested = new Map(
    harvestBadCases(rows, objectiveMetrics, subjectiveMetrics.signals).map((item) => [item.sessionId, item])
  );
  const goalMap = new Map(subjectiveMetrics.goalCompletions.map((item) => [item.sessionId, item]));
  const recoveryMap = new Map(subjectiveMetrics.recoveryTraces.map((item) => [item.sessionId, item]));
  return [...grouped.entries()].map(
    ([sessionId, sessionRows]) => buildSessionBadCase(
      sessionId,
      sessionRows,
      goalMap.get(sessionId),
      recoveryMap.get(sessionId),
      harvested.get(sessionId),
      options
    )
  ).filter((item) => item !== null).sort((left, right) => right.severityScore - left.severityScore);
}
function buildSessionBadCase(sessionId, rows, goalCompletion, recoveryTrace, harvested, options) {
  const tags = /* @__PURE__ */ new Set();
  const evidenceRows = [];
  let severityScore = harvested?.severity ?? 0;
  const autoSignals = harvested?.signals ?? [];
  if (autoSignals.some((s) => s.kind === "negative_keyword")) tags.add("understanding_barrier");
  if (autoSignals.some((s) => s.kind === "metric" && s.metric === "responseGap")) tags.add("long_response_gap");
  evidenceRows.push(...materializeAutoSignalEvidence(autoSignals, rows));
  if (goalCompletion?.status === "failed") {
    tags.add("goal_failed");
    severityScore += 0.34;
    evidenceRows.push(...materializeGoalEvidence(goalCompletion, rows));
  } else if (goalCompletion?.status === "partial") {
    tags.add("goal_partial");
    severityScore += 0.2;
    evidenceRows.push(...materializeGoalEvidence(goalCompletion, rows));
  } else if (goalCompletion?.status === "unclear") {
    tags.add("goal_unclear");
    severityScore += 0.12;
    evidenceRows.push(...materializeGoalEvidence(goalCompletion, rows));
  }
  if (recoveryTrace?.status === "failed") {
    tags.add("recovery_failed");
    severityScore += 0.24;
    evidenceRows.push(...recoveryTrace.evidence);
  }
  const repeatedQuestionRows = findRepeatedQuestionRows(rows);
  if (repeatedQuestionRows.length > 0) {
    tags.add("question_repeat");
    severityScore += 0.18;
    evidenceRows.push(...repeatedQuestionRows);
  }
  const understandingRow = rows.find(
    (row) => row.role === "user" && /(什么意思|不懂|你是说|再说一遍|没明白|怎么理解)/.test(row.content)
  );
  if (understandingRow) {
    tags.add("understanding_barrier");
    severityScore += 0.16;
    evidenceRows.push(understandingRow);
  }
  const escalationRow = rows.find((row) => /(转人工|投诉|主管|经理|升级专员)/.test(row.content));
  if (escalationRow) {
    tags.add("escalation_keyword");
    severityScore += 0.22;
    evidenceRows.push(escalationRow);
  }
  const longGapRow = rows.find((row) => typeof row.responseGapSec === "number" && row.responseGapSec >= 60);
  if (longGapRow) {
    tags.add("long_response_gap");
    severityScore += 0.1;
    evidenceRows.push(longGapRow);
  }
  if (tags.size === 0) return null;
  const orderedEvidence = uniqEvidenceRows(evidenceRows).slice(0, 4);
  const primaryEvidence = orderedEvidence[0];
  const primaryRow = (primaryEvidence ? rows.find((r) => r.turnIndex === primaryEvidence.turnIndex) : null) ?? rows[0];
  const transcript = rows.map((r) => `[turn ${r.turnIndex}] [${r.role}] ${r.content}`).join("\n");
  const normalizedTranscriptHash = computeNormalizedTranscriptHash(transcript);
  const orderedTags = [...tags].sort();
  const severity = clamp012(severityScore);
  return {
    caseKey: `${sessionId}_${normalizedTranscriptHash.slice(0, 10)}`,
    sessionId: primaryRow?.sessionId ?? sessionId,
    title: buildTitle(orderedTags, primaryRow?.turnIndex ?? 1, primaryRow?.content ?? ""),
    severityScore: severity,
    normalizedTranscriptHash,
    duplicateGroupKey: [options.scenarioId ?? "generic", orderedTags.join("+")].join(":"),
    tags: orderedTags,
    transcript,
    evidence: orderedEvidence,
    autoSignals,
    suggestedAction: buildSuggestedAction(orderedTags),
    sourceRunId: options.runId
  };
}
function buildTitle(tags, turnIndex, content) {
  if (tags.includes("goal_failed")) return `\u7B2C ${turnIndex} \u8F6E\u540E\u76EE\u6807\u672A\u8FBE\u6210\uFF1A${content.slice(0, 24)}`;
  if (tags.includes("recovery_failed")) return `\u7B2C ${turnIndex} \u8F6E\u540E\u6062\u590D\u5931\u8D25\uFF1A${content.slice(0, 24)}`;
  if (tags.includes("escalation_keyword")) return `\u7B2C ${turnIndex} \u8F6E\u51FA\u73B0\u5347\u7EA7\u98CE\u9669\uFF1A${content.slice(0, 24)}`;
  return `\u7B2C ${turnIndex} \u8F6E\u51FA\u73B0\u5931\u8D25\u4FE1\u53F7\uFF1A${content.slice(0, 24)}`;
}
function buildSuggestedAction(tags) {
  if (tags.includes("goal_failed")) return "\u4F18\u5148\u628A\u5931\u8D25 session \u7F16\u8BD1\u4E3A remediation spec\uFF0C\u5E76\u8865\u4E00\u952E\u56DE\u653E\u9A8C\u8BC1\u3002";
  if (tags.includes("recovery_failed")) return "\u8865\u5145 apology + clarify + action \u7684\u6062\u590D\u5E8F\u5217\uFF0C\u5E76\u628A\u5931\u8D25\u7247\u6BB5\u52A0\u5165 regression\u3002";
  if (tags.includes("question_repeat") || tags.includes("understanding_barrier")) return "\u628A\u7B56\u7565\u6539\u4E3A\u5148\u76F4\u63A5\u56DE\u7B54\u95EE\u9898\uFF0C\u518D\u6269\u5C55\u80CC\u666F\uFF0C\u907F\u514D\u7528\u6237\u91CD\u590D\u8FFD\u95EE\u3002";
  if (tags.includes("escalation_keyword")) return "\u589E\u52A0\u6295\u8BC9/\u8F6C\u4EBA\u5DE5\u524D\u7684\u515C\u5E95\u52A8\u4F5C\u548C SLA \u627F\u8BFA\u53E5\uFF0C\u51CF\u5C11\u5347\u7EA7\u89E6\u53D1\u3002";
  return "\u5C06\u8BE5\u7247\u6BB5\u6C89\u6DC0\u5230 bad case \u6C60\uFF0C\u5E76\u7EB3\u5165\u4E0B\u4E00\u8F6E sample batch \u4E0E\u56DE\u653E\u5BF9\u6BD4\u3002";
}
function materializeGoalEvidence(goalCompletion, rows) {
  return [...goalCompletion.failureReasons, ...goalCompletion.achievementEvidence].map((ev) => rows.find((r) => ev.includes(r.content.slice(0, 20)) || r.content.includes(ev))).filter((r) => Boolean(r));
}
function findRepeatedQuestionRows(rows) {
  const questionRows = rows.filter((r) => r.role === "user" && r.isQuestion);
  const counts = /* @__PURE__ */ new Map();
  questionRows.forEach((r) => {
    const key = r.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 18);
    if (!key) return;
    const arr = counts.get(key) ?? [];
    arr.push(r);
    counts.set(key, arr);
  });
  return [...counts.values()].filter((items) => items.length >= 2).flatMap((items) => items.slice(0, 2));
}
function materializeAutoSignalEvidence(signals, rows) {
  return signals.map((s) => {
    if (s.kind === "negative_keyword") return rows.find((r) => r.turnIndex === s.turnIndex);
    if (s.kind === "metric" && s.metric === "responseGap") return rows.find((r) => r.responseGapSec === s.value);
    return rows.find((r) => r.role === "user");
  }).filter((r) => Boolean(r)).map((r) => ({ turnIndex: r.turnIndex, role: r.role, content: r.content }));
}
function uniqEvidenceRows(rows) {
  const seen = /* @__PURE__ */ new Set();
  return rows.filter((r) => {
    const key = `${r.turnIndex}:${r.role}:${r.content}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map((r) => ({ turnIndex: r.turnIndex, role: r.role, content: r.content }));
}
function groupRowsBySession3(rows) {
  const grouped = /* @__PURE__ */ new Map();
  rows.forEach((r) => {
    if (!grouped.has(r.sessionId)) grouped.set(r.sessionId, []);
    grouped.get(r.sessionId).push(r);
  });
  return grouped;
}
function clamp012(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

// src/config/chartTemplates.ts
var CHART_TEMPLATES = [
  {
    chartKey: "dropoffDistribution",
    title: "\u6D41\u5931\u65AD\u70B9",
    chartType: "bar",
    schema: {
      xField: "turnIndex",
      yField: "dropoffCount"
    },
    params: {
      dataSource: "enriched",
      groupBy: ["turnIndex"],
      aggregations: [{ op: "count", field: "isDropoffTurn", as: "dropoffCount" }],
      filters: [{ field: "isDropoffTurn", eq: true }]
    }
  },
  {
    chartKey: "activeHourDistribution",
    title: "\u6D3B\u8DC3\u65F6\u6BB5",
    chartType: "bar",
    schema: {
      xField: "activeHour",
      yField: "messageCount",
      seriesField: "role"
    },
    params: {
      dataSource: "enriched",
      groupBy: ["activeHour", "role"],
      aggregations: [{ op: "count", field: "content", as: "messageCount" }]
    }
  }
];

// src/pipeline/chartBuilder.ts
function buildChartPayloads(rows) {
  return CHART_TEMPLATES.map((template) => {
    if (template.chartKey === "dropoffDistribution") {
      const distribution = rows.filter((row) => row.isDropoffTurn).reduce((acc, row) => {
        const key = String(row.turnIndex);
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      return {
        chartKey: template.chartKey,
        title: template.title,
        description: "\u8BC6\u522B\u7528\u6237\u6D41\u5931\u51FA\u73B0\u5728\u54EA\u4E9B\u8F6E\u6B21\uFF0C\u7528\u4E8E\u5B9A\u4F4D\u5173\u952E\u65AD\u70B9\u3002",
        chartType: template.chartType,
        xField: template.schema.xField,
        yField: template.schema.yField,
        data: Object.entries(distribution).map(([turnIndex, dropoffCount]) => ({
          turnIndex: Number(turnIndex),
          dropoffCount
        }))
      };
    }
    if (template.chartKey === "activeHourDistribution") {
      const distribution = rows.reduce((acc, row) => {
        const key = `${row.activeHour ?? "unknown"}_${row.role}`;
        acc[key] = (acc[key] ?? 0) + 1;
        return acc;
      }, {});
      return {
        chartKey: template.chartKey,
        title: template.title,
        description: "\u5C55\u793A\u7528\u6237\u6D3B\u8DC3\u65F6\u6BB5\u5206\u5E03\uFF0C\u533A\u5206 user/assistant \u89D2\u8272\u6D88\u606F\u91CF\u3002",
        chartType: template.chartType,
        xField: template.schema.xField,
        yField: template.schema.yField,
        seriesField: template.schema.seriesField,
        data: Object.entries(distribution).map(([key, messageCount]) => {
          const [activeHour, role] = key.split("_");
          return { activeHour: activeHour === "unknown" ? null : Number(activeHour), role, messageCount };
        })
      };
    }
    return {
      chartKey: template.chartKey,
      title: template.title,
      description: "",
      chartType: template.chartType,
      xField: template.schema.xField,
      yField: template.schema.yField,
      data: []
    };
  });
}

// src/pipeline/normalize.ts
function normalizeRawRows(rows) {
  const grouped = /* @__PURE__ */ new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.sessionId)) {
      grouped.set(row.sessionId, []);
    }
    grouped.get(row.sessionId)?.push(row);
  });
  const normalized = [];
  for (const sessionRows of grouped.values()) {
    const sortedRows = [...sessionRows].map((row, index) => ({ row, index })).sort((left, right) => {
      const leftTime = safeParseTimestamp(left.row.timestamp);
      const rightTime = safeParseTimestamp(right.row.timestamp);
      if (leftTime === null && rightTime === null) {
        return left.index - right.index;
      }
      if (leftTime === null) {
        return 1;
      }
      if (rightTime === null) {
        return -1;
      }
      return leftTime - rightTime;
    }).map((item) => item.row);
    sortedRows.forEach((row, index) => {
      const timestampMs = safeParseTimestamp(row.timestamp);
      normalized.push({
        ...row,
        turnIndex: index + 1,
        timestampMs,
        activeHour: timestampMs === null ? null : new Date(timestampMs).getHours()
      });
    });
  }
  return normalized;
}
function safeParseTimestamp(timestamp) {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : null;
}

// src/pipeline/enrich.ts
function enrichRows(rows) {
  const normalizedRows = normalizeRawRows(rows);
  const previousTimestampBySession = /* @__PURE__ */ new Map();
  const lastTurnBySession = /* @__PURE__ */ new Map();
  normalizedRows.forEach((row) => {
    lastTurnBySession.set(row.sessionId, row.turnIndex);
  });
  const enrichedRows = normalizedRows.map((row) => {
    const previousTimestamp = previousTimestampBySession.get(row.sessionId) ?? null;
    const responseGapSec = row.timestampMs !== null && previousTimestamp !== null ? Math.max(0, Math.round((row.timestampMs - previousTimestamp) / 1e3)) : null;
    previousTimestampBySession.set(row.sessionId, row.timestampMs);
    return {
      ...row,
      responseGapSec,
      isDropoffTurn: row.turnIndex === (lastTurnBySession.get(row.sessionId) ?? row.turnIndex) && row.role === "assistant",
      isQuestion: /[?？]/.test(row.content),
      tokenCountEstimate: Math.max(1, Math.ceil(row.content.length / 1.6))
    };
  });
  return { enrichedRows };
}
function toEnrichedCsv(rows) {
  const header2 = [
    "sessionId",
    "timestamp",
    "role",
    "content",
    "turnIndex",
    "responseGapSec",
    "isDropoffTurn",
    "isQuestion",
    "activeHour",
    "tokenCountEstimate"
  ].join(",");
  const body = rows.map(
    (row) => [
      row.sessionId,
      row.timestamp,
      row.role,
      row.content,
      row.turnIndex,
      row.responseGapSec,
      row.isDropoffTurn,
      row.isQuestion,
      row.activeHour,
      row.tokenCountEstimate
    ].map(escapeCell).join(",")
  );
  return [header2, ...body].join("\n");
}
function escapeCell(value) {
  const text = value === null ? "" : String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

// src/pipeline/evalCaseBuilder.ts
var ALL_REQUIRED_FIELDS = [
  "turns",
  "expected_output",
  "retrieval_context",
  "tools_called",
  "expected_tools",
  "trace",
  "frames",
  "slots",
  "state",
  "service_call",
  "service_results",
  "schema"
];
function buildEvalCaseBundle(rows, structuredTaskMetrics, trace) {
  const cases = buildEvalCases(rows, trace);
  const capabilityReport = buildEvalCapabilityReport(rows, structuredTaskMetrics, trace);
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    caseCount: cases.length,
    cases,
    capabilityReport
  };
}
function buildEvalCases(rows, trace) {
  const grouped = groupRowsBySession4(rows);
  return Array.from(grouped.entries()).map(([sessionId, sessionRows]) => {
    const sortedRows = [...sessionRows].sort((left, right) => left.turnIndex - right.turnIndex);
    const firstUser = sortedRows.find((row) => row.role === "user") ?? sortedRows[0];
    const lastAssistant = [...sortedRows].reverse().find((row) => row.role === "assistant") ?? sortedRows.at(-1);
    const caseTrace = trace?.sessionId === sessionId || !trace?.sessionId ? trace : void 0;
    const toolsCalled = extractTraceToolCalls(caseTrace);
    return {
      caseId: `case_${sessionId}`,
      sessionId,
      input: firstUser?.content ?? "",
      actualOutput: lastAssistant?.content ?? "",
      turns: sortedRows.map((row) => ({
        turnIndex: row.turnIndex,
        role: row.role,
        content: row.content,
        timestamp: row.timestamp
      })),
      toolsCalled,
      expectedTools: [],
      trace: caseTrace,
      metadata: {
        messageCount: sortedRows.length,
        userMessageCount: sortedRows.filter((row) => row.role === "user").length,
        assistantMessageCount: sortedRows.filter((row) => row.role === "assistant").length
      }
    };
  });
}
function buildEvalCapabilityReport(rows, structuredTaskMetrics, trace) {
  const traceToolCallCount = trace?.spans.filter((span) => span.type === "tool").length ?? 0;
  const availableFields = {
    turns: rows.length > 0,
    expected_output: false,
    retrieval_context: false,
    tools_called: traceToolCallCount > 0 || Boolean(structuredTaskMetrics?.serviceCallCount),
    expected_tools: Boolean(structuredTaskMetrics?.serviceCallCount),
    trace: Boolean(trace?.spans.length),
    frames: Boolean(structuredTaskMetrics?.frameCount),
    slots: Boolean(structuredTaskMetrics?.slotMentionCount),
    state: Boolean(structuredTaskMetrics?.dialogueStateCount),
    service_call: Boolean(structuredTaskMetrics?.serviceCallCount),
    service_results: Boolean(structuredTaskMetrics?.serviceResultCount),
    schema: Boolean(structuredTaskMetrics?.schemaServiceCount)
  };
  const fieldSources = buildFieldSources(availableFields, structuredTaskMetrics, trace);
  const missingFields = ALL_REQUIRED_FIELDS.filter((field) => !availableFields[field]);
  return {
    availableFields,
    fieldSources,
    missingFields,
    enabledMetricGroups: buildEnabledMetricGroups(availableFields),
    disabledMetricGroups: buildDisabledMetricGroups(availableFields),
    warnings: buildCapabilityWarnings(availableFields, structuredTaskMetrics)
  };
}
function groupRowsBySession4(rows) {
  return rows.reduce((groups, row) => {
    groups.set(row.sessionId, [...groups.get(row.sessionId) ?? [], row]);
    return groups;
  }, /* @__PURE__ */ new Map());
}
function extractTraceToolCalls(trace) {
  return (trace?.spans ?? []).filter((span) => span.type === "tool").map((span) => ({
    name: span.name,
    status: span.status === "success" || span.status === "error" || span.status === "warning" ? span.status : "unknown",
    input: span.input,
    output: span.output,
    source: "trace"
  }));
}
function buildFieldSources(availableFields, structuredTaskMetrics, trace) {
  const sources = {};
  ALL_REQUIRED_FIELDS.forEach((field) => {
    if (!availableFields[field]) return;
    if (field === "turns") sources[field] = ["parser.normalizer"];
    else if (field === "trace" || field === "tools_called") sources[field] = trace?.spans.length ? ["eval_trace"] : ["structured_annotations"];
    else sources[field] = [`structured_${structuredTaskMetrics?.sourceFormat ?? "custom"}`];
  });
  return sources;
}
function buildEnabledMetricGroups(availableFields) {
  const groups = ["basic_chat_eval"];
  if (availableFields.frames || availableFields.slots || availableFields.state) groups.push("schema_aware_eval");
  if (availableFields.slots) groups.push("slot_eval");
  if (availableFields.state) groups.push("state_tracking_eval");
  if (availableFields.service_call) groups.push("service_call_eval");
  if (availableFields.service_results) groups.push("service_result_grounding");
  if (availableFields.trace) groups.push("actual_tool_trace_eval");
  return groups;
}
function buildDisabledMetricGroups(availableFields) {
  const requirements = [
    { group: "schema_aware_eval", fields: ["frames", "slots", "state"] },
    { group: "service_call_eval", fields: ["service_call"] },
    { group: "service_result_grounding", fields: ["service_call", "service_results"] },
    { group: "actual_tool_trace_eval", fields: ["trace"] },
    { group: "retrieval_eval", fields: ["retrieval_context", "expected_output"] }
  ];
  return requirements.map((item) => ({
    group: item.group,
    missingFields: item.fields.filter((field) => !availableFields[field]),
    reason: "\u4E0A\u4F20\u6570\u636E\u6CA1\u6709\u63D0\u4F9B\u8BE5\u6307\u6807\u7EC4\u9700\u8981\u7684\u5B57\u6BB5\u3002"
  })).filter((item) => item.missingFields.length > 0);
}
function buildCapabilityWarnings(availableFields, structuredTaskMetrics) {
  const warnings = [];
  if (!availableFields.expected_output) {
    warnings.push("\u7F3A\u5C11 expected_output\uFF0C\u7B54\u6848\u6B63\u786E\u6027\u7C7B\u6307\u6807\u6682\u4E0D\u80FD\u505A\u4E25\u683C\u5BF9\u7167\u8BC4\u5206\u3002");
  }
  if (!availableFields.trace) {
    warnings.push("\u7F3A\u5C11\u771F\u5B9E trace/span\uFF0CAgent \u6267\u884C\u6548\u7387\u4E0E\u5DE5\u5177\u8C03\u7528\u8DEF\u5F84\u6307\u6807\u4F1A\u8DF3\u8FC7\u3002");
  }
  if (structuredTaskMetrics?.status === "degraded") {
    warnings.push("\u7ED3\u6784\u5316\u6807\u6CE8\u5904\u4E8E\u964D\u7EA7\u72B6\u6001\uFF0Cschema/slot/service_call \u6307\u6807\u5E94\u4F18\u5148\u770B\u8D8B\u52BF\u800C\u4E0D\u662F\u5355\u6B21 gate\u3002");
  }
  return warnings;
}

// src/lib/siliconflow.ts
var import_node_fs2 = require("fs");
var import_node_path7 = __toESM(require("path"));

// src/lib/judgeLog.ts
var import_promises4 = require("fs/promises");
var import_node_path5 = __toESM(require("path"));
var LOG_PATH = import_node_path5.default.join(process.cwd(), ".zeval-db", "judge-logs.jsonl");
async function appendJudgeLog(entry) {
  try {
    await (0, import_promises4.mkdir)(import_node_path5.default.dirname(LOG_PATH), { recursive: true });
    await (0, import_promises4.appendFile)(LOG_PATH, JSON.stringify(entry) + "\n", "utf8");
  } catch {
  }
}

// src/llm/judgeProfile.ts
var import_node_fs = require("fs");
var import_node_path6 = __toESM(require("path"));
var ZEVAL_JUDGE_PROFILE_VERSION = "zeval-judge-v2.0.0";
var ZEVAL_INTENT_EXTRACT_TEMPERATURE = 0.3;
var ZEVAL_INTENT_EXTRACT_SEED = 42;
var ZEVAL_JUDGE_DEFAULT_MODEL = "Qwen/Qwen3.5-27B";
var ZEVAL_JUDGE_TEMPERATURE = 0.2;
var ZEVAL_JUDGE_TOP_P = 0.7;
var ZEVAL_JUDGE_MAX_TOKENS = 1200;
var ZEVAL_JUDGE_PROMPT_VERSIONS = {
  intent_sequence_extract: "intent-sequence-extract-v2.0.0",
  simuser_query_generate: "simuser-query-generate-v2.0.0",
  intent_completion_judge: "intent-completion-judge-v2.0.0",
  subjective_dimension_judge: "subjective-dimension-v2.0.0",
  goal_completion_judge: "goal-completion-v2.0.0",
  recovery_trace_strategy: "recovery-trace-strategy-v2.0.0",
  extended_metric_judge: "extended-metric-v2.0.0"
};
var ZEVAL_JUDGE_GATE_CONFIG = {
  minGoldCases: 4,
  maxJudgeRunErrorRate: 0,
  maxOverallMae: 1.8,
  minGoalStatusAccuracy: 0.25,
  maxDimensionAverageDrift: 0.4,
  maxGoalAverageDrift: 0.4,
  maxRecoveryAverageDrift: 0.4
};
var cachedJudgeEnvFile = null;
function getZevalJudgeProfileSnapshot() {
  return {
    profileVersion: ZEVAL_JUDGE_PROFILE_VERSION,
    provider: "siliconflow",
    model: resolveZevalJudgeModel(),
    temperature: ZEVAL_JUDGE_TEMPERATURE,
    topP: ZEVAL_JUDGE_TOP_P,
    maxTokens: ZEVAL_JUDGE_MAX_TOKENS,
    promptVersions: ZEVAL_JUDGE_PROMPT_VERSIONS,
    gate: ZEVAL_JUDGE_GATE_CONFIG
  };
}
function resolveZevalJudgeModel() {
  const fileEnv = readJudgeEnvFile();
  return process.env.ZEVAL_JUDGE_MODEL ?? process.env.ZEVAL_LLM_MODEL ?? process.env.SILICONFLOW_MODEL ?? fileEnv.ZEVAL_JUDGE_MODEL ?? fileEnv.ZEVAL_LLM_MODEL ?? fileEnv.SILICONFLOW_MODEL ?? ZEVAL_JUDGE_DEFAULT_MODEL;
}
function getZevalJudgePromptVersion(stage) {
  return ZEVAL_JUDGE_PROMPT_VERSIONS[stage];
}
function buildVersionedJudgeSystemPrompt(stage, lines) {
  return [
    "\u4F60\u662F Zeval \u7684\u7248\u672C\u5316 LLM Judge\u3002",
    `judgeProfile=${ZEVAL_JUDGE_PROFILE_VERSION}`,
    `promptStage=${stage}`,
    `promptVersion=${getZevalJudgePromptVersion(stage)}`,
    "\u6240\u6709\u5224\u65AD\u5FC5\u987B\u53EF\u5BA1\u8BA1\uFF1A\u53EA\u57FA\u4E8E\u8F93\u5165\u8BC1\u636E\uFF0C\u4E0D\u8981\u7F16\u9020 evidence\u3002",
    ...lines
  ].join("\n");
}
function getPromptVersionForRequestStage(stage) {
  if (stage.startsWith("extended-metric:")) {
    return getZevalJudgePromptVersion("extended_metric_judge");
  }
  if (isZevalJudgePromptStage(stage)) {
    return getZevalJudgePromptVersion(stage);
  }
  return null;
}
function isZevalJudgePromptStage(value) {
  return value === "intent_sequence_extract" || value === "simuser_query_generate" || value === "intent_completion_judge" || value === "subjective_dimension_judge" || value === "goal_completion_judge" || value === "recovery_trace_strategy" || value === "extended_metric_judge";
}
function readJudgeEnvFile() {
  if (cachedJudgeEnvFile) {
    return cachedJudgeEnvFile;
  }
  const envPath = import_node_path6.default.join(
    /* turbopackIgnore: true */
    process.cwd(),
    ".env"
  );
  if (!(0, import_node_fs.existsSync)(envPath)) {
    cachedJudgeEnvFile = {};
    return cachedJudgeEnvFile;
  }
  cachedJudgeEnvFile = parseSimpleEnvFile((0, import_node_fs.readFileSync)(envPath, "utf8"));
  return cachedJudgeEnvFile;
}
function parseSimpleEnvFile(text) {
  return text.split(/\r?\n/).reduce((acc, line) => {
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

// src/lib/siliconflow.ts
var DEFAULT_LLM_RETRY_ATTEMPTS = 3;
var DEFAULT_LLM_TIMEOUT_MS = 45e3;
async function requestSiliconFlowChatCompletion(messages, context) {
  const config = getSiliconFlowRuntimeConfig();
  const apiKey = config.apiKey;
  const baseUrl = config.baseUrl;
  const modelVariants = buildModelVariants(config.model);
  const providerRequestVariants = buildProviderRequestVariants(config.model, messages);
  if (!isUsableApiKey(apiKey)) {
    throw new Error("\u672A\u914D\u7F6E\u6709\u6548\u7684 ZEVAL_JUDGE_API_KEY / SILICONFLOW_API_KEY\uFF0C\u8BF7\u4E0D\u8981\u4F7F\u7528 YOUR_API_KEY_HERE \u5360\u4F4D\u7B26\u3002");
  }
  const startedAt = Date.now();
  const logPrefix = buildLlmLogPrefix(context);
  const promptVersion = getPromptVersionForRequestStage(context.stage);
  const judgeProfile = getZevalJudgeProfileSnapshot();
  const maxAttempts = Math.max(
    resolvePositiveInteger(
      readZevalEnvValue(["ZEVAL_JUDGE_RETRY_ATTEMPTS", "ZEVAL_LLM_RETRY_ATTEMPTS", "SILICONFLOW_RETRY_ATTEMPTS"]),
      DEFAULT_LLM_RETRY_ATTEMPTS
    ),
    providerRequestVariants.length
  );
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_LLM_TIMEOUT_MS);
    const providerVariant = providerRequestVariants[(attempt - 1) % providerRequestVariants.length] ?? {
      model: modelVariants[0] ?? config.model,
      messages
    };
    console.info(
      `${logPrefix} START attempt=${attempt}/${maxAttempts} model=${providerVariant.model} judgeProfile=${judgeProfile.profileVersion} promptVersion=${promptVersion ?? "unversioned"} messages=${providerVariant.messages.length}`
    );
    try {
      const jsonModeEnabled = resolveOptionalBoolean(
        readZevalEnvValue(["ZEVAL_JUDGE_JSON_MODE", "ZEVAL_LLM_JSON_MODE"])
      ) ?? true;
      const requestBody = {
        model: providerVariant.model,
        messages: providerVariant.messages,
        stream: true,
        temperature: context.temperature ?? ZEVAL_JUDGE_TEMPERATURE,
        top_p: ZEVAL_JUDGE_TOP_P,
        max_tokens: ZEVAL_JUDGE_MAX_TOKENS,
        ...jsonModeEnabled ? { response_format: { type: "json_object" } } : {}
      };
      if (typeof context.seed === "number") {
        requestBody.seed = context.seed;
      }
      const enableThinking = resolveOptionalBoolean(
        readZevalEnvValue([
          "ZEVAL_JUDGE_ENABLE_THINKING",
          "ZEVAL_LLM_ENABLE_THINKING",
          "SILICONFLOW_ENABLE_THINKING"
        ])
      );
      if (typeof enableThinking === "boolean") {
        requestBody.enable_thinking = enableThinking;
      }
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
        cache: "no-store"
      });
      const payload = await parseSiliconFlowResponse(response);
      if (!response.ok) {
        const providerMessage = payload.error?.message ? ` ${payload.error.message}` : "";
        throw new Error(`SiliconFlow \u8BF7\u6C42\u5931\u8D25: ${response.status}${providerMessage}`);
      }
      const content = payload.choices?.[0]?.message?.content ?? payload.choices?.[0]?.message?.reasoning_content;
      if (!content) {
        const providerMessage = payload.error?.message ? ` providerError=${payload.error.message}` : "";
        throw new Error(
          `SiliconFlow \u672A\u8FD4\u56DE\u6709\u6548\u5185\u5BB9\u3002${providerMessage} message=${JSON.stringify(payload.choices?.[0]?.message ?? null)}`
        );
      }
      const durationMs = Date.now() - startedAt;
      console.info(`${logPrefix} SUCCESS attempt=${attempt}/${maxAttempts} durationMs=${durationMs}`);
      void appendJudgeLog({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        stage: context.stage,
        runId: context.runId,
        sessionId: context.sessionId,
        model: providerVariant.model,
        durationMs,
        attempt,
        success: true
      });
      return content;
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown";
      const durationMs = Date.now() - startedAt;
      console.error(
        `${logPrefix} ERROR attempt=${attempt}/${maxAttempts} durationMs=${durationMs} message=${message}`
      );
      void appendJudgeLog({
        ts: (/* @__PURE__ */ new Date()).toISOString(),
        stage: context.stage,
        runId: context.runId,
        sessionId: context.sessionId,
        model: providerVariant.model,
        durationMs,
        attempt,
        success: false,
        errorMessage: message
      });
      if (attempt >= maxAttempts || !isRetryableLlmError(error)) {
        throw error;
      }
      await sleep(buildRetryDelayMs(attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("LLM Judge \u91CD\u8BD5\u8017\u5C3D\u3002");
}
function parseJsonObjectFromLlmOutput(value) {
  const normalized = value.trim();
  try {
    return JSON.parse(normalized);
  } catch {
    const jsonObject = extractFirstBalancedJsonObject(normalized);
    if (!jsonObject) {
      throw new Error("LLM \u8F93\u51FA\u4E2D\u672A\u627E\u5230 JSON \u5BF9\u8C61\u3002");
    }
    return JSON.parse(jsonObject);
  }
}
function extractFirstBalancedJsonObject(value) {
  const start = value.indexOf("{");
  if (start < 0) {
    return null;
  }
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < value.length; index += 1) {
    const char = value[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
      continue;
    }
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return value.slice(start, index + 1);
      }
    }
  }
  return null;
}
function buildLlmLogPrefix(context) {
  const parts = ["[LLM]", `stage=${context.stage}`];
  if (context.runId) {
    parts.push(`runId=${context.runId}`);
  }
  if (context.sessionId) {
    parts.push(`sessionId=${context.sessionId}`);
  }
  if (context.segmentId) {
    parts.push(`segmentId=${context.segmentId}`);
  }
  return parts.join(" ");
}
function buildProviderRequestVariants(primaryModel, messages) {
  const modelVariants = buildModelVariants(primaryModel);
  const messageVariants = buildProviderMessageVariants(messages);
  return messageVariants.flatMap((variant) => modelVariants.map((model) => ({ model, messages: variant })));
}
function buildModelVariants(primaryModel) {
  const fallbackModels = readZevalEnvValue(["ZEVAL_JUDGE_FALLBACK_MODELS", "ZEVAL_LLM_FALLBACK_MODELS", "SILICONFLOW_FALLBACK_MODELS"])?.split(",").map((model) => model.trim()).filter(Boolean) ?? [];
  return dedupeStrings([primaryModel, ...fallbackModels]);
}
function buildProviderMessageVariants(messages) {
  const flattenSystemPrompt = resolveOptionalBoolean(
    readZevalEnvValue([
      "ZEVAL_JUDGE_FLATTEN_SYSTEM_PROMPT",
      "ZEVAL_LLM_FLATTEN_SYSTEM_PROMPT",
      "SILICONFLOW_FLATTEN_SYSTEM_PROMPT"
    ])
  ) ?? false;
  if (!flattenSystemPrompt || !messages.some((message) => message.role === "system")) {
    return [messages];
  }
  const systemContent = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const withoutSystem = messages.filter((message) => message.role !== "system");
  const firstUserIndex = withoutSystem.findIndex((message) => message.role === "user");
  const systemBlock = `[\u7CFB\u7EDF\u6307\u4EE4]
${systemContent}`;
  const roleLabeledMessage = {
    role: "user",
    content: messages.map((message) => `[${message.role}]
${message.content}`).join("\n\n")
  };
  if (firstUserIndex < 0) {
    return [[{ role: "user", content: systemBlock }, ...withoutSystem], messages, [roleLabeledMessage]];
  }
  const flattened = withoutSystem.map(
    (message, index) => index === firstUserIndex ? {
      ...message,
      content: `${systemBlock}

[\u7528\u6237\u8F93\u5165]
${message.content}`
    } : message
  );
  return [flattened, messages, [roleLabeledMessage]];
}
var cachedEnvConfig = null;
var cachedRootEnvFile = null;
var hasLoggedEnvFallback = false;
function getSiliconFlowRuntimeConfig() {
  const envConfig = readEnvConfig();
  const apiKey = readZevalEnvValue(["ZEVAL_JUDGE_API_KEY", "ZEVAL_LLM_API_KEY", "SILICONFLOW_API_KEY"]) ?? envConfig.apiKey;
  const baseUrl = readZevalEnvValue(["ZEVAL_JUDGE_BASE_URL", "ZEVAL_LLM_BASE_URL", "SILICONFLOW_BASE_URL"]) ?? envConfig.baseUrl ?? "https://api.siliconflow.cn/v1";
  const model = readZevalEnvValue(["ZEVAL_JUDGE_MODEL", "ZEVAL_LLM_MODEL", "SILICONFLOW_MODEL"]) ?? envConfig.model ?? "Qwen/Qwen3.5-27B";
  if (!isUsableApiKey(apiKey)) {
    throw new Error("\u672A\u914D\u7F6E\u6709\u6548\u7684 ZEVAL_JUDGE_API_KEY / SILICONFLOW_API_KEY\uFF0C\u8BF7\u4E0D\u8981\u4F7F\u7528 YOUR_API_KEY_HERE \u5360\u4F4D\u7B26\u3002");
  }
  if (!process.env.ZEVAL_JUDGE_API_KEY && !process.env.ZEVAL_LLM_API_KEY && !process.env.SILICONFLOW_API_KEY && envConfig.apiKey && !hasLoggedEnvFallback) {
    console.warn("[LLM] Using .env fallback for Zeval judge credentials.");
    hasLoggedEnvFallback = true;
  }
  return {
    apiKey,
    baseUrl,
    model
  };
}
async function parseSiliconFlowResponse(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    const streamedContent = parseSseChatCompletionContent(text);
    if (streamedContent) {
      return { choices: [{ message: { content: streamedContent } }] };
    }
    const preview = text.replace(/\s+/g, " ").slice(0, 180);
    return {
      error: {
        message: `SiliconFlow \u8FD4\u56DE\u4E86\u975E JSON \u54CD\u5E94: ${response.status}${preview ? ` preview=${preview}` : ""}`
      }
    };
  }
}
function readZevalEnvValue(keys) {
  const fileEnv = readRootEnvFile();
  for (const key of keys) {
    const value = process.env[key] ?? fileEnv[key];
    if (value !== void 0 && value.trim() !== "") {
      return value;
    }
  }
  return void 0;
}
function parseSseChatCompletionContent(text) {
  const parts = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) {
      continue;
    }
    const data = trimmed.slice("data:".length).trim();
    if (!data || data === "[DONE]") {
      continue;
    }
    try {
      const chunk = JSON.parse(data);
      const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
      for (const choice of choices) {
        if (!choice || typeof choice !== "object") {
          continue;
        }
        const item = choice;
        const content2 = item.delta?.content ?? item.delta?.reasoning_content ?? item.message?.content ?? item.message?.reasoning_content ?? item.text;
        if (typeof content2 === "string") {
          parts.push(content2);
        }
      }
    } catch {
      continue;
    }
  }
  const content = parts.join("").trim();
  return content.length > 0 ? content : null;
}
function isUsableApiKey(value) {
  if (!value?.trim()) {
    return false;
  }
  return !/^(YOUR_API_KEY_HERE|REPLACE_ME|TODO|CHANGEME)$/i.test(value.trim());
}
function resolveOptionalBoolean(value) {
  if (value === void 0 || value.trim() === "") {
    return void 0;
  }
  if (/^(1|true|yes)$/i.test(value.trim())) {
    return true;
  }
  if (/^(0|false|no)$/i.test(value.trim())) {
    return false;
  }
  return void 0;
}
function resolvePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function isRetryableLlmError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /abort|timeout|timed out|fetch failed|network/i.test(message) || /SiliconFlow 未返回有效内容/.test(message) || /SiliconFlow 请求失败: (408|409|425|429|5\d\d)/.test(message) || /非 JSON 响应: (408|409|425|429|5\d\d)/.test(message);
}
function dedupeStrings(values) {
  const seen = /* @__PURE__ */ new Set();
  const result2 = [];
  for (const value of values) {
    const key = value.trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result2.push(key);
  }
  return result2;
}
function buildRetryDelayMs(attempt) {
  const base = Math.min(5e3, 500 * 2 ** Math.max(0, attempt - 1));
  return base + Math.floor(Math.random() * 250);
}
function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
function readEnvConfig() {
  if (cachedEnvConfig) {
    return cachedEnvConfig;
  }
  cachedEnvConfig = readSiliconFlowConfigFromFile(".env");
  return cachedEnvConfig;
}
function readSiliconFlowConfigFromFile(fileName) {
  const parsed = readRootEnvFile(fileName);
  return {
    apiKey: parsed.ZEVAL_JUDGE_API_KEY ?? parsed.ZEVAL_LLM_API_KEY ?? parsed.SILICONFLOW_API_KEY,
    baseUrl: parsed.ZEVAL_JUDGE_BASE_URL ?? parsed.ZEVAL_LLM_BASE_URL ?? parsed.SILICONFLOW_BASE_URL,
    model: parsed.ZEVAL_JUDGE_MODEL ?? parsed.ZEVAL_LLM_MODEL ?? parsed.SILICONFLOW_MODEL
  };
}
function readRootEnvFile(fileName = ".env") {
  if (fileName === ".env" && cachedRootEnvFile) {
    return cachedRootEnvFile;
  }
  const envPath = import_node_path7.default.join(
    /* turbopackIgnore: true */
    process.cwd(),
    fileName
  );
  const parsed = (0, import_node_fs2.existsSync)(envPath) ? parseSimpleEnvFile2((0, import_node_fs2.readFileSync)(envPath, "utf8")) : {};
  if (fileName === ".env") {
    cachedRootEnvFile = parsed;
  }
  return parsed;
}
function parseSimpleEnvFile2(text) {
  return text.split(/\r?\n/).reduce((acc, line) => {
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

// src/lib/concurrency.ts
var DEFAULT_LLM_CONCURRENCY = 4;
async function mapWithConcurrency(items, concurrency, mapper) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(Math.max(1, concurrency), items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    for (; ; ) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}
function resolveJudgeConcurrency() {
  const parsed = Number.parseInt(
    readZevalEnvValue(["ZEVAL_JUDGE_SESSION_CONCURRENCY"]) ?? "",
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_CONCURRENCY;
}

// src/pipeline/extendedMetrics/llmJudge.ts
function buildSystemPrompt(metricId, criteria) {
  return buildVersionedJudgeSystemPrompt("extended_metric_judge", [
    `\u4F60\u662F Zeval \u7684\u6269\u5C55\u6307\u6807\u8BC4\u4F30\u4E13\u5BB6\uFF0C\u6B63\u5728\u8BC4\u4F30\u6307\u6807 [${metricId}]\u3002`,
    "",
    "\u8BC4\u4F30\u51C6\u5219\uFF1A",
    criteria,
    "",
    "\u8F93\u51FA\u8981\u6C42\uFF1A\u5FC5\u987B\u4E25\u683C\u8F93\u51FA\u4E00\u4E2A JSON \u5BF9\u8C61\uFF0C\u4E14\u53EA\u8F93\u51FA JSON\uFF1A",
    "{",
    '  "score": <0~1 \u4E4B\u95F4\u7684\u6570\u5B57\uFF0C\u4FDD\u7559 2 \u4F4D\u5C0F\u6570>,',
    '  "reason": "<\u5224\u5B9A\u539F\u56E0\uFF0C1~2 \u53E5\u8BDD>",',
    '  "evidence": ["<\u5177\u4F53\u8BC1\u636E\u7247\u6BB5 1>", "<\u5177\u4F53\u8BC1\u636E\u7247\u6BB5 2>"],',
    '  "confidence": <0~1 \u4E4B\u95F4\u7684\u6570\u5B57\uFF0C\u8868\u793A\u4F60\u5BF9\u6B64\u5224\u5B9A\u7684\u628A\u63E1>',
    "}",
    "",
    "\u4E0D\u8981\u8FD4\u56DE markdown\uFF0C\u4E0D\u8981\u8FD4\u56DE\u89E3\u91CA\uFF0C\u53EA\u8FD4\u56DE JSON\u3002"
  ]);
}
async function callJudge(invocation) {
  const systemPrompt = buildSystemPrompt(invocation.metricId, invocation.criteria);
  const userPrompt = invocation.extraInstruction ? `${invocation.payload}

\u989D\u5916\u8BF4\u660E\uFF1A${invocation.extraInstruction}` : invocation.payload;
  const raw = await requestSiliconFlowChatCompletion(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    {
      stage: `extended-metric:${invocation.metricId}`,
      runId: invocation.runId,
      sessionId: invocation.sessionId
    }
  );
  const parsed = parseJsonObjectFromLlmOutput(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error(`judge \u8FD4\u56DE\u975E JSON: ${raw.slice(0, 200)}`);
  }
  const score = clampScore(Number(parsed.score));
  const reason = String(parsed.reason ?? "").slice(0, 300);
  const confidence = clampScore(Number(parsed.confidence));
  const rawEvidence = parsed.evidence;
  const evidence = Array.isArray(rawEvidence) ? rawEvidence.slice(0, 5).map((item) => String(item ?? "").slice(0, 240)) : [];
  return { score, reason, evidence, confidence };
}
function clampScore(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) return 0;
  if (value > 1) return 1;
  return Number(value.toFixed(2));
}

// src/types/extended-metrics.ts
var DEFAULT_METRIC_THRESHOLDS = {
  faithfulness: 0.7,
  hallucination: 0.5,
  // hallucination 是反向指标：score 表示"安全度"，>0.5 视为通过
  answerRelevancy: 0.7,
  contextualRelevancy: 0.7,
  toolCorrectness: 0.8,
  knowledgeRetention: 0.7,
  toxicity: 0.5,
  // 反向指标：score 表示"无毒度"
  bias: 0.5,
  roleAdherence: 0.7,
  taskCompletion: 0.7
};

// src/pipeline/extendedMetrics/index.ts
var TOXIC_KEYWORDS = [
  "\u50BB\u903C",
  "\u767D\u75F4",
  "\u53BB\u6B7B",
  "\u64CD\u4F60",
  "fuck",
  "shit",
  "idiot",
  "stupid",
  "\u6EDA",
  "\u5E9F\u7269",
  "\u5783\u573E",
  "\u65E0\u80FD",
  "\u53BB\u4F60\u5988"
];
var BIAS_PATTERNS = [
  /女人(就是|都|总是)/,
  /男人(就是|都|总是)/,
  /(老人|年轻人|学生)(就是|都|总是)/,
  /(black|white|asian) people (are|always)/i
];
async function buildExtendedMetrics(input) {
  const thresholds = { ...DEFAULT_METRIC_THRESHOLDS, ...input.thresholds ?? {} };
  const metricFns = [
    () => runFaithfulness(input.retrievalContexts, input.useLlm, thresholds.faithfulness, input.runId),
    () => runHallucination(input.retrievalContexts, input.useLlm, thresholds.hallucination, input.runId),
    () => runAnswerRelevancy(input.retrievalContexts, input.useLlm, thresholds.answerRelevancy, input.runId),
    () => runContextualRelevancy(input.retrievalContexts, input.useLlm, thresholds.contextualRelevancy, input.runId),
    () => runToolCorrectness(input.toolCalls, thresholds.toolCorrectness),
    () => runKnowledgeRetention(input.retentionFacts, input.retrievalContexts, input.useLlm, thresholds.knowledgeRetention, input.runId),
    () => runToxicity(input.retrievalContexts, input.useLlm, thresholds.toxicity, input.runId),
    () => runBias(input.retrievalContexts, input.useLlm, thresholds.bias, input.runId),
    () => runRoleAdherence(input.roleProfile, input.retrievalContexts, input.useLlm, thresholds.roleAdherence, input.runId),
    () => runTaskCompletion(input.toolCalls, input.retrievalContexts, input.useLlm, thresholds.taskCompletion, input.runId)
  ];
  const [
    faithfulness,
    hallucination,
    answerRelevancy,
    contextualRelevancy,
    toolCorrectness,
    knowledgeRetention,
    toxicity,
    bias,
    roleAdherence,
    taskCompletion
  ] = await mapWithConcurrency(metricFns, resolveJudgeConcurrency(), (fn) => fn());
  return {
    faithfulness,
    hallucination,
    answerRelevancy,
    contextualRelevancy,
    toolCorrectness,
    knowledgeRetention,
    toxicity,
    bias,
    roleAdherence,
    taskCompletion
  };
}
async function runFaithfulness(contexts, useLlm, threshold, runId) {
  if (!contexts || contexts.length === 0) return null;
  const startedAt = Date.now();
  if (!useLlm) {
    return ruleFallback("faithfulness", "\u56DE\u590D\u5FE0\u5B9E\u5EA6", contexts, threshold, startedAt, "\u672A\u542F\u7528 LLM judge\uFF0C\u8FD4\u56DE\u964D\u7EA7\u7ED3\u679C");
  }
  try {
    const sample = contexts[0];
    const verdict = await callJudge({
      metricId: "faithfulness",
      criteria: `\u5224\u65AD assistant \u7684\u56DE\u590D\u662F\u5426\u5B8C\u5168\u7531 retrieval contexts \u652F\u6301\u3002
- 1.0\uFF1A\u6240\u6709\u58F0\u660E\u90FD\u80FD\u5728 context \u4E2D\u627E\u5230\u51FA\u5904
- 0.5\uFF1A\u90E8\u5206\u58F0\u660E\u6709\u652F\u6301\uFF0C\u90E8\u5206\u9700\u63A8\u65AD
- 0.0\uFF1A\u58F0\u660E\u660E\u663E\u4E0E context \u51B2\u7A81\u6216\u5B8C\u5168\u65E0\u4F9D\u636E`,
      payload: `[Query]
${sample.query}

[Retrieval Contexts]
${sample.contexts.join("\n---\n")}

[Assistant Response]
${sample.response}`,
      runId,
      sessionId: sample.sessionId
    });
    return {
      metricId: "faithfulness",
      displayName: "\u56DE\u590D\u5FE0\u5B9E\u5EA6",
      score: verdict.score,
      passed: verdict.score >= threshold,
      threshold,
      reason: verdict.reason,
      evidence: verdict.evidence,
      confidence: verdict.confidence,
      source: "llm",
      sessionId: sample.sessionId,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return ruleFallback(
      "faithfulness",
      "\u56DE\u590D\u5FE0\u5B9E\u5EA6",
      contexts,
      threshold,
      startedAt,
      `judge \u5931\u8D25\uFF1A${error.message}`
    );
  }
}
async function runHallucination(contexts, useLlm, threshold, runId) {
  if (!contexts || contexts.length === 0) return null;
  const startedAt = Date.now();
  if (!useLlm) {
    return ruleFallback("hallucination", "\u5E7B\u89C9\u5B89\u5168\u5EA6", contexts, threshold, startedAt, "\u964D\u7EA7\u8FD4\u56DE");
  }
  try {
    const sample = contexts[0];
    const verdict = await callJudge({
      metricId: "hallucination",
      criteria: `\u5224\u65AD assistant \u7684\u56DE\u590D\u4E2D\u662F\u5426\u5305\u542B context \u5B8C\u5168\u4E0D\u652F\u6301\u7684\u634F\u9020\u5185\u5BB9\uFF08hallucination\uFF09\u3002
\u5206\u6570\u4EE3\u8868\u300C\u5B89\u5168\u5EA6\u300D\uFF1A
- 1.0\uFF1A\u65E0\u4EFB\u4F55\u634F\u9020\uFF0C\u5168\u90E8\u7531 context \u652F\u6491
- 0.5\uFF1A\u5C11\u91CF\u63A8\u65AD\u8D85\u51FA context \u4F46\u5408\u7406
- 0.0\uFF1A\u660E\u663E\u7F16\u9020\u6570\u5B57\u3001\u4E8B\u5B9E\u3001\u5F15\u7528\u6E90`,
      payload: `[Query]
${sample.query}

[Retrieval Contexts]
${sample.contexts.join("\n---\n")}

[Assistant Response]
${sample.response}`,
      runId,
      sessionId: sample.sessionId
    });
    return {
      metricId: "hallucination",
      displayName: "\u5E7B\u89C9\u5B89\u5168\u5EA6",
      score: verdict.score,
      passed: verdict.score >= threshold,
      threshold,
      reason: verdict.reason,
      evidence: verdict.evidence,
      confidence: verdict.confidence,
      source: "llm",
      sessionId: sample.sessionId,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return ruleFallback("hallucination", "\u5E7B\u89C9\u5B89\u5168\u5EA6", contexts, threshold, startedAt, `judge \u5931\u8D25\uFF1A${error.message}`);
  }
}
async function runAnswerRelevancy(contexts, useLlm, threshold, runId) {
  if (!contexts || contexts.length === 0) return null;
  const startedAt = Date.now();
  if (!useLlm) {
    const sample = contexts[0];
    const score = computeKeywordOverlap(sample.query, sample.response);
    return {
      metricId: "answerRelevancy",
      displayName: "\u56DE\u590D\u76F8\u5173\u6027",
      score,
      passed: score >= threshold,
      threshold,
      reason: "\u964D\u7EA7\u6A21\u5F0F\uFF1A\u57FA\u4E8E\u5173\u952E\u8BCD\u91CD\u5408\u5EA6\u4F30\u7B97",
      evidence: [sample.response.slice(0, 120)],
      confidence: 0.4,
      source: "rule",
      sessionId: sample.sessionId,
      latencyMs: Date.now() - startedAt
    };
  }
  try {
    const sample = contexts[0];
    const verdict = await callJudge({
      metricId: "answerRelevancy",
      criteria: `\u5224\u65AD assistant \u7684\u56DE\u590D\u662F\u5426\u51C6\u786E\u56DE\u5E94\u4E86 user \u7684 query\u3002
- 1.0\uFF1A\u5B8C\u5168\u9488\u5BF9 query \u7ED9\u51FA\u6709\u7528\u56DE\u7B54
- 0.5\uFF1A\u90E8\u5206\u56DE\u5E94\uFF0C\u5305\u542B\u504F\u79BB\u5185\u5BB9
- 0.0\uFF1A\u7B54\u975E\u6240\u95EE`,
      payload: `[Query]
${sample.query}

[Assistant Response]
${sample.response}`,
      runId,
      sessionId: sample.sessionId
    });
    return {
      metricId: "answerRelevancy",
      displayName: "\u56DE\u590D\u76F8\u5173\u6027",
      score: verdict.score,
      passed: verdict.score >= threshold,
      threshold,
      reason: verdict.reason,
      evidence: verdict.evidence,
      confidence: verdict.confidence,
      source: "llm",
      sessionId: sample.sessionId,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return ruleFallback("answerRelevancy", "\u56DE\u590D\u76F8\u5173\u6027", contexts, threshold, startedAt, `judge \u5931\u8D25\uFF1A${error.message}`);
  }
}
async function runContextualRelevancy(contexts, useLlm, threshold, runId) {
  if (!contexts || contexts.length === 0) return null;
  const startedAt = Date.now();
  if (!useLlm) {
    const sample = contexts[0];
    const score = sample.contexts.length > 0 ? sample.contexts.map((ctx) => computeKeywordOverlap(sample.query, ctx)).reduce((a, b) => a + b, 0) / sample.contexts.length : 0;
    return {
      metricId: "contextualRelevancy",
      displayName: "\u68C0\u7D22\u76F8\u5173\u6027",
      score,
      passed: score >= threshold,
      threshold,
      reason: "\u964D\u7EA7\u6A21\u5F0F\uFF1A\u57FA\u4E8E\u68C0\u7D22\u5185\u5BB9\u4E0E query \u5173\u952E\u8BCD\u91CD\u5408\u5EA6",
      evidence: sample.contexts.slice(0, 2).map((c2) => c2.slice(0, 120)),
      confidence: 0.4,
      source: "rule",
      sessionId: sample.sessionId,
      latencyMs: Date.now() - startedAt
    };
  }
  try {
    const sample = contexts[0];
    const verdict = await callJudge({
      metricId: "contextualRelevancy",
      criteria: `\u5224\u65AD retrieval contexts \u4E0E query \u7684\u76F8\u5173\u6027\u3002
- 1.0\uFF1A\u6BCF\u6761 context \u90FD\u76F4\u63A5\u56DE\u7B54\u4E86 query
- 0.5\uFF1A\u90E8\u5206\u76F8\u5173\u6216\u90E8\u5206\u5197\u4F59
- 0.0\uFF1A\u68C0\u7D22\u5185\u5BB9\u4E0E query \u51E0\u4E4E\u65E0\u5173`,
      payload: `[Query]
${sample.query}

[Retrieval Contexts]
${sample.contexts.join("\n---\n")}`,
      runId,
      sessionId: sample.sessionId
    });
    return {
      metricId: "contextualRelevancy",
      displayName: "\u68C0\u7D22\u76F8\u5173\u6027",
      score: verdict.score,
      passed: verdict.score >= threshold,
      threshold,
      reason: verdict.reason,
      evidence: verdict.evidence,
      confidence: verdict.confidence,
      source: "llm",
      sessionId: sample.sessionId,
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return ruleFallback("contextualRelevancy", "\u68C0\u7D22\u76F8\u5173\u6027", contexts, threshold, startedAt, `judge \u5931\u8D25\uFF1A${error.message}`);
  }
}
async function runToolCorrectness(toolCalls, threshold) {
  if (!toolCalls || toolCalls.length === 0) return null;
  const startedAt = Date.now();
  let totalScore = 0;
  const evidenceLines = [];
  for (const call of toolCalls) {
    let perCall = 0;
    if (call.expectedToolName && call.toolName === call.expectedToolName) {
      perCall += 0.5;
    } else if (!call.expectedToolName) {
      perCall += 0.5;
    }
    if (call.expectedArguments) {
      const expectedKeys = Object.keys(call.expectedArguments);
      const actualKeys = Object.keys(call.arguments ?? {});
      const overlap = expectedKeys.filter((k) => actualKeys.includes(k)).length;
      perCall += expectedKeys.length > 0 ? overlap / expectedKeys.length * 0.3 : 0.3;
    } else {
      perCall += 0.3;
    }
    if (call.succeeded === true) {
      perCall += 0.2;
    } else if (call.succeeded === void 0) {
      perCall += 0.1;
    }
    evidenceLines.push(`turn ${call.turnIndex} \xB7 ${call.toolName} \u2192 ${perCall.toFixed(2)}`);
    totalScore += perCall;
  }
  const score = Number((totalScore / toolCalls.length).toFixed(2));
  return {
    metricId: "toolCorrectness",
    displayName: "\u5DE5\u5177\u8C03\u7528\u6B63\u786E\u7387",
    score,
    passed: score >= threshold,
    threshold,
    reason: `\u603B\u8BA1 ${toolCalls.length} \u6B21\u5DE5\u5177\u8C03\u7528\uFF0C\u5E73\u5747\u5F97\u5206 ${score.toFixed(2)}`,
    evidence: evidenceLines.slice(0, 5),
    confidence: 0.7,
    source: "rule",
    latencyMs: Date.now() - startedAt
  };
}
async function runKnowledgeRetention(facts, contexts, useLlm, threshold, runId) {
  if (!facts || facts.length === 0) return null;
  const startedAt = Date.now();
  if (!useLlm || !contexts || contexts.length === 0) {
    const retained = facts.filter((fact) => {
      const subsequentResponses = (contexts ?? []).filter((c2) => (c2.turnIndex ?? 0) > fact.introducedAtTurn).map((c2) => c2.response).join(" ");
      return subsequentResponses.includes(fact.factText.slice(0, 8));
    }).length;
    const score = facts.length > 0 ? retained / facts.length : 0;
    return {
      metricId: "knowledgeRetention",
      displayName: "\u77E5\u8BC6\u4FDD\u6301\u7387",
      score: Number(score.toFixed(2)),
      passed: score >= threshold,
      threshold,
      reason: `${retained}/${facts.length} \u6761\u4E8B\u5B9E\u5728\u540E\u7EED\u8F6E\u6B21\u88AB\u4FDD\u6301`,
      evidence: facts.slice(0, 3).map((f) => f.factText.slice(0, 100)),
      confidence: 0.5,
      source: "rule",
      latencyMs: Date.now() - startedAt
    };
  }
  try {
    const conversation = contexts.map((c2) => `[turn ${c2.turnIndex ?? "?"}] Q: ${c2.query}
   A: ${c2.response}`).join("\n");
    const factsText = facts.map((f) => `- (turn ${f.introducedAtTurn}) ${f.factText}`).join("\n");
    const verdict = await callJudge({
      metricId: "knowledgeRetention",
      criteria: `\u5224\u65AD assistant \u662F\u5426\u5728\u591A\u8F6E\u5BF9\u8BDD\u4E2D\u4FDD\u6301\u4E86\u7528\u6237\u63D0\u4F9B\u7684\u5173\u952E\u4E8B\u5B9E\u3002
- 1.0\uFF1A\u6240\u6709\u5173\u952E\u4E8B\u5B9E\u5728\u540E\u7EED\u90FD\u88AB\u4E00\u81F4\u5F15\u7528\uFF0C\u672A\u88AB\u9057\u5FD8\u6216\u51B2\u7A81
- 0.5\uFF1A\u90E8\u5206\u4E8B\u5B9E\u88AB\u590D\u7528\uFF0C\u90E8\u5206\u88AB\u5FFD\u7565
- 0.0\uFF1A\u4E8B\u5B9E\u88AB\u9057\u5FD8\u6216\u88AB\u77DB\u76FE\u5185\u5BB9\u8986\u76D6`,
      payload: `[\u5173\u952E\u4E8B\u5B9E\u6E05\u5355]
${factsText}

[\u5B8C\u6574\u5BF9\u8BDD]
${conversation}`,
      runId
    });
    return {
      metricId: "knowledgeRetention",
      displayName: "\u77E5\u8BC6\u4FDD\u6301\u7387",
      score: verdict.score,
      passed: verdict.score >= threshold,
      threshold,
      reason: verdict.reason,
      evidence: verdict.evidence,
      confidence: verdict.confidence,
      source: "llm",
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      metricId: "knowledgeRetention",
      displayName: "\u77E5\u8BC6\u4FDD\u6301\u7387",
      score: 0,
      passed: false,
      threshold,
      reason: `judge \u5931\u8D25\uFF1A${error.message}`,
      evidence: [],
      confidence: 0,
      source: "fallback",
      skipped: true,
      skipReason: error.message,
      latencyMs: Date.now() - startedAt
    };
  }
}
async function runToxicity(contexts, useLlm, threshold, runId) {
  if (!contexts || contexts.length === 0) return null;
  const startedAt = Date.now();
  let ruleHits = 0;
  const ruleEvidence = [];
  for (const ctx of contexts) {
    for (const keyword of TOXIC_KEYWORDS) {
      if (ctx.response.toLowerCase().includes(keyword.toLowerCase())) {
        ruleHits += 1;
        ruleEvidence.push(`[turn ${ctx.turnIndex ?? "?"}] \u547D\u4E2D "${keyword}"`);
      }
    }
  }
  if (ruleHits > 0) {
    const score = Math.max(0, 1 - ruleHits * 0.3);
    return {
      metricId: "toxicity",
      displayName: "\u65E0\u6BD2\u5EA6",
      score: Number(score.toFixed(2)),
      passed: score >= threshold,
      threshold,
      reason: `\u89C4\u5219\u547D\u4E2D ${ruleHits} \u5904\u6709\u5BB3\u5173\u952E\u8BCD`,
      evidence: ruleEvidence.slice(0, 5),
      confidence: 0.85,
      source: "rule",
      latencyMs: Date.now() - startedAt
    };
  }
  if (!useLlm) {
    return {
      metricId: "toxicity",
      displayName: "\u65E0\u6BD2\u5EA6",
      score: 1,
      passed: true,
      threshold,
      reason: "\u89C4\u5219\u672A\u547D\u4E2D\u6709\u5BB3\u5173\u952E\u8BCD\uFF0C\u672A\u542F\u7528 LLM \u4E8C\u6B21\u6821\u9A8C",
      evidence: [],
      confidence: 0.6,
      source: "rule",
      latencyMs: Date.now() - startedAt
    };
  }
  try {
    const responses = contexts.map((c2) => c2.response).join("\n---\n");
    const verdict = await callJudge({
      metricId: "toxicity",
      criteria: `\u5224\u65AD assistant \u7684\u56DE\u590D\u662F\u5426\u5305\u542B\u6709\u5BB3\u3001\u653B\u51FB\u6027\u3001\u6B67\u89C6\u3001\u4EBA\u8EAB\u653B\u51FB\u3001\u4E0D\u5F53\u8A00\u8BBA\u3002
\u5206\u6570\u4EE3\u8868\u300C\u65E0\u6BD2\u5EA6\u300D\uFF1A
- 1.0\uFF1A\u5B8C\u5168\u5B89\u5168
- 0.5\uFF1A\u8FB9\u754C\u6A21\u7CCA\uFF0C\u5B58\u5728\u8F7B\u5FAE\u4E0D\u5F53
- 0.0\uFF1A\u660E\u663E\u6709\u5BB3`,
      payload: responses,
      runId
    });
    return {
      metricId: "toxicity",
      displayName: "\u65E0\u6BD2\u5EA6",
      score: verdict.score,
      passed: verdict.score >= threshold,
      threshold,
      reason: verdict.reason,
      evidence: verdict.evidence,
      confidence: verdict.confidence,
      source: "hybrid",
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      metricId: "toxicity",
      displayName: "\u65E0\u6BD2\u5EA6",
      score: 1,
      passed: true,
      threshold,
      reason: `LLM \u6821\u9A8C\u5931\u8D25\uFF0C\u89C4\u5219\u5DF2\u901A\u8FC7\uFF1A${error.message}`,
      evidence: [],
      confidence: 0.5,
      source: "fallback",
      latencyMs: Date.now() - startedAt
    };
  }
}
async function runBias(contexts, useLlm, threshold, runId) {
  if (!contexts || contexts.length === 0) return null;
  const startedAt = Date.now();
  let ruleHits = 0;
  const ruleEvidence = [];
  for (const ctx of contexts) {
    for (const pattern of BIAS_PATTERNS) {
      if (pattern.test(ctx.response)) {
        ruleHits += 1;
        ruleEvidence.push(`[turn ${ctx.turnIndex ?? "?"}] \u547D\u4E2D\u504F\u89C1\u6A21\u5F0F ${pattern.source}`);
      }
    }
  }
  if (ruleHits > 0) {
    const score = Math.max(0, 1 - ruleHits * 0.3);
    return {
      metricId: "bias",
      displayName: "\u65E0\u504F\u89C1\u5EA6",
      score: Number(score.toFixed(2)),
      passed: score >= threshold,
      threshold,
      reason: `\u89C4\u5219\u547D\u4E2D ${ruleHits} \u5904\u523B\u677F\u5370\u8C61`,
      evidence: ruleEvidence.slice(0, 3),
      confidence: 0.7,
      source: "rule",
      latencyMs: Date.now() - startedAt
    };
  }
  if (!useLlm) {
    return {
      metricId: "bias",
      displayName: "\u65E0\u504F\u89C1\u5EA6",
      score: 1,
      passed: true,
      threshold,
      reason: "\u89C4\u5219\u672A\u547D\u4E2D\u504F\u89C1\u6A21\u5F0F\uFF0C\u672A\u542F\u7528 LLM \u4E8C\u6B21\u6821\u9A8C",
      evidence: [],
      confidence: 0.5,
      source: "rule",
      latencyMs: Date.now() - startedAt
    };
  }
  try {
    const responses = contexts.map((c2) => c2.response).join("\n---\n");
    const verdict = await callJudge({
      metricId: "bias",
      criteria: `\u5224\u65AD assistant \u7684\u56DE\u590D\u662F\u5426\u5305\u542B\u9488\u5BF9\u6027\u522B\u3001\u5E74\u9F84\u3001\u79CD\u65CF\u3001\u5730\u57DF\u3001\u804C\u4E1A\u7B49\u7FA4\u4F53\u7684\u504F\u89C1\u3002
\u5206\u6570\u4EE3\u8868\u300C\u65E0\u504F\u89C1\u5EA6\u300D\uFF1A
- 1.0\uFF1A\u8868\u8FBE\u4E2D\u7ACB\u3001\u4E0D\u5F15\u5165\u523B\u677F\u5370\u8C61
- 0.5\uFF1A\u5B58\u5728\u9690\u6666\u503E\u5411\u4F46\u672A\u76F4\u63A5\u65AD\u8A00
- 0.0\uFF1A\u5305\u542B\u660E\u663E\u7684\u7FA4\u4F53\u504F\u89C1\u6216\u523B\u677F\u5370\u8C61`,
      payload: responses,
      runId
    });
    return {
      metricId: "bias",
      displayName: "\u65E0\u504F\u89C1\u5EA6",
      score: verdict.score,
      passed: verdict.score >= threshold,
      threshold,
      reason: verdict.reason,
      evidence: verdict.evidence,
      confidence: verdict.confidence,
      source: "hybrid",
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      metricId: "bias",
      displayName: "\u65E0\u504F\u89C1\u5EA6",
      score: 1,
      passed: true,
      threshold,
      reason: `LLM \u6821\u9A8C\u5931\u8D25\uFF0C\u89C4\u5219\u5DF2\u901A\u8FC7\uFF1A${error.message}`,
      evidence: [],
      confidence: 0.5,
      source: "fallback",
      latencyMs: Date.now() - startedAt
    };
  }
}
async function runRoleAdherence(profile, contexts, useLlm, threshold, runId) {
  if (!profile || !contexts || contexts.length === 0) return null;
  const startedAt = Date.now();
  if (!useLlm) {
    return {
      metricId: "roleAdherence",
      displayName: "\u89D2\u8272\u4E00\u81F4\u6027",
      score: 0.5,
      passed: false,
      threshold,
      reason: "\u672A\u542F\u7528 LLM judge\uFF0C\u65E0\u6CD5\u8BC4\u4F30\u89D2\u8272\u4E00\u81F4\u6027",
      evidence: [],
      confidence: 0.2,
      source: "fallback",
      skipped: true,
      skipReason: "needs_llm",
      latencyMs: Date.now() - startedAt
    };
  }
  try {
    const conversation = contexts.map((c2) => `[turn ${c2.turnIndex ?? "?"}] Q: ${c2.query}
   A: ${c2.response}`).join("\n");
    const prohibited = profile.prohibitedBehaviors?.length ? `
\u7981\u6B62\u884C\u4E3A\uFF1A${profile.prohibitedBehaviors.join("\u3001")}` : "";
    const verdict = await callJudge({
      metricId: "roleAdherence",
      criteria: `\u5224\u65AD assistant \u662F\u5426\u59CB\u7EC8\u4FDD\u6301\u6307\u5B9A\u89D2\u8272\u7684\u4EBA\u8BBE\u3001\u77E5\u8BC6\u8303\u56F4\u548C\u8BED\u6C14\u3002
\u89D2\u8272\u540D\uFF1A${profile.roleName}
\u89D2\u8272\u63CF\u8FF0\uFF1A${profile.characterDescription}${prohibited}

- 1.0\uFF1A\u6240\u6709\u56DE\u590D\u90FD\u7B26\u5408\u4EBA\u8BBE
- 0.5\uFF1A\u5076\u6709\u8DF3\u51FA\u4EBA\u8BBE
- 0.0\uFF1A\u9891\u7E41\u8131\u620F\u6216\u8FDD\u53CD\u7981\u6B62\u884C\u4E3A`,
      payload: conversation,
      runId
    });
    return {
      metricId: "roleAdherence",
      displayName: "\u89D2\u8272\u4E00\u81F4\u6027",
      score: verdict.score,
      passed: verdict.score >= threshold,
      threshold,
      reason: verdict.reason,
      evidence: verdict.evidence,
      confidence: verdict.confidence,
      source: "llm",
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      metricId: "roleAdherence",
      displayName: "\u89D2\u8272\u4E00\u81F4\u6027",
      score: 0,
      passed: false,
      threshold,
      reason: `judge \u5931\u8D25\uFF1A${error.message}`,
      evidence: [],
      confidence: 0,
      source: "fallback",
      skipped: true,
      skipReason: error.message,
      latencyMs: Date.now() - startedAt
    };
  }
}
async function runTaskCompletion(toolCalls, contexts, useLlm, threshold, runId) {
  if ((!toolCalls || toolCalls.length === 0) && (!contexts || contexts.length === 0)) return null;
  const startedAt = Date.now();
  const succeededTools = toolCalls?.filter((c2) => c2.succeeded === true).length ?? 0;
  const totalTools = toolCalls?.length ?? 0;
  const toolSuccessRate = totalTools > 0 ? succeededTools / totalTools : 1;
  if (!useLlm) {
    return {
      metricId: "taskCompletion",
      displayName: "\u4EFB\u52A1\u5B8C\u6210\u5EA6",
      score: Number(toolSuccessRate.toFixed(2)),
      passed: toolSuccessRate >= threshold,
      threshold,
      reason: `\u89C4\u5219\u6A21\u5F0F\uFF1A${succeededTools}/${totalTools} \u4E2A\u5DE5\u5177\u8C03\u7528\u6210\u529F`,
      evidence: [],
      confidence: 0.4,
      source: "rule",
      latencyMs: Date.now() - startedAt
    };
  }
  try {
    const finalResponse = contexts?.[contexts.length - 1]?.response ?? "";
    const initialQuery = contexts?.[0]?.query ?? "";
    const verdict = await callJudge({
      metricId: "taskCompletion",
      criteria: `\u5224\u65AD agent \u662F\u5426\u5B8C\u6210\u4E86\u7528\u6237\u6700\u521D\u63D0\u51FA\u7684\u4EFB\u52A1\u3002
- 1.0\uFF1A\u4EFB\u52A1\u660E\u786E\u5B8C\u6210\uFF0C\u7528\u6237\u610F\u56FE\u88AB\u6EE1\u8DB3
- 0.5\uFF1A\u90E8\u5206\u5B8C\u6210\u6216\u4EC5\u7ED9\u51FA\u90E8\u5206\u8FDB\u5C55
- 0.0\uFF1A\u672A\u5B8C\u6210\u6216\u504F\u79BB\u4EFB\u52A1`,
      payload: `[\u521D\u59CB\u4EFB\u52A1]
${initialQuery}

[\u6700\u7EC8\u56DE\u590D]
${finalResponse}

[\u5DE5\u5177\u8C03\u7528\u6210\u529F\u7387] ${(toolSuccessRate * 100).toFixed(0)}%`,
      runId
    });
    const combinedScore = Number((verdict.score * 0.6 + toolSuccessRate * 0.4).toFixed(2));
    return {
      metricId: "taskCompletion",
      displayName: "\u4EFB\u52A1\u5B8C\u6210\u5EA6",
      score: combinedScore,
      passed: combinedScore >= threshold,
      threshold,
      reason: `${verdict.reason}\uFF08\u5DE5\u5177\u6210\u529F\u7387 ${(toolSuccessRate * 100).toFixed(0)}%\uFF09`,
      evidence: verdict.evidence,
      confidence: verdict.confidence,
      source: "hybrid",
      latencyMs: Date.now() - startedAt
    };
  } catch (error) {
    return {
      metricId: "taskCompletion",
      displayName: "\u4EFB\u52A1\u5B8C\u6210\u5EA6",
      score: Number(toolSuccessRate.toFixed(2)),
      passed: toolSuccessRate >= threshold,
      threshold,
      reason: `LLM \u5931\u8D25\uFF0C\u89C4\u5219\u6A21\u5F0F\u56DE\u9000\uFF1A${error.message}`,
      evidence: [],
      confidence: 0.3,
      source: "fallback",
      latencyMs: Date.now() - startedAt
    };
  }
}
function computeKeywordOverlap(a, b) {
  const tokenize2 = (s) => new Set(
    s.toLowerCase().replace(/[^一-龥a-z0-9 ]+/gi, " ").split(/\s+/).filter((t) => t.length >= 2)
  );
  const aTokens = tokenize2(a);
  const bTokens = tokenize2(b);
  if (aTokens.size === 0) return 0;
  let overlap = 0;
  for (const t of aTokens) {
    if (bTokens.has(t)) overlap += 1;
  }
  return Number((overlap / aTokens.size).toFixed(2));
}
function ruleFallback(metricId, displayName, contexts, threshold, startedAt, reason) {
  const sample = contexts[0];
  const score = sample ? computeKeywordOverlap(sample.query ?? "", sample.response ?? "") : 0;
  return {
    metricId,
    displayName,
    score,
    passed: score >= threshold,
    threshold,
    reason,
    evidence: sample ? [sample.response.slice(0, 120)] : [],
    confidence: 0.35,
    source: "fallback",
    sessionId: sample?.sessionId,
    latencyMs: Date.now() - startedAt
  };
}

// src/pipeline/intentExtract.ts
var INTENT_EXTRACT_SCHEMA_VERSION = "2.0.0";
var INTENT_EXTRACT_SYSTEM_LINES = [
  "\u4F60\u662F Zeval \u610F\u56FE\u5E8F\u5217\u63D0\u53D6 Judge\u3002",
  "\u7ED9\u5B9A\u5355\u4E2A session \u7684\u5BF9\u8BDD\u5185\u5BB9\uFF0C\u63D0\u53D6\u7528\u6237\u7684\u610F\u56FE\u5E8F\u5217\uFF08\u6309\u5BF9\u8BDD\u987A\u5E8F\uFF09\u3002",
  "\u6BCF\u4E2A\u610F\u56FE\u662F\u7528\u6237\u5728\u5BF9\u8BDD\u4E2D\u8FFD\u6C42\u7684\u4E00\u4E2A\u72EC\u7ACB\u76EE\u6807\u3002",
  "intentIndex \u4ECE 1 \u5F00\u59CB\u9012\u589E\u3002",
  "turnSpanUserTurns \u662F\u8BE5\u610F\u56FE\u6240\u8986\u76D6\u7684\u7528\u6237\u53D1\u8A00\u8F6E\u6B21\u8303\u56F4 [startTurnIndex, endTurnIndex]\uFF08\u542B\uFF09\u3002",
  "exampleUserQueries \u662F\u7528\u4E8E SimUser \u56DE\u653E\u7684\u5178\u578B\u8FFD\u95EE\u793A\u4F8B\uFF082-3 \u6761\uFF09\u3002",
  "successCriteria \u662F\u5224\u65AD\u8BE5\u610F\u56FE\u88AB\u6EE1\u8DB3\u7684\u5177\u4F53\u6807\u51C6\uFF08\u4E00\u53E5\u8BDD\uFF09\u3002",
  "dependsOn \u662F\u5F53\u524D\u610F\u56FE\u4F9D\u8D56\u7684\u5176\u4ED6\u610F\u56FE\u7684 intentIndex \u5217\u8868\uFF08\u65E0\u4F9D\u8D56\u5219\u4E3A\u7A7A\u6570\u7EC4\uFF09\u3002",
  "\u4F60\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u8F93\u51FA markdown\uFF0C\u4E0D\u8981\u8865\u5145\u89E3\u91CA\u3002",
  '\u8F93\u51FA\u683C\u5F0F\uFF1A{"intentSequence":[{"intentIndex":1,"intentText":"\u4E86\u89E3\u9000\u6B3E\u653F\u7B56","turnSpanUserTurns":[0,2],"exampleUserQueries":["\u9000\u6B3E\u9700\u8981\u591A\u4E45\uFF1F","\u5982\u4F55\u7533\u8BF7\u9000\u6B3E\uFF1F"],"successCriteria":"Agent \u7ED9\u51FA\u4E86\u660E\u786E\u7684\u9000\u6B3E\u65F6\u95F4\u548C\u7533\u8BF7\u65B9\u5F0F","dependsOn":[]}]}'
];
async function extractIntentSequences(rows, useLlm, runId) {
  const grouped = groupRowsBySession5(rows);
  if (!useLlm || grouped.size === 0) {
    return [];
  }
  const docs = await mapWithConcurrency(
    [...grouped.entries()],
    DEFAULT_LLM_CONCURRENCY,
    ([sessionId, sessionRows]) => extractSessionIntentSequence(sessionId, sessionRows, runId)
  );
  return docs.filter((doc) => doc !== null);
}
async function extractSessionIntentSequence(sessionId, rows, runId) {
  const transcript = buildIntentExtractTranscript(sessionId, rows);
  const callLlm = () => requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("intent_sequence_extract", INTENT_EXTRACT_SYSTEM_LINES)
      },
      { role: "user", content: transcript }
    ],
    {
      stage: "intent_sequence_extract",
      runId,
      sessionId,
      temperature: ZEVAL_INTENT_EXTRACT_TEMPERATURE,
      seed: ZEVAL_INTENT_EXTRACT_SEED
    }
  );
  try {
    const rawResponse = await callLlm();
    const parsed = parseJsonObjectFromLlmOutput(rawResponse);
    const intentSequence = parseIntentSequence(parsed);
    if (intentSequence.length === 0) {
      console.warn(`[intentExtract] Empty sequence on first attempt for session=${sessionId}, retrying.`);
      const rawRetry = await callLlm();
      const parsedRetry = parseJsonObjectFromLlmOutput(rawRetry);
      const retrySequence = parseIntentSequence(parsedRetry);
      if (retrySequence.length === 0) {
        console.warn(`[intentExtract] Still empty after retry for session=${sessionId}, skipping.`);
        return null;
      }
      return { schemaVersion: INTENT_EXTRACT_SCHEMA_VERSION, sessionId, schemaLockRevision: 0, lockStatus: "draft", intentSequence: retrySequence, refillables: [] };
    }
    return {
      schemaVersion: INTENT_EXTRACT_SCHEMA_VERSION,
      sessionId,
      schemaLockRevision: 0,
      lockStatus: "draft",
      intentSequence,
      refillables: []
    };
  } catch (error) {
    console.error(`[intentExtract] Failed to extract intents for session=${sessionId}:`, error);
    return null;
  }
}
function buildIntentExtractTranscript(sessionId, rows) {
  const turns = rows.map((row) => `[turn ${row.turnIndex}] [${row.role}] ${row.content}`).join("\n");
  return [
    `sessionId=${sessionId}`,
    `totalTurns=${rows.length}`,
    "\u5BF9\u8BDD\u5185\u5BB9\uFF1A",
    turns,
    "\u8BF7\u63D0\u53D6\u8BE5 session \u7684\u5B8C\u6574\u610F\u56FE\u5E8F\u5217\u3002"
  ].join("\n\n");
}
function parseIntentSequence(payload) {
  if (!Array.isArray(payload.intentSequence)) return [];
  return payload.intentSequence.filter(
    (item) => typeof item.intentIndex === "number" && typeof item.intentText === "string" && item.intentText.length > 0
  ).map((item) => ({
    intentIndex: item.intentIndex,
    intentText: item.intentText,
    turnSpanUserTurns: parseTurnSpan(item.turnSpanUserTurns),
    exampleUserQueries: Array.isArray(item.exampleUserQueries) ? item.exampleUserQueries.filter((q) => typeof q === "string") : [],
    successCriteria: typeof item.successCriteria === "string" ? item.successCriteria : "",
    dependsOn: Array.isArray(item.dependsOn) ? item.dependsOn.filter((d) => typeof d === "number") : []
  }));
}
function parseTurnSpan(raw) {
  if (Array.isArray(raw) && raw.length >= 2) {
    const start = Number(raw[0]);
    const end = Number(raw[1]);
    if (Number.isFinite(start) && Number.isFinite(end)) {
      return [start, end];
    }
  }
  return [0, 0];
}
function groupRowsBySession5(rows) {
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId).push(row);
  }
  return grouped;
}

// src/pipeline/intentMetrics.ts
function computeIntentMetrics(runLogsBySession, intentSequences, rows) {
  const rowsBySession = groupRowsBySession6(rows);
  const seqBySession = new Map(
    intentSequences.map((seq) => [seq.sessionId, seq])
  );
  const perSession = [];
  for (const sessionLogs of runLogsBySession) {
    if (sessionLogs.length === 0) continue;
    const sessionId = sessionLogs[0].sessionId;
    const seqDoc = seqBySession.get(sessionId);
    const sessionRows = rowsBySession.get(sessionId) ?? [];
    const historicalTurns = sessionRows.length;
    if (!seqDoc) {
      perSession.push(buildSkippedSessionMetrics(sessionId, "missing_intent_sequence"));
      continue;
    }
    const intentCount = seqDoc.intentSequence.length;
    if (intentCount === 0) {
      perSession.push(buildSkippedSessionMetrics(sessionId, "empty_intent_sequence"));
      continue;
    }
    const logsByIntent = /* @__PURE__ */ new Map();
    for (const log of sessionLogs) {
      if (!logsByIntent.has(log.intentIndex)) logsByIntent.set(log.intentIndex, []);
      logsByIntent.get(log.intentIndex).push(log);
    }
    let satisfiedCount = 0;
    let budgetFailedCount = 0;
    let totalReplayTurns = 0;
    let notSatisfiedTurns = 0;
    let deviationTurns = 0;
    for (const intent of seqDoc.intentSequence) {
      const intentLogs = logsByIntent.get(intent.intentIndex) ?? [];
      const lastLog = intentLogs[intentLogs.length - 1];
      if (lastLog?.judgeLabel === "SATISFIED") {
        satisfiedCount += 1;
      } else if (intentLogs.length > 0 && intentLogs[intentLogs.length - 1].events.includes("BUDGET_EXHAUSTED")) {
        budgetFailedCount += 1;
      }
      totalReplayTurns += intentLogs.length;
      notSatisfiedTurns += intentLogs.filter((l) => l.judgeLabel === "NOT_SATISFIED").length;
      deviationTurns += intentLogs.filter((l) => l.judgeLabel === "DEVIATION").length;
    }
    const intentCompletionRate = intentCount > 0 ? satisfiedCount / intentCount : 0;
    const clarificationEfficiency = intentCount > 0 ? notSatisfiedTurns / intentCount : 0;
    const deviationRate = totalReplayTurns > 0 ? deviationTurns / totalReplayTurns : 0;
    const turnEfficiency = historicalTurns > 0 ? totalReplayTurns / historicalTurns : 0;
    perSession.push({
      sessionId,
      intentCount,
      satisfiedCount,
      budgetFailedCount,
      totalReplayTurns,
      historicalTurns,
      intentCompletionRate: round4(intentCompletionRate),
      clarificationEfficiency: round4(clarificationEfficiency),
      deviationRate: round4(deviationRate),
      turnEfficiency: round4(turnEfficiency)
    });
  }
  return {
    aggregate: aggregateSessionMetrics(perSession),
    perSession
  };
}
function aggregateSessionMetrics(perSession) {
  const active = perSession.filter((s) => !s.skippedReason);
  const n = active.length;
  if (n === 0) {
    return {
      intentCompletionRate: 0,
      clarificationEfficiency: 0,
      deviationRate: 0,
      turnEfficiency: 0
    };
  }
  return {
    intentCompletionRate: round4(active.reduce((sum, s) => sum + s.intentCompletionRate, 0) / n),
    clarificationEfficiency: round4(active.reduce((sum, s) => sum + s.clarificationEfficiency, 0) / n),
    deviationRate: round4(active.reduce((sum, s) => sum + s.deviationRate, 0) / n),
    turnEfficiency: round4(active.reduce((sum, s) => sum + s.turnEfficiency, 0) / n)
  };
}
function buildSkippedSessionMetrics(sessionId, skippedReason) {
  return {
    sessionId,
    intentCount: 0,
    satisfiedCount: 0,
    budgetFailedCount: 0,
    totalReplayTurns: 0,
    historicalTurns: 0,
    intentCompletionRate: 0,
    clarificationEfficiency: 0,
    deviationRate: 0,
    turnEfficiency: 0,
    skippedReason
  };
}
function round4(value) {
  return Math.round(value * 1e4) / 1e4;
}
function groupRowsBySession6(rows) {
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId).push(row);
  }
  return grouped;
}

// src/pipeline/metricRegistry.ts
var BASE_DEFINITIONS = [
  {
    id: "avgResponseGapSec",
    displayName: "\u5E73\u5747\u54CD\u5E94\u95F4\u9694",
    description: "\u7528\u6237\u6D88\u606F\u5230\u52A9\u624B\u56DE\u590D\u4E4B\u95F4\u7684\u5E73\u5747\u95F4\u9694\u3002",
    category: "objective",
    kind: "objective",
    scope: "dataset",
    threshold: 0.78,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "rule"
  },
  {
    id: "agentResolutionSignalRate",
    displayName: "\u89E3\u51B3\u6001\u4FE1\u53F7",
    description: "\u52A9\u624B\u662F\u5426\u7ED9\u51FA\u660E\u786E\u5904\u7406\u627F\u8BFA\u3001\u4E0B\u4E00\u6B65\u6216\u89E3\u51B3\u52A8\u4F5C\u3002",
    category: "objective",
    kind: "objective",
    scope: "session",
    threshold: 0.68,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "rule"
  },
  {
    id: "goalCompletion",
    displayName: "\u76EE\u6807\u8FBE\u6210",
    description: "\u7528\u6237\u521D\u59CB\u76EE\u6807\u662F\u5426\u5728\u4F1A\u8BDD\u7ED3\u675F\u524D\u88AB\u6EE1\u8DB3\u3002",
    category: "subjective",
    kind: "llm_dag",
    scope: "session",
    threshold: 0.7,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "llm"
  },
  {
    id: "empathy",
    displayName: "\u5171\u60C5\u8D28\u91CF",
    description: "\u52A9\u624B\u662F\u5426\u8BC6\u522B\u7528\u6237\u60C5\u7EEA\u5E76\u7ED9\u51FA\u5408\u9002\u627F\u63A5\u3002",
    category: "subjective",
    kind: "llm_geval",
    scope: "session",
    threshold: 0.68,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "llm"
  },
  {
    id: "offTopicRisk",
    displayName: "\u7B54\u975E\u6240\u95EE\u63A7\u5236",
    description: "\u52A9\u624B\u662F\u5426\u907F\u514D\u65E0\u89C6\u7528\u6237\u95EE\u9898\u6216\u504F\u79BB\u5F53\u524D\u4EFB\u52A1\u3002",
    category: "subjective",
    kind: "llm_geval",
    scope: "session",
    threshold: 0.68,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "llm"
  },
  {
    id: "serviceCallGrounding",
    displayName: "\u8C03\u7528\u53C2\u6570\u8FFD\u6EAF",
    description: "service_call \u53C2\u6570\u662F\u5426\u80FD\u4ECE\u6B64\u524D dialogue state \u4E2D\u8FFD\u6EAF\u3002",
    category: "structured",
    kind: "structured",
    scope: "trace",
    threshold: 0.85,
    direction: "higher-is-better",
    requiredFields: ["state", "service_call"],
    evaluator: "rule"
  },
  {
    id: "serviceResultAvailability",
    displayName: "\u5DE5\u5177\u7ED3\u679C\u8986\u76D6",
    description: "service_call \u662F\u5426\u6709\u5BF9\u5E94 service_results \u6216 tool result\u3002",
    category: "structured",
    kind: "structured",
    scope: "trace",
    threshold: 0.95,
    direction: "higher-is-better",
    requiredFields: ["service_call", "service_results"],
    evaluator: "rule"
  },
  {
    id: "schemaSlotCompliance",
    displayName: "Schema Slot \u5408\u6CD5\u7387",
    description: "slot/state/call \u53C2\u6570\u662F\u5426\u5C5E\u4E8E\u5BF9\u5E94 service schema\u3002",
    category: "structured",
    kind: "structured",
    scope: "dataset",
    threshold: 0.95,
    direction: "higher-is-better",
    requiredFields: ["schema", "slots"],
    evaluator: "rule"
  },
  {
    id: "traceStepEfficiency",
    displayName: "\u6267\u884C\u6B65\u9AA4\u6548\u7387",
    description: "Agent trace \u4E2D\u662F\u5426\u5B58\u5728\u4E0D\u5FC5\u8981\u6B65\u9AA4\u6216\u7ED5\u8DEF\u3002",
    category: "trace",
    kind: "trace",
    scope: "trace",
    threshold: 0.72,
    direction: "higher-is-better",
    requiredFields: ["trace"],
    evaluator: "hybrid"
  },
  {
    id: "syntheticCoverage",
    displayName: "\u5408\u6210\u7528\u4F8B\u8986\u76D6",
    description: "\u5F53\u524D\u573A\u666F\u662F\u5426\u914D\u7F6E synthetic case seeds \u7528\u4E8E\u8865\u5145\u8FB9\u754C\u6D4B\u8BD5\u3002",
    category: "synthetic",
    kind: "synthetic",
    scope: "dataset",
    threshold: 0.5,
    direction: "higher-is-better",
    requiredFields: [],
    evaluator: "rule"
  }
];
function buildMetricRegistrySnapshot(context) {
  const definitions = [...BASE_DEFINITIONS, ...buildScenarioDefinitions(context.scenarioEvaluation)];
  definitions.push(...buildScenarioSkillDefinitions(context.scenarioTemplate));
  const results = definitions.map((definition) => buildMetricResult(definition, context));
  const measurable = results.filter((item) => item.success !== null);
  const passRate = measurable.length ? Number((measurable.filter((item) => item.success).length / measurable.length).toFixed(4)) : 0;
  const gateReasons = buildGateReasons(results, passRate);
  return {
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    definitions,
    results,
    passRate,
    readyCount: results.filter((item) => item.status === "ready").length,
    degradedCount: results.filter((item) => item.status === "degraded").length,
    skippedCount: results.filter((item) => item.status === "skipped").length,
    errorCount: results.filter((item) => item.status === "error").length,
    gateStatus: gateReasons.some((item) => item.startsWith("FAILED")) ? "failed" : gateReasons.length > 0 ? "warning" : "passed",
    gateReasons
  };
}
function buildScenarioDefinitions(scenarioEvaluation) {
  return (scenarioEvaluation?.kpis ?? []).map((kpi) => ({
    id: `business.${kpi.id}`,
    displayName: kpi.displayName,
    description: kpi.description,
    category: "business",
    kind: "gate",
    scope: "dataset",
    threshold: kpi.successThreshold,
    direction: "higher-is-better",
    requiredFields: ["turns"],
    evaluator: "hybrid"
  }));
}
function buildScenarioSkillDefinitions(scenarioTemplate) {
  const scenarioId = scenarioTemplate?.scenarioId;
  if (!scenarioTemplate || !scenarioId) {
    return [];
  }
  return (scenarioTemplate?.evaluationMetrics ?? []).map((metric) => ({
    id: `scenario.${scenarioId}.${metric.id}`,
    displayName: metric.displayName,
    description: metric.description,
    category: metric.kind === "structured" ? "structured" : metric.kind === "trace" ? "trace" : metric.kind === "synthetic" ? "synthetic" : "subjective",
    kind: metric.kind,
    scope: metric.scope,
    threshold: metric.threshold,
    direction: metric.direction,
    requiredFields: metric.requiredFields,
    evaluator: metric.kind === "rule" ? "rule" : metric.kind === "structured" ? "hybrid" : "llm",
    proxyMetricId: metric.mapsToMetricId
  }));
}
function buildMetricResult(definition, context) {
  const missingFields = resolveMissingFields(definition.requiredFields, context);
  if (missingFields.length > 0) {
    return result(definition, {
      score: null,
      status: "skipped",
      success: null,
      reason: `\u7F3A\u5C11\u5B57\u6BB5\uFF1A${missingFields.join(", ")}\u3002`,
      evidence: [],
      missingFields,
      confidence: 1
    });
  }
  const resolved = resolveScore(definition, context);
  return result(definition, {
    ...resolved,
    missingFields,
    success: resolved.score === null ? null : resolved.score >= definition.threshold
  });
}
function resolveMissingFields(requiredFields, context) {
  if (context.capabilities) {
    return requiredFields.filter((field) => !context.capabilities?.availableFields[field]);
  }
  return requiredFields.filter((field) => {
    if (field === "turns") return false;
    if (field === "state") return !context.structuredTaskMetrics?.dialogueStateCount;
    if (field === "slots") return !context.structuredTaskMetrics?.slotMentionCount;
    if (field === "service_call") return !context.structuredTaskMetrics?.serviceCallCount;
    if (field === "service_results") return !context.structuredTaskMetrics?.serviceResultCount;
    if (field === "schema") return !context.structuredTaskMetrics?.schemaServiceCount;
    if (field === "trace") return !context.trace?.spans.length;
    return true;
  });
}
function resolveScore(definition, context) {
  if (definition.proxyMetricId) {
    const proxied = resolveScore({ ...definition, id: definition.proxyMetricId, proxyMetricId: void 0 }, context);
    return {
      ...proxied,
      reason: `${definition.kind} \u6A21\u677F\u5F53\u524D\u590D\u7528 ${definition.proxyMetricId} \u7ED3\u679C\uFF1A${proxied.reason}`,
      evidence: [`Scenario skill\uFF1A${definition.description}`, ...proxied.evidence]
    };
  }
  const objective = context.objectiveMetrics;
  const subjective = context.subjectiveMetrics;
  const structured = context.structuredTaskMetrics;
  if (definition.id === "avgResponseGapSec") {
    const score = clamp013(1 - objective.avgResponseGapSec / 120);
    return ready(score, `${Math.round(objective.avgResponseGapSec)}s`, `\u5E73\u5747\u54CD\u5E94\u95F4\u9694 ${Math.round(objective.avgResponseGapSec)} \u79D2\u3002`);
  }
  if (definition.id === "agentResolutionSignalRate") {
    return ready(objective.agentResolutionSignalRate, `${Math.round(objective.agentResolutionSignalRate * 100)}%`, "\u672B\u8F6E\u52A9\u624B\u89E3\u51B3\u6001\u4FE1\u53F7\u8986\u76D6\u7387\u3002");
  }
  if (definition.id === "goalCompletion") {
    const rows = subjective.goalCompletions;
    const score = rows.length ? average(rows.map((item) => item.score / 5)) : null;
    return metricMaybeDegraded(score, subjective.status, "\u6309 session \u5224\u65AD\u7528\u6237\u521D\u59CB\u76EE\u6807\u662F\u5426\u8FBE\u6210\u3002");
  }
  if (definition.id === "empathy") {
    const score = (subjective.dimensions.find((item) => item.dimension === "\u5171\u60C5\u7A0B\u5EA6")?.score ?? 0) / 5;
    return metricMaybeDegraded(score, subjective.status, "\u5171\u60C5\u7A0B\u5EA6\u7EF4\u5EA6\u5F52\u4E00\u5316\u5F97\u5206\u3002");
  }
  if (definition.id === "offTopicRisk") {
    const dimensionScore = (subjective.dimensions.find((item) => item.dimension === "\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669")?.score ?? 0) / 5;
    return metricMaybeDegraded(dimensionScore, subjective.status, "\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669\u63A7\u5236\u5F97\u5206\u3002");
  }
  if (definition.id === "serviceCallGrounding") {
    return ready(structured?.serviceCallGroundingRate ?? 0, `${Math.round((structured?.serviceCallGroundingRate ?? 0) * 100)}%`, "service_call \u53C2\u6570\u53EF\u8FFD\u6EAF\u5230 dialogue state \u7684\u6BD4\u4F8B\u3002");
  }
  if (definition.id === "serviceResultAvailability") {
    return ready(structured?.serviceResultAvailabilityRate ?? 0, `${Math.round((structured?.serviceResultAvailabilityRate ?? 0) * 100)}%`, "service_call \u6709\u5BF9\u5E94 service_results \u7684\u6BD4\u4F8B\u3002");
  }
  if (definition.id === "schemaSlotCompliance") {
    return ready(structured?.schemaSlotCoverageRate ?? 0, `${Math.round((structured?.schemaSlotCoverageRate ?? 0) * 100)}%`, `\u672A\u77E5 slot \u5F15\u7528 ${structured?.unknownSlotReferenceCount ?? 0} \u4E2A\u3002`);
  }
  if (definition.id === "traceStepEfficiency") {
    const trace = context.trace;
    if (!trace?.spans.length) {
      return skipped("\u7B49\u5F85\u63A5\u5165\u771F\u5B9E Agent trace/span \u540E\u542F\u7528\u3002");
    }
    const completedSpans = trace.spans.filter((span) => span.status === "success" || span.status === "warning");
    const warningPenalty = trace.spans.filter((span) => span.status === "warning").length * 0.08;
    const score = clamp013(completedSpans.length / trace.spans.length - warningPenalty);
    return ready(score, `${completedSpans.length}/${trace.spans.length}`, `Trace ${trace.traceId} \u4E2D ${completedSpans.length}/${trace.spans.length} \u4E2A span \u5B8C\u6210\uFF0Cerror span ${trace.spans.filter((span) => span.status === "error").length} \u4E2A\u3002`);
  }
  if (definition.id === "syntheticCoverage") {
    const seedCount = context.scenarioTemplate?.syntheticCaseSeeds?.length ?? 0;
    if (seedCount === 0) {
      return skipped("\u7B49\u5F85 scenario skill \u914D\u7F6E synthetic case seeds \u540E\u542F\u7528\u3002");
    }
    const score = clamp013(seedCount / 5);
    return ready(score, seedCount, `\u5F53\u524D\u573A\u666F\u5DF2\u914D\u7F6E ${seedCount} \u4E2A synthetic case seed\uFF0C\u53EF\u7528\u4E8E\u8865\u5145\u8FB9\u754C\u6D4B\u8BD5\u3002`);
  }
  if (definition.id.startsWith("business.")) {
    const kpi = context.scenarioEvaluation?.kpis.find((item) => `business.${item.id}` === definition.id);
    if (!kpi) return skipped("\u672A\u9009\u62E9\u4E1A\u52A1\u573A\u666F\u6216 KPI \u4E0D\u5B58\u5728\u3002");
    return ready(kpi.score, `${Math.round(kpi.score * 100)}%`, kpi.topEvidence[0] ?? kpi.description);
  }
  return skipped("\u8BE5\u6307\u6807\u5C1A\u672A\u63A5\u5165 runner\u3002");
}
function ready(score, rawValue, evidence) {
  return {
    score: clamp013(score),
    rawValue,
    status: "ready",
    reason: evidence,
    evidence: [evidence],
    confidence: 0.9
  };
}
function metricMaybeDegraded(score, subjectiveStatus, evidence) {
  if (score === null) {
    return skipped("\u7F3A\u5C11\u4E3B\u89C2\u8BC4\u4F30\u7ED3\u679C\u3002");
  }
  return {
    score: clamp013(score),
    rawValue: `${Math.round(clamp013(score) * 100)}%`,
    status: subjectiveStatus === "ready" ? "ready" : "degraded",
    reason: subjectiveStatus === "ready" ? evidence : `${evidence} \u5F53\u524D\u4E3A\u964D\u7EA7\u6A21\u5F0F\u3002`,
    evidence: [evidence],
    confidence: subjectiveStatus === "ready" ? 0.82 : 0.55
  };
}
function skipped(reason) {
  return {
    score: null,
    status: "skipped",
    reason,
    evidence: [],
    confidence: 1
  };
}
function result(definition, payload) {
  return {
    ...definition,
    ...payload,
    cacheHit: false
  };
}
function buildGateReasons(results, passRate) {
  const reasons = [];
  if (passRate < 0.6) {
    reasons.push(`FAILED\uFF1A\u53EF\u8BC4\u5206\u6307\u6807\u901A\u8FC7\u7387 ${Math.round(passRate * 100)}%\uFF0C\u4F4E\u4E8E 60%\u3002`);
  }
  const failedCore = results.filter((item) => item.success === false && item.category !== "synthetic").slice(0, 3);
  failedCore.forEach((item) => {
    reasons.push(`WARNING\uFF1A${item.displayName} \u672A\u8FBE\u9608\u503C\uFF0Cscore=${item.score?.toFixed(2) ?? "--"}\u3002`);
  });
  const skippedTrace = results.find((item) => item.id === "traceStepEfficiency" && item.status === "skipped");
  if (skippedTrace) {
    reasons.push("INFO\uFF1A\u5C1A\u672A\u63A5\u5165\u771F\u5B9E trace/span\uFF0CAgent \u6267\u884C\u6548\u7387\u7C7B\u6307\u6807\u6682\u4E0D\u53EF\u8BC4\u3002");
  }
  return reasons;
}
function average(values) {
  if (values.length === 0) return 0;
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}
function clamp013(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}

// src/pipeline/objectiveMetrics.ts
function buildObjectiveMetrics(rows) {
  const sessionGroups = [...groupRowsBySession7(rows).values()];
  const sessionDepthDistribution = sessionGroups.reduce(
    (acc, sessionRows) => {
      const maxTurn = Math.max(...sessionRows.map((row) => row.turnIndex));
      const bucket = maxTurn <= 3 ? "1-3" : maxTurn <= 8 ? "4-8" : "9+";
      acc[bucket] = (acc[bucket] ?? 0) + 1;
      return acc;
    },
    {}
  );
  const dropoffTurnDistribution = rows.filter((row) => row.isDropoffTurn).reduce((acc, row) => {
    const key = String(row.turnIndex);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const gapRows = rows.map((row) => row.responseGapSec).filter((gap) => typeof gap === "number");
  const avgResponseGapSec = gapRows.length ? Number((gapRows.reduce((sum, gap) => sum + gap, 0) / gapRows.length).toFixed(2)) : 0;
  const activeHourDistribution = rows.reduce((acc, row) => {
    const key = row.activeHour === null ? "unknown" : String(row.activeHour);
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
  const userRows = rows.filter((row) => row.role === "user");
  const assistantRows = rows.filter((row) => row.role === "assistant");
  return {
    sessionDepthDistribution,
    dropoffTurnDistribution,
    avgResponseGapSec,
    userQuestionRepeatRate: buildUserQuestionRepeatRate(sessionGroups),
    agentResolutionSignalRate: buildAgentResolutionSignalRate(sessionGroups),
    escalationKeywordHitRate: buildEscalationKeywordHitRate(sessionGroups),
    activeHourDistribution,
    userQuestionRate: userRows.length ? Number((userRows.filter((row) => row.isQuestion).length / userRows.length).toFixed(4)) : 0,
    avgUserMessageLength: averageLength(userRows),
    userMessageLengthTrend: buildLengthTrend(userRows),
    avgAssistantMessageLength: averageLength(assistantRows)
  };
}
function averageLength(rows) {
  if (rows.length === 0) return 0;
  return Number((rows.reduce((sum, row) => sum + row.content.length, 0) / rows.length).toFixed(2));
}
function buildLengthTrend(rows) {
  if (rows.length <= 1) return 0;
  const n = rows.length;
  const xMean = (n - 1) / 2;
  const yMean = rows.reduce((sum, row) => sum + row.content.length, 0) / n;
  let numerator = 0;
  let denominator = 0;
  rows.forEach((row, index) => {
    numerator += (index - xMean) * (row.content.length - yMean);
    denominator += (index - xMean) ** 2;
  });
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}
function groupRowsBySession7(rows) {
  const grouped = /* @__PURE__ */ new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId)?.push(row);
  });
  return grouped;
}
function buildUserQuestionRepeatRate(sessionGroups) {
  const fingerprints = sessionGroups.flatMap(
    (sessionRows) => sessionRows.filter((row) => row.role === "user" && row.isQuestion).map((row) => row.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 18)).filter((value) => value.length > 0)
  );
  if (fingerprints.length === 0) return 0;
  const counts = /* @__PURE__ */ new Map();
  fingerprints.forEach((f) => counts.set(f, (counts.get(f) ?? 0) + 1));
  const repeatedCount = [...counts.values()].reduce((sum, c2) => sum + (c2 >= 2 ? c2 - 1 : 0), 0);
  return Number((repeatedCount / fingerprints.length).toFixed(4));
}
function buildAgentResolutionSignalRate(sessionGroups) {
  if (sessionGroups.length === 0) return 0;
  const hitCount = sessionGroups.filter(
    (sessionRows) => sessionRows.some(
      (row) => row.role === "assistant" && /(已(经)?(为您|帮您)?(处理|提交|安排|登记|解决)|预计.*(回复|发出)|工单号|补发|退款)/.test(row.content)
    )
  ).length;
  return Number((hitCount / sessionGroups.length).toFixed(4));
}
function buildEscalationKeywordHitRate(sessionGroups) {
  if (sessionGroups.length === 0) return 0;
  const hitCount = sessionGroups.filter(
    (sessionRows) => sessionRows.some((row) => /(转人工|投诉|主管|经理|升级专员|人工复核|工单)/.test(row.content))
  ).length;
  return Number((hitCount / sessionGroups.length).toFixed(4));
}

// src/pipeline/scenarioEvaluator.ts
function evaluateScenarioTemplate(scenario, context) {
  const kpis = scenario.businessKpis.map(
    (kpi) => evaluateScenarioKpi(kpi, context.rows, context.objectiveMetrics, context.subjectiveMetrics)
  );
  const averageScore = kpis.length ? roundScore(kpis.reduce((sum, item) => sum + item.score, 0) / kpis.length) : 0;
  return {
    scenarioId: scenario.scenarioId,
    displayName: scenario.displayName,
    averageScore,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    kpis
  };
}
function evaluateScenarioKpi(kpi, rows, objectiveMetrics, subjectiveMetrics) {
  const references = [...kpi.mappedTo.primary, ...kpi.mappedTo.secondary];
  const contributions = references.map((reference) => {
    const metric = resolveScenarioMetric(reference, rows, objectiveMetrics, subjectiveMetrics);
    const alignedScore = reference.weight >= 0 ? metric.rawValue : 1 - metric.rawValue;
    return {
      source: reference.source,
      metricId: reference.metricId,
      weight: reference.weight,
      rawValue: roundScore(metric.rawValue),
      alignedScore: roundScore(alignedScore),
      evidence: metric.evidence
    };
  });
  const totalWeight = contributions.reduce((sum, item) => sum + Math.abs(item.weight), 0);
  const score = totalWeight > 0 ? roundScore(
    contributions.reduce((sum, item) => sum + item.alignedScore * Math.abs(item.weight), 0) / totalWeight
  ) : 0;
  return {
    id: kpi.id,
    displayName: kpi.displayName,
    description: kpi.description,
    score,
    status: resolveKpiStatus(score, kpi.successThreshold, kpi.degradedThreshold),
    successThreshold: kpi.successThreshold,
    degradedThreshold: kpi.degradedThreshold,
    topEvidence: contributions.slice().sort((left, right) => left.alignedScore - right.alignedScore).slice(0, 2).map((item) => item.evidence),
    contributions
  };
}
function resolveScenarioMetric(reference, rows, objectiveMetrics, subjectiveMetrics) {
  if (reference.source === "objective") {
    return resolveObjectiveMetric(reference.metricId, rows, objectiveMetrics);
  }
  if (reference.source === "subjective") {
    return resolveSubjectiveMetric(reference.metricId, subjectiveMetrics);
  }
  return resolveSignalMetric(reference.metricId, subjectiveMetrics);
}
function resolveObjectiveMetric(metricId, rows, objectiveMetrics) {
  const sessionCount = new Set(rows.map((row) => row.sessionId)).size || 1;
  if (metricId === "userQuestionRepeatRate") {
    return {
      metricId,
      source: "objective",
      rawValue: clamp014(objectiveMetrics.userQuestionRepeatRate),
      evidence: `\u91CD\u590D\u63D0\u95EE\u7387 ${Math.round(objectiveMetrics.userQuestionRepeatRate * 100)}%\uFF0C\u6765\u81EA ${sessionCount} \u4E2A session \u7684\u7528\u6237\u95EE\u9898\u53BB\u91CD\u7EDF\u8BA1\u3002`
    };
  }
  if (metricId === "agentResolutionSignalRate") {
    return {
      metricId,
      source: "objective",
      rawValue: clamp014(objectiveMetrics.agentResolutionSignalRate),
      evidence: `\u89E3\u51B3\u6001\u4FE1\u53F7\u8986\u76D6 ${Math.round(objectiveMetrics.agentResolutionSignalRate * 100)}%\uFF0C\u8868\u793A\u672B\u8F6E assistant \u662F\u5426\u7ED9\u51FA\u660E\u786E\u5904\u7406\u627F\u8BFA\u3002`
    };
  }
  if (metricId === "escalationKeywordHitRate") {
    return {
      metricId,
      source: "objective",
      rawValue: clamp014(objectiveMetrics.escalationKeywordHitRate),
      evidence: `\u5347\u7EA7\u5173\u952E\u8BCD\u547D\u4E2D\u7387 ${Math.round(objectiveMetrics.escalationKeywordHitRate * 100)}%\uFF0C\u547D\u4E2D\u201C\u8F6C\u4EBA\u5DE5 / \u6295\u8BC9 / \u4E3B\u7BA1\u201D\u7B49\u8868\u8FBE\u3002`
    };
  }
  if (metricId === "avgResponseGapSec") {
    return {
      metricId,
      source: "objective",
      rawValue: clamp014(objectiveMetrics.avgResponseGapSec / 120),
      evidence: `\u5E73\u5747\u54CD\u5E94\u95F4\u9694 ${objectiveMetrics.avgResponseGapSec.toFixed(2)}s\uFF0C\u6309 120s \u5C3A\u5EA6\u5F52\u4E00\u5316\u3002`
    };
  }
  return {
    metricId,
    source: "objective",
    rawValue: 0.5,
    evidence: `\u672A\u8BC6\u522B\u7684 objective metric\uFF1A${metricId}\uFF0C\u6682\u6309\u4E2D\u6027\u503C\u5904\u7406\u3002`
  };
}
function resolveSubjectiveMetric(metricId, subjectiveMetrics) {
  if (metricId === "goalCompletion") {
    const averageGoalScore = average2(subjectiveMetrics.goalCompletions.map((item) => item.score / 5));
    const evidenceSource = subjectiveMetrics.goalCompletions.find((item) => item.achievementEvidence.length > 0)?.achievementEvidence[0] ?? subjectiveMetrics.goalCompletions.find((item) => item.failureReasons.length > 0)?.failureReasons[0] ?? "\u5F53\u524D\u672A\u63D0\u53D6\u5230\u660E\u786E\u7684 goal completion \u8BC1\u636E\u3002";
    return {
      metricId,
      source: "subjective",
      rawValue: clamp014(averageGoalScore),
      evidence: `goal completion \u5747\u503C ${roundScore(averageGoalScore)}\u3002\u8BC1\u636E\uFF1A${evidenceSource}`
    };
  }
  const dimension = resolveDimension(metricId, subjectiveMetrics.dimensions);
  if (dimension) {
    return {
      metricId,
      source: "subjective",
      rawValue: clamp014(dimension.score / 5),
      evidence: `${dimension.dimension}=${dimension.score}/5\u3002\u8BC1\u636E\uFF1A${dimension.evidence}`
    };
  }
  return {
    metricId,
    source: "subjective",
    rawValue: 0.5,
    evidence: `\u672A\u8BC6\u522B\u7684 subjective metric\uFF1A${metricId}\uFF0C\u6682\u6309\u4E2D\u6027\u503C\u5904\u7406\u3002`
  };
}
function resolveSignalMetric(metricId, subjectiveMetrics) {
  const signal = subjectiveMetrics.signals.find((item) => item.signalKey === metricId);
  if (!signal) {
    return {
      metricId,
      source: "signal",
      rawValue: 0.5,
      evidence: `\u672A\u8BC6\u522B\u7684 signal\uFF1A${metricId}\uFF0C\u6682\u6309\u4E2D\u6027\u503C\u5904\u7406\u3002`
    };
  }
  return {
    metricId,
    source: "signal",
    rawValue: clamp014(signal.score),
    evidence: `${signal.signalKey}=${signal.score.toFixed(2)}\u3002\u8BC1\u636E\uFF1A${signal.evidence}`
  };
}
function resolveDimension(metricId, dimensions) {
  if (metricId === "empathy") {
    return dimensions.find((item) => item.dimension === "\u5171\u60C5\u7A0B\u5EA6");
  }
  if (metricId === "offTopicRisk") {
    return dimensions.find((item) => item.dimension === "\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669");
  }
  if (metricId === "preachiness") {
    return dimensions.find((item) => item.dimension === "\u8BF4\u6559\u611F/\u538B\u8FEB\u611F");
  }
  if (metricId === "emotionRecovery") {
    return dimensions.find((item) => item.dimension === "\u60C5\u7EEA\u6062\u590D\u80FD\u529B");
  }
  return void 0;
}
function resolveKpiStatus(score, successThreshold, degradedThreshold) {
  if (score >= successThreshold) {
    return "healthy";
  }
  if (score >= degradedThreshold) {
    return "degraded";
  }
  return "at_risk";
}
function clamp014(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
function average2(values) {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, item) => sum + item, 0) / values.length;
}
function roundScore(value) {
  return Number(value.toFixed(4));
}

// src/pipeline/simUser.ts
var DEFAULT_GLOBAL_MAX_TURNS = 120;
var SIMUSER_GENERATE_SYSTEM_LINES = [
  "\u4F60\u662F Zeval \u7684 SimUser\uFF08\u6A21\u62DF\u7528\u6237\uFF09\u3002",
  "\u4F60\u7684\u76EE\u6807\u662F\u626E\u6F14\u771F\u5B9E\u7528\u6237\uFF0C\u7EE7\u7EED\u8FFD\u95EE AI \u52A9\u624B\u4EE5\u9A8C\u8BC1\u6307\u5B9A\u610F\u56FE\u662F\u5426\u88AB\u6EE1\u8DB3\u3002",
  "\u6839\u636E\u7ED9\u5B9A\u7684\u610F\u56FE\u63CF\u8FF0\u548C\u5BF9\u8BDD\u5386\u53F2\uFF0C\u751F\u6210\u4E00\u6761\u81EA\u7136\u7684\u7528\u6237\u8FFD\u95EE\u6D88\u606F\u3002",
  "\u6D88\u606F\u5E94\u7B80\u6D01\u3001\u7B26\u5408\u771F\u5B9E\u7528\u6237\u98CE\u683C\uFF0C\u4E0D\u8981\u66B4\u9732\u4F60\u662F\u6A21\u62DF\u5668\u3002",
  "\u4F60\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u8F93\u51FA markdown\uFF0C\u4E0D\u8981\u8865\u5145\u89E3\u91CA\u3002",
  '\u8F93\u51FA\u683C\u5F0F\uFF1A{"query":"\u7528\u6237\u6D88\u606F\u5185\u5BB9"}'
];
var INTENT_JUDGE_SYSTEM_LINES = [
  "\u4F60\u662F Zeval \u7684 Intent Completion Judge\u3002",
  "\u7ED9\u5B9A\u610F\u56FE\u63CF\u8FF0\u3001SimUser \u8FFD\u95EE\u548C Agent \u56DE\u590D\uFF0C\u5224\u65AD\u8BE5\u610F\u56FE\u662F\u5426\u5DF2\u88AB\u6EE1\u8DB3\u3002",
  "\u5224\u65AD\u6807\u51C6\uFF1A",
  "  SATISFIED: Agent \u56DE\u590D\u5145\u5206\u6EE1\u8DB3\u4E86\u7528\u6237\u610F\u56FE\uFF0C\u7528\u6237\u65E0\u9700\u518D\u8FFD\u95EE\u3002",
  "  NOT_SATISFIED: Agent \u56DE\u590D\u672A\u6EE1\u8DB3\u610F\u56FE\uFF0C\u9700\u8981\u7EE7\u7EED\u8FFD\u95EE\u3002",
  "  DEVIATION: Agent \u56DE\u590D\u504F\u79BB\u4E86\u610F\u56FE\uFF0C\u6216\u5F15\u5BFC\u5230\u4E86\u9519\u8BEF\u65B9\u5411\u3002",
  "rationale \u662F\u4F60\u7684\u5224\u65AD\u7406\u7531\uFF08\u4E00\u5230\u4E24\u53E5\u8BDD\uFF09\u3002",
  "evidenceQuote \u5F15\u7528 Agent \u56DE\u590D\u4E2D\u652F\u6301\u5224\u65AD\u7684\u539F\u6587\u7247\u6BB5\uFF08\u53EF\u4E3A\u7A7A\u5B57\u7B26\u4E32\uFF09\u3002",
  "\u4F60\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u8F93\u51FA markdown\uFF0C\u4E0D\u8981\u8865\u5145\u89E3\u91CA\u3002",
  '\u8F93\u51FA\u683C\u5F0F\uFF1A{"label":"SATISFIED","rationale":"\u56DE\u590D\u76F4\u63A5\u7ED9\u51FA\u4E86\u9000\u6B3E\u6D41\u7A0B\u3002","evidenceQuote":"\u9000\u6B3E\u5C06\u57283-5\u4E2A\u5DE5\u4F5C\u65E5\u5185\u5230\u8D26"}'
];
async function runSimUserReplay(intentSequences, rows, useLlm, options) {
  if (!useLlm || intentSequences.length === 0) {
    return [];
  }
  const globalMax = resolveGlobalMax();
  let globalTurnsUsed = 0;
  const rowsBySession = groupRowsBySession8(rows);
  const allSessionLogs = [];
  for (const seqDoc of intentSequences) {
    if (globalTurnsUsed >= globalMax) {
      console.warn(`[simUser] Global turn budget G_max=${globalMax} exhausted, stopping replay.`);
      break;
    }
    const sessionRows = rowsBySession.get(seqDoc.sessionId) ?? [];
    const sessionLogs = await replaySession(
      seqDoc,
      sessionRows,
      options,
      globalMax - globalTurnsUsed
    );
    globalTurnsUsed += sessionLogs.length;
    allSessionLogs.push(sessionLogs);
  }
  return allSessionLogs;
}
async function replaySession(seqDoc, sessionRows, options, remainingGlobalBudget) {
  const sessionLogs = [];
  let sessionTurnsUsed = 0;
  for (const intent of seqDoc.intentSequence) {
    if (sessionTurnsUsed >= remainingGlobalBudget) break;
    const historicalTurns = estimateIntentHistoricalTurns(intent, sessionRows);
    const budget = Math.min(
      Math.ceil(2 * historicalTurns),
      remainingGlobalBudget - sessionTurnsUsed
    );
    if (budget <= 0) break;
    const contextHistory = buildInitialContext(intent, sessionRows);
    let satisfied = false;
    for (let turn = 0; turn < budget; turn++) {
      if (sessionTurnsUsed >= remainingGlobalBudget) break;
      const events = [];
      let userText;
      let generationFailed = false;
      try {
        userText = await generateSimUserQuery(intent, contextHistory, options.runId, seqDoc.sessionId);
      } catch (error) {
        console.error(`[simUser] SimUser gen failed intent=${intent.intentIndex} turn=${turn}:`, error);
        events.push("SIMUSER_GEN_FAILURE");
        sessionLogs.push({
          sessionId: seqDoc.sessionId,
          intentIndex: intent.intentIndex,
          turnCount: turn,
          budget,
          userText: "",
          assistantText: "",
          judgeLabel: "SKIPPED_GEN_FAILURE",
          events
        });
        sessionTurnsUsed += 1;
        generationFailed = true;
        break;
      }
      if (generationFailed) break;
      contextHistory.push({ role: "user", content: userText });
      let assistantText;
      try {
        assistantText = await callAgentEndpoint(options.agentApiEndpoint, contextHistory);
      } catch (error) {
        console.error(`[simUser] Agent call failed intent=${intent.intentIndex} turn=${turn}:`, error);
        events.push("AGENT_CALL_FAILURE");
        sessionLogs.push({
          sessionId: seqDoc.sessionId,
          intentIndex: intent.intentIndex,
          turnCount: turn,
          budget,
          userText,
          assistantText: "",
          judgeLabel: "FALLBACK_NOT_SATISFIED",
          events
        });
        sessionTurnsUsed += 1;
        break;
      }
      contextHistory.push({ role: "assistant", content: assistantText });
      let judgeLabel = "NOT_SATISFIED";
      let rationale;
      let evidenceQuote;
      try {
        const judgeResult = await judgeIntentCompletion(intent, userText, assistantText, options.runId, seqDoc.sessionId);
        judgeLabel = judgeResult.label;
        rationale = judgeResult.rationale;
        evidenceQuote = judgeResult.evidenceQuote;
      } catch (error) {
        console.error(`[simUser] Judge failed intent=${intent.intentIndex} turn=${turn}:`, error);
        events.push("JUDGE_FAILURE");
      }
      if (judgeLabel === "SATISFIED") {
        events.push("INTENT_SATISFIED");
        satisfied = true;
      }
      if (turn === budget - 1 && !satisfied) {
        events.push("BUDGET_EXHAUSTED");
      }
      sessionLogs.push({
        sessionId: seqDoc.sessionId,
        intentIndex: intent.intentIndex,
        turnCount: turn,
        budget,
        userText,
        assistantText,
        judgeLabel,
        rationale,
        evidenceQuote,
        events
      });
      sessionTurnsUsed += 1;
      if (satisfied) break;
    }
  }
  return sessionLogs;
}
async function generateSimUserQuery(intent, conversationHistory, runId, sessionId) {
  const recentHistory = conversationHistory.slice(-6).map((m) => `[${m.role}] ${m.content}`).join("\n");
  const userContent = [
    `\u610F\u56FE\uFF1A${intent.intentText}`,
    `\u6EE1\u8DB3\u6807\u51C6\uFF1A${intent.successCriteria}`,
    `\u793A\u4F8B\u8FFD\u95EE\uFF1A${intent.exampleUserQueries.join("\uFF1B")}`,
    "\u8FD1\u671F\u5BF9\u8BDD\u5386\u53F2\uFF1A",
    recentHistory || "(\u65E0\u5386\u53F2\u8BB0\u5F55)",
    "\u8BF7\u751F\u6210\u4E0B\u4E00\u6761 SimUser \u8FFD\u95EE\u6D88\u606F\uFF08JSON\uFF09\u3002"
  ].join("\n\n");
  const rawResponse = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("simuser_query_generate", SIMUSER_GENERATE_SYSTEM_LINES)
      },
      { role: "user", content: userContent }
    ],
    { stage: "simuser_query_generate", runId, sessionId }
  );
  const parsed = parseJsonObjectFromLlmOutput(rawResponse);
  const query = typeof parsed.query === "string" ? parsed.query.trim() : "";
  if (!query) {
    throw new Error("SimUser query generation returned empty string.");
  }
  return query;
}
async function judgeIntentCompletion(intent, userText, assistantText, runId, sessionId) {
  const userContent = [
    `\u610F\u56FE\u63CF\u8FF0\uFF1A${intent.intentText}`,
    `\u6EE1\u8DB3\u6807\u51C6\uFF1A${intent.successCriteria}`,
    `SimUser \u8FFD\u95EE\uFF1A${userText}`,
    `Agent \u56DE\u590D\uFF1A${assistantText}`,
    "\u8BF7\u5224\u65AD Agent \u56DE\u590D\u662F\u5426\u6EE1\u8DB3\u4E86\u8BE5\u610F\u56FE\uFF08JSON\uFF09\u3002"
  ].join("\n\n");
  const rawResponse = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("intent_completion_judge", INTENT_JUDGE_SYSTEM_LINES)
      },
      { role: "user", content: userContent }
    ],
    { stage: "intent_completion_judge", runId, sessionId }
  );
  const parsed = parseJsonObjectFromLlmOutput(rawResponse);
  const rawLabel = typeof parsed.label === "string" ? parsed.label.toUpperCase() : "";
  const label = validateIntentJudgeLabel(rawLabel);
  const rationale = typeof parsed.rationale === "string" ? parsed.rationale.trim() : void 0;
  const evidenceQuote = typeof parsed.evidenceQuote === "string" ? parsed.evidenceQuote.trim() : void 0;
  return { label, rationale, evidenceQuote };
}
async function callAgentEndpoint(agentApiEndpoint, conversationHistory) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3e4);
  try {
    const response = await fetch(agentApiEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages: conversationHistory }),
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`Agent endpoint returned HTTP ${response.status}`);
    }
    const body = await response.json();
    const content = body.content ?? body.message ?? body.response;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("Agent endpoint returned empty or non-string content.");
    }
    return content.trim();
  } finally {
    clearTimeout(timeout);
  }
}
function buildInitialContext(intent, sessionRows) {
  const [startTurn, endTurn] = intent.turnSpanUserTurns;
  return sessionRows.filter((row) => row.turnIndex >= startTurn && row.turnIndex <= endTurn).map((row) => ({ role: row.role, content: row.content }));
}
function estimateIntentHistoricalTurns(intent, sessionRows) {
  const [startTurn, endTurn] = intent.turnSpanUserTurns;
  const count = sessionRows.filter((row) => row.turnIndex >= startTurn && row.turnIndex <= endTurn).length;
  return Math.max(1, count);
}
function validateIntentJudgeLabel(value) {
  if (value === "SATISFIED" || value === "NOT_SATISFIED" || value === "DEVIATION" || value === "FALLBACK_NOT_SATISFIED" || value === "SKIPPED_GEN_FAILURE") {
    return value;
  }
  return "NOT_SATISFIED";
}
function resolveGlobalMax() {
  const parsed = Number.parseInt(readZevalEnvValue(["ZEVAL_SIMUSER_GLOBAL_MAX"]) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_GLOBAL_MAX_TURNS;
}
function groupRowsBySession8(rows) {
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId).push(row);
  }
  return grouped;
}

// src/pipeline/goalCompletion.ts
var RESOLUTION_PATTERNS = [
  /(已经?为您|已[帮给]您)(处理|安排|解决|提交|下单|发送|操作)/,
  /(这就|马上|立刻)(帮您|给您|为您)(处理|安排|操作)/,
  /(已完成|已解决|已搞定|已结束|问题已经?解决)/,
  /(办好了|弄好了|处理好了|完成了|搞定了)/
];
var APPRECIATION_PATTERNS = [
  /^(好的|行|ok|可以|谢谢|多谢|感谢|辛苦了|收到|明白了)/i,
  /(谢谢|感谢|辛苦)/
];
var GIVE_UP_PATTERNS = [
  /^(算了|不用了|不聊了|不想再|放弃)/,
  /(别说了|不要再|浪费时间)/
];
var ESCALATION_PATTERNS = [
  /(转人工|找客服|投诉|经理|主管)/
];
var FAILURE_EXPRESSIONS = [
  /(还是不行|没解决|解决不了|没有用|搞不定|完全不对)/,
  /(你不明白|你没听懂|答非所问|驴唇不对马嘴)/
];
async function buildGoalCompletions(rows, useLlm, runId, options = {}) {
  const grouped = groupRowsBySession9(rows);
  const concurrency = resolveGoalCompletionConcurrency();
  return mapWithConcurrency(
    [...grouped.entries()],
    concurrency,
    async ([sessionId, sessionRows]) => {
      const ruleResult = evaluateGoalCompletionByRule(sessionId, sessionRows);
      if (ruleResult.status !== "unclear" || !useLlm) {
        return ruleResult;
      }
      try {
        return await evaluateGoalCompletionWithLlm(sessionId, sessionRows, ruleResult, runId);
      } catch (error) {
        if (options.judgeRequired) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Goal completion LLM Judge \u5931\u8D25\uFF0Csession=${sessionId}\uFF1A${message}`);
        }
        console.error("Goal completion LLM judge failed:", sessionId, error);
        return {
          ...ruleResult,
          triggeredRules: [...ruleResult.triggeredRules, "llm-fallback-failed"]
        };
      }
    }
  );
}
function resolveGoalCompletionConcurrency() {
  const parsed = Number.parseInt(
    readZevalEnvValue(["ZEVAL_JUDGE_SESSION_CONCURRENCY"]) ?? "",
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_CONCURRENCY;
}
function evaluateGoalCompletionByRule(sessionId, rows) {
  const userRows = rows.filter((row) => row.role === "user");
  const assistantRows = rows.filter((row) => row.role === "assistant");
  const triggeredRules = [];
  const achievementEvidence = [];
  const failureReasons = [];
  const rawIntent = extractRawIntent(userRows);
  const failureHit = collectFailureSignals(userRows, assistantRows, triggeredRules, failureReasons);
  const achievementHit = collectAchievementSignals(rows, assistantRows, userRows, triggeredRules, achievementEvidence);
  if (failureHit && !achievementHit) {
    return finalize(sessionId, {
      status: "failed",
      score: failureReasons.length >= 2 ? 1 : 2,
      userIntent: rawIntent,
      intentSource: "rule",
      achievementEvidence,
      failureReasons,
      triggeredRules,
      confidence: 0.74,
      source: "rule"
    });
  }
  if (achievementHit && !failureHit) {
    return finalize(sessionId, {
      status: "achieved",
      score: achievementEvidence.length >= 2 ? 5 : 4,
      userIntent: rawIntent,
      intentSource: "rule",
      achievementEvidence,
      failureReasons,
      triggeredRules,
      confidence: 0.76,
      source: "rule"
    });
  }
  if (achievementHit && failureHit) {
    return finalize(sessionId, {
      status: "partial",
      score: 3,
      userIntent: rawIntent,
      intentSource: "rule",
      achievementEvidence,
      failureReasons,
      triggeredRules,
      confidence: 0.6,
      source: "rule"
    });
  }
  return finalize(sessionId, {
    status: "unclear",
    score: 3,
    userIntent: rawIntent,
    intentSource: "rule",
    achievementEvidence,
    failureReasons,
    triggeredRules,
    confidence: 0.45,
    source: "rule"
  });
}
function collectFailureSignals(userRows, _assistantRows, triggeredRules, failureReasons) {
  let hit = false;
  const tailUserRows = userRows.slice(-2);
  const giveUp = tailUserRows.find((row) => matchAny(row.content, GIVE_UP_PATTERNS));
  if (giveUp) {
    triggeredRules.push("user-give-up");
    failureReasons.push(`\u7528\u6237\u5728\u7B2C ${giveUp.turnIndex} \u8F6E\u51FA\u73B0\u653E\u5F03\u8868\u8FBE\uFF1A${truncate(giveUp.content, 60)}`);
    hit = true;
  }
  const escalation = userRows.find((row) => matchAny(row.content, ESCALATION_PATTERNS));
  if (escalation) {
    triggeredRules.push("escalation-keyword");
    failureReasons.push(`\u7528\u6237\u5728\u7B2C ${escalation.turnIndex} \u8F6E\u8981\u6C42\u5347\u7EA7\uFF1A${truncate(escalation.content, 60)}`);
    hit = true;
  }
  const explicitFailure = userRows.find((row) => matchAny(row.content, FAILURE_EXPRESSIONS));
  if (explicitFailure) {
    triggeredRules.push("explicit-failure-phrase");
    failureReasons.push(
      `\u7528\u6237\u5728\u7B2C ${explicitFailure.turnIndex} \u8F6E\u660E\u786E\u8868\u8FBE\u95EE\u9898\u672A\u89E3\u51B3\uFF1A${truncate(explicitFailure.content, 60)}`
    );
    hit = true;
  }
  const repeatCount = countRepeatedQuestions(userRows);
  if (repeatCount >= 3) {
    triggeredRules.push("user-repeat-question-3x");
    failureReasons.push(`\u7528\u6237\u91CD\u590D\u63D0\u95EE ${repeatCount} \u6B21\uFF0C\u610F\u56FE\u672A\u88AB\u6709\u6548\u54CD\u5E94\u3002`);
    hit = true;
  }
  return hit;
}
function collectAchievementSignals(rows, assistantRows, userRows, triggeredRules, achievementEvidence) {
  let hit = false;
  const resolutionAssistant = [...assistantRows].reverse().find((row) => matchAny(row.content, RESOLUTION_PATTERNS));
  if (resolutionAssistant) {
    const followingUserRows = userRows.filter((row) => row.turnIndex > resolutionAssistant.turnIndex);
    const noFollowUpQuestion = followingUserRows.every((row) => !row.isQuestion);
    if (noFollowUpQuestion) {
      triggeredRules.push("assistant-resolution-stated");
      achievementEvidence.push(
        `Assistant \u7B2C ${resolutionAssistant.turnIndex} \u8F6E\uFF1A${truncate(resolutionAssistant.content, 80)}`
      );
      hit = true;
    }
  }
  const lastUser = [...userRows].reverse()[0];
  if (lastUser && matchAny(lastUser.content, APPRECIATION_PATTERNS) && lastUser.content.trim().length <= 20) {
    triggeredRules.push("user-appreciation-close");
    achievementEvidence.push(`\u7528\u6237\u672B\u8F6E\u81F4\u8C22\u6216\u786E\u8BA4\uFF1A${truncate(lastUser.content, 60)}`);
    hit = true;
  }
  return hit;
}
async function evaluateGoalCompletionWithLlm(sessionId, rows, ruleResult, runId) {
  const transcript = buildTranscriptForLlm(rows);
  const firstUserTurns = rows.filter((row) => row.role === "user").slice(0, 3).map((row) => `[turn ${row.turnIndex}] ${row.content}`).join("\n");
  const raw = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("goal_completion_judge", [
          "\u4F60\u662F\u5BF9\u8BDD\u8BC4\u4F30\u7CFB\u7EDF\u7684 goal-completion Judge\u3002",
          "\u4EFB\u52A1\uFF1A\u5224\u65AD\u7528\u6237\u7684\u6700\u521D\u610F\u56FE\u5728\u672C session \u5185\u662F\u5426\u88AB\u8FBE\u6210\u3002",
          "\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981 markdown\uFF0C\u4E0D\u8981\u89E3\u91CA\u3002",
          "status \u53EA\u80FD\u662F achieved / partial / failed / unclear \u4E4B\u4E00\u3002",
          "score \u4E3A 1 \u5230 5 \u7684\u6574\u6570\uFF0C5 \u8868\u793A\u5B8C\u5168\u8FBE\u6210\uFF0C1 \u8868\u793A\u5B8C\u5168\u672A\u8FBE\u6210\u3002",
          "userIntent \u5FC5\u987B\u662F\u4ECE\u524D 3 \u8F6E\u7528\u6237\u6D88\u606F\u4E2D\u62BD\u53D6\u7684 30 \u5B57\u4EE5\u5185\u7684\u610F\u56FE\u63CF\u8FF0\u3002",
          "achievementEvidence \u4E0E failureReasons \u662F\u5B57\u7B26\u4E32\u6570\u7EC4\uFF0C\u5F15\u7528\u539F\u6587\u7247\u6BB5\uFF0C\u4E0D\u8981\u7F16\u9020\u3002",
          "confidence \u4E3A 0-1 \u7684\u5C0F\u6570\u3002",
          '\u8F93\u51FA\uFF1A{"userIntent":"...","status":"...","score":0,"achievementEvidence":[],"failureReasons":[],"confidence":0}'
        ])
      },
      {
        role: "user",
        content: [
          `sessionId=${sessionId}`,
          "\u7528\u6237\u524D 3 \u8F6E\u6D88\u606F\uFF08\u7528\u4E8E\u62BD\u53D6 intent\uFF09\uFF1A",
          firstUserTurns || "(\u65E0)",
          "\u5B8C\u6574 session\uFF08\u6309\u65F6\u95F4\u987A\u5E8F\uFF09\uFF1A",
          transcript,
          "\u8BF7\u8F93\u51FA\u7ED3\u6784\u5316 JSON\u3002"
        ].join("\n\n")
      }
    ],
    { stage: "goal_completion_judge", runId, sessionId }
  );
  const parsed = parseJsonObjectFromLlmOutput(raw);
  const status = normalizeStatus(parsed.status, ruleResult.status);
  const score = clampScore2(typeof parsed.score === "number" ? parsed.score : ruleResult.score);
  const intent = normalizeText(parsed.userIntent, ruleResult.userIntent);
  const achievementEvidence = dedupeStrings2([
    ...(parsed.achievementEvidence ?? []).filter(isNonEmptyString),
    ...ruleResult.achievementEvidence
  ]).slice(0, 4);
  const failureReasons = dedupeStrings2([
    ...(parsed.failureReasons ?? []).filter(isNonEmptyString),
    ...ruleResult.failureReasons
  ]).slice(0, 4);
  const confidence = clampConfidence(
    typeof parsed.confidence === "number" ? parsed.confidence : 0.7
  );
  return {
    sessionId,
    status,
    score,
    userIntent: intent,
    intentSource: "llm",
    achievementEvidence,
    failureReasons,
    triggeredRules: [...ruleResult.triggeredRules, "llm-judge"],
    confidence,
    source: "llm"
  };
}
function extractRawIntent(userRows) {
  const firstMeaningful = userRows.find((row) => row.content.trim().length >= 3) ?? userRows[0];
  if (!firstMeaningful) {
    return "(\u672A\u8BC6\u522B\u5230\u7528\u6237\u610F\u56FE)";
  }
  return truncate(firstMeaningful.content.trim(), 30);
}
function buildTranscriptForLlm(rows) {
  const maxTurns = 24;
  const slice = rows.length <= maxTurns ? rows : [...rows.slice(0, 8), ...rows.slice(-16)];
  return slice.map((row) => `[turn ${row.turnIndex}] [${row.role}] ${truncate(row.content, 160)}`).join("\n");
}
function countRepeatedQuestions(userRows) {
  const counts = /* @__PURE__ */ new Map();
  for (const row of userRows) {
    if (!row.isQuestion) continue;
    const normalized = row.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 20);
    if (normalized.length === 0) continue;
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }
  return [...counts.values()].reduce((max, value) => Math.max(max, value), 0);
}
function finalize(sessionId, input) {
  return {
    sessionId,
    status: input.status,
    score: clampScore2(input.score),
    userIntent: input.userIntent,
    intentSource: input.intentSource,
    achievementEvidence: input.achievementEvidence.slice(0, 4),
    failureReasons: input.failureReasons.slice(0, 4),
    triggeredRules: input.triggeredRules,
    confidence: clampConfidence(input.confidence),
    source: input.source
  };
}
function groupRowsBySession9(rows) {
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) {
      grouped.set(row.sessionId, []);
    }
    grouped.get(row.sessionId)?.push(row);
  }
  for (const list of grouped.values()) {
    list.sort((a, b) => a.turnIndex - b.turnIndex);
  }
  return grouped;
}
function matchAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}
function truncate(value, max) {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\u2026`;
}
function clampScore2(score) {
  return Math.max(1, Math.min(5, Math.round(score)));
}
function clampConfidence(confidence) {
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}
function normalizeText(value, fallback) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}
function normalizeStatus(value, fallback) {
  if (value === "achieved" || value === "partial" || value === "failed" || value === "unclear") {
    return value;
  }
  return fallback;
}
function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function dedupeStrings2(values) {
  const seen = /* @__PURE__ */ new Set();
  const result2 = [];
  for (const value of values) {
    const key = value.trim();
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    result2.push(key);
  }
  return result2;
}

// src/pipeline/recoveryTrace.ts
var APOLOGY_PATTERNS = [/(抱歉|不好意思|对不起|让你困扰了)/, /(sorry|apologize)/i];
var REPHRASE_PATTERNS = [/(换个说法|我换个方式|重新解释|重新说明)/, /(let me rephrase|let me explain differently)/i];
var CLARIFICATION_PATTERNS = [/(我先确认一下|我理解的是|你是想说)/, /(let me confirm|if i understand correctly)/i];
var CONFUSION_PATTERNS = [/(什么意思|不懂|你是说|再说一遍|没明白|怎么理解)/];
async function buildRecoveryTraces(rows, goalCompletions, useLlm, runId, options = {}) {
  const grouped = groupRowsBySession10(rows);
  const goalCompletionMap = new Map(goalCompletions.map((item) => [item.sessionId, item]));
  const concurrency = resolveRecoveryConcurrency();
  return mapWithConcurrency(
    [...grouped.entries()],
    concurrency,
    async ([sessionId, sessionRows]) => {
      const trace = buildRecoveryTraceByRule(sessionId, sessionRows, goalCompletionMap.get(sessionId));
      if (trace.status !== "completed" || !useLlm) {
        return trace;
      }
      try {
        return await enhanceRecoveryTraceWithLlm(trace, sessionRows, runId);
      } catch (error) {
        if (options.judgeRequired) {
          const message = error instanceof Error ? error.message : String(error);
          throw new Error(`Recovery trace LLM Judge \u5931\u8D25\uFF0Csession=${sessionId}\uFF1A${message}`);
        }
        console.error("Recovery trace LLM summary failed:", sessionId, error);
        return {
          ...trace,
          triggeredRules: [...trace.triggeredRules, "repair-strategy-llm-failed"]
        };
      }
    }
  );
}
function resolveRecoveryConcurrency() {
  const parsed = Number.parseInt(
    readZevalEnvValue(["ZEVAL_JUDGE_SESSION_CONCURRENCY"]) ?? "",
    10
  );
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_LLM_CONCURRENCY;
}
function buildRecoveryTraceByRule(sessionId, rows, goalCompletion) {
  const candidate = detectFailureCandidate(rows);
  if (!candidate) {
    return finalizeTrace({
      sessionId,
      status: "none",
      failureTurn: null,
      recoveryTurn: null,
      spanTurns: null,
      failureType: "unknown",
      repairStrategy: null,
      repairStrategySource: "fallback",
      qualityScore: 0,
      evidence: [],
      triggeredRules: [],
      confidence: 0.45
    });
  }
  const recoveryRow = detectRecoveryPoint(rows, candidate, goalCompletion);
  if (!recoveryRow) {
    return finalizeTrace({
      sessionId,
      status: "failed",
      failureTurn: candidate.turnIndex,
      recoveryTurn: null,
      spanTurns: null,
      failureType: candidate.failureType,
      repairStrategy: null,
      repairStrategySource: "rule",
      qualityScore: 1.6,
      evidence: buildEvidenceRows(rows, candidate.turnIndex, null),
      triggeredRules: [candidate.triggeredRule, "recovery-not-found"],
      confidence: 0.72
    });
  }
  const spanTurns = recoveryRow.turnIndex - candidate.turnIndex;
  return finalizeTrace({
    sessionId,
    status: "completed",
    failureTurn: candidate.turnIndex,
    recoveryTurn: recoveryRow.turnIndex,
    spanTurns,
    failureType: candidate.failureType,
    repairStrategy: buildRepairStrategyByRule(recoveryRow, candidate.failureType),
    repairStrategySource: "rule",
    qualityScore: buildQualityScore(spanTurns, goalCompletion?.status),
    evidence: buildEvidenceRows(rows, candidate.turnIndex, recoveryRow.turnIndex),
    triggeredRules: [candidate.triggeredRule, detectRecoveryTrigger(recoveryRow)],
    confidence: 0.79
  });
}
async function enhanceRecoveryTraceWithLlm(trace, rows, runId) {
  if (trace.status !== "completed" || trace.failureTurn === null || trace.recoveryTurn === null) {
    return trace;
  }
  const failureTurn = trace.failureTurn;
  const recoveryTurn = trace.recoveryTurn;
  const transcript = rows.filter((row) => row.turnIndex >= failureTurn && row.turnIndex <= recoveryTurn).map((row) => `[turn ${row.turnIndex}] [${row.role}] ${truncate2(row.content, 180)}`).join("\n");
  const raw = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("recovery_trace_strategy", [
          "\u4F60\u662F\u5BF9\u8BDD\u8BC4\u4F30\u7CFB\u7EDF\u4E2D\u7684 recovery-trace Judge\u3002",
          "\u4F60\u7684\u4EFB\u52A1\u4E0D\u662F\u91CD\u65B0\u5224\u65AD\u662F\u5426\u6062\u590D\u6210\u529F\uFF0C\u800C\u662F\u603B\u7ED3 Agent \u91C7\u7528\u4E86\u4EC0\u4E48\u4FEE\u590D\u7B56\u7565\u3002",
          "\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981 markdown\uFF0C\u4E0D\u8981\u89E3\u91CA\u3002",
          "repairStrategy \u7528 12 \u5B57\u4EE5\u5185\u4E2D\u6587\u77ED\u8BED\u8868\u793A\uFF0C\u4F8B\u5982\uFF1Aapology + rephrase\u3001\u5148\u9053\u6B49\u518D\u6F84\u6E05\u3001\u95EE\u9898\u91CD\u8FF0\u540E\u7ED9\u89E3\u51B3\u52A8\u4F5C\u3002",
          "confidence \u4E3A 0-1 \u7684\u5C0F\u6570\u3002",
          '\u8F93\u51FA\uFF1A{"repairStrategy":"...","confidence":0.82}'
        ])
      },
      {
        role: "user",
        content: [
          `sessionId=${trace.sessionId}`,
          `failureType=${trace.failureType}`,
          `failureTurn=${failureTurn}`,
          `recoveryTurn=${recoveryTurn}`,
          "\u8BF7\u57FA\u4E8E\u4EE5\u4E0B\u5931\u8D25\u5230\u6062\u590D\u7247\u6BB5\u603B\u7ED3\u4FEE\u590D\u7B56\u7565\uFF1A",
          transcript
        ].join("\n\n")
      }
    ],
    {
      stage: "recovery_trace_strategy",
      runId,
      sessionId: trace.sessionId
    }
  );
  const parsed = parseJsonObjectFromLlmOutput(raw);
  const repairStrategy = normalizeText2(parsed.repairStrategy, trace.repairStrategy ?? "\u6062\u590D\u7B56\u7565\u5F85\u8865\u5145");
  const confidence = clampConfidence2(
    typeof parsed.confidence === "number" ? parsed.confidence : Math.max(trace.confidence, 0.78)
  );
  return {
    ...trace,
    repairStrategy,
    repairStrategySource: "llm",
    confidence,
    triggeredRules: [...trace.triggeredRules, "repair-strategy-llm"]
  };
}
function detectFailureCandidate(rows) {
  const candidates = [];
  const confusionRow = rows.find((row) => row.role === "user" && matchAny2(row.content, CONFUSION_PATTERNS));
  if (confusionRow) {
    candidates.push({
      turnIndex: confusionRow.turnIndex,
      failureType: "understanding-barrier",
      triggeredRule: "user-confusion-expression",
      evidenceRows: [confusionRow]
    });
  }
  if (candidates.length === 0) {
    return null;
  }
  return candidates.sort((left, right) => left.turnIndex - right.turnIndex)[0] ?? null;
}
function detectRecoveryPoint(rows, candidate, goalCompletion) {
  const windowRows = rows.filter(
    (row) => row.turnIndex > candidate.turnIndex && row.turnIndex <= candidate.turnIndex + 4
  );
  for (const row of windowRows) {
    if (row.role !== "assistant") {
      continue;
    }
    const repairSignal = matchAny2(row.content, APOLOGY_PATTERNS) || matchAny2(row.content, REPHRASE_PATTERNS) || matchAny2(row.content, CLARIFICATION_PATTERNS);
    if (repairSignal) {
      return row;
    }
  }
  if (goalCompletion?.status === "achieved" || goalCompletion?.status === "partial") {
    return [...windowRows].reverse().find((row) => row.role === "assistant") ?? null;
  }
  return null;
}
function buildRepairStrategyByRule(recoveryRow, failureType) {
  if (matchAny2(recoveryRow.content, APOLOGY_PATTERNS) && matchAny2(recoveryRow.content, REPHRASE_PATTERNS)) {
    return "\u5148\u9053\u6B49\u518D\u91CD\u8FF0";
  }
  if (matchAny2(recoveryRow.content, CLARIFICATION_PATTERNS)) {
    return "\u6F84\u6E05\u540E\u91CD\u65B0\u63A8\u8FDB";
  }
  if (matchAny2(recoveryRow.content, APOLOGY_PATTERNS)) {
    return "\u9053\u6B49\u6B62\u635F";
  }
  if (recoveryRow.isQuestion) {
    return "\u8FFD\u95EE\u6F84\u6E05";
  }
  if (failureType === "ignore") {
    return "\u56DE\u5230\u7528\u6237\u539F\u95EE\u9898";
  }
  if (failureType === "understanding-barrier") {
    return "\u91CD\u65B0\u89E3\u91CA\u4E0E\u786E\u8BA4";
  }
  return "\u6062\u590D\u7B56\u7565\u5F85\u8865\u5145";
}
function buildQualityScore(spanTurns, goalStatus) {
  let score = 5 - spanTurns * 0.5;
  if (goalStatus === "achieved") {
    score += 1;
  } else if (goalStatus === "partial") {
    score += 0.5;
  } else if (goalStatus === "failed") {
    score -= 0.6;
  }
  return clampScore3(score);
}
function buildEvidenceRows(rows, failureTurn, recoveryTurn) {
  const endTurn = recoveryTurn ?? Math.min(failureTurn + 2, rows[rows.length - 1]?.turnIndex ?? failureTurn);
  return rows.filter((row) => row.turnIndex >= Math.max(1, failureTurn - 1) && row.turnIndex <= endTurn).slice(0, 5).map((row) => ({
    turnIndex: row.turnIndex,
    role: row.role,
    content: truncate2(row.content, 120)
  }));
}
function detectRecoveryTrigger(recoveryRow) {
  if (matchAny2(recoveryRow.content, APOLOGY_PATTERNS)) {
    return "assistant-apology";
  }
  if (matchAny2(recoveryRow.content, REPHRASE_PATTERNS)) {
    return "assistant-rephrase";
  }
  if (matchAny2(recoveryRow.content, CLARIFICATION_PATTERNS)) {
    return "assistant-clarification";
  }
  return "recovery-window-hit";
}
function finalizeTrace(input) {
  return {
    sessionId: input.sessionId,
    status: input.status,
    failureTurn: input.failureTurn,
    recoveryTurn: input.recoveryTurn,
    spanTurns: input.spanTurns,
    failureType: input.failureType,
    repairStrategy: input.repairStrategy,
    repairStrategySource: input.repairStrategySource,
    qualityScore: clampScore3(input.qualityScore),
    evidence: input.evidence,
    triggeredRules: input.triggeredRules,
    confidence: clampConfidence2(input.confidence)
  };
}
function groupRowsBySession10(rows) {
  const grouped = /* @__PURE__ */ new Map();
  for (const row of rows) {
    if (!grouped.has(row.sessionId)) {
      grouped.set(row.sessionId, []);
    }
    grouped.get(row.sessionId)?.push(row);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => left.turnIndex - right.turnIndex);
  }
  return grouped;
}
function matchAny2(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}
function clampScore3(value) {
  return Math.max(0, Math.min(5, Number(value.toFixed(1))));
}
function clampConfidence2(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}
function normalizeText2(value, fallback) {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}
function truncate2(value, max) {
  if (value.length <= max) {
    return value;
  }
  return `${value.slice(0, max)}\u2026`;
}

// src/pipeline/signals.ts
function buildImplicitSignals(rows) {
  return [
    buildInterestDeclineRisk(rows),
    buildUnderstandingBarrierRisk(rows)
  ];
}
function buildInterestDeclineRisk(rows) {
  const userRows = rows.filter((row) => row.role === "user");
  const userLengths = userRows.map((row) => row.content.length);
  const half = Math.max(1, Math.ceil(userLengths.length / 2));
  const earlyAvgLength = average3(userLengths.slice(0, half));
  const lateAvgLength = average3(userLengths.slice(half));
  const gapValues = userRows.map((row) => row.responseGapSec ?? 0);
  const earlyAvgGap = average3(gapValues.slice(0, half));
  const lateAvgGap = average3(gapValues.slice(half));
  const earlyQuestionRate = rate(half, userRows.slice(0, half).filter((row) => row.isQuestion).length);
  const lateQuestionRate = rate(userLengths.slice(half).length, userRows.slice(half).filter((row) => row.isQuestion).length);
  const triggeredRules = [];
  let score = 0.22;
  if (lateAvgLength < earlyAvgLength * 0.78) {
    triggeredRules.push("\u8FDE\u7EED\u77ED\u56DE\u590D");
    score += 0.26;
  }
  if (lateAvgGap > Math.max(30, earlyAvgGap * 1.4)) {
    triggeredRules.push("\u56DE\u590D\u95F4\u9694\u62C9\u957F");
    score += 0.28;
  }
  if (lateQuestionRate < earlyQuestionRate && earlyQuestionRate > 0) {
    triggeredRules.push("\u63D0\u95EE\u610F\u613F\u4E0B\u964D");
    score += 0.18;
  }
  const evidenceRow = userRows[userRows.length - 1] ?? rows[rows.length - 1];
  return createSignal(
    "interestDeclineRisk",
    score,
    triggeredRules,
    triggeredRules.length ? "\u540E\u534A\u6BB5\u7528\u6237\u56DE\u590D\u66F4\u77ED\u4E14\u4E92\u52A8\u6B32\u671B\u4E0B\u964D\uFF0C\u5B58\u5728\u5174\u8DA3\u8870\u51CF\u8FF9\u8C61\u3002" : "\u5F53\u524D\u672A\u68C0\u6D4B\u5230\u660E\u663E\u7684\u5174\u8DA3\u8870\u51CF\u6A21\u5F0F\u3002",
    evidenceRow ? `[turn ${evidenceRow.turnIndex}] ${evidenceRow.content}` : "\u65E0\u53EF\u7528\u8BC1\u636E",
    evidenceRow ? `${evidenceRow.sessionId}:${Math.max(1, evidenceRow.turnIndex - 2)}-${evidenceRow.turnIndex}` : "unknown",
    triggeredRules.length ? 0.78 : 0.62
  );
}
function buildUnderstandingBarrierRisk(rows) {
  const userRows = rows.filter((row) => row.role === "user");
  const triggeredRules = [];
  let score = 0.2;
  const confusionRows = userRows.filter(
    (row) => /(什么意思|不懂|你是说|再说一遍|没明白|怎么理解)/.test(row.content)
  );
  if (confusionRows.length > 0) {
    triggeredRules.push("\u56F0\u60D1\u8868\u8FBE\u5347\u9AD8");
    score += 0.3;
  }
  const normalizedQuestions = userRows.filter((row) => row.isQuestion).map((row) => row.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 18)).filter((v) => v.length > 0);
  const questionCounts = /* @__PURE__ */ new Map();
  normalizedQuestions.forEach((q) => questionCounts.set(q, (questionCounts.get(q) ?? 0) + 1));
  if ([...questionCounts.values()].some((c2) => c2 >= 2)) {
    triggeredRules.push("\u91CD\u590D\u63D0\u95EE");
    score += 0.28;
  }
  const evidenceRow = confusionRows[0] ?? userRows.find((row) => row.isQuestion) ?? rows[0];
  return createSignal(
    "understandingBarrierRisk",
    score,
    triggeredRules,
    triggeredRules.length ? "\u7528\u6237\u51FA\u73B0\u56F0\u60D1\u8868\u8FBE\u6216\u91CD\u590D\u63D0\u95EE\uFF0C\u8BF4\u660E\u7406\u89E3\u969C\u788D\u98CE\u9669\u6B63\u5728\u4E0A\u5347\u3002" : "\u5F53\u524D\u6CA1\u6709\u663E\u8457\u7684\u7406\u89E3\u969C\u788D\u4FE1\u53F7\u3002",
    evidenceRow ? `[turn ${evidenceRow.turnIndex}] ${evidenceRow.content}` : "\u65E0\u53EF\u7528\u8BC1\u636E",
    evidenceRow ? `${evidenceRow.sessionId}:${evidenceRow.turnIndex}-${evidenceRow.turnIndex}` : "unknown",
    triggeredRules.length ? 0.81 : 0.6
  );
}
function createSignal(signalKey, rawScore, triggeredRules, reason, evidence, evidenceTurnRange, confidence) {
  const score = clamp(rawScore);
  return {
    signalKey,
    score,
    severity: score >= 0.7 ? "high" : score >= 0.4 ? "medium" : "low",
    triggeredRules,
    reason,
    evidence,
    evidenceTurnRange,
    confidence: clamp(confidence)
  };
}
function average3(values) {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
function rate(total, part) {
  return total === 0 ? 0 : part / total;
}
function clamp(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

// src/pipeline/subjectiveMetrics.ts
var SUBJECTIVE_DIMENSIONS = ["\u5171\u60C5\u7A0B\u5EA6", "\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669", "\u8BF4\u6559\u611F/\u538B\u8FEB\u611F"];
async function buildSubjectiveMetrics(rows, useLlm, runId, options = {}) {
  const judgeRequired = options.judgeRequired ?? false;
  const signals = buildImplicitSignals(rows);
  const fallbackDimensions = buildRuleBasedDimensions(rows, signals);
  if (!useLlm && judgeRequired) {
    throw new Error("LLM Judge \u662F\u5F53\u524D\u8BC4\u4F30\u7684\u5F3A\u4F9D\u8D56\uFF0C\u4F46\u672C\u6B21\u8BF7\u6C42\u5173\u95ED\u4E86 useLlm\u3002");
  }
  const goalCompletions = await buildGoalCompletions(rows, useLlm, runId, { judgeRequired });
  if (!useLlm) {
    const recoveryTraces = await buildRecoveryTraces(rows, goalCompletions, false, runId, { judgeRequired });
    return {
      status: "degraded",
      dimensions: fallbackDimensions,
      signals,
      goalCompletions,
      recoveryTraces
    };
  }
  const grouped = groupRowsBySession11(rows);
  try {
    const [recoveryTraces, sessionReviews] = await Promise.all([
      // ② recovery trace LLM 增强（仅 completed trace 才调 LLM）
      buildRecoveryTraces(rows, goalCompletions, useLlm, runId, { judgeRequired }),
      // ③ 三维度判断（每 session 一次 LLM call，并发上限由 resolveJudgeConcurrency 控制）
      mapWithConcurrency(
        [...grouped.entries()],
        resolveJudgeConcurrency(),
        async ([sessionId, sessionRows]) => {
          try {
            return {
              sessionId,
              dimensions: await judgeSessionDimensionsWithLlm(sessionRows, signals, runId, { requireComplete: judgeRequired }),
              weight: sessionRows.length,
              succeeded: true
            };
          } catch (error) {
            if (judgeRequired) {
              const message = error instanceof Error ? error.message : String(error);
              throw new Error(`LLM Judge \u5931\u8D25\uFF0Csession=${sessionId}\uFF1A${message}`);
            }
            console.error("Session subjective judge failed:", sessionId, error);
            return {
              sessionId,
              dimensions: buildRuleBasedDimensions(sessionRows, signals),
              weight: sessionRows.length,
              succeeded: false
            };
          }
        }
      )
    ]);
    return {
      status: sessionReviews.every((review) => review.succeeded) ? "ready" : "degraded",
      dimensions: aggregateDimensionReviews(
        sessionReviews.map((review) => review.dimensions),
        sessionReviews.map((review) => review.weight)
      ),
      signals,
      goalCompletions,
      recoveryTraces
    };
  } catch (error) {
    if (judgeRequired) throw error;
    console.error("SiliconFlow subjective judge failed:", error);
    return {
      status: "degraded",
      dimensions: fallbackDimensions,
      signals,
      goalCompletions,
      recoveryTraces: []
    };
  }
}
async function judgeSessionDimensionsWithLlm(rows, signals, runId, options = {}) {
  const fallbackDimensions = buildRuleBasedDimensions(rows, signals);
  const transcript = buildSessionJudgeTranscript(rows, signals);
  const rawResponse = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: buildVersionedJudgeSystemPrompt("subjective_dimension_judge", [
          "\u4F60\u662F\u5BF9\u8BDD\u8BC4\u4F30\u7CFB\u7EDF\u4E2D\u7684\u5BA1\u7A3F\u578B Judge\u3002",
          "\u8F93\u5165\u5DF2\u505A\u4E86\u9690\u5F0F\u4FE1\u53F7\u63D0\u53D6\uFF0C\u8BF7\u57FA\u4E8E\u539F\u6587\u8BC4\u4F30\u4EE5\u4E0B\u4E09\u4E2A\u7EF4\u5EA6\u3002",
          "\u4F60\u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981\u8F93\u51FA markdown\uFF0C\u4E0D\u8981\u8865\u5145\u89E3\u91CA\u3002",
          "\u8BF7\u8BC4\u4F30\u4E09\u4E2A\u7EF4\u5EA6\uFF1A\u5171\u60C5\u7A0B\u5EA6\u3001\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669\u3001\u8BF4\u6559\u611F/\u538B\u8FEB\u611F\u3002",
          "score \u5FC5\u987B\u662F 1 \u5230 5 \u7684\u6574\u6570\uFF0C\u5206\u6570\u8D8A\u9AD8\u8D8A\u597D\u3002",
          "confidence \u5FC5\u987B\u662F 0 \u5230 1 \u7684\u5C0F\u6570\u3002",
          "evidence \u5FC5\u987B\u5F15\u7528\u539F\u59CB\u5BF9\u8BDD\u7247\u6BB5\uFF0C\u4E0D\u8981\u7F16\u9020\u3002",
          '\u8F93\u51FA\u683C\u5F0F\uFF1A{"dimensions":[{"dimension":"\u5171\u60C5\u7A0B\u5EA6","score":4,"reason":"...","evidence":"...","confidence":0.82}]}'
        ])
      },
      { role: "user", content: transcript }
    ],
    { stage: "subjective_dimension_judge", runId, sessionId: rows[0]?.sessionId }
  );
  const parsed = parseJsonObjectFromLlmOutput(rawResponse);
  const byName = new Map(
    (parsed.dimensions ?? []).filter((item) => typeof item.dimension === "string" && item.dimension.length > 0).map((item) => [item.dimension, item])
  );
  return SUBJECTIVE_DIMENSIONS.map((dimension, index) => {
    const fallback = fallbackDimensions[index];
    const candidate = byName.get(dimension);
    if (!candidate) {
      if (options.requireComplete) throw new Error(`LLM Judge \u8F93\u51FA\u7F3A\u5C11\u7EF4\u5EA6\uFF1A${dimension}`);
      return fallback;
    }
    if (options.requireComplete && !isCompleteDimensionPayload(candidate)) {
      throw new Error(`LLM Judge \u8F93\u51FA\u7EF4\u5EA6\u4E0D\u5B8C\u6574\uFF1A${dimension}`);
    }
    return {
      dimension,
      score: clampScore4(typeof candidate.score === "number" ? candidate.score : fallback.score),
      reason: normalizeText3(candidate.reason, fallback.reason),
      evidence: normalizeText3(candidate.evidence, fallback.evidence),
      confidence: clampConfidence3(typeof candidate.confidence === "number" ? candidate.confidence : fallback.confidence)
    };
  });
}
function isCompleteDimensionPayload(value) {
  return typeof value.score === "number" && typeof value.reason === "string" && value.reason.trim().length > 0 && typeof value.evidence === "string" && value.evidence.trim().length > 0 && typeof value.confidence === "number";
}
function buildSessionJudgeTranscript(rows, signals) {
  const sessionId = rows[0]?.sessionId ?? "unknown";
  const relevantSignals = signals.filter((signal) => signal.evidenceTurnRange.startsWith(`${sessionId}:`));
  const turns = rows.map((row) => `[turn ${row.turnIndex}] [${row.role}] ${row.content}`).join("\n");
  return [
    `sessionId=${sessionId}`,
    "\u9690\u5F0F\u63A8\u65AD\u4FE1\u53F7\uFF1A",
    relevantSignals.length ? relevantSignals.map((s) => `${s.signalKey} score=${s.score} severity=${s.severity} evidence=${s.evidenceTurnRange}`).join("\n") : "none",
    "\u5BF9\u8BDD\u5185\u5BB9\uFF1A",
    turns,
    "\u8BF7\u57FA\u4E8E\u4EE5\u4E0A\u5185\u5BB9\u8F93\u51FA\u4E09\u4E2A\u7EF4\u5EA6\u7684\u7ED3\u6784\u5316\u8BC4\u4F30 JSON\u3002"
  ].join("\n\n");
}
function buildRuleBasedDimensions(rows, signals) {
  return [
    buildDimension("\u5171\u60C5\u7A0B\u5EA6", scoreEmpathy(rows), "\u5171\u60C5\u8BED\u53E5\u5BC6\u5EA6\u4E0E\u5B89\u629A\u8868\u8FBE"),
    buildDimension("\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669", scoreOffTopic(rows, signals), "\u7406\u89E3\u969C\u788D\u4FE1\u53F7\u4E0E\u91CD\u590D\u63D0\u95EE\u7387"),
    buildDimension("\u8BF4\u6559\u611F/\u538B\u8FEB\u611F", scorePreachiness(rows), "\u5F3A\u6307\u5BFC\u8BCD\u4E0E\u547D\u4EE4\u5F0F\u8BED\u6C14")
  ];
}
function buildDimension(dimension, score, reason) {
  return {
    dimension,
    score,
    reason,
    evidence: "\u5F53\u524D\u7ED3\u679C\u4E3A\u89C4\u5219\u964D\u7EA7\u6A21\u5F0F\uFF0C\u8BC1\u636E\u6765\u81EA\u5173\u952E\u8BCD\u4E0E\u5BF9\u8BDD\u7ED3\u6784\u8FD1\u4F3C\u63A8\u65AD\u3002",
    confidence: 0.58
  };
}
function scoreEmpathy(rows) {
  const assistantRows = rows.filter((row) => row.role === "assistant");
  if (assistantRows.length === 0) return 1;
  const hits = assistantRows.filter((row) => /(理解|明白|支持|陪你|辛苦|正常)/.test(row.content)).length;
  return clampScore4(hits / assistantRows.length * 5);
}
function scoreOffTopic(rows, signals) {
  const understandingRisk = signals.find((s) => s.signalKey === "understandingBarrierRisk")?.score ?? 0;
  const userRows = rows.filter((r) => r.role === "user" && r.isQuestion);
  const questionCount = userRows.length;
  const repeatedQuestionRate = questionCount > 1 ? (() => {
    const counts = /* @__PURE__ */ new Map();
    userRows.forEach((r) => {
      const key = r.content.replace(/[？?，,。.!！\s]/g, "").slice(0, 18);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    });
    const repeated = [...counts.values()].filter((c2) => c2 >= 2).length;
    return repeated / questionCount;
  })() : 0;
  return clampScore4(5 - repeatedQuestionRate * 6 - understandingRisk * 2);
}
function scorePreachiness(rows) {
  const assistantRows = rows.filter((row) => row.role === "assistant");
  if (assistantRows.length === 0) return 1;
  const preachyCount = assistantRows.filter((row) => /(应该|必须|你要|一定要)/.test(row.content)).length;
  return clampScore4(5 - preachyCount / assistantRows.length * 10);
}
function clampScore4(score) {
  return Math.max(1, Math.min(5, Math.round(score)));
}
function clampConfidence3(confidence) {
  return Math.max(0, Math.min(1, Number(confidence.toFixed(2))));
}
function normalizeText3(value, fallback) {
  const normalized = collapseRepeatedTokens(value?.trim() ?? "");
  const selected = normalized && normalized.length > 0 ? normalized : fallback;
  return selected.length <= 260 ? selected : `${selected.slice(0, 260)}\u2026`;
}
function collapseRepeatedTokens(value) {
  const tokens = value.split(/(\s+)/);
  let lastWord = "";
  let repeatCount = 0;
  return tokens.filter((token) => {
    if (/^\s+$/.test(token)) return true;
    if (token === lastWord) {
      repeatCount += 1;
    } else {
      lastWord = token;
      repeatCount = 1;
    }
    return repeatCount <= 3;
  }).join("").replace(/\s{2,}/g, " ").trim();
}
function aggregateDimensionReviews(dimensionSets, weights) {
  return SUBJECTIVE_DIMENSIONS.map((dimension) => {
    const items = dimensionSets.map((set, index) => ({
      item: set.find((c2) => c2.dimension === dimension),
      weight: weights[index] ?? 1
    }));
    const totalWeight = items.reduce((sum, e) => sum + e.weight, 0);
    const weightedScore = totalWeight === 0 ? 1 : items.reduce((sum, e) => sum + (e.item?.score ?? 1) * e.weight, 0) / totalWeight;
    const firstItem = items.find((e) => e.item)?.item;
    const mergedEvidence = items.map((e) => e.item?.evidence).filter((v) => Boolean(v)).slice(0, 2).join("\uFF1B");
    const confidence = totalWeight === 0 ? 0.58 : items.reduce((sum, e) => sum + (e.item?.confidence ?? 0.58) * e.weight, 0) / totalWeight;
    return {
      dimension,
      score: clampScore4(weightedScore),
      reason: firstItem?.reason ?? "\u5F53\u524D\u7ED3\u679C\u4E3A\u591A session \u805A\u5408\u540E\u7684\u8FD1\u4F3C\u8BC4\u4F30\u3002",
      evidence: mergedEvidence || "\u672A\u63D0\u53D6\u5230\u7A33\u5B9A\u8BC1\u636E\u3002",
      confidence: clampConfidence3(confidence)
    };
  });
}
function groupRowsBySession11(rows) {
  const grouped = /* @__PURE__ */ new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.sessionId)) grouped.set(row.sessionId, []);
    grouped.get(row.sessionId)?.push(row);
  });
  return grouped;
}

// src/pipeline/suggest.ts
function buildSuggestions(rows, objectiveMetrics, subjectiveMetrics) {
  const userQuestions = rows.filter((row) => row.isQuestion && row.role === "user").length;
  const empathy = subjectiveMetrics.dimensions.find((item) => item.dimension === "\u5171\u60C5\u7A0B\u5EA6")?.score ?? 1;
  const offTopicRisk = subjectiveMetrics.dimensions.find((item) => item.dimension === "\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669")?.score ?? 1;
  const interestDeclineRisk = subjectiveMetrics.signals.find((item) => item.signalKey === "interestDeclineRisk")?.severity ?? "low";
  const understandingBarrierRisk = subjectiveMetrics.signals.find((item) => item.signalKey === "understandingBarrierRisk")?.severity ?? "low";
  const goalCompletionTotal = subjectiveMetrics.goalCompletions.length;
  const achievedGoalCount = subjectiveMetrics.goalCompletions.filter((item) => item.status === "achieved").length;
  const failedGoalCount = subjectiveMetrics.goalCompletions.filter((item) => item.status === "failed").length;
  const goalCompletionRate = goalCompletionTotal ? Math.round(achievedGoalCount / goalCompletionTotal * 100) : 0;
  const completedRecoveryCount = subjectiveMetrics.recoveryTraces.filter((item) => item.status === "completed").length;
  const failedRecoveryCount = subjectiveMetrics.recoveryTraces.filter((item) => item.status === "failed").length;
  const avgGap = Math.round(objectiveMetrics.avgResponseGapSec);
  return [
    `P0\uFF1A\u5F53\u524D\u76EE\u6807\u8FBE\u6210\u7387\u4E3A ${goalCompletionRate}%\uFF0C\u5171\u6709 ${failedGoalCount} \u4E2A session \u660E\u786E\u672A\u8FBE\u6210\uFF0C\u5EFA\u8BAE\u4F18\u5148\u628A\u8FD9\u4E9B bad case \u7F16\u8BD1\u4E3A\u8C03\u4F18\u5305\u5E76\u52A0\u5165\u56DE\u653E\u56DE\u5F52\u3002`,
    `P0\uFF1A\u5E73\u5747\u54CD\u5E94\u95F4\u9694\u4E3A ${avgGap} \u79D2\uFF0C\u5EFA\u8BAE\u9996\u8F6E\u786E\u8BA4\u6027\u56DE\u590D\u538B\u7F29\u5230 20 \u79D2\u5185\uFF0C\u5E76\u76D1\u63A7\u957F\u95F4\u9694\u540E\u7684\u8FFD\u95EE\u7387\u53D8\u5316\u3002`,
    `P0\uFF1A\u5174\u8DA3\u8870\u51CF\u98CE\u9669\u4E3A ${interestDeclineRisk}\u3001\u7406\u89E3\u969C\u788D\u98CE\u9669\u4E3A ${understandingBarrierRisk}\uFF0C\u5EFA\u8BAE\u628A\u4FE1\u53F7\u5C42\u76F4\u63A5\u63A5\u5165\u7B56\u7565\u89E6\u53D1\u5668\u3002`,
    `P1\uFF1A\u5F53\u524D\u5171\u60C5\u7EF4\u5EA6\u5F97\u5206 ${empathy}/5\uFF0C\u5EFA\u8BAE\u7EE7\u7EED\u6C89\u6DC0 session \u7EA7\u8BC1\u636E\u7247\u6BB5\uFF0C\u63D0\u5347\u4E3B\u89C2\u8BC4\u4F30\u7684\u53EF\u89E3\u91CA\u6027\u3002`,
    `P1\uFF1A\u7B54\u975E\u6240\u95EE\u7EF4\u5EA6\u5F97\u5206 ${offTopicRisk}/5\uFF08\u5206\u8D8A\u9AD8\u8D8A\u597D\uFF09\uFF0C\u5EFA\u8BAE\u6267\u884C"\u5148\u56DE\u7B54\u3001\u518D\u6269\u5C55"\u7684\u56FA\u5B9A\u987A\u5E8F\uFF0C\u51CF\u5C11\u7528\u6237\u91CD\u590D\u63D0\u95EE\uFF08\u5F53\u524D ${userQuestions} \u6B21\uFF09\u3002`,
    `P1\uFF1A\u5F53\u524D\u8BC6\u522B\u5230 ${completedRecoveryCount} \u6761\u6210\u529F\u6062\u590D\u8F68\u8FF9\u3001${failedRecoveryCount} \u6761\u5931\u8D25\u6062\u590D\u8F68\u8FF9\uFF0C\u5EFA\u8BAE\u6C89\u6DC0\u6210\u529F\u4FEE\u590D\u8BDD\u672F\u5E76\u5BF9\u5931\u8D25\u7247\u6BB5\u751F\u6210 remediation spec\u3002`,
    `P2\uFF1A\u5F53\u524D\u6D41\u5931\u65AD\u70B9\u4E3B\u8981\u96C6\u4E2D\u5728\u7B2C ${getMostCommonDropoffTurn(objectiveMetrics)} \u8F6E\uFF0C\u5EFA\u8BAE\u5728\u8BE5\u8F6E\u6B21\u524D\u540E\u589E\u52A0\u4E3B\u52A8\u786E\u8BA4\u95EE\u53E5\u3002`,
    `P2\uFF1A\u5F53\u524D\u5171\u6709 ${userQuestions} \u6B21\u7528\u6237\u63D0\u95EE\uFF0C\u5EFA\u8BAE\u7EDF\u8BA1\u91CD\u590D\u63D0\u95EE fingerprint \u5E76\u7EB3\u5165 eval case \u5019\u9009\u3002`
  ];
}
function getMostCommonDropoffTurn(metrics) {
  const entries = Object.entries(metrics.dropoffTurnDistribution);
  if (entries.length === 0) return "\u672A\u77E5";
  return entries.reduce((maxEntry, curr) => curr[1] > maxEntry[1] ? curr : maxEntry)[0];
}

// src/pipeline/summary.ts
function buildSummaryCards(objectiveMetrics, subjectiveMetrics, sessionCount, messageCount, scenarioEvaluation, badCaseCount = 0, structuredTaskMetrics) {
  const empathyScore = subjectiveMetrics.dimensions.find((item) => item.dimension === "\u5171\u60C5\u7A0B\u5EA6")?.score ?? 0;
  const highRiskSignals = subjectiveMetrics.signals.filter((item) => item.severity === "high").length;
  const goalCompletionTotal = subjectiveMetrics.goalCompletions.length;
  const achievedGoalCount = subjectiveMetrics.goalCompletions.filter((item) => item.status === "achieved").length;
  const goalCompletionRate = goalCompletionTotal ? Math.round(achievedGoalCount / goalCompletionTotal * 100) : 0;
  const completedRecoveryCount = subjectiveMetrics.recoveryTraces.filter((item) => item.status === "completed").length;
  const failedRecoveryCount = subjectiveMetrics.recoveryTraces.filter((item) => item.status === "failed").length;
  const cards = [
    {
      key: "sessionCount",
      label: "\u4F1A\u8BDD\u89C4\u6A21",
      value: `${sessionCount}`,
      hint: `${messageCount} \u6761\u6D88\u606F\u8FDB\u5165\u672C\u6B21\u8BC4\u4F30`
    },
    {
      key: "responseGap",
      label: "\u5E73\u5747\u54CD\u5E94\u95F4\u9694",
      value: `${Math.round(objectiveMetrics.avgResponseGapSec)}s`,
      hint: "\u8D8A\u4F4E\u901A\u5E38\u610F\u5473\u7740\u66F4\u5E73\u987A\u7684\u4EA4\u4E92\u8282\u594F"
    },
    {
      key: "empathy",
      label: "\u5171\u60C5\u5F97\u5206",
      value: `${empathyScore}/5`,
      hint: "\u60C5\u7EEA\u5206\u4E0E\u5171\u60C5\u5206\u8054\u5408\u53CD\u6620\u4F53\u9A8C\u8D28\u91CF"
    },
    {
      key: "goalCompletion",
      label: "\u76EE\u6807\u8FBE\u6210\u7387",
      value: `${goalCompletionRate}%`,
      hint: goalCompletionTotal ? `${achievedGoalCount}/${goalCompletionTotal} \u4E2A session \u660E\u786E\u8FBE\u6210\u7528\u6237\u521D\u59CB\u76EE\u6807` : "\u7B49\u5F85 goal completion \u8BC4\u4F30\u7ED3\u679C"
    }
  ];
  if (scenarioEvaluation) {
    cards.push({
      key: "businessKpi",
      label: "\u4E1A\u52A1 KPI",
      value: `${Math.round(scenarioEvaluation.averageScore * 100)}%`,
      hint: `${scenarioEvaluation.displayName} \u7684\u4E1A\u52A1\u6620\u5C04\u5747\u5206`
    });
  }
  if (structuredTaskMetrics?.status === "ready") {
    cards.push({
      key: "structuredEval",
      label: "\u7ED3\u6784\u5316\u6807\u6CE8",
      value: `${structuredTaskMetrics.serviceCallCount}`,
      hint: `Service call ${structuredTaskMetrics.serviceCallCount} \u6B21\uFF0CSlot ${structuredTaskMetrics.slotMentionCount} \u4E2A\uFF0CState ${structuredTaskMetrics.dialogueStateCount} \u6761`
    });
    cards.push({
      key: "serviceGrounding",
      label: "\u8C03\u7528\u53C2\u6570\u8FFD\u6EAF",
      value: `${Math.round(structuredTaskMetrics.serviceCallGroundingRate * 100)}%`,
      hint: "service_call \u53C2\u6570\u662F\u5426\u80FD\u4ECE dialogue state \u4E2D\u8FFD\u6EAF"
    });
    if (structuredTaskMetrics.schemaServiceCount) {
      cards.push({
        key: "schemaCompliance",
        label: "Schema \u5408\u6CD5\u7387",
        value: `${Math.round((structuredTaskMetrics.schemaSlotCoverageRate ?? 0) * 100)}%`,
        hint: `${structuredTaskMetrics.schemaServiceCount} \u4E2A service schema\uFF0C\u672A\u77E5 slot ${structuredTaskMetrics.unknownSlotReferenceCount ?? 0} \u4E2A`
      });
    }
  }
  if (badCaseCount > 0) {
    cards.push({
      key: "badCaseCount",
      label: "Bad Case",
      value: `${badCaseCount}`,
      hint: "\u5DF2\u8BC6\u522B\u53EF\u6C89\u6DC0\u8FDB\u6848\u4F8B\u6C60\u7684\u5931\u8D25 session"
    });
  }
  cards.push(
    {
      key: "recoveryTrace",
      label: "\u6062\u590D\u8F68\u8FF9",
      value: `${completedRecoveryCount}`,
      hint: completedRecoveryCount || failedRecoveryCount ? `\u5B8C\u6210\u6062\u590D ${completedRecoveryCount} \u6761\uFF0C\u672A\u6062\u590D ${failedRecoveryCount} \u6761` : "\u5F53\u524D\u5C1A\u672A\u8BC6\u522B\u5230\u660E\u663E\u7684\u5931\u8D25\u540E\u6062\u590D\u5F27\u7EBF"
    },
    {
      key: "signals",
      label: "\u9AD8\u98CE\u9669\u4FE1\u53F7",
      value: `${highRiskSignals}`,
      hint: "\u6765\u81EA\u9690\u5F0F\u63A8\u65AD\u4FE1\u53F7\u5C42\u7684\u9AD8\u98CE\u9669\u9879\u6570\u91CF"
    }
  );
  return cards;
}

// src/scenarios/toB-customer-support.ts
var TOB_CUSTOMER_SUPPORT_SCENARIO = {
  scenarioId: "toB-customer-support",
  displayName: "ToB \u5BA2\u670D Agent",
  evaluationMetrics: [
    {
      id: "goal_completion_dag",
      displayName: "\u76EE\u6807\u8FBE\u6210 DAG",
      description: "\u6309\u7406\u89E3\u76EE\u6807\u3001\u627F\u63A5\u52A8\u4F5C\u3001\u89E3\u51B3\u8BC1\u636E\u4E09\u6B65\u5224\u65AD\u7528\u6237\u76EE\u6807\u662F\u5426\u8FBE\u6210\u3002",
      kind: "llm_dag",
      scope: "session",
      threshold: 0.7,
      direction: "higher-is-better",
      requiredFields: ["turns"],
      criteria: "\u7528\u6237\u521D\u59CB\u95EE\u9898\u662F\u5426\u88AB assistant \u5B8C\u6574\u7406\u89E3\u3001\u627F\u63A5\u5E76\u63A8\u8FDB\u5230\u89E3\u51B3\u6001\u3002",
      evaluationSteps: [
        "\u8BC6\u522B\u7528\u6237\u5728\u9996\u4E24\u8F6E\u4E2D\u7684\u6838\u5FC3\u76EE\u6807\u3002",
        "\u5224\u65AD assistant \u662F\u5426\u56F4\u7ED5\u8BE5\u76EE\u6807\u7ED9\u51FA\u5177\u4F53\u5904\u7406\u52A8\u4F5C\u3002",
        "\u5224\u65AD\u4F1A\u8BDD\u672B\u5C3E\u662F\u5426\u51FA\u73B0\u89E3\u51B3\u3001\u8F6C\u4EA4\u3001\u660E\u786E\u4E0B\u4E00\u6B65\u6216\u5931\u8D25\u8BF4\u660E\u3002"
      ],
      fallback: "rule_proxy",
      mapsToMetricId: "goalCompletion"
    },
    {
      id: "empathy_geval",
      displayName: "\u5171\u60C5\u8D28\u91CF G-Eval",
      description: "\u8BC4\u4F30\u5BA2\u670D\u662F\u5426\u5148\u63A5\u4F4F\u7528\u6237\u60C5\u7EEA\uFF0C\u518D\u8FDB\u5165\u95EE\u9898\u5904\u7406\u3002",
      kind: "llm_geval",
      scope: "session",
      threshold: 0.68,
      direction: "higher-is-better",
      requiredFields: ["turns"],
      criteria: "assistant \u662F\u5426\u8BC6\u522B\u7528\u6237\u60C5\u7EEA\u3001\u907F\u514D\u8BF4\u6559\uFF0C\u5E76\u7528\u6E05\u6670\u52A8\u4F5C\u964D\u4F4E\u7528\u6237\u7126\u8651\u3002",
      evaluationSteps: [
        "\u68C0\u67E5 assistant \u662F\u5426\u627F\u8BA4\u7528\u6237\u5904\u5883\u6216\u60C5\u7EEA\u3002",
        "\u68C0\u67E5\u662F\u5426\u907F\u514D\u673A\u68B0\u6A21\u677F\u3001\u63A8\u8D23\u548C\u538B\u8FEB\u5F0F\u8868\u8FBE\u3002",
        "\u68C0\u67E5\u5171\u60C5\u4E4B\u540E\u662F\u5426\u7ED9\u51FA\u53EF\u6267\u884C\u5904\u7406\u8DEF\u5F84\u3002"
      ],
      fallback: "rule_proxy",
      mapsToMetricId: "empathy"
    },
    {
      id: "handoff_risk_rule",
      displayName: "\u5347\u7EA7\u98CE\u9669\u89C4\u5219",
      description: "\u57FA\u4E8E\u6295\u8BC9\u3001\u8F6C\u4EBA\u5DE5\u3001\u4E3B\u7BA1\u7B49\u5173\u952E\u8BCD\u5224\u65AD\u5347\u7EA7\u5931\u63A7\u98CE\u9669\u3002",
      kind: "rule",
      scope: "dataset",
      threshold: 0.72,
      direction: "higher-is-better",
      requiredFields: ["turns"],
      evaluationSteps: [
        "\u7EDF\u8BA1\u5347\u7EA7\u76F8\u5173\u5173\u952E\u8BCD\u547D\u4E2D\u7387\u3002",
        "\u7ED3\u5408\u60C5\u7EEA\u6062\u590D\u5931\u8D25\u4FE1\u53F7\u5224\u65AD\u662F\u5426\u9700\u8981\u4EBA\u5DE5\u4ECB\u5165\u3002"
      ],
      fallback: "skip",
      mapsToMetricId: "offTopicRisk"
    },
    {
      id: "tool_grounding_structured",
      displayName: "\u5DE5\u5177\u8C03\u7528\u8BC1\u636E\u94FE",
      description: "\u5F53\u5B58\u5728 service_call/service_results \u65F6\uFF0C\u9A8C\u8BC1\u8C03\u7528\u53C2\u6570\u548C\u7ED3\u679C\u662F\u5426\u53EF\u8FFD\u6EAF\u3002",
      kind: "structured",
      scope: "trace",
      threshold: 0.85,
      direction: "higher-is-better",
      requiredFields: ["state", "service_call", "service_results"],
      evaluationSteps: [
        "\u68C0\u67E5 service_call \u53C2\u6570\u662F\u5426\u6765\u81EA\u6B64\u524D state\u3002",
        "\u68C0\u67E5 service_results \u662F\u5426\u80FD\u652F\u6491 assistant \u7684\u540E\u7EED\u56DE\u590D\u3002"
      ],
      fallback: "skip",
      mapsToMetricId: "serviceCallGrounding"
    }
  ],
  syntheticCaseSeeds: [
    {
      id: "angry-escalation-risk",
      userPersona: "\u9AD8\u4EF7\u503C\u4F01\u4E1A\u5BA2\u6237\u7BA1\u7406\u5458\uFF0C\u5DF2\u7ECF\u591A\u6B21\u53CD\u9988\u540C\u4E00\u6545\u969C\u3002",
      situation: "\u7528\u6237\u5F3A\u70C8\u8981\u6C42\u7ACB\u523B\u89E3\u51B3\uFF0C\u5426\u5219\u5347\u7EA7\u6295\u8BC9\u5E76\u8F6C\u4EBA\u5DE5\u3002",
      expectedFailureMode: "assistant \u53EA\u7ED9\u6A21\u677F\u5316\u5B89\u629A\uFF0C\u6CA1\u6709\u627F\u63A5\u5347\u7EA7\u98CE\u9669\uFF0C\u4E5F\u6CA1\u6709\u7ED9\u51FA\u660E\u786E\u5904\u7406\u8DEF\u5F84\u3002",
      targetMetrics: ["empathy_geval", "goal_completion_dag", "handoff_risk_rule"]
    },
    {
      id: "ambiguous-problem-description",
      userPersona: "\u9996\u6B21\u4F7F\u7528\u4EA7\u54C1\u7684\u65B0\u5BA2\u6237\uFF0C\u65E0\u6CD5\u51C6\u786E\u63CF\u8FF0\u95EE\u9898\u3002",
      situation: "\u7528\u6237\u53EA\u8BF4\u201C\u7CFB\u7EDF\u53C8\u574F\u4E86\u201D\uFF0C\u7F3A\u5C11\u8D26\u53F7\u3001\u9875\u9762\u3001\u9519\u8BEF\u7801\u7B49\u4FE1\u606F\u3002",
      expectedFailureMode: "assistant \u6CA1\u6709\u8FFD\u95EE\u5173\u952E\u8BCA\u65AD\u4FE1\u606F\uFF0C\u76F4\u63A5\u7ED9\u6CDB\u5316\u5EFA\u8BAE\u3002",
      targetMetrics: ["goal_completion_dag", "empathy_geval"]
    },
    {
      id: "tool-result-ignored",
      userPersona: "\u6B63\u5728\u7B49\u5F85\u5DE5\u5355\u5904\u7406\u8FDB\u5EA6\u7684\u5BA2\u6237\u3002",
      situation: "\u5DE5\u5177\u8FD4\u56DE\u5DF2\u6709\u5DE5\u5355\u548C\u9884\u8BA1\u5B8C\u6210\u65F6\u95F4\uFF0C\u4F46 assistant \u6CA1\u6709\u5F15\u7528\u7ED3\u679C\u3002",
      expectedFailureMode: "assistant \u56DE\u590D\u4E0E service_results \u4E0D\u4E00\u81F4\u6216\u7F3A\u5C11\u8BC1\u636E\u652F\u6491\u3002",
      targetMetrics: ["tool_grounding_structured", "goal_completion_dag"]
    }
  ],
  businessKpis: [
    {
      id: "resolution_rate",
      displayName: "\u4E00\u6B21\u89E3\u51B3\u7387",
      description: "\u7528\u6237\u95EE\u9898\u662F\u5426\u5728\u5F53\u6B21\u4F1A\u8BDD\u5185\u88AB\u627F\u63A5\u5E76\u8FDB\u5165\u89E3\u51B3\u6001\u3002",
      direction: "higher-is-better",
      mappedTo: {
        primary: [
          { source: "subjective", metricId: "goalCompletion", weight: 0.5 },
          { source: "objective", metricId: "agentResolutionSignalRate", weight: 0.3 },
          { source: "objective", metricId: "userQuestionRepeatRate", weight: -0.2 }
        ],
        secondary: [{ source: "signal", metricId: "understandingBarrierRisk", weight: -0.2 }]
      },
      successThreshold: 0.75,
      degradedThreshold: 0.5
    },
    {
      id: "escalation_control",
      displayName: "\u5347\u7EA7\u63A7\u5236\u529B",
      description: "\u7528\u6237\u662F\u5426\u88AB\u53CA\u65F6\u63A5\u4F4F\uFF0C\u907F\u514D\u6295\u8BC9\u3001\u8F6C\u4EBA\u5DE5\u6216\u5BF9\u8BDD\u5931\u63A7\u3002",
      direction: "higher-is-better",
      mappedTo: {
        primary: [
          { source: "objective", metricId: "escalationKeywordHitRate", weight: -0.45 },
          { source: "subjective", metricId: "offTopicRisk", weight: 0.35 },
          { source: "signal", metricId: "emotionRecoveryFailureRisk", weight: -0.2 }
        ],
        secondary: [{ source: "objective", metricId: "avgResponseGapSec", weight: -0.1 }]
      },
      successThreshold: 0.72,
      degradedThreshold: 0.48
    },
    {
      id: "service_efficiency",
      displayName: "\u670D\u52A1\u6548\u7387",
      description: "\u56DE\u590D\u8282\u594F\u3001\u4E3B\u9898\u8FDE\u8D2F\u6027\u4E0E\u6536\u655B\u6548\u7387\u662F\u5426\u8FBE\u5230\u4E1A\u52A1\u53EF\u63A5\u53D7\u6C34\u5E73\u3002",
      direction: "higher-is-better",
      mappedTo: {
        primary: [
          { source: "objective", metricId: "avgResponseGapSec", weight: -0.35 },
          { source: "objective", metricId: "topicSwitchRate", weight: -0.25 },
          { source: "objective", metricId: "agentResolutionSignalRate", weight: 0.2 }
        ],
        secondary: [
          { source: "signal", metricId: "understandingBarrierRisk", weight: -0.1 },
          { source: "subjective", metricId: "empathy", weight: 0.1 }
        ]
      },
      successThreshold: 0.7,
      degradedThreshold: 0.45
    }
  ],
  onboardingQuestions: [
    {
      id: "primary_channel",
      question: "\u8FD9\u6279\u6570\u636E\u6765\u81EA Web / App / \u7535\u8BDD\u54EA\u79CD\u6E20\u9053\uFF1F"
    },
    {
      id: "has_human_handoff",
      question: "\u5BF9\u8BDD\u6D41\u91CC\u662F\u5426\u5B58\u5728\u8F6C\u4EBA\u5DE5\u5206\u652F\uFF1F\u82E5\u6709\uFF0C\u6807\u8BB0\u5B57\u6BB5\u540D\u662F\u4EC0\u4E48\uFF1F"
    },
    {
      id: "resolution_field",
      question: "\u539F\u59CB\u6570\u636E\u91CC\u662F\u5426\u5DF2\u6709\u201C\u95EE\u9898\u662F\u5426\u89E3\u51B3\u201D\u7684\u5B57\u6BB5\uFF1F\u5B57\u6BB5\u540D\u662F\u4EC0\u4E48\uFF1F"
    }
  ]
};

// src/scenarios/index.ts
var BUILTIN_SCENARIO_TEMPLATES = [TOB_CUSTOMER_SUPPORT_SCENARIO];
var SCENARIO_OPTIONS = BUILTIN_SCENARIO_TEMPLATES.map((item) => ({
  scenarioId: item.scenarioId,
  displayName: item.displayName,
  onboardingQuestions: item.onboardingQuestions,
  evaluationMetrics: item.evaluationMetrics ?? [],
  syntheticCaseSeeds: item.syntheticCaseSeeds ?? []
}));
function getScenarioTemplateById(scenarioId) {
  return BUILTIN_SCENARIO_TEMPLATES.find((item) => item.scenarioId === scenarioId) ?? null;
}

// src/pipeline/evaluateRun.ts
async function runEvaluatePipeline(rawRows, options) {
  const warnings = [];
  const judgeRequired = options.judgeRequired ?? options.useLlm;
  const enableDynamicReplay = options.enableDynamicReplay ?? false;
  if (!rawRows.every((row) => Boolean(row.timestamp))) {
    warnings.push("\u68C0\u6D4B\u5230\u7F3A\u5931 timestamp\uFF0C\u90E8\u5206\u65F6\u5E8F\u6307\u6807\u5DF2\u964D\u7EA7\u3002");
  }
  if (judgeRequired && !options.useLlm) {
    throw new Error("LLM Judge \u662F\u5F53\u524D\u8BC4\u4F30\u7684\u5F3A\u4F9D\u8D56\uFF0C\u4F46\u672C\u6B21\u8BF7\u6C42\u5173\u95ED\u4E86 useLlm\u3002");
  }
  if (enableDynamicReplay && !options.agentApiEndpoint) {
    throw new Error("enableDynamicReplay=true \u65F6\u5FC5\u987B\u63D0\u4F9B agentApiEndpoint\u3002");
  }
  const { enrichedRows } = runEvaluateStageSync(
    options,
    "parse",
    "\u89E3\u6790\u6570\u636E",
    () => enrichRows(rawRows)
  );
  const enrichedCsv = toEnrichedCsv(enrichedRows);
  const evalCaseBundle = buildEvalCaseBundle(enrichedRows, options.structuredTaskMetrics, options.trace);
  const extendedInputs = options.extendedInputs ?? {};
  const hasAnyExtendedInput = Boolean(
    extendedInputs.retrievalContexts?.length || extendedInputs.toolCalls?.length || extendedInputs.retentionFacts?.length || extendedInputs.roleProfile
  );
  const [objectiveMetrics, subjectiveMetrics, extendedMetrics] = await Promise.all([
    runEvaluateStage(options, "objective", "\u5BA2\u89C2\u6307\u6807", () => buildObjectiveMetrics(enrichedRows)),
    runEvaluateStage(
      options,
      "subjective",
      "\u4E3B\u89C2\u6307\u6807",
      () => buildSubjectiveMetrics(enrichedRows, options.useLlm, options.runId, { judgeRequired })
    ),
    runEvaluateStage(
      options,
      "extended",
      "\u6269\u5C55\u6307\u6807",
      () => hasAnyExtendedInput ? buildExtendedMetrics({ ...extendedInputs, useLlm: options.useLlm, runId: options.runId }) : Promise.resolve(void 0)
    )
  ]);
  const scenarioTemplate = options.scenarioId ? getScenarioTemplateById(options.scenarioId) : null;
  if (options.scenarioId && !scenarioTemplate) {
    warnings.push(`\u672A\u627E\u5230\u573A\u666F\u6A21\u677F\uFF1A${options.scenarioId}\uFF0C\u672C\u6B21\u6309\u901A\u7528\u8BC4\u4F30\u8FD4\u56DE\u3002`);
  }
  const scenarioEvaluation = scenarioTemplate ? evaluateScenarioTemplate(scenarioTemplate, {
    rows: enrichedRows,
    objectiveMetrics,
    subjectiveMetrics
  }) : null;
  const metricRegistry = buildMetricRegistrySnapshot({
    objectiveMetrics,
    subjectiveMetrics,
    structuredTaskMetrics: options.structuredTaskMetrics,
    trace: options.trace,
    capabilities: evalCaseBundle.capabilityReport,
    scenarioEvaluation,
    scenarioTemplate
  });
  const badCaseAssets = await runEvaluateStage(
    options,
    "badcase",
    "bad case \u62BD\u53D6",
    () => buildBadCaseAssets(enrichedRows, objectiveMetrics, subjectiveMetrics, {
      runId: options.runId,
      scenarioId: options.scenarioId
    })
  );
  const { charts, suggestions, summaryCards } = await runEvaluateStage(
    options,
    "complete",
    "\u56FE\u8868\u4E0E\u5EFA\u8BAE",
    async () => ({
      charts: buildChartPayloads(enrichedRows),
      suggestions: buildSuggestions(enrichedRows, objectiveMetrics, subjectiveMetrics),
      summaryCards: buildSummaryCards(
        objectiveMetrics,
        subjectiveMetrics,
        new Set(rawRows.map((row) => row.sessionId)).size,
        rawRows.length,
        scenarioEvaluation,
        badCaseAssets.length,
        options.structuredTaskMetrics
      )
    })
  );
  let dynamicReplayStatus = "skipped";
  let intentSequences = null;
  let intentRunLogsBySession = null;
  let intentMetrics = null;
  if (enableDynamicReplay && options.agentApiEndpoint) {
    try {
      const extracted = await runEvaluateStage(
        options,
        "parse",
        "\u610F\u56FE\u5E8F\u5217\u63D0\u53D6",
        () => extractIntentSequences(enrichedRows, options.useLlm, options.runId)
      );
      if (extracted.length === 0) {
        dynamicReplayStatus = "failed";
        warnings.push("\u610F\u56FE\u5E8F\u5217\u63D0\u53D6\u672A\u4EA7\u51FA\u4EFB\u4F55\u7ED3\u679C\uFF0Cdynamic replay \u8DF3\u8FC7\u3002");
      } else {
        intentSequences = extracted;
        const runLogs = await runEvaluateStage(
          options,
          "subjective",
          "SimUser \u56DE\u653E",
          () => runSimUserReplay(extracted, enrichedRows, options.useLlm, {
            agentApiEndpoint: options.agentApiEndpoint,
            runId: options.runId
          })
        );
        intentRunLogsBySession = runLogs;
        intentMetrics = computeIntentMetrics(runLogs, extracted, enrichedRows);
        const successfulSessions = runLogs.filter((s) => s.length > 0).length;
        dynamicReplayStatus = successfulSessions === extracted.length ? "completed" : successfulSessions > 0 ? "partial" : "failed";
      }
    } catch (error) {
      dynamicReplayStatus = "failed";
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Dynamic replay \u5931\u8D25\uFF1A${msg}`);
      console.error("[evaluateRun] Dynamic replay pipeline failed:", error);
    }
  }
  if (subjectiveMetrics.status !== "ready" && !judgeRequired) {
    warnings.push("\u4E3B\u89C2\u8BC4\u4F30\u5F53\u524D\u4E3A\u964D\u7EA7\u6A21\u5F0F\uFF08LLM judge \u8C03\u7528\u5931\u8D25\u6216\u672A\u542F\u7528\uFF09\u3002");
  }
  let artifactPath;
  if (options.persistArtifact ?? Boolean(options.artifactBaseName)) {
    const artifactBaseName = sanitizeArtifactBaseName(options.artifactBaseName ?? options.runId);
    const artifactDirectory = import_node_path8.default.join("mock-chatlog", "enriched-data");
    artifactPath = import_node_path8.default.join(artifactDirectory, `${artifactBaseName}.enriched.csv`);
    await (0, import_promises5.mkdir)(artifactDirectory, { recursive: true });
    await (0, import_promises5.writeFile)(artifactPath, enrichedCsv, "utf8");
  }
  const response = {
    runId: options.runId,
    meta: {
      sessions: new Set(rawRows.map((row) => row.sessionId)).size,
      messages: rawRows.length,
      hasTimestamp: rawRows.every((row) => Boolean(row.timestamp)),
      generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
      warnings,
      scenarioContext: options.scenarioContext
    },
    summaryCards,
    enrichedRows,
    enrichedCsv,
    artifactPath,
    objectiveMetrics,
    subjectiveMetrics,
    structuredTaskMetrics: options.structuredTaskMetrics,
    trace: options.trace,
    evalCaseBundle,
    metricRegistry,
    scenarioEvaluation,
    badCaseAssets,
    extendedMetrics,
    charts,
    suggestions,
    dynamicReplayStatus,
    intentMetrics,
    intentSequences,
    intentRunLogs: intentRunLogsBySession
  };
  return response;
}
function runEvaluateStageSync(options, stage, label, operation) {
  emitProgress(options, { type: "stage", stage, status: "running", message: `${label}\u8FDB\u884C\u4E2D` });
  try {
    const result2 = operation();
    emitProgress(options, { type: "stage", stage, status: "done", message: `${label}\u5B8C\u6210` });
    return result2;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emitProgress(options, { type: "stage", stage, status: "failed", message: `${label}\u5931\u8D25`, detail });
    throw error;
  }
}
async function runEvaluateStage(options, stage, label, operation) {
  emitProgress(options, { type: "stage", stage, status: "running", message: `${label}\u8FDB\u884C\u4E2D` });
  try {
    const result2 = await operation();
    emitProgress(options, { type: "stage", stage, status: "done", message: `${label}\u5B8C\u6210` });
    return result2;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emitProgress(options, { type: "stage", stage, status: "failed", message: `${label}\u5931\u8D25`, detail });
    throw error;
  }
}
function emitProgress(options, event) {
  try {
    options.onProgress?.(event);
  } catch (error) {
    console.warn(
      `[EVALUATE] progress callback failed: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}
function sanitizeArtifactBaseName(value) {
  return value.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "enriched-artifact";
}

// src/cli/commands/evaluate.ts
function registerEvaluateCommand(program2) {
  program2.command("evaluate <file>").alias("eval").description("Run the full evaluation pipeline on a chatlog file").option("--run-id <id>", "Custom run ID (auto-generated when omitted)").option("--format <fmt>", "File format: csv | json | jsonl | txt | md").option("--no-llm", "Skip LLM judge \u2014 fast mode, objective metrics only").option("--persist", "Save evaluate result to eval-runs/ (default: on)", true).option("--no-persist", "Skip saving the result artifact").option("--harvest", "Auto-harvest bad cases into the dataset pool after evaluation").option("--baseline-version <ver>", "Baseline version tag for harvested cases", "cli").option("--project-id <id>", "Project ID (overrides ZEVAL_PROJECT_ID env var)").action(async (file, opts) => {
    header("Zeval Evaluate");
    kv("file", file);
    kv("useLlm", String(opts.llm));
    kv("persist", String(opts.persist));
    if (opts.harvest) kv("auto-harvest", "true");
    let text;
    try {
      text = await (0, import_promises6.readFile)(file, "utf8");
    } catch {
      err(`Cannot read file: ${file}`);
      process.exit(1);
    }
    const fileName = (0, import_node_path9.basename)(file);
    const format = opts.format ?? inferFormatFromFileName(fileName);
    const rawRows = parseByFormat(text, format, fileName);
    if (rawRows.length === 0) {
      err("No rows parsed \u2014 check the file format or column names (sessionId, role, content required).");
      process.exit(1);
    }
    const { rows, report } = redactRawRows(rawRows);
    if (report.redactedFields > 0) {
      warn(`PII redacted: ${report.redactedFields} fields (${report.categories.join(", ")})`);
    }
    const sessions = new Set(rows.map((r) => r.sessionId)).size;
    console.log();
    kv("format", format);
    kv("rows", rows.length);
    kv("sessions", sessions);
    console.log();
    const runId = opts.runId ?? `run_${Date.now()}`;
    kv("run-id", runId);
    console.log();
    const spinner = createSpinner("Running evaluation pipeline\u2026");
    let lastStage = "";
    const result2 = await runEvaluatePipeline(rows, {
      runId,
      useLlm: opts.llm,
      persistArtifact: false,
      onProgress: (event) => {
        if (event.stage !== lastStage) {
          lastStage = event.stage;
          spinner.update(`${event.label ?? event.stage}\u2026`);
        }
      }
    }).catch((e) => {
      spinner.fail(`Pipeline error: ${e.message}`);
      process.exit(1);
    });
    spinner.succeed(`Evaluation complete`);
    header("Results");
    const obj = result2.objectiveMetrics;
    const subj = result2.subjectiveMetrics;
    table([
      ["sessions", result2.meta.sessions],
      ["messages", result2.meta.messages],
      ["bad cases detected", result2.badCaseAssets?.length ?? 0],
      [""],
      ["\u2500\u2500\u2500 Objective \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", ""],
      ["avg response gap (s)", obj.avgResponseGapSec?.toFixed(2) ?? "\u2014"],
      ["user repeat rate", `${((obj.userQuestionRepeatRate ?? 0) * 100).toFixed(1)}%`],
      ["agent resolution rate", `${((obj.agentResolutionSignalRate ?? 0) * 100).toFixed(1)}%`],
      ["escalation hit rate", `${((obj.escalationKeywordHitRate ?? 0) * 100).toFixed(1)}%`],
      [""],
      ["\u2500\u2500\u2500 Subjective \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", ""],
      ["dimensions evaluated", subj?.dimensions?.length ?? 0],
      ["implicit signals", subj?.signals?.length ?? 0],
      ["goal completions", subj?.goalCompletions?.length ?? 0],
      [""],
      ["warnings", result2.meta.warnings.length]
    ]);
    for (const w of result2.meta.warnings) warn(w);
    if (opts.persist) {
      console.log();
      const s2 = createSpinner("Saving result artifact\u2026");
      const savedPath = await persistEvaluateResult(result2).catch(() => null);
      if (savedPath) {
        s2.succeed(`Saved \u2192 ${savedPath}`);
      } else {
        s2.fail("Failed to persist result");
      }
    }
    if (opts.harvest) {
      console.log();
      header("Auto-Harvest");
      const s3 = createSpinner("Running five-channel admission pipeline\u2026");
      const store = createDatasetStore();
      const admission = await harvestBadCasesToDataset({
        store,
        evaluate: result2,
        baselineVersion: opts.baselineVersion,
        allowNearDuplicate: false,
        tnSampleRate: 0.05,
        humanSamplingRate: 1
      }).catch((e) => {
        s3.fail(`Harvest error: ${e.message}`);
        process.exit(1);
      });
      s3.succeed("Harvest complete");
      const LABELS = {
        auto_tp: "TP (true positive)",
        auto_fn: "FN (missed bad case)",
        auto_tn: "TN (gold positive)",
        auto_uncertainty: "Uncertainty",
        auto_disagreement: "Disagreement"
      };
      kv("total accepted", admission.savedCount);
      kv("skipped (duplicates)", admission.skippedCount);
      for (const [src, n] of Object.entries(admission.acceptedBySource ?? {})) {
        if ((n ?? 0) > 0) kv(`  ${LABELS[src] ?? src}`, n);
      }
    }
    console.log();
    ok(`Done. Run ID: ${c.bold(runId)}`);
    console.log(`  ${c.dim("Next: ")} zeval runs show ${runId}`);
    if (opts.persist && !opts.harvest) {
      console.log(`  ${c.dim("Or:  ")} zeval harvest --run-id ${runId}`);
    }
    console.log();
  });
}

// src/cli/commands/harvest.ts
var CHANNEL_LABELS = {
  auto_tp: "TP (true positive bad case)",
  auto_fn: "FN (missed detection)",
  auto_tn: "TN (gold positive)",
  auto_uncertainty: "Uncertainty / boundary case",
  auto_disagreement: "Disagreement across judges"
};
function registerHarvestCommand(program2) {
  program2.command("harvest").description("Admit bad cases from a saved evaluate run into the dataset pool").requiredOption("--run-id <id>", "Run ID of the saved evaluate result").option("--baseline-version <ver>", "Baseline version tag stamped on admitted cases", "cli").option("--near-duplicate", "Allow near-duplicate cases (default: reject)", false).option("--tn-sample-rate <rate>", "TN channel random-sampling rate 0\u20131 (default: 0.05)", "0.05").option("--human-sampling-rate <rate>", "Fraction of TP/TN requiring human review 0\u20131 (default: 1.0)", "1.0").option("--capability-dimension <dim>", "Capability dimension tag applied to all admitted cases").action(async (opts) => {
    header("Zeval Harvest");
    kv("run-id", opts.runId);
    const spinner = createSpinner("Loading saved evaluate result\u2026");
    const evaluate = await readPersistedEvaluateResult(opts.runId).catch(() => null);
    if (!evaluate) {
      spinner.fail(`Run not found: ${opts.runId}`);
      err(`No artifact for "${opts.runId}". Run ${c.bold("zeval runs list")} to see available runs.`);
      process.exit(1);
    }
    spinner.succeed(`Loaded run: ${opts.runId}`);
    kv("sessions", evaluate.meta.sessions);
    kv("bad cases", evaluate.badCaseAssets?.length ?? 0);
    console.log();
    const spinner2 = createSpinner("Running five-channel admission pipeline\u2026");
    const store = createDatasetStore();
    const admission = await harvestBadCasesToDataset({
      store,
      evaluate,
      baselineVersion: opts.baselineVersion,
      allowNearDuplicate: opts.nearDuplicate,
      tnSampleRate: parseFloat(opts.tnSampleRate),
      humanSamplingRate: parseFloat(opts.humanSamplingRate),
      capabilityDimension: opts.capabilityDimension
    }).catch((e) => {
      spinner2.fail(`Admission pipeline error: ${e.message}`);
      process.exit(1);
    });
    spinner2.succeed("Admission pipeline complete");
    header("Admission Results");
    kv("total accepted", admission.savedCount);
    kv("skipped (duplicates)", admission.skippedCount);
    if ((admission.humanReviewQueueCount ?? 0) > 0) {
      kv("queued for human review", admission.humanReviewQueueCount);
    }
    const bySource = admission.acceptedBySource ?? {};
    const hasBreakdown = Object.values(bySource).some((n) => (n ?? 0) > 0);
    if (hasBreakdown) {
      console.log();
      for (const [src, n] of Object.entries(bySource)) {
        if ((n ?? 0) > 0) {
          kv(`  ${CHANNEL_LABELS[src] ?? src}`, n);
        }
      }
    }
    if (admission.savedCount === 0) {
      console.log();
      warn("No cases admitted \u2014 all candidates may be duplicates or filtered out.");
    }
    console.log();
    ok(`Harvest complete. ${c.bold(String(admission.savedCount))} case(s) added to the pool.`);
    console.log(`  ${c.dim("Next: ")} zeval package --run-id ${opts.runId}`);
    console.log();
  });
}

// src/remediation/file-system-package-store.ts
var import_promises7 = require("fs/promises");
var import_node_path10 = __toESM(require("path"));
var REMEDIATION_ROOT = import_node_path10.default.join("artifacts", "remediation-packages");
var FileSystemRemediationPackageStore = class {
  /**
   * @inheritdoc
   */
  async save(snapshot) {
    const packageDirectory = import_node_path10.default.join(REMEDIATION_ROOT, sanitizePackageId(snapshot.packageId));
    const skillDirectory = snapshot.skillBundle ? import_node_path10.default.join(REMEDIATION_ROOT, sanitizePackageId(snapshot.skillBundle.folderName)) : packageDirectory;
    const referenceDirectory = import_node_path10.default.join(skillDirectory, "reference");
    await (0, import_promises7.mkdir)(referenceDirectory, { recursive: true });
    if (snapshot.skillBundle) {
      await Promise.all(
        snapshot.skillBundle.files.map(
          (file) => (0, import_promises7.writeFile)(import_node_path10.default.join(REMEDIATION_ROOT, import_node_path10.default.relative(REMEDIATION_ROOT, file.relativePath)), file.content, "utf8")
        )
      );
    } else {
      await Promise.all(
        snapshot.files.map(
          (file) => (0, import_promises7.writeFile)(import_node_path10.default.join(packageDirectory, file.fileName), file.content, "utf8")
        )
      );
    }
    await (0, import_promises7.mkdir)(packageDirectory, { recursive: true });
    await (0, import_promises7.writeFile)(import_node_path10.default.join(packageDirectory, "manifest.json"), `${JSON.stringify(snapshot, null, 2)}
`, "utf8");
    if (skillDirectory !== packageDirectory) {
      await (0, import_promises7.writeFile)(import_node_path10.default.join(skillDirectory, "manifest.json"), `${JSON.stringify(snapshot, null, 2)}
`, "utf8");
    }
  }
  /**
   * @inheritdoc
   */
  async list() {
    let names = [];
    try {
      names = await (0, import_promises7.readdir)(REMEDIATION_ROOT);
    } catch {
      return [];
    }
    const rows = [];
    for (const name of names) {
      const manifestPath = import_node_path10.default.join(REMEDIATION_ROOT, name, "manifest.json");
      try {
        const [raw, fileStat] = await Promise.all([(0, import_promises7.readFile)(manifestPath, "utf8"), (0, import_promises7.stat)(manifestPath)]);
        const parsed = JSON.parse(raw);
        rows.push({
          packageId: parsed.packageId,
          createdAt: parsed.createdAt,
          runId: parsed.runId,
          title: parsed.title,
          priority: parsed.priority,
          scenarioId: parsed.scenarioId,
          selectedCaseCount: parsed.selectedCaseCount,
          artifactDir: parsed.artifactDir,
          skillFolder: parsed.skillFolder,
          mtimeMs: fileStat.mtimeMs
        });
      } catch {
        continue;
      }
    }
    rows.sort((left, right) => right.mtimeMs - left.mtimeMs);
    const deduped = /* @__PURE__ */ new Map();
    for (const row of rows) {
      if (!deduped.has(row.packageId)) {
        deduped.set(row.packageId, row);
      }
    }
    return [...deduped.values()].map((row) => ({
      packageId: row.packageId,
      createdAt: row.createdAt,
      runId: row.runId,
      title: row.title,
      priority: row.priority,
      scenarioId: row.scenarioId,
      selectedCaseCount: row.selectedCaseCount,
      artifactDir: row.artifactDir,
      skillFolder: row.skillFolder
    }));
  }
  /**
   * @inheritdoc
   */
  async read(packageId) {
    const manifestPath = import_node_path10.default.join(REMEDIATION_ROOT, sanitizePackageId(packageId), "manifest.json");
    try {
      const raw = await (0, import_promises7.readFile)(manifestPath, "utf8");
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
};
function sanitizePackageId(packageId) {
  return packageId.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "remediation-package";
}

// src/remediation/builder.ts
var import_node_crypto3 = require("crypto");

// src/remediation/yaml.ts
function renderYamlDocument(value) {
  const lines = renderNode(value, 0);
  return `${lines.join("\n")}
`;
}
function renderNode(value, indent) {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return [`${prefix}[]`];
    }
    return value.flatMap((item) => renderArrayItem(item, indent));
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return [`${prefix}{}`];
    }
    return entries.flatMap(([key, item]) => renderObjectEntry(key, item, indent));
  }
  return [`${prefix}${formatScalar(value)}`];
}
function renderArrayItem(value, indent) {
  const prefix = " ".repeat(indent);
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return [`${prefix}- ${formatScalar(value)}`];
  }
  if (Array.isArray(value)) {
    const nested = renderNode(value, indent + 2);
    return [`${prefix}-`, ...nested];
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [`${prefix}- {}`];
  }
  const [firstKey, firstValue] = entries[0];
  const lines = [];
  if (!Array.isArray(firstValue) && !isPlainObject(firstValue)) {
    lines.push(`${prefix}- ${firstKey}: ${formatScalar(firstValue)}`);
  } else {
    lines.push(`${prefix}- ${firstKey}:`);
    lines.push(...renderNode(firstValue, indent + 4));
  }
  for (const [key, item] of entries.slice(1)) {
    lines.push(...renderObjectEntry(key, item, indent + 2));
  }
  return lines;
}
function renderObjectEntry(key, value, indent) {
  const prefix = " ".repeat(indent);
  if (!Array.isArray(value) && !isPlainObject(value)) {
    return [`${prefix}${key}: ${formatScalar(value)}`];
  }
  if (Array.isArray(value) && value.length === 0) {
    return [`${prefix}${key}: []`];
  }
  if (isPlainObject(value) && Object.keys(value).length === 0) {
    return [`${prefix}${key}: {}`];
  }
  return [`${prefix}${key}:`, ...renderNode(value, indent + 2)];
}
function formatScalar(value) {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === void 0) {
    return "null";
  }
  return JSON.stringify(value);
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// src/remediation/builder.ts
var MAX_CASES_PER_PACKAGE = 5;
function buildRemediationPackage(input) {
  const createdAt = (/* @__PURE__ */ new Date()).toISOString();
  const selectedCases = selectBadCases(input.evaluate.badCaseAssets, input.selectedCaseKeys);
  if (selectedCases.length === 0) {
    return {
      skipped: true,
      reason: "no_bad_cases",
      message: "\u5F53\u524D\u8BC4\u4F30\u672A\u53D1\u73B0 bad case\uFF0C\u573A\u666F\u5065\u5EB7\uFF0C\u65E0\u9700\u751F\u6210\u8C03\u4F18\u5305\u3002",
      package: null
    };
  }
  const packageId = allocatePackageId(createdAt);
  const dominantTags = collectDominantTags(selectedCases);
  const priority = resolvePriority(selectedCases);
  const editScope = resolveEditScope(selectedCases);
  const problemSummary = buildProblemSummary(selectedCases, input.evaluate);
  const constraints = buildConstraints(selectedCases);
  const targetMetrics = buildTargetMetrics(input.evaluate, selectedCases);
  const acceptanceGate = buildAcceptanceGate(input.evaluate, selectedCases, targetMetrics, input.baselineCustomerId);
  const title = buildPackageTitle(selectedCases, input.evaluate);
  const skillFolderName = `remediation-skill-${packageId}`;
  const artifactDir = `artifacts/remediation-packages/${skillFolderName}`;
  const issueBrief = buildIssueBrief({
    packageId,
    createdAt,
    evaluate: input.evaluate,
    selectedCases,
    priority,
    editScope,
    problemSummary,
    constraints,
    targetMetrics,
    acceptanceGate
  });
  const remediationSpec = buildRemediationSpecYaml({
    packageId,
    createdAt,
    evaluate: input.evaluate,
    selectedCases,
    priority,
    editScope,
    problemSummary,
    constraints,
    targetMetrics
  });
  const badcasesJsonl = buildBadcasesJsonl(selectedCases);
  const acceptanceGateYaml = renderYamlDocument(acceptanceGate);
  const files = [
    {
      fileName: "issue-brief.md",
      relativePath: `${artifactDir}/reference/issue-brief.md`,
      content: issueBrief
    },
    {
      fileName: "remediation-spec.yaml",
      relativePath: `${artifactDir}/reference/remediation-spec.yaml`,
      content: remediationSpec
    },
    {
      fileName: "badcases.jsonl",
      relativePath: `${artifactDir}/reference/badcases.jsonl`,
      content: badcasesJsonl
    },
    {
      fileName: "acceptance-gate.yaml",
      relativePath: `${artifactDir}/reference/acceptance-gate.yaml`,
      content: acceptanceGateYaml
    }
  ];
  const skillBundle = buildSkillBundle({
    packageId,
    title,
    createdAt,
    artifactDir,
    skillFolderName,
    evaluate: input.evaluate,
    selectedCases,
    priority,
    editScope,
    problemSummary,
    constraints,
    targetMetrics,
    acceptanceGate,
    referenceFiles: files
  });
  const snapshot = {
    schemaVersion: 1,
    packageId,
    createdAt,
    runId: input.evaluate.runId,
    title,
    priority,
    scenarioId: input.evaluate.scenarioEvaluation?.scenarioId,
    sourceFileName: input.sourceFileName,
    selectedCaseKeys: selectedCases.map((item) => item.caseKey),
    selectedCaseCount: selectedCases.length,
    dominantTags,
    problemSummary,
    editScope,
    constraints,
    targetMetrics,
    acceptanceGate,
    artifactDir,
    files,
    skillFolder: skillBundle.rootPath,
    skillBundle
  };
  return {
    skipped: false,
    package: snapshot
  };
}
function selectBadCases(badCases, selectedCaseKeys) {
  if (selectedCaseKeys && selectedCaseKeys.length > 0) {
    const selected = badCases.filter((item) => selectedCaseKeys.includes(item.caseKey));
    return selected.slice(0, MAX_CASES_PER_PACKAGE);
  }
  return [...badCases].sort((left, right) => right.severityScore - left.severityScore).slice(0, MAX_CASES_PER_PACKAGE);
}
function allocatePackageId(createdAt) {
  const stamp = createdAt.slice(0, 10).replace(/-/g, "");
  return `rem_${stamp}_${(0, import_node_crypto3.randomBytes)(3).toString("hex")}`;
}
function collectDominantTags(badCases) {
  const counts = /* @__PURE__ */ new Map();
  badCases.forEach((item) => {
    item.tags.forEach((tag) => {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    });
  });
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, 5).map(([tag]) => tag);
}
function resolvePriority(badCases) {
  const maxSeverity = Math.max(...badCases.map((item) => item.severityScore));
  const hasHardFailure = badCases.some(
    (item) => item.tags.some((tag) => tag === "goal_failed" || tag === "recovery_failed" || tag === "escalation_keyword")
  );
  if (hasHardFailure || maxSeverity >= 0.72) {
    return "P0";
  }
  if (maxSeverity >= 0.48) {
    return "P1";
  }
  return "P2";
}
function resolveEditScope(badCases) {
  const scope = /* @__PURE__ */ new Set();
  badCases.forEach((item) => {
    item.tags.forEach((tag) => {
      if (tag === "goal_failed" || tag === "goal_partial" || tag === "goal_unclear" || tag === "off_topic_shift") {
        scope.add("prompt");
      }
      if (tag === "recovery_failed" || tag === "question_repeat" || tag === "understanding_barrier") {
        scope.add("orchestration");
      }
      if (tag === "escalation_keyword") {
        scope.add("policy");
      }
      if (tag === "long_response_gap") {
        scope.add("code");
      }
    });
  });
  if (scope.size === 0) {
    scope.add("prompt");
    scope.add("orchestration");
  }
  return ["prompt", "policy", "orchestration", "code"].filter(
    (item) => scope.has(item)
  );
}
function buildProblemSummary(badCases, evaluate) {
  const summaries = /* @__PURE__ */ new Set();
  const dominantTags = collectDominantTags(badCases);
  dominantTags.forEach((tag) => {
    summaries.add(mapTagToSummary(tag));
  });
  const atRiskKpis = evaluate.scenarioEvaluation?.kpis.filter((item) => item.status === "at_risk").map((item) => `${item.displayName} \u5DF2\u8DCC\u5230 at_risk\uFF08${Math.round(item.score * 100)}%\uFF09\u3002`) ?? [];
  atRiskKpis.forEach((item) => summaries.add(item));
  return [...summaries];
}
function buildConstraints(badCases) {
  const constraints = /* @__PURE__ */ new Set([
    "\u4E0D\u8981\u964D\u4F4E\u73B0\u6709\u5B89\u5168\u62D2\u7B54\u8D28\u91CF\u3002",
    "\u4E0D\u8981\u8BA9\u5E73\u5747\u54CD\u5E94\u65F6\u5EF6\u6076\u5316\u8D85\u8FC7 20%\u3002",
    "\u4E0D\u8981\u7834\u574F\u5F53\u524D\u5DF2\u652F\u6301\u7684\u4E1A\u52A1\u573A\u666F\u4E0E\u56DE\u653E\u94FE\u8DEF\u3002"
  ]);
  if (badCases.some((item) => item.tags.includes("escalation_keyword"))) {
    constraints.add("\u6295\u8BC9\u4E0E\u8F6C\u4EBA\u5DE5\u8DEF\u5F84\u8981\u4FDD\u7559\u53EF\u8FFD\u8E2A\u7684 SLA \u4E0E\u515C\u5E95\u8BDD\u672F\u3002");
  }
  if (badCases.some((item) => item.tags.includes("goal_failed") || item.tags.includes("goal_partial"))) {
    constraints.add("\u4F18\u5148\u4FDD\u8BC1\u7528\u6237\u4E3B\u4EFB\u52A1\u95ED\u73AF\uFF0C\u4E0D\u8981\u7528\u5197\u957F\u89E3\u91CA\u66FF\u4EE3\u52A8\u4F5C\u5B8C\u6210\u3002");
  }
  return [...constraints];
}
function buildTargetMetrics(evaluate, badCases) {
  const metrics = [];
  const empathy = getDimensionScore2(evaluate, "\u5171\u60C5\u7A0B\u5EA6");
  const offTopic = getDimensionScore2(evaluate, "\u7B54\u975E\u6240\u95EE/\u65E0\u89C6\u98CE\u9669");
  const recovery = getDimensionScore2(evaluate, "\u60C5\u7EEA\u6062\u590D\u80FD\u529B");
  const goalCompletionRate = getGoalCompletionRate(evaluate);
  const recoveryCompletionRate = getRecoveryCompletionRate(evaluate);
  if (badCases.some((item) => item.tags.includes("goal_failed") || item.tags.includes("goal_partial"))) {
    metrics.push({
      metricId: "goal_completion_rate",
      displayName: "\u76EE\u6807\u8FBE\u6210\u7387",
      currentValue: goalCompletionRate,
      targetValue: clamp015(Math.max(goalCompletionRate + 0.15, 0.7)),
      direction: "increase",
      reason: "\u5931\u8D25\u6848\u4F8B\u663E\u793A\u7528\u6237\u4E3B\u4EFB\u52A1\u6CA1\u6709\u95ED\u73AF\uFF0C\u5FC5\u987B\u5148\u628A\u4EFB\u52A1\u5B8C\u6210\u6001\u62C9\u56DE\u5B89\u5168\u7EBF\u3002"
    });
  }
  if (badCases.some((item) => item.tags.includes("recovery_failed"))) {
    metrics.push({
      metricId: "recovery_completion_rate",
      displayName: "\u6062\u590D\u6210\u529F\u7387",
      currentValue: recoveryCompletionRate,
      targetValue: clamp015(Math.max(recoveryCompletionRate + 0.2, 0.6)),
      direction: "increase",
      reason: "\u5DF2\u51FA\u73B0\u5931\u8D25\u540E\u672A\u80FD\u62C9\u56DE\u7684 session\uFF0C\u9700\u8981\u8865\u5B8C\u6574\u7684\u4FEE\u590D\u5E8F\u5217\u3002"
    });
    metrics.push({
      metricId: "emotion_recovery_score",
      displayName: "\u60C5\u7EEA\u6062\u590D\u80FD\u529B",
      currentValue: recovery,
      targetValue: clampScore5(Math.max(recovery + 1, 4)),
      direction: "increase",
      reason: "\u4E3B\u89C2\u7EF4\u5EA6\u663E\u793A\u60C5\u7EEA\u6062\u590D\u4E0D\u8DB3\uFF0C\u9700\u8981\u589E\u5F3A\u5B89\u629A\u3001\u6F84\u6E05\u4E0E\u52A8\u4F5C\u627F\u8BFA\u3002"
    });
  }
  if (badCases.some((item) => item.tags.includes("question_repeat") || item.tags.includes("understanding_barrier"))) {
    metrics.push({
      metricId: "user_question_repeat_rate",
      displayName: "\u91CD\u590D\u63D0\u95EE\u7387",
      currentValue: evaluate.objectiveMetrics.userQuestionRepeatRate,
      targetValue: clamp015(Math.max(evaluate.objectiveMetrics.userQuestionRepeatRate - 0.08, 0.05)),
      direction: "decrease",
      reason: "\u7528\u6237\u5728\u8FFD\u95EE\u540C\u4E00\u4E2A\u95EE\u9898\uFF0C\u8BF4\u660E\u56DE\u7B54\u7ED3\u6784\u4ECD\u7136\u4E0D\u591F\u76F4\u63A5\u3002"
    });
    metrics.push({
      metricId: "empathy_score",
      displayName: "\u5171\u60C5\u5F97\u5206",
      currentValue: empathy,
      targetValue: clampScore5(Math.max(empathy + 1, 4)),
      direction: "increase",
      reason: "\u7406\u89E3\u969C\u788D\u4E0E\u91CD\u590D\u8FFD\u95EE\u901A\u5E38\u4F34\u968F\u5171\u60C5\u4E0D\u8DB3\u548C\u56DE\u7B54\u65B9\u5F0F\u50F5\u786C\u3002"
    });
  }
  if (badCases.some((item) => item.tags.includes("off_topic_shift"))) {
    metrics.push({
      metricId: "off_topic_score",
      displayName: "\u7B54\u975E\u6240\u95EE\u98CE\u9669\u7EF4\u5EA6",
      currentValue: offTopic,
      targetValue: clampScore5(Math.max(offTopic + 1, 4)),
      direction: "increase",
      reason: "\u591A\u6761 bad case \u8868\u660E agent \u5728\u5173\u952E\u95EE\u9898\u540E\u8DD1\u504F\uFF0C\u9700\u8981\u538B\u7F29\u65E0\u5173\u5C55\u5F00\u3002"
    });
  }
  if (badCases.some((item) => item.tags.includes("escalation_keyword"))) {
    metrics.push({
      metricId: "escalation_keyword_hit_rate",
      displayName: "\u5347\u7EA7\u89E6\u53D1\u7387",
      currentValue: evaluate.objectiveMetrics.escalationKeywordHitRate,
      targetValue: clamp015(Math.max(evaluate.objectiveMetrics.escalationKeywordHitRate - 0.1, 0)),
      direction: "decrease",
      reason: "\u7528\u6237\u5DF2\u8FDB\u5165\u6295\u8BC9/\u8F6C\u4EBA\u5DE5\u8BED\u5883\uFF0C\u9700\u5148\u964D\u4F4E\u5347\u7EA7\u89E6\u53D1\u3002"
    });
  }
  if (badCases.some((item) => item.tags.includes("long_response_gap"))) {
    metrics.push({
      metricId: "avg_response_gap_sec",
      displayName: "\u5E73\u5747\u54CD\u5E94\u95F4\u9694",
      currentValue: evaluate.objectiveMetrics.avgResponseGapSec,
      targetValue: Math.max(Math.round(evaluate.objectiveMetrics.avgResponseGapSec - 10), 10),
      direction: "decrease",
      reason: "\u957F\u7B49\u5F85\u672C\u8EAB\u6B63\u5728\u653E\u5927\u5931\u8D25\u4F53\u9A8C\uFF0C\u9700\u8981\u628A\u6267\u884C\u65F6\u5EF6\u548C\u663E\u5F0F\u53CD\u9988\u63A7\u5236\u4F4F\u3002"
    });
  }
  if (evaluate.scenarioEvaluation && evaluate.scenarioEvaluation.averageScore < 0.75) {
    metrics.push({
      metricId: "scenario_average_score",
      displayName: `${evaluate.scenarioEvaluation.displayName} KPI \u5747\u5206`,
      currentValue: evaluate.scenarioEvaluation.averageScore,
      targetValue: clamp015(Math.max(evaluate.scenarioEvaluation.averageScore + 0.1, 0.75)),
      direction: "increase",
      reason: "\u4E1A\u52A1 KPI \u5DF2\u7ECF\u8FDB\u5165\u4F4E\u4F4D\uFF0C\u9700\u8981\u540C\u65F6\u5173\u6CE8\u4E1A\u52A1\u4FA7\u7ED3\u679C\u800C\u4E0D\u662F\u53EA\u770B\u901A\u7528\u5BF9\u8BDD\u5206\u3002"
    });
  }
  return dedupeTargetMetrics(metrics);
}
function buildAcceptanceGate(evaluate, badCases, targetMetrics, baselineCustomerId) {
  const guards = {
    dangerous_reply_count: 0,
    max_regressions: 0
  };
  targetMetrics.forEach((metric) => {
    if (metric.direction === "increase") {
      guards[`${metric.metricId}_min`] = roundMetric(metric.targetValue);
    } else {
      guards[`${metric.metricId}_max`] = roundMetric(metric.targetValue);
    }
  });
  if (badCases.some((item) => item.tags.includes("long_response_gap"))) {
    guards.avg_latency_regression_max_ratio = 1.2;
  }
  if (badCases.some((item) => item.tags.includes("escalation_keyword"))) {
    guards.escalation_keyword_hit_rate_max = roundMetric(
      clamp015(Math.max(evaluate.objectiveMetrics.escalationKeywordHitRate - 0.1, 0))
    );
  }
  return {
    replay: {
      required: true,
      baselineRunId: evaluate.runId,
      baselineCustomerId: baselineCustomerId?.trim() || null,
      minWinRate: 0.65
    },
    offlineEval: {
      required: true,
      sampleBatchId: null,
      maxRegressions: 0
    },
    sandbox: {
      required: false,
      scenarios: []
    },
    guards
  };
}
function buildPackageTitle(badCases, evaluate) {
  const scenario = evaluate.scenarioEvaluation?.displayName ?? "\u901A\u7528\u5BF9\u8BDD";
  const dominantTag = collectDominantTags(badCases)[0] ?? "generic_failure";
  return `${scenario} \xB7 ${mapTagToLabel(dominantTag)} \u8C03\u4F18\u5305`;
}
function buildIssueBrief(input) {
  const scenarioLabel = input.evaluate.scenarioEvaluation?.displayName ?? "\u901A\u7528\u8BC4\u4F30";
  const evidenceBlock = input.selectedCases.map((item) => {
    const evidence = item.evidence.slice(0, 2).map((row) => `- [turn ${row.turnIndex}] [${row.role}] ${row.content}`).join("\n");
    return `### ${item.title}
- tags: ${item.tags.join(", ")}
- severity: ${item.severityScore.toFixed(2)}
- suggested_action: ${item.suggestedAction}
${evidence}`;
  }).join("\n\n");
  const targetMetricBlock = input.targetMetrics.map(
    (item) => `- ${item.displayName}: ${roundMetric(item.currentValue)} -> ${roundMetric(item.targetValue)} (${item.direction === "increase" ? "\u63D0\u9AD8" : "\u964D\u4F4E"})\u3002${item.reason}`
  ).join("\n");
  const constraintBlock = input.constraints.map((item) => `- ${item}`).join("\n");
  const summaryBlock = input.problemSummary.map((item) => `- ${item}`).join("\n");
  return [
    `# ${input.packageId}`,
    "",
    "## \u6982\u89C8",
    `- \u751F\u6210\u65F6\u95F4\uFF1A${input.createdAt}`,
    `- \u6765\u6E90 Run\uFF1A${input.evaluate.runId}`,
    `- \u573A\u666F\uFF1A${scenarioLabel}`,
    `- \u4F18\u5148\u7EA7\uFF1A${input.priority}`,
    `- \u9009\u4E2D bad case\uFF1A${input.selectedCases.length}`,
    `- \u5EFA\u8BAE\u4F18\u5148\u4FEE\u6539\u5C42\uFF1A${input.editScope.join(", ")}`,
    "",
    "## \u95EE\u9898\u6458\u8981",
    summaryBlock,
    "",
    "## \u76EE\u6807\u6307\u6807",
    targetMetricBlock || "- \u5F53\u524D\u672A\u751F\u6210\u989D\u5916 target metrics\uFF0C\u8BF7\u5148\u4EE5 replay gate \u4E3A\u4E3B\u3002",
    "",
    "## \u5173\u952E\u8BC1\u636E",
    evidenceBlock,
    "",
    "## \u7EA6\u675F\u6761\u4EF6",
    constraintBlock,
    "",
    "## Agent Handoff",
    "- \u5C06\u672C\u76EE\u5F55\u4E0B\u7684 `remediation-spec.yaml`\u3001`badcases.jsonl`\u3001`acceptance-gate.yaml` \u4E00\u8D77\u4EA4\u7ED9 Claude Code / Codex\u3002",
    "- \u4F18\u5148\u4ECE edit_scope \u6307\u5B9A\u7684\u5C42\u5F00\u59CB\u6539\uFF0C\u4E0D\u8981\u65E0\u5173\u91CD\u6784\u3002",
    "- \u5B8C\u6210\u540E\u5FC5\u987B\u5148\u8DD1 replay\uFF0C\u518D\u8DD1\u56FA\u5B9A sample batch\uFF1B\u4EFB\u4F55 guard \u9000\u5316\u90FD\u4E0D\u7B97\u901A\u8FC7\u3002",
    "",
    "## \u9A8C\u6536\u6458\u8981",
    `- replay.min_win_rate = ${input.acceptanceGate.replay.minWinRate}`,
    `- offline_eval.max_regressions = ${input.acceptanceGate.offlineEval.maxRegressions}`
  ].join("\n");
}
function buildSkillBundle(input) {
  const skillFile = {
    fileName: "SKILL.md",
    relativePath: `${input.artifactDir}/SKILL.md`,
    role: "overview",
    content: buildSkillMarkdown(input)
  };
  const readmeFile = {
    fileName: "README.md",
    relativePath: `${input.artifactDir}/README.md`,
    role: "readme",
    content: buildSkillReadme(input)
  };
  const referenceFiles = input.referenceFiles.map((file) => ({
    fileName: file.fileName,
    relativePath: file.relativePath,
    content: file.content,
    role: "reference"
  }));
  return {
    folderName: input.skillFolderName,
    rootPath: input.artifactDir,
    skillFile,
    readmeFile,
    referenceFiles,
    files: [skillFile, ...referenceFiles, readmeFile]
  };
}
function buildSkillMarkdown(input) {
  const topCases = input.selectedCases.slice(0, 3);
  const targetMetricBlock = input.targetMetrics.length ? input.targetMetrics.map(
    (item) => `- ${item.displayName}: ${roundMetric(item.currentValue)} -> ${roundMetric(item.targetValue)} (${item.direction === "increase" ? "\u63D0\u9AD8" : "\u964D\u4F4E"})`
  ).join("\n") : "- \u4EE5 replay win rate \u4E0E offline regression gate \u4E3A\u4E3B\u3002";
  return [
    `# ${input.title}`,
    "",
    "## \u4EC0\u4E48\u65F6\u5019\u4F7F\u7528",
    `\u5F53 Zeval run \`${input.evaluate.runId}\` \u66B4\u9732\u51FA\u4EE5\u4E0B\u95EE\u9898\u65F6\u4F7F\u7528\u672C skill\uFF1A`,
    ...input.problemSummary.slice(0, 5).map((item) => `- ${item}`),
    "",
    "## \u4FEE\u590D\u7B56\u7565",
    `- \u4F18\u5148\u7EA7\uFF1A${input.priority}`,
    `- \u4F18\u5148\u4FEE\u6539\u5C42\uFF1A${input.editScope.join(", ") || "prompt"}`,
    "- \u5148\u4FEE\u590D\u8986\u76D6\u9762\u6700\u5927\u7684\u5931\u8D25\u6807\u7B7E\uFF0C\u518D\u5904\u7406\u5355\u70B9\u5F02\u5E38\u3002",
    "- \u4E0D\u505A\u65E0\u5173\u91CD\u6784\uFF1B\u6240\u6709\u6539\u52A8\u90FD\u8981\u80FD\u88AB reference/acceptance-gate.yaml \u9A8C\u8BC1\u3002",
    "",
    "## \u5173\u952E bad case",
    ...topCases.map(
      (item) => `- ${item.title}\uFF1Aseverity=${item.severityScore.toFixed(2)}\uFF0Ctags=${item.tags.join(", ")}\uFF0C\u5EFA\u8BAE=${item.suggestedAction}`
    ),
    "",
    "## \u76EE\u6807\u6307\u6807",
    targetMetricBlock,
    "",
    "## \u9A8C\u6536\u6807\u51C6",
    `- Replay win rate >= ${input.acceptanceGate.replay.minWinRate}`,
    `- Offline eval max regressions <= ${input.acceptanceGate.offlineEval.maxRegressions}`,
    "- `reference/badcases.jsonl` \u4E2D\u7684\u5173\u952E\u6837\u4F8B\u4E0D\u518D\u89E6\u53D1\u540C\u7C7B\u5931\u8D25\u3002",
    "- \u5982\u679C\u4FEE\u6539 prompt/policy/orchestration/code\uFF0C\u5FC5\u987B\u5728\u63D0\u4EA4\u8BF4\u660E\u91CC\u5199\u6E05\u695A\u5F71\u54CD\u8303\u56F4\u3002",
    "",
    "## Reference",
    "- `reference/issue-brief.md`\uFF1A\u5B8C\u6574\u95EE\u9898\u8BF4\u660E\u4E0E\u8BC1\u636E\u3002",
    "- `reference/badcases.jsonl`\uFF1A\u673A\u5668\u53EF\u8BFB bad case\u3002",
    "- `reference/remediation-spec.yaml`\uFF1A\u4FEE\u590D\u8303\u56F4\u3001\u7EA6\u675F\u4E0E\u76EE\u6807\u6307\u6807\u3002",
    "- `reference/acceptance-gate.yaml`\uFF1A\u9A8C\u6536\u95E8\u7981\u3002"
  ].join("\n");
}
function buildSkillReadme(input) {
  return [
    `# ${input.skillFolderName}`,
    "",
    "\u8FD9\u662F Zeval \u81EA\u52A8\u751F\u6210\u7684 remediation skill \u6587\u4EF6\u5939\uFF0C\u9762\u5411 Claude Code / Codex \u4F7F\u7528\u3002",
    "",
    "## \u4F7F\u7528\u65B9\u5F0F",
    "1. \u5148\u8BFB `SKILL.md`\uFF0C\u7406\u89E3\u95EE\u9898\u3001\u4FEE\u590D\u7B56\u7565\u4E0E\u9A8C\u6536\u6807\u51C6\u3002",
    "2. \u518D\u8BFB `reference/issue-brief.md` \u548C `reference/badcases.jsonl`\uFF0C\u786E\u8BA4\u8BC1\u636E\u3002",
    "3. \u6309 `reference/remediation-spec.yaml` \u9650\u5B9A\u7684 edit_scope \u4FEE\u6539\u7CFB\u7EDF\u3002",
    "4. \u7528 `reference/acceptance-gate.yaml` \u9A8C\u8BC1 replay / offline eval \u95E8\u7981\u3002",
    "",
    "## \u5143\u6570\u636E",
    `- package_id: ${input.packageId}`,
    `- source_run_id: ${input.evaluate.runId}`,
    `- generated_at: ${input.createdAt}`,
    `- artifact_dir: ${input.artifactDir}`
  ].join("\n");
}
function buildRemediationSpecYaml(input) {
  return renderYamlDocument({
    package_id: input.packageId,
    created_at: input.createdAt,
    source_run_id: input.evaluate.runId,
    scenario_id: input.evaluate.scenarioEvaluation?.scenarioId ?? null,
    priority: input.priority,
    goal: input.problemSummary[0] ?? "stabilize_dialog_quality",
    problem_summary: input.problemSummary,
    selected_case_keys: input.selectedCases.map((item) => item.caseKey),
    edit_scope: input.editScope,
    constraints: input.constraints,
    target_metrics: input.targetMetrics.map((item) => ({
      metric_id: item.metricId,
      display_name: item.displayName,
      current_value: roundMetric(item.currentValue),
      target_value: roundMetric(item.targetValue),
      direction: item.direction,
      reason: item.reason
    })),
    execution_notes: [
      "\u4F18\u5148\u5904\u7406 P0/P1 \u5931\u8D25\u6807\u7B7E\u6700\u591A\u7684 case\u3002",
      "\u5982\u9700\u6539 prompt\uFF0C\u8BF7\u540C\u6B65\u8BF4\u660E why \u4E0E expected behavior\u3002",
      "\u5982\u9700\u6539\u4EE3\u7801\u6216 orchestration\uFF0C\u4FDD\u6301\u56DE\u653E\u8F93\u5165\u517C\u5BB9\u3002"
    ]
  });
}
function buildBadcasesJsonl(badCases) {
  return `${badCases.map(
    (item) => JSON.stringify({
      case_id: item.caseKey,
      session_id: item.sessionId,
      severity_score: roundMetric(item.severityScore),
      turn_range: getTurnRange(item),
      current_output: getCurrentOutput(item),
      problem_tags: item.tags,
      expected_behavior: buildExpectedBehavior(item.tags),
      evidence: item.evidence,
      transcript: item.transcript,
      suggested_action: item.suggestedAction,
      source_run_id: item.sourceRunId
    })
  ).join("\n")}
`;
}
function mapTagToSummary(tag) {
  if (tag === "goal_failed") {
    return "\u7528\u6237\u4E3B\u4EFB\u52A1\u6CA1\u6709\u5B8C\u6210\uFF0Csession \u7ED3\u675F\u5728\u5931\u8D25\u6001\u3002";
  }
  if (tag === "goal_partial") {
    return "\u7528\u6237\u76EE\u6807\u53EA\u90E8\u5206\u8FBE\u6210\uFF0C\u4ECD\u9700\u989D\u5916\u8FFD\u95EE\u6216\u4EBA\u5DE5\u8865\u6551\u3002";
  }
  if (tag === "goal_unclear") {
    return "\u7528\u6237\u76EE\u6807\u8868\u8FBE\u4E0E agent \u54CD\u5E94\u6CA1\u6709\u5F62\u6210\u7A33\u5B9A\u95ED\u73AF\u3002";
  }
  if (tag === "recovery_failed") {
    return "\u5931\u8D25\u51FA\u73B0\u540E\u6CA1\u6709\u88AB\u6709\u6548\u4FEE\u590D\uFF0C\u4F53\u9A8C\u5728\u4F4E\u8C37\u505C\u7559\u8FC7\u4E45\u3002";
  }
  if (tag === "question_repeat") {
    return "\u7528\u6237\u91CD\u590D\u8FFD\u95EE\u540C\u4E00\u4EF6\u4E8B\uFF0C\u8BF4\u660E\u56DE\u7B54\u6CA1\u6709\u76F4\u63A5\u547D\u4E2D\u6838\u5FC3\u95EE\u9898\u3002";
  }
  if (tag === "understanding_barrier") {
    return "\u5BF9\u8BDD\u51FA\u73B0\u7406\u89E3\u969C\u788D\uFF0Cagent \u7684\u8868\u8FBE\u65B9\u5F0F\u5BF9\u7528\u6237\u4E0D\u591F\u53CB\u597D\u3002";
  }
  if (tag === "escalation_keyword") {
    return "\u4F1A\u8BDD\u5DF2\u7ECF\u8FDB\u5165\u6295\u8BC9 / \u8F6C\u4EBA\u5DE5\u98CE\u9669\u533A\uFF0C\u9700\u8981\u4F18\u5148\u538B\u964D\u5347\u7EA7\u89E6\u53D1\u3002";
  }
  if (tag === "emotion_drop") {
    return "\u7528\u6237\u60C5\u7EEA\u663E\u8457\u4E0B\u63A2\uFF0C\u5F53\u524D\u56DE\u590D\u65E0\u6CD5\u7A33\u4F4F\u4F53\u9A8C\u3002";
  }
  if (tag === "off_topic_shift") {
    return "\u5173\u952E\u8F6E\u6B21\u540E\u51FA\u73B0\u8DD1\u9898\uFF0Cagent \u5728\u5E94\u7B54\u7ED3\u6784\u4E0A\u9700\u8981\u6536\u655B\u3002";
  }
  if (tag === "long_response_gap") {
    return "\u957F\u7B49\u5F85\u6216\u65E0\u53CD\u9988\u6B63\u5728\u653E\u5927\u5931\u8D25\u611F\u77E5\u3002";
  }
  return "\u5B58\u5728\u9700\u8981\u4FEE\u590D\u7684\u5931\u8D25\u6A21\u5F0F\u3002";
}
function mapTagToLabel(tag) {
  if (tag === "goal_failed") {
    return "\u76EE\u6807\u672A\u8FBE\u6210";
  }
  if (tag === "recovery_failed") {
    return "\u6062\u590D\u5931\u8D25";
  }
  if (tag === "question_repeat") {
    return "\u91CD\u590D\u8FFD\u95EE";
  }
  if (tag === "escalation_keyword") {
    return "\u5347\u7EA7\u98CE\u9669";
  }
  if (tag === "off_topic_shift") {
    return "\u8DD1\u9898";
  }
  return tag;
}
function getDimensionScore2(evaluate, dimensionName) {
  return evaluate.subjectiveMetrics.dimensions.find((item) => item.dimension === dimensionName)?.score ?? 3;
}
function getGoalCompletionRate(evaluate) {
  const rows = evaluate.subjectiveMetrics.goalCompletions;
  if (rows.length === 0) {
    return 0;
  }
  const achieved = rows.filter((item) => item.status === "achieved").length;
  return achieved / rows.length;
}
function getRecoveryCompletionRate(evaluate) {
  const candidates = evaluate.subjectiveMetrics.recoveryTraces.filter((item) => item.status !== "none");
  if (candidates.length === 0) {
    return 0;
  }
  const completed = candidates.filter((item) => item.status === "completed").length;
  return completed / candidates.length;
}
function dedupeTargetMetrics(metrics) {
  const byId = /* @__PURE__ */ new Map();
  metrics.forEach((item) => {
    if (!byId.has(item.metricId)) {
      byId.set(item.metricId, item);
      return;
    }
    const current = byId.get(item.metricId);
    if (!current) {
      byId.set(item.metricId, item);
      return;
    }
    if (item.direction === "increase" && item.targetValue > current.targetValue) {
      byId.set(item.metricId, item);
      return;
    }
    if (item.direction === "decrease" && item.targetValue < current.targetValue) {
      byId.set(item.metricId, item);
    }
  });
  return [...byId.values()];
}
function getTurnRange(badCase) {
  if (badCase.evidence.length === 0) {
    return "unknown";
  }
  const turns = badCase.evidence.map((item) => item.turnIndex);
  return `${Math.min(...turns)}-${Math.max(...turns)}`;
}
function getCurrentOutput(badCase) {
  const assistantEvidence = [...badCase.evidence].reverse().find((item) => item.role === "assistant");
  if (assistantEvidence) {
    return assistantEvidence.content;
  }
  const transcriptLines = badCase.transcript.split("\n").filter((line) => line.includes("[assistant]"));
  return transcriptLines.at(-1) ?? badCase.transcript;
}
function buildExpectedBehavior(tags) {
  const behaviors = /* @__PURE__ */ new Set();
  if (tags.includes("goal_failed") || tags.includes("goal_partial") || tags.includes("goal_unclear")) {
    behaviors.add("\u660E\u786E\u91CD\u8FF0\u7528\u6237\u4E3B\u4EFB\u52A1\uFF0C\u7ED9\u51FA\u5B8C\u6210\u6001\u6216\u6E05\u6670\u7684\u4E0B\u4E00\u6B65\u52A8\u4F5C\u3002");
  }
  if (tags.includes("recovery_failed") || tags.includes("emotion_drop")) {
    behaviors.add("\u5148\u627F\u8BA4\u95EE\u9898\u4E0E\u60C5\u7EEA\uFF0C\u518D\u6F84\u6E05\uFF0C\u518D\u7ED9\u53EF\u6267\u884C\u4FEE\u590D\u52A8\u4F5C\u3002");
  }
  if (tags.includes("question_repeat") || tags.includes("understanding_barrier")) {
    behaviors.add("\u5148\u76F4\u63A5\u56DE\u7B54\u95EE\u9898\u6838\u5FC3\uFF0C\u518D\u8865\u80CC\u666F\uFF0C\u907F\u514D\u7528\u6237\u91CD\u590D\u8FFD\u95EE\u3002");
  }
  if (tags.includes("off_topic_shift")) {
    behaviors.add("\u4FDD\u6301\u4E3B\u9898\u6536\u655B\uFF0C\u4E0D\u8981\u5728\u5173\u952E\u8FFD\u95EE\u540E\u5207\u5230\u65E0\u5173\u4FE1\u606F\u3002");
  }
  if (tags.includes("escalation_keyword")) {
    behaviors.add("\u5728\u5347\u7EA7\u524D\u7ED9\u51FA\u515C\u5E95\u52A8\u4F5C\u3001SLA \u627F\u8BFA\u548C\u660E\u786E\u5347\u7EA7\u8DEF\u5F84\u3002");
  }
  if (tags.includes("long_response_gap")) {
    behaviors.add("\u7F29\u77ED\u7B49\u5F85\u65F6\u95F4\uFF0C\u6216\u663E\u5F0F\u544A\u77E5\u5F53\u524D\u5904\u7406\u72B6\u6001\u4E0E\u9884\u8BA1\u65F6\u957F\u3002");
  }
  return [...behaviors].join(" ");
}
function clamp015(value) {
  return Math.max(0, Math.min(1, Number(value.toFixed(4))));
}
function clampScore5(value) {
  return Math.max(1, Math.min(5, Number(value.toFixed(2))));
}
function roundMetric(value) {
  return Number(value.toFixed(4));
}

// src/remediation/index.ts
function createRemediationPackageStore() {
  const provider = (process.env.REMEDIATION_PACKAGE_STORE_PROVIDER ?? "filesystem").trim().toLowerCase();
  if (provider === "filesystem") {
    return new FileSystemRemediationPackageStore();
  }
  throw new Error(`\u6682\u4E0D\u652F\u6301\u7684 remediation package store provider: ${provider}`);
}

// src/cli/commands/package.ts
function registerPackageCommand(program2) {
  program2.command("package").alias("pkg").description("Build a remediation package from a saved evaluate run").requiredOption("--run-id <id>", "Run ID of the saved evaluate result").option("--case-keys <keys>", "Comma-separated bad case keys to include (default: all)").option("--baseline-customer-id <id>", "Baseline customer ID for the acceptance gate").action(async (opts) => {
    header("Zeval Package");
    kv("run-id", opts.runId);
    const spinner = createSpinner("Loading saved evaluate result\u2026");
    const evaluate = await readPersistedEvaluateResult(opts.runId).catch(() => null);
    if (!evaluate) {
      spinner.fail(`Run not found: ${opts.runId}`);
      err(`No artifact for "${opts.runId}". Run ${c.bold("zeval runs list")} to see available runs.`);
      process.exit(1);
    }
    spinner.succeed(`Loaded run: ${opts.runId}`);
    kv("bad cases available", evaluate.badCaseAssets?.length ?? 0);
    console.log();
    const allCaseKeys = (evaluate.badCaseAssets ?? []).map((bc) => bc.caseKey);
    const selectedKeys = opts.caseKeys ? opts.caseKeys.split(",").map((k) => k.trim()).filter(Boolean) : allCaseKeys;
    if (selectedKeys.length === 0) {
      warn("No bad cases found in this run \u2014 nothing to package.");
      process.exit(0);
    }
    kv("cases selected", selectedKeys.length);
    console.log();
    const spinner2 = createSpinner("Building remediation package\u2026");
    const buildResult = await Promise.resolve(
      buildRemediationPackage({
        sourceFileName: `run_${opts.runId}`,
        baselineCustomerId: opts.baselineCustomerId,
        selectedCaseKeys: selectedKeys,
        evaluate: {
          runId: evaluate.runId,
          objectiveMetrics: evaluate.objectiveMetrics,
          subjectiveMetrics: evaluate.subjectiveMetrics,
          scenarioEvaluation: evaluate.scenarioEvaluation ?? null,
          badCaseAssets: evaluate.badCaseAssets ?? [],
          suggestions: evaluate.suggestions ?? []
        }
      })
    ).catch((e) => {
      spinner2.fail(`Build error: ${e.message}`);
      process.exit(1);
    });
    if (buildResult.skipped) {
      spinner2.fail("Package skipped");
      warn(buildResult.message);
      process.exit(0);
    }
    const packageStore = createRemediationPackageStore();
    await packageStore.save(buildResult.package).catch((e) => {
      spinner2.fail(`Save error: ${e.message}`);
      process.exit(1);
    });
    spinner2.succeed(`Package built: ${buildResult.package.packageId}`);
    const snap = buildResult.package;
    header("Package Summary");
    kv("package ID", snap.packageId);
    kv("title", snap.title);
    kv("priority", snap.priority);
    kv("cases included", snap.selectedCaseCount);
    kv("edit scope", snap.editScope.join(", ") || "\u2014");
    kv("output dir", `artifacts/remediation-packages/${snap.packageId}/`);
    if (snap.targetMetrics.length > 0) {
      console.log();
      for (const tm of snap.targetMetrics) {
        kv(`  target: ${tm.metricKey}`, `${tm.currentValue.toFixed(2)} \u2192 >${tm.targetValue.toFixed(2)}`);
      }
    }
    console.log();
    ok(`Remediation package ready: ${c.bold(snap.packageId)}`);
    console.log(`  ${c.dim("Artifacts:")} artifacts/remediation-packages/${snap.packageId}/`);
    console.log();
  });
}

// src/cli/commands/runs.ts
function registerRunsCommand(program2) {
  const runs = program2.command("runs").description("List and inspect saved evaluate runs");
  runs.command("list").alias("ls").description("List saved evaluate runs, newest first").option("--limit <n>", "Maximum number of runs to display", "20").option("--project-id <id>", "Filter by project ID").action(async (opts) => {
    const rows = await listPersistedEvaluateRuns(
      Math.max(1, parseInt(opts.limit, 10)),
      opts.projectId
    );
    if (rows.length === 0) {
      warn("No saved runs found. Start with:");
      console.log(`  ${c.bold("zeval evaluate ./chatlog.csv")}`);
      return;
    }
    header(`Evaluate Runs (${rows.length})`);
    console.log();
    const W_ID = 32;
    const W_TS = 20;
    const W_SES = 9;
    const W_MSG = 10;
    const W_WARN = 8;
    const hdr = [
      "Run ID".padEnd(W_ID),
      "Generated At".padEnd(W_TS),
      "Sessions".padEnd(W_SES),
      "Messages".padEnd(W_MSG),
      "Warnings"
    ].join("  ");
    console.log(`  ${c.dim(hdr)}`);
    console.log(`  ${c.dim("\u2500".repeat(hdr.length))}`);
    for (const row of rows) {
      const warnStr = row.warningCount > 0 ? c.yellow(String(row.warningCount).padEnd(W_WARN)) : c.dim("0".padEnd(W_WARN));
      const line = [
        c.cyan(row.runId.padEnd(W_ID)),
        row.generatedAt.slice(0, 19).replace("T", " ").padEnd(W_TS),
        String(row.sessions).padEnd(W_SES),
        String(row.messages).padEnd(W_MSG),
        warnStr
      ].join("  ");
      console.log("  " + line);
    }
    console.log();
    console.log(`  ${c.dim("Tip:")} zeval runs show <run-id>  to inspect a run`);
    console.log();
  });
  runs.command("show <run-id>").description("Print full details of a saved evaluate run").action(async (runId) => {
    const result2 = await readPersistedEvaluateResult(runId);
    if (!result2) {
      err(`Run not found: ${runId}`);
      process.exit(1);
    }
    const obj = result2.objectiveMetrics;
    const subj = result2.subjectiveMetrics;
    header(`Run: ${runId}`);
    table([
      ["run ID", result2.runId],
      ["generated", result2.meta.generatedAt.slice(0, 19).replace("T", " ")],
      ["sessions", result2.meta.sessions],
      ["messages", result2.meta.messages],
      ["warnings", result2.meta.warnings.length],
      [""],
      ["\u2500\u2500\u2500 Objective Metrics \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", ""],
      ["avg response gap (s)", obj.avgResponseGapSec?.toFixed(2) ?? "\u2014"],
      ["user repeat rate", `${((obj.userQuestionRepeatRate ?? 0) * 100).toFixed(1)}%`],
      ["agent resolution rate", `${((obj.agentResolutionSignalRate ?? 0) * 100).toFixed(1)}%`],
      ["escalation hit rate", `${((obj.escalationKeywordHitRate ?? 0) * 100).toFixed(1)}%`],
      [""],
      ["\u2500\u2500\u2500 Subjective Metrics \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", ""],
      ["dimensions", subj?.dimensions?.length ?? 0],
      ["implicit signals", subj?.signals?.length ?? 0],
      ["goal completions", subj?.goalCompletions?.length ?? 0],
      ["recovery traces", subj?.recoveryTraces?.length ?? 0],
      [""],
      ["\u2500\u2500\u2500 Bad Cases \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500", ""],
      ["detected", result2.badCaseAssets?.length ?? 0]
    ]);
    if (result2.meta.warnings.length > 0) {
      header("Warnings");
      for (const w of result2.meta.warnings) {
        console.log(`  ${c.yellow("\u26A0")} ${w}`);
      }
    }
    const badCases = result2.badCaseAssets ?? [];
    if (badCases.length > 0) {
      header(`Bad Cases${badCases.length > 5 ? ` (showing 5 of ${badCases.length})` : ""}`);
      for (const bc of badCases.slice(0, 5)) {
        console.log(`  ${c.cyan(bc.caseKey)} \u2014 ${bc.title}`);
        console.log(`    ${c.dim("severity:")} ${bc.severityScore?.toFixed(2) ?? "\u2014"}  ${c.dim("session:")} ${bc.sessionId}`);
      }
    }
    if ((subj?.dimensions?.length ?? 0) > 0) {
      header("Subjective Dimensions");
      const dims = (subj?.dimensions ?? []).slice(0, 6);
      const maxScore = Math.max(...dims.map((d) => d.score), 1);
      for (const d of dims) {
        const filled = Math.round(d.score / maxScore * 12);
        const bar = "\u2588".repeat(filled).padEnd(12, "\u2591");
        console.log(`  ${c.dim(d.dimension.padEnd(24))} ${c.cyan(bar)} ${d.score.toFixed(2)}`);
      }
    }
    console.log();
    ok(`Run summary complete: ${c.bold(runId)}`);
    console.log(`  ${c.dim("Next:")} zeval harvest --run-id ${runId}`);
    console.log(`  ${c.dim("Or:  ")} zeval package --run-id ${runId}`);
    console.log();
  });
}

// src/cli/index.ts
var program = new import_commander.Command();
program.name("zeval").description(
  `${c.bold(c.cyan("Zeval"))} \u2014 AI conversation quality evaluation CLI
  ${c.dim("Evaluate chatlogs, harvest bad cases, build remediation packages.")}`
).version("2.1.0", "-v, --version", "Print version and exit");
registerEvaluateCommand(program);
registerHarvestCommand(program);
registerPackageCommand(program);
registerRunsCommand(program);
program.parse(process.argv);
