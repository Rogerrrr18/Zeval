/**
 * @fileoverview Rule-first data onboarding and mapping-plan generation.
 */

import { splitCsvLine } from "@/lib/csv";
import { inferFormatFromFileName } from "@/parsers";
import type {
  DataCapabilityReport,
  DataFieldMapping,
  DataMappingPlan,
  DataSourceFormat,
  DataTransformPlan,
  DetectedDataStructure,
} from "@/types/data-onboarding";
import type { UploadFormat } from "@/types/pipeline";

type BuildDataMappingPlanInput = {
  text: string;
  format?: UploadFormat;
  fileName?: string;
};

type JsonProfile = {
  rootType: DetectedDataStructure["rootType"];
  value: unknown;
  recordCount: number;
  detectedFields: string[];
  samplePaths: string[];
};

const ROLE_FIELD_CANDIDATES = ["role", "speaker", "sender", "author", "from", "participant_type"];
const CONTENT_FIELD_CANDIDATES = ["content", "utterance", "message", "text", "body", "reply", "response"];
const SESSION_FIELD_CANDIDATES = ["sessionId", "session_id", "conversationId", "conversation_id", "dialogue_id", "chat_id", "thread_id"];
const TIMESTAMP_FIELD_CANDIDATES = ["timestamp", "created_at", "createdAt", "time", "datetime", "date"];

/**
 * Build a deterministic data mapping plan from uploaded source text.
 * @param input Uploaded text and optional format hints.
 * @returns Mapping plan with capability flags and warnings.
 */
export function buildDataMappingPlan(input: BuildDataMappingPlanInput): DataMappingPlan {
  const fileName = input.fileName ?? "upload.txt";
  const uploadFormat = input.format ?? inferFormatFromFileName(fileName);
  if (uploadFormat === "csv") {
    return buildCsvPlan(input.text, fileName, uploadFormat);
  }
  if (uploadFormat === "json" || uploadFormat === "jsonl") {
    return buildJsonPlan(input.text, fileName, uploadFormat);
  }
  return buildTextPlan(input.text, fileName, uploadFormat);
}

/**
 * Merge LLM review fields into a deterministic plan without replacing auditable mappings.
 * @param plan Base deterministic plan.
 * @param review LLM review payload.
 * @returns Plan with review notes.
 */
export function applyAgentReview(
  plan: DataMappingPlan,
  review: {
    summary?: string;
    confidence?: number;
    warnings?: string[];
    questionsForUser?: string[];
  },
): DataMappingPlan {
  const confidence = clamp01(review.confidence ?? plan.confidence);
  return {
    ...plan,
    confidence: Number(((plan.confidence + confidence) / 2).toFixed(2)),
    warnings: dedupeStrings([...plan.warnings, ...(review.warnings ?? [])]),
    questionsForUser: dedupeStrings([...plan.questionsForUser, ...(review.questionsForUser ?? [])]),
    agentReview: {
      status: "completed",
      summary: review.summary?.trim() || "LLM 已复核字段映射，未返回额外说明。",
      confidence,
    },
  };
}

/**
 * Mark a plan as LLM-degraded while preserving deterministic output.
 * @param plan Base plan.
 * @param message Degradation reason.
 * @returns Plan with degraded review metadata.
 */
export function markAgentReviewDegraded(plan: DataMappingPlan, message: string): DataMappingPlan {
  return {
    ...plan,
    warnings: dedupeStrings([...plan.warnings, `Data Onboarding Agent 降级：${message}`]),
    agentReview: {
      status: "degraded",
      summary: message,
      confidence: plan.confidence,
    },
  };
}

/**
 * Build a mapping plan for CSV input.
 * @param text CSV text.
 * @param fileName Upload file name.
 * @param uploadFormat Upload format.
 * @returns CSV mapping plan.
 */
