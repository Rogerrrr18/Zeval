/**
 * @fileoverview Deterministic normalization from mapping plans into raw chat rows.
 */

import { splitCsvLine } from "@/lib/csv";
import type { DataMappingPlan } from "@/types/data-onboarding";
import type { RawChatlogRow } from "@/types/pipeline";

const ROLE_MAP: Record<string, RawChatlogRow["role"]> = {
  user: "user",
  human: "user",
  customer: "user",
  client: "user",
  speaker: "user",
  assistant: "assistant",
  bot: "assistant",
  agent: "assistant",
  system: "system",
};

/**
 * Normalize uploaded source text into raw chat rows by applying a mapping plan.
 * @param text Source text.
 * @param plan Data mapping plan.
 * @returns Raw rows or an empty list when the plan is insufficient.
 */
export function normalizeSourceWithMappingPlan(text: string, plan: DataMappingPlan): RawChatlogRow[] {
  if (!plan.capabilityReport.basicChat) {
    return [];
  }
  if (plan.uploadFormat === "csv") {
    return normalizeCsvWithPlan(text, plan);
  }
  if (plan.uploadFormat === "json" || plan.uploadFormat === "jsonl") {
    return normalizeJsonWithPlan(text, plan);
  }
  return [];
}

/**
 * Normalize CSV source with a mapping plan.
 * @param text CSV source.
 * @param plan Mapping plan.
 * @returns Raw rows.
 */
function normalizeCsvWithPlan(text: string, plan: DataMappingPlan): RawChatlogRow[] {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length <= 1) {
    return [];
  }
  const header = splitCsvLine(lines[0]).map((cell) => cell.trim());
  const fields = resolveMessageFields(plan);
  const indexes = {
    sessionId: fields.sessionId ? header.indexOf(fields.sessionId) : -1,
    role: fields.role ? header.indexOf(fields.role) : -1,
    content: fields.content ? header.indexOf(fields.content) : -1,
    timestamp: fields.timestamp ? header.indexOf(fields.timestamp) : -1,
  };
  if (indexes.role < 0 || indexes.content < 0) {
    return [];
  }

  return lines.slice(1).flatMap((line, index) => {
    const cells = splitCsvLine(line);
    const role = normalizeRole(cells[indexes.role]);
    const content = String(cells[indexes.content] ?? "").trim();
    if (!role || !content) {
      return [];
    }
    return [
      {
        sessionId: indexes.sessionId >= 0 ? String(cells[indexes.sessionId] ?? "csv_session_001") : "csv_session_001",
        timestamp:
          indexes.timestamp >= 0 && cells[indexes.timestamp]
            ? String(cells[indexes.timestamp])
            : new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
        role,
        content,
      },
    ];
  });
}

/**
 * Normalize JSON or JSONL source with a mapping plan.
 * @param text JSON source.
 * @param plan Mapping plan.
 * @returns Raw rows.
 */
function normalizeJsonWithPlan(text: string, plan: DataMappingPlan): RawChatlogRow[] {
  const parsed = parseJsonOrJsonl(text, plan.uploadFormat);
  const fields = resolveMessageFields(plan);
  if (!fields.role || !fields.content) {
    return [];
  }
  const records = extractMessageRecords(parsed, plan);
  return records.flatMap((record, index) => {
    const role = normalizeRole(readRecordField(record.message, fields.role));
    const content = String(readRecordField(record.message, fields.content) ?? "").trim();
    if (!role || !content) {
      return [];
    }
    const sessionId =
      readRecordField(record.message, fields.sessionId) ??
      readRecordField(record.parent, fields.sessionId) ??
      "json_session_001";
    const timestamp = readRecordField(record.message, fields.timestamp);
    return [
      {
        sessionId: String(sessionId),
        timestamp: timestamp ? String(timestamp) : new Date(Date.UTC(2020, 0, 1, 0, 0, index)).toISOString(),
        role,
        content,
      },
    ];
  });
}

