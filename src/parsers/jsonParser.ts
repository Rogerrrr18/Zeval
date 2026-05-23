/**
 * @fileoverview JSON parser for raw chatlog rows.
 */

import type { RawChatlogRow } from "@/types/pipeline";

const ALLOWED_ROLES = new Set<RawChatlogRow["role"]>(["user", "assistant", "system"]);

/**
 * Parse JSON text into raw rows.
 * @param text Raw JSON text.
 * @returns Parsed raw chat rows.
 */
export function parseJsonRows(text: string): RawChatlogRow[] {
  const parsed = parseJsonOrJsonl(text);
  const sgdDialogues = getSgdDialogues(parsed);
  if (sgdDialogues.length > 0) {
    return parseSgdDialogues(sgdDialogues);
  }

  const arrayData = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed !== null && "messages" in parsed
      ? (parsed as { messages: unknown[] }).messages
      : [];

  return arrayData.flatMap((item, index) => {
    if (!item || typeof item !== "object") {
      return [];
    }
    const record = item as Record<string, unknown>;
    const role = String(record.role ?? "").toLowerCase() as RawChatlogRow["role"];
    if (!ALLOWED_ROLES.has(role)) {
      return [];
    }
    return [
      {
        sessionId: String(record.sessionId ?? "json_session_001"),
        timestamp: String(record.timestamp ?? new Date(Date.now() + index * 1000).toISOString()),
        role,
        content: String(record.content ?? ""),
      },
    ];
  });
}

/**
 * Parse JSON or newline-delimited JSON text.
 * @param text Raw JSON or JSONL text.
 * @returns Parsed value.
 */
function parseJsonOrJsonl(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    const records = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
    if (records.length === 0) {
      throw error;
    }
    return records;
  }
}

type SgdDialogue = {
  dialogue_id?: unknown;
  turns?: unknown;
};

type SgdTurn = {
  speaker?: unknown;
  utterance?: unknown;
};

/**
 * Detect the DSTC8 Schema-Guided Dialogue JSON shape.
 * @param value Parsed JSON value.
 * @returns Whether value is an SGD dialogue array.
 */
function isSgdDialogueArray(value: unknown): value is SgdDialogue[] {
  return (
    Array.isArray(value) &&
    value.some(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        "dialogue_id" in item &&
        "turns" in item &&
        Array.isArray((item as SgdDialogue).turns),
    )
  );
}

/**
 * Extract SGD dialogues from raw array, wrapper object, or JSONL records.
 * @param value Parsed JSON value.
 * @returns SGD dialogue records.
 */
function getSgdDialogues(value: unknown): SgdDialogue[] {
  if (isSgdDialogueArray(value)) {
    return value;
  }
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { dialogues?: unknown }).dialogues)
  ) {
    return ((value as { dialogues: unknown[] }).dialogues).filter(isSgdDialogue);
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (isSgdDialogue(item)) {
        return [item];
      }
      if (
        item &&
        typeof item === "object" &&
        Array.isArray((item as { dialogues?: unknown }).dialogues)
      ) {
        return ((item as { dialogues: unknown[] }).dialogues).filter(isSgdDialogue);
      }
      return [];
    });
  }
  return [];
}

/**
 * Detect one DSTC8 Schema-Guided Dialogue record.
 * @param value Candidate value.
 * @returns Whether value has SGD dialogue shape.
 */
function isSgdDialogue(value: unknown): value is SgdDialogue {
  return (
    typeof value === "object" &&
    value !== null &&
    "dialogue_id" in value &&
    "turns" in value &&
    Array.isArray((value as SgdDialogue).turns)
  );
}

/**
 * Convert DSTC8 Schema-Guided Dialogue records into canonical raw rows.
 * @param dialogues SGD dialogue objects.
 * @returns Raw rows with synthetic timestamps.
 */
function parseSgdDialogues(dialogues: SgdDialogue[]): RawChatlogRow[] {
  return dialogues.flatMap((dialogue, dialogueIndex) => {
    const sessionId = String(dialogue.dialogue_id ?? `sgd_dialogue_${dialogueIndex + 1}`);
    const turns = Array.isArray(dialogue.turns) ? (dialogue.turns as SgdTurn[]) : [];
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
          content,
        },
      ];
    });
  });
}

/**
 * Map SGD speaker labels to the local chat role vocabulary.
 * @param speaker Raw SGD speaker value.
 * @returns Local role or null for unsupported speakers.
 */
function mapSgdSpeakerToRole(speaker: unknown): RawChatlogRow["role"] | null {
  const normalized = String(speaker ?? "").toUpperCase();
  if (normalized === "USER") {
    return "user";
  }
  if (normalized === "SYSTEM") {
    return "assistant";
  }
  return null;
}

/**
 * Build deterministic timestamps for datasets that do not include time fields.
 * @param dialogueIndex Dialogue index in the source file.
 * @param turnIndex Turn index inside one dialogue.
 * @returns ISO timestamp spaced by dialogue and turn order.
 */
function buildSyntheticTimestamp(dialogueIndex: number, turnIndex: number): string {
  return new Date(Date.UTC(2020, 0, 1 + dialogueIndex, 0, 0, turnIndex)).toISOString();
}