function buildCsvPlan(text: string, fileName: string, uploadFormat: UploadFormat): DataMappingPlan {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const header = lines.length > 0 ? splitCsvLine(lines[0]).map((cell) => cell.trim()) : [];
  const mappings = buildMessageFieldMappingsFromFields("$", header);
  const transforms = buildMessageTransforms(mappings);
  const hasRole = mappings.some((item) => item.target === "messages.role");
  const hasContent = mappings.some((item) => item.target === "messages.content");
  const hasSession = mappings.some((item) => item.target === "messages.sessionId");
  const hasTimestamp = mappings.some((item) => item.target === "messages.timestamp");
  const sourceFormat: DataSourceFormat = hasRole && hasContent ? "plain-chatlog" : "custom-csv";
  const warnings: string[] = [];
  if (!hasSession) warnings.push("未检测到 session 字段，将需要按文件或窗口推断 session。");
  if (!hasTimestamp) warnings.push("未检测到 timestamp 字段，响应间隔和活跃时段指标会降级。");
  if (!hasRole || !hasContent) warnings.push("未检测到完整 role/content 映射，基础 chatlog 评估不可直接启用。");

  return createPlan({
    sourceFormat,
    uploadFormat,
    fileName,
    confidence: sourceFormat === "plain-chatlog" ? 0.92 : 0.62,
    detectedStructure: {
      rootType: "csv",
      recordCount: Math.max(0, lines.length - 1),
      messageCount: Math.max(0, lines.length - 1),
      detectedFields: header,
      samplePaths: header.map((field) => `$.${field}`),
    },
    fieldMappings: mappings,
    transforms,
    warnings,
    questionsForUser: hasRole && hasContent ? [] : ["请确认哪一列代表说话人，哪一列代表消息正文。"],
  });
}

/**
 * Build a mapping plan for JSON or JSONL input.
 * @param text JSON text.
 * @param fileName Upload file name.
 * @param uploadFormat Upload format.
 * @returns JSON mapping plan.
 */
function buildJsonPlan(text: string, fileName: string, uploadFormat: UploadFormat): DataMappingPlan {
  const profile = parseJsonProfile(text, uploadFormat);
  const sourceFormat = detectJsonSourceFormat(profile.value, uploadFormat);
  if (sourceFormat === "sgd") {
    return buildSgdPlan(profile, fileName, uploadFormat);
  }
  if (sourceFormat === "assetops") {
    return buildAssetOpsPlan(profile, fileName, uploadFormat);
  }
  return buildGenericJsonPlan(profile, fileName, uploadFormat, sourceFormat);
}

/**
 * Build a mapping plan for TXT or MD input.
 * @param text Source text.
 * @param fileName Upload file name.
 * @param uploadFormat Upload format.
 * @returns Text mapping plan.
 */
function buildTextPlan(text: string, fileName: string, uploadFormat: UploadFormat): DataMappingPlan {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const speakerLineCount = lines.filter((line) => /^(user|assistant|system)[:：]/i.test(line)).length;
  const basicChat = speakerLineCount >= 2;
  return createPlan({
    sourceFormat: basicChat ? "plain-chatlog" : "plain-text",
    uploadFormat,
    fileName,
    confidence: basicChat ? 0.72 : 0.38,
    detectedStructure: {
      rootType: "text",
      recordCount: lines.length,
      messageCount: basicChat ? speakerLineCount : lines.length,
      detectedFields: [],
      samplePaths: [],
    },
    fieldMappings: basicChat
      ? [
          mapping("$[*]", "messages.role", "line speaker prefix", 0.72, true, "role-normalize"),
          mapping("$[*]", "messages.content", "line body after colon", 0.72, true),
          mapping("$", "messages.sessionId", "fileName", 0.5, true, "copy"),
        ]
      : [],
    transforms: basicChat
      ? [
          { field: "messages.role", transform: "role-normalize", detail: "从 user/assistant/system 行前缀映射角色。" },
          { field: "messages.timestamp", transform: "timestamp-parse", detail: "文本缺失 timestamp 时使用上传顺序合成时间。" },
        ]
      : [],
    warnings: basicChat ? ["文本日志缺少结构化标注，只能启用基础对话评估。"] : ["未检测到稳定对话结构。"],
    questionsForUser: basicChat ? [] : ["请确认文本中是否存在固定的说话人标记，例如 user: / assistant:。"],
  });
}

/**
 * Build an SGD-specific plan.
 * @param profile JSON profile.
 * @param fileName Upload file name.
 * @param uploadFormat Upload format.
 * @returns SGD mapping plan.
 */