/**
 * Extract record arrays supported by the first mapper version.
 * @param parsed Parsed JSON value.
 * @param plan Mapping plan.
 * @returns Message records with optional parent context.
 */
function extractMessageRecords(
  parsed: unknown,
  plan: DataMappingPlan,
): Array<{ message: Record<string, unknown>; parent?: Record<string, unknown> }> {
  const roleMapping = plan.fieldMappings.find((item) => item.target === "messages.role");
  const path = roleMapping?.path ?? "";
  if (Array.isArray(parsed) && path.startsWith("$[*].turns[*]")) {
    return parsed.flatMap((parent) => {
      if (!isRecord(parent) || !Array.isArray(parent.turns)) return [];
      return parent.turns.filter(isRecord).map((message) => ({ message, parent }));
    });
  }
  if (isRecord(parsed) && path.startsWith("$.dialogues[*].turns[*]") && Array.isArray(parsed.dialogues)) {
    return parsed.dialogues.flatMap((parent) => {
      if (!isRecord(parent) || !Array.isArray(parent.turns)) return [];
      return parent.turns.filter(isRecord).map((message) => ({ message, parent }));
    });
  }
  if (isRecord(parsed) && path.startsWith("$.data[*].turns[*]") && Array.isArray(parsed.data)) {
    return parsed.data.flatMap((parent) => {
      if (!isRecord(parent) || !Array.isArray(parent.turns)) return [];
      return parent.turns.filter(isRecord).map((message) => ({ message, parent }));
    });
  }
  if (Array.isArray(parsed) && path.startsWith("$[*]")) {
    return parsed.filter(isRecord).map((message) => ({ message }));
  }
  if (isRecord(parsed)) {
    if (Array.isArray(parsed.messages)) {
      return parsed.messages.filter(isRecord).map((message) => ({ message, parent: parsed }));
    }
    if (Array.isArray(parsed.turns)) {
      return parsed.turns.filter(isRecord).map((message) => ({ message, parent: parsed }));
    }
    if (Array.isArray(parsed.conversations)) {
      return parsed.conversations.flatMap((conversation) => {
        if (!isRecord(conversation)) return [];
        const turns = Array.isArray(conversation.turns)
          ? conversation.turns
          : Array.isArray(conversation.messages)
            ? conversation.messages
            : [];
        return turns.filter(isRecord).map((message) => ({ message, parent: conversation }));
      });
    }
  }
  return [];
}

/**
 * Resolve mapped source field names for raw messages.
 * @param plan Mapping plan.
 * @returns Source field map.
 */
function resolveMessageFields(plan: DataMappingPlan): Partial<Record<keyof RawChatlogRow, string>> {
  return {
    sessionId: plan.fieldMappings.find((item) => item.target === "messages.sessionId")?.sourceField,
    role: plan.fieldMappings.find((item) => item.target === "messages.role")?.sourceField,
    content: plan.fieldMappings.find((item) => item.target === "messages.content")?.sourceField,
    timestamp: plan.fieldMappings.find((item) => item.target === "messages.timestamp")?.sourceField,
  };
}

/**
 * Parse JSON or JSONL text.
 * @param text Source text.
 * @param format Upload format.
 * @returns Parsed value.
 */
function parseJsonOrJsonl(text: string, format: DataMappingPlan["uploadFormat"]): unknown {
  if (format === "jsonl") {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => JSON.parse(line) as unknown);
  }
}

/**
 * Normalize many common role vocabularies.
 * @param value Raw role value.
 * @returns Internal role or null.
 */
function normalizeRole(value: unknown): RawChatlogRow["role"] | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ROLE_MAP[normalized] ?? null;
}

function readRecordField(record: Record<string, unknown> | undefined, field: string | undefined): unknown {
  if (!record || !field) {
    return undefined;
  }
  return record[field];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