function buildSgdPlan(profile: JsonProfile, fileName: string, uploadFormat: UploadFormat): DataMappingPlan {
  const dialoguePath = getSgdDialogueBasePath(profile.value);
  const schemaPath = getSgdSchemaPath(profile.value);
  const schemaMappings = schemaPath
    ? [mapping(schemaPath, "schema.services", "schema", 0.92, false)]
    : [];
  return createPlan({
    sourceFormat: "sgd",
    uploadFormat,
    fileName,
    confidence: schemaPath ? 0.97 : 0.94,
    detectedStructure: {
      ...baseStructure(profile),
      conversationCount: countSgdDialogues(profile.value),
      messageCount: countSgdTurns(profile.value),
      detectedFields: dedupeStrings([
        ...profile.detectedFields,
        "dialogue_id",
        "services",
        "turns",
        "turns[].frames",
        "frames[].slots",
        "frames[].state.slot_values",
        "frames[].service_call",
        "frames[].service_results",
        "frames[].actions",
        ...(schemaPath ? ["schema[].service_name", "schema[].intents", "schema[].slots"] : []),
      ]),
      samplePaths: dedupeStrings([...profile.samplePaths, `${dialoguePath}.turns[*].frames[*].state.slot_values`]),
    },
    fieldMappings: [
      mapping(`${dialoguePath}.dialogue_id`, "messages.sessionId", "dialogue_id", 0.98, true),
      mapping(`${dialoguePath}.turns[*].speaker`, "messages.role", "speaker", 0.98, true, "role-normalize"),
      mapping(`${dialoguePath}.turns[*].utterance`, "messages.content", "utterance", 0.98, true),
      mapping(`${dialoguePath}.turns[*]`, "messages.timestamp", "turn index", 0.72, false, "timestamp-parse"),
      ...schemaMappings,
      mapping(`${dialoguePath}.turns[*].frames`, "annotations.frames", "frames", 0.98, false, "flatten-array"),
      mapping(`${dialoguePath}.turns[*].frames[*].slots`, "annotations.slotMentions", "slots", 0.95, false, "flatten-array"),
      mapping(`${dialoguePath}.turns[*].frames[*].state.slot_values`, "annotations.dialogueStates", "state.slot_values", 0.95, false),
      mapping(`${dialoguePath}.turns[*].frames[*].service_call`, "annotations.serviceCalls", "service_call", 0.95, false),
      mapping(`${dialoguePath}.turns[*].frames[*].service_results`, "annotations.serviceResults", "service_results", 0.95, false),
    ],
    transforms: [
      { field: "messages.role", transform: "role-normalize", detail: "SGD USER -> user，SYSTEM -> assistant。" },
      { field: "messages.timestamp", transform: "timestamp-parse", detail: "SGD 原始 turns 无 timestamp，按 turn 顺序生成合成时间。" },
      { field: "annotations.frames", transform: "flatten-array", detail: "按 turn/frame 展平，并保留 turnIndex 与 service name。" },
    ],
    warnings: [
      "SGD 中的 service_call 是 gold/标注轨迹；若没有实际 agent tool trace，只能做 gold 标注评估，不能比较模型实际调用。",
      ...(schemaPath ? [] : ["未检测到 schema/service definitions，schema-aware 指标会降级；slot/state/service_call 评估仍可用。"]),
    ],
    questionsForUser: ["这次要评估 SGD 原始对话质量，还是要把你的 Agent 输出/工具调用与 SGD gold service_call 对比？"],
  });
}

/**
 * Build an AssetOpsBench scenario-catalog plan.
 * @param profile JSON profile.
 * @param fileName Upload file name.
 * @param uploadFormat Upload format.
 * @returns AssetOps mapping plan.
 */
function buildAssetOpsPlan(profile: JsonProfile, fileName: string, uploadFormat: UploadFormat): DataMappingPlan {
  return createPlan({
    sourceFormat: "assetops",
    uploadFormat,
    fileName,
    confidence: 0.9,
    detectedStructure: {
      ...baseStructure(profile),
      detectedFields: dedupeStrings([...profile.detectedFields, "id", "type", "text", "category", "characteristic_form"]),
    },
    fieldMappings: [
      mapping("$[*].id", "gold.caseId", "id", 0.92, true),
      mapping("$[*].text", "messages.content", "text", 0.82, true),
      mapping("$[*].type", "gold.scenarioType", "type", 0.88, false),
      mapping("$[*].category", "gold.category", "category", 0.88, false),
      mapping("$[*].characteristic_form", "gold.expectedAnswer", "characteristic_form", 0.92, false),
    ],
    transforms: [
      { field: "messages.role", transform: "copy", detail: "AssetOps utterance catalog 只有用户问题，需要实际 Agent 回答/trace 才能完整评估。" },
    ],
    warnings: ["检测到 AssetOpsBench utterance catalog，而不是完整对话日志；请补充 Agent final answer 与 trace 后再跑端到端评估。"],
    questionsForUser: ["是否有对应的 Agent 输出 JSON、工具调用 trace 或 benchmark submission 文件？"],
  });
}

/**
 * Build a generic JSON mapping plan.
 * @param profile JSON profile.
 * @param fileName Upload file name.
 * @param uploadFormat Upload format.
 * @param sourceFormat Inferred source format.
 * @returns Generic mapping plan.
 */
function buildGenericJsonPlan(
  profile: JsonProfile,
  fileName: string,
  uploadFormat: UploadFormat,
  sourceFormat: DataSourceFormat,
): DataMappingPlan {
  const messageCandidate = findMessageArrayCandidate(profile.value);
  const fields = messageCandidate?.fields ?? profile.detectedFields;
  const mappings = messageCandidate
    ? buildMessageFieldMappingsFromFields(messageCandidate.path, fields)
    : buildMessageFieldMappingsFromFields("$", fields);
  const hasRole = mappings.some((item) => item.target === "messages.role");
  const hasContent = mappings.some((item) => item.target === "messages.content");
  const warnings: string[] = [];
  if (!messageCandidate) {
    warnings.push("未找到明确 messages/turns 数组，只生成弱映射建议。");
  }
  if (!hasRole || !hasContent) {
    warnings.push("未检测到完整 role/content 字段，基础对话评估需要人工确认映射。");
  }
  return createPlan({
    sourceFormat: hasRole && hasContent ? "plain-chatlog" : sourceFormat,
    uploadFormat,
    fileName,
    confidence: hasRole && hasContent ? 0.78 : 0.52,
    detectedStructure: {
      ...baseStructure(profile),
      messageCount: messageCandidate?.count,
    },
    fieldMappings: [
      ...mappings,
      ...detectOptionalJsonMappings(profile.value),
    ],
    transforms: buildMessageTransforms(mappings),
    warnings,
    questionsForUser: hasRole && hasContent ? [] : ["请确认 JSON 中哪一组数组代表对话消息。"],
  });
}

/**
 * Parse JSON/JSONL enough for profiling.
 * @param text Source text.
 * @param uploadFormat Upload format.
 * @returns JSON profile.
 */
function parseJsonProfile(text: string, uploadFormat: UploadFormat): JsonProfile {
  let value: unknown;
  let rootType: DetectedDataStructure["rootType"] = "unknown";
  if (uploadFormat === "jsonl") {
    value = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown);
    rootType = "jsonl";
  } else {
    try {
      value = JSON.parse(text) as unknown;
      rootType = Array.isArray(value) ? "array" : typeof value === "object" && value !== null ? "object" : "unknown";
    } catch {
      value = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown);
      rootType = "jsonl";
    }
  }
  const detectedFields = collectTopLevelFields(value);
  return {
    rootType,
    value,
    recordCount: Array.isArray(value) ? value.length : typeof value === "object" && value !== null ? 1 : 0,
    detectedFields,
    samplePaths: collectSamplePaths(value).slice(0, 30),
  };
}

/**
 * Detect well-known JSON source formats.
 * @param value Parsed JSON value.
 * @param uploadFormat Upload format.
 * @returns Source format.
 */
function detectJsonSourceFormat(value: unknown, uploadFormat: UploadFormat): DataSourceFormat {
  const sample = Array.isArray(value) ? value[0] : value;
  if (containsSgdDialogues(value)) {
    return "sgd";
  }
  if (isObject(sample) && "id" in sample && "text" in sample && "characteristic_form" in sample) {
    return "assetops";
  }
  return uploadFormat === "jsonl" ? "custom-jsonl" : "custom-json";
}

/**
 * Build message mappings from a flat field list.
 * @param basePath Base record path.
 * @param fields Field names.
 * @returns Mapping candidates.
 */
function buildMessageFieldMappingsFromFields(basePath: string, fields: string[]): DataFieldMapping[] {
  const session = findField(fields, SESSION_FIELD_CANDIDATES);
  const role = findField(fields, ROLE_FIELD_CANDIDATES);
  const content = findField(fields, CONTENT_FIELD_CANDIDATES);
  const timestamp = findField(fields, TIMESTAMP_FIELD_CANDIDATES);
  return [
    session ? mapping(`${basePath}.${session}`, "messages.sessionId", session, 0.86, true) : null,
    role ? mapping(`${basePath}.${role}`, "messages.role", role, 0.88, true, "role-normalize") : null,
    content ? mapping(`${basePath}.${content}`, "messages.content", content, 0.9, true) : null,
    timestamp ? mapping(`${basePath}.${timestamp}`, "messages.timestamp", timestamp, 0.8, false, "timestamp-parse") : null,
  ].filter((item): item is DataFieldMapping => Boolean(item));
}

/**
 * Build transforms implied by basic message mappings.
 * @param mappings Mapping candidates.
 * @returns Transform plan.
 */
function buildMessageTransforms(mappings: DataFieldMapping[]): DataTransformPlan[] {
  const transforms: DataTransformPlan[] = [];
  if (mappings.some((item) => item.target === "messages.role")) {
    transforms.push({ field: "messages.role", transform: "role-normalize", detail: "将 human/bot/system 等角色归一到 user/assistant/system。" });
  }
  if (mappings.some((item) => item.target === "messages.timestamp")) {
    transforms.push({ field: "messages.timestamp", transform: "timestamp-parse", detail: "解析时间字符串，失败时标记时序指标降级。" });
  }
  return transforms;
}

/**
 * Detect optional rich JSON structures by key presence.
 * @param value Parsed JSON value.
 * @returns Optional mapping candidates.
 */
function detectOptionalJsonMappings(value: unknown): DataFieldMapping[] {
  const paths = collectSamplePaths(value);
  return [
    paths.some((path) => path.endsWith(".frames")) ? mapping("$.**.frames", "annotations.frames", "frames", 0.72, false, "flatten-array") : null,
    paths.some((path) => path.includes(".slots")) ? mapping("$.**.slots", "annotations.slotMentions", "slots", 0.7, false, "flatten-array") : null,
    paths.some((path) => path.includes(".state")) ? mapping("$.**.state", "annotations.dialogueStates", "state", 0.68, false) : null,
    paths.some((path) => path.includes("service_call")) ? mapping("$.**.service_call", "annotations.serviceCalls", "service_call", 0.76, false) : null,
    paths.some((path) => path.includes("service_results")) ? mapping("$.**.service_results", "annotations.serviceResults", "service_results", 0.76, false) : null,
    paths.some((path) => path.includes("tool_calls")) ? mapping("$.**.tool_calls", "actualTrace.toolCalls", "tool_calls", 0.74, false) : null,
    paths.some((path) => path.includes("tool_results")) ? mapping("$.**.tool_results", "actualTrace.toolResults", "tool_results", 0.74, false) : null,
  ].filter((item): item is DataFieldMapping => Boolean(item));
}

/**
 * Find a likely array of message records in custom JSON.
 * @param value Parsed JSON.
 * @returns Candidate path and fields.
 */
function findMessageArrayCandidate(value: unknown): { path: string; fields: string[]; count: number } | null {
  const candidates: Array<{ path: string; fields: string[]; count: number; score: number }> = [];
  visitJson(value, "$", (path, candidate) => {
    if (!Array.isArray(candidate) || candidate.length === 0 || !isObject(candidate[0])) {
      return;
    }
    const fields = Object.keys(candidate[0]);
    const hasContent = Boolean(findField(fields, CONTENT_FIELD_CANDIDATES));
    const hasRole = Boolean(findField(fields, ROLE_FIELD_CANDIDATES));
    const nameBonus = /(messages|turns|conversation|dialogue|chat)/i.test(path) ? 0.2 : 0;
    const score = (hasContent ? 0.45 : 0) + (hasRole ? 0.35 : 0) + nameBonus;
    if (score > 0.4) {
      candidates.push({ path: `${path}[*]`, fields, count: candidate.length, score });
    }
  });
  return candidates.sort((left, right) => right.score - left.score)[0] ?? null;
}

/**
 * Create a mapping object.
 */
function mapping(
  path: string,
  target: string,
  sourceField: string,
  confidence: number,
  required: boolean,
  transform?: DataFieldMapping["transform"],
): DataFieldMapping {
  return { path, target, sourceField, confidence, required, transform };
}

/**
 * Create a final plan with computed capabilities.
 */
function createPlan(input: {
  sourceFormat: DataSourceFormat;
  uploadFormat: UploadFormat;
  fileName: string;
  confidence: number;
  detectedStructure: DetectedDataStructure;
  fieldMappings: DataFieldMapping[];
  transforms: DataTransformPlan[];
  warnings: string[];
  questionsForUser: string[];
}): DataMappingPlan {
  const capabilityReport = buildCapabilityReport(input.fieldMappings);
  return {
    planId: `map_${Date.now()}`,
    sourceFormat: input.sourceFormat,
    uploadFormat: input.uploadFormat,
    fileName: input.fileName,
    confidence: input.confidence,
    detectedStructure: input.detectedStructure,
    fieldMappings: input.fieldMappings,
    transforms: input.transforms,
    capabilityReport,
    warnings: input.warnings,
    questionsForUser: input.questionsForUser,
    agentReview: {
      status: "not_requested",
      summary: "尚未请求 LLM 复核。",
      confidence: input.confidence,
    },
  };
}

/**
 * Build capability flags from mapping targets.
 * @param mappings Field mappings.
 * @returns Capability report.
 */
function buildCapabilityReport(mappings: DataFieldMapping[]): DataCapabilityReport {
  const targets = new Set(mappings.map((item) => item.target));
  const basicChat = targets.has("messages.role") && targets.has("messages.content");
  const schemaAware = [...targets].some((target) => target.startsWith("schema."));
  const slotEval = targets.has("annotations.slotMentions") || targets.has("annotations.dialogueStates");
  const stateTracking = targets.has("annotations.dialogueStates");
  const serviceCallEval = targets.has("annotations.serviceCalls");
  const serviceResultGrounding = targets.has("annotations.serviceResults");
  const actualToolTraceEval = targets.has("actualTrace.toolCalls") || targets.has("actualTrace.toolResults");
  const benchmarkGoldEval = [...targets].some((target) => target.startsWith("gold.")) || serviceCallEval;
  const enabledMetricGroups: string[] = [];
  const disabledMetricGroups: DataCapabilityReport["disabledMetricGroups"] = [];

  pushCapability(enabledMetricGroups, disabledMetricGroups, basicChat, "basic_chat_eval", "缺少 role/content 消息映射。");
  pushCapability(enabledMetricGroups, disabledMetricGroups, schemaAware, "schema_aware_eval", "缺少 schema/service 定义。");
  pushCapability(enabledMetricGroups, disabledMetricGroups, slotEval, "slot_eval", "缺少 slot 或 dialogue state 标注。");
  pushCapability(enabledMetricGroups, disabledMetricGroups, stateTracking, "state_tracking_eval", "缺少 dialogue state 快照。");
  pushCapability(enabledMetricGroups, disabledMetricGroups, serviceCallEval, "service_call_eval", "缺少 service_call/tool_call 标注。");
  pushCapability(enabledMetricGroups, disabledMetricGroups, serviceResultGrounding, "service_result_grounding", "缺少 service_results/tool_results。");
  pushCapability(enabledMetricGroups, disabledMetricGroups, actualToolTraceEval, "actual_tool_trace_eval", "缺少实际 Agent 工具调用轨迹。");

  return {
    basicChat,
    schemaAware,
    slotEval,
    stateTracking,
    serviceCallEval,
    serviceResultGrounding,
    actualToolTraceEval,
    benchmarkGoldEval,
    enabledMetricGroups,
    disabledMetricGroups,
  };
}

/**
 * Add one capability to enabled or disabled lists.
 */
function pushCapability(
  enabled: string[],
  disabled: DataCapabilityReport["disabledMetricGroups"],
  value: boolean,
  group: string,
  reason: string,
) {
  if (value) {
    enabled.push(group);
  } else {
    disabled.push({ group, reason });
  }
}

function baseStructure(profile: JsonProfile): DetectedDataStructure {
  return {
    rootType: profile.rootType,
    recordCount: profile.recordCount,
    detectedFields: profile.detectedFields,
    samplePaths: profile.samplePaths,
  };
}

/**
 * Detect whether parsed JSON contains SGD dialogue records.
 * @param value Parsed JSON value.
 * @returns True when at least one SGD dialogue record exists.
 */
function containsSgdDialogues(value: unknown): boolean {
  return extractSgdDialogues(value).length > 0;
}

/**
 * Resolve the JSONPath-like base path for SGD dialogue records.
 * @param value Parsed JSON value.
 * @returns Dialogue base path used by mapping records.
 */
function getSgdDialogueBasePath(value: unknown): string {
  if (Array.isArray(value) && value.some(isSgdDialogueRecord)) {
    return "$[*]";
  }
  if (isObject(value)) {
    if (Array.isArray(value.dialogues) && value.dialogues.some(isSgdDialogueRecord)) {
      return "$.dialogues[*]";
    }
    if (Array.isArray(value.data) && value.data.some(isSgdDialogueRecord)) {
      return "$.data[*]";
    }
  }
  return "$[*]";
}

/**
 * Resolve the JSONPath-like path for embedded SGD service schema.
 * @param value Parsed JSON value.
 * @returns Schema path, or null when no schema is embedded.
 */
function getSgdSchemaPath(value: unknown): string | null {
  if (Array.isArray(value) && value.some(isSgdSchemaRecord)) {
    return "$[*]";
  }
  if (isObject(value)) {
    if (Array.isArray(value.schema) && value.schema.some(isSgdSchemaRecord)) {
      return "$.schema";
    }
    if (isObject(value.schema) && Array.isArray(value.schema.services) && value.schema.services.some(isSgdSchemaRecord)) {
      return "$.schema.services";
    }
    if (Array.isArray(value.services) && value.services.some(isSgdSchemaRecord)) {
      return "$.services";
    }
  }
  return null;
}

/**
 * Count SGD turns across array or wrapper payloads.
 * @param value Parsed JSON value.
 * @returns Number of dialogue turns.
 */
function countSgdTurns(value: unknown): number {
  return extractSgdDialogues(value).reduce((sum, item) => sum + (Array.isArray(item.turns) ? item.turns.length : 0), 0);
}

/**
 * Count SGD dialogue records across array or wrapper payloads.
 * @param value Parsed JSON value.
 * @returns Number of dialogues.
 */
function countSgdDialogues(value: unknown): number {
  return extractSgdDialogues(value).length;
}

/**
 * Extract SGD dialogue records from common array and wrapper payloads.
 * @param value Parsed JSON value.
 * @returns SGD dialogue records.
 */
function extractSgdDialogues(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.filter(isSgdDialogueRecord);
  }
  if (isObject(value)) {
    if (Array.isArray(value.dialogues)) {
      return value.dialogues.filter(isSgdDialogueRecord);
    }
    if (Array.isArray(value.data)) {
      return value.data.filter(isSgdDialogueRecord);
    }
    if (isSgdDialogueRecord(value)) {
      return [value];
    }
  }
  return [];
}

/**
 * Detect one SGD dialogue record.
 * @param value Candidate record.
 * @returns True when candidate has dialogue_id and turns.
 */
function isSgdDialogueRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && "dialogue_id" in value && Array.isArray(value.turns);
}

/**
 * Detect one SGD service schema record.
 * @param value Candidate record.
 * @returns True when candidate has service_name, intents and slots.
 */
function isSgdSchemaRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value) && "service_name" in value && Array.isArray(value.intents) && Array.isArray(value.slots);
}

function collectTopLevelFields(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.slice(0, 5).flatMap((item) => (isObject(item) ? Object.keys(item) : []));
  }
  return isObject(value) ? Object.keys(value) : [];
}

function collectSamplePaths(value: unknown): string[] {
  const paths: string[] = [];
  visitJson(value, "$", (path, candidate) => {
    if (isObject(candidate)) {
      Object.keys(candidate).forEach((key) => paths.push(`${path}.${key}`));
    }
  }, 3);
  return dedupeStrings(paths);
}

function visitJson(
  value: unknown,
  path: string,
  visitor: (path: string, value: unknown) => void,
  maxDepth = 4,
  depth = 0,
) {
  visitor(path, value);
  if (depth >= maxDepth) return;
  if (Array.isArray(value)) {
    value.slice(0, 3).forEach((item) => visitJson(item, `${path}[*]`, visitor, maxDepth, depth + 1));
    return;
  }
  if (isObject(value)) {
    Object.entries(value).slice(0, 20).forEach(([key, item]) => visitJson(item, `${path}.${key}`, visitor, maxDepth, depth + 1));
  }
}

function findField(fields: string[], candidates: string[]): string | null {
  const lower = new Map(fields.map((field) => [field.toLowerCase(), field]));
  for (const candidate of candidates) {
    const exact = lower.get(candidate.toLowerCase());
    if (exact) return exact;
  }
  return fields.find((field) => candidates.some((candidate) => field.toLowerCase().includes(candidate.toLowerCase()))) ?? null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
