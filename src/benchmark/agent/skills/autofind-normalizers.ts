/**
 * @fileoverview Normalize discovered dataset payloads into Zeval CSV.
 */

export type NormalizeCsvInput = {
  rawText: string;
  contentType?: string;
  searchProfile: string;
  positiveCount: number;
  negativeCount: number;
  sessionPrefix: string;
};

export type DialogueSessionPoolItem = {
  poolId: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  relevanceScore: number;
  preview: string;
};

export type CuratedDialogueSessions = {
  positive: Array<{ messages: Array<{ role: "user" | "assistant"; content: string }> }>;
  negative: Array<{ messages: Array<{ role: "user" | "assistant"; content: string }> }>;
};

export type ExtractSessionPoolInput = {
  rawText: string;
  contentType?: string;
  searchProfile: string;
  maxSessions?: number;
};

export type CpsyItem = {
  history?: Array<[string, string]>;
  instruction?: string;
  output?: string;
};

export type EsconvItem = {
  dialog?: Array<{ speaker?: string; text?: string; content?: string }>;
};

export type GenericDialogueItem = {
  session_id?: string;
  sessionId?: string;
  messages?: Array<{ role?: string; content?: string; text?: string }>;
  conversations?: Array<{ from?: string; value?: string; role?: string; content?: string }>;
};

export type InputOutputItem = {
  input?: string;
  instruction?: string;
  question?: string;
  prompt?: string;
  query?: string;
  output?: string;
  response?: string;
  answer?: string;
  category?: string;
};

export type ConversationTextItem = {
  conversation?: string;
  dialogue?: string;
  dialog?: string | Array<unknown>;
  dia?: string;
  chat?: string;
  context?: string;
};

/**
 * Detect whether raw text is already Zeval CSV.
 *
 * @param rawText Dataset text.
 * @returns True when header matches Zeval ingest format.
 */
export function isZevalCsv(rawText: string): boolean {
  const header = rawText.trim().split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  return header.includes("sessionid") && header.includes("role") && header.includes("content");
}

/**
 * Normalize a downloaded dataset into Zeval CSV.
 *
 * @param input Raw dataset text and sampling options.
 * @returns Zeval CSV text or null when format is unsupported.
 */
/**
 * Extract a ranked dialogue session pool from a downloaded dataset payload.
 *
 * @param input Raw dataset text and task profile.
 * @returns Dialogue sessions with previews for LLM curation; empty when unsupported.
 */
export function extractDialogueSessionPool(input: ExtractSessionPoolInput): DialogueSessionPoolItem[] {
  const trimmed = input.rawText.trim();
  if (!trimmed) return [];

  if (isZevalCsv(trimmed)) {
    return parseZevalCsvPool(trimmed, input.searchProfile, input.maxSessions ?? 60);
  }

  if (looksLikeJsonl(trimmed)) {
    return extractJsonlSessionPool(trimmed, input);
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return extractJsonSessionPool(parsed, input);
    } catch {
      return [];
    }
  }

  return extractLooseCsvSessionPool(trimmed, input);
}

/**
 * Parse multi-turn dialogue text with speaker prefixes into Zeval messages.
 *
 * @param text Raw conversation text.
 * @returns User/assistant message list.
 */
export function parseConversationText(
  text: string,
): Array<{ role: "user" | "assistant"; content: string }> {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  const lines = normalized.split("\n");
  let currentRole: "user" | "assistant" | null = null;
  let currentContent: string[] = [];

  const flush = () => {
    const content = currentContent.join("\n").trim();
    if (currentRole && content) {
      messages.push({ role: currentRole, content });
    }
    currentRole = null;
    currentContent = [];
  };

  for (const line of lines) {
    const match = line.match(
      /^(agent|customer|user|system|assistant|human|bot|counselor|listener)\s*:\s*(.*)$/i,
    );
    if (match) {
      flush();
      currentRole = /agent|system|assistant|bot|counselor|listener/i.test(match[1])
        ? "assistant"
        : "user";
      if (match[2]?.trim()) currentContent.push(match[2].trim());
      continue;
    }
    if (currentRole) currentContent.push(line);
  }
  flush();
  return messages.filter((message) => message.content);
}

/**
 * Build Zeval CSV from curated positive/negative sessions.
 *
 * @param curated Positive and negative session groups.
 * @param sessionPrefix Zeval sessionId prefix.
 * @returns Zeval CSV text.
 */
export function buildCsvFromCuratedSessions(
  curated: CuratedDialogueSessions,
  sessionPrefix: string,
): string {
  const sessions = [
    ...curated.positive.map((entry, index) => ({
      sessionId: `${sessionPrefix}pos_${String(index + 1).padStart(2, "0")}`,
      messages: entry.messages,
      label: "positive" as const,
    })),
    ...curated.negative.map((entry, index) => ({
      sessionId: `${sessionPrefix}neg_${String(index + 1).padStart(2, "0")}`,
      messages: entry.messages,
      label: "negative" as const,
    })),
  ];
  return sessionsToCsv(sessions, sessions.length) ?? "";
}

/**
 * Rule-based fallback when LLM session curation is unavailable.
 *
 * @param pool Extracted session pool.
 * @param positiveCount Required positive sessions.
 * @param negativeCount Required negative sessions.
 * @returns Top-ranked positive and next-ranked negative sessions.
 */
export function fallbackCurateSessions(
  pool: DialogueSessionPoolItem[],
  positiveCount: number,
  negativeCount: number,
): CuratedDialogueSessions {
  const sorted = [...pool].sort(
    (left, right) => right.relevanceScore - left.relevanceScore || right.messages.length - left.messages.length,
  );
  return {
    positive: sorted.slice(0, positiveCount).map((entry) => ({ messages: entry.messages })),
    negative: sorted
      .slice(positiveCount, positiveCount + negativeCount)
      .map((entry) => ({ messages: entry.messages })),
  };
}

export function normalizeDatasetToCsv(input: NormalizeCsvInput): string | null {
  const trimmed = input.rawText.trim();
  if (!trimmed) return null;
  if (isZevalCsv(trimmed)) {
    return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  }

  if (looksLikeJsonl(trimmed)) {
    const pool = extractJsonlSessionPool(trimmed, input);
    return buildCsvFromSessionPool(pool, input);
  }

  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return normalizeJsonDataset(parsed, input);
    } catch {
      return null;
    }
  }

  return normalizeLooseCsv(trimmed, input);
}

function extractJsonSessionPool(parsed: unknown, input: ExtractSessionPoolInput): DialogueSessionPoolItem[] {
  if (!Array.isArray(parsed) || parsed.length === 0) return [];

  if (looksLikeCpsy(parsed[0])) {
    return buildPoolFromCpsy(parsed as CpsyItem[], input);
  }
  if (looksLikeEsconv(parsed[0])) {
    return buildPoolFromEsconv(parsed as EsconvItem[], input);
  }
  if (looksLikeConversationText(parsed[0])) {
    return buildPoolFromConversationText(parsed as ConversationTextItem[], input);
  }
  if (looksLikeInputOutput(parsed[0])) {
    return buildPoolFromInputOutput(parsed as InputOutputItem[], input);
  }
  if (looksLikeGenericDialogue(parsed[0])) {
    return buildPoolFromGenericDialogue(parsed as GenericDialogueItem[], input);
  }
  return [];
}

function extractJsonlSessionPool(rawText: string, input: ExtractSessionPoolInput): DialogueSessionPoolItem[] {
  const records = parseJsonlRecords(rawText);
  if (records.length === 0) return [];
  return extractJsonSessionPool(records, input);
}

function extractLooseCsvSessionPool(rawText: string, input: ExtractSessionPoolInput): DialogueSessionPoolItem[] {
  const sessions = parseCsvDialogueSessions(rawText);
  return buildPoolFromParsedSessions(sessions, input);
}

function parseCsvDialogueSessions(
  rawText: string,
): Array<{ sessionId: string; messages: Array<{ role: "user" | "assistant"; content: string }> }> {
  const records = splitCsvRecords(rawText);
  if (records.length < 2) return [];

  const header = splitCsvLine(records[0]).map((cell) => cell.trim().toLowerCase());
  const findIdx = (pattern: RegExp) => header.findIndex((cell) => pattern.test(cell));

  const diaIdx = findIdx(/^dia$|dialogue|conversation|dialog$|chat$/);
  const sessionIdx = findIdx(/dia_no|session_id|sessionid|conversation_id|dialog_id/);
  const userIdx = findIdx(/^user$|question|customer|instruction|query|prompt|input$/);
  const assistantIdx = findIdx(/^assistant$|answer|response|reply|agent|output$/);
  const contextIdx = findIdx(/^context$/);

  if (diaIdx >= 0 || findIdx(/^conversation$/) >= 0) {
    const textIdx = diaIdx >= 0 ? diaIdx : findIdx(/^conversation$/);
    const sessions: Array<{ sessionId: string; messages: Array<{ role: "user" | "assistant"; content: string }> }> = [];
    for (let index = 1; index < records.length; index += 1) {
      const cells = splitCsvLine(records[index]);
      const text = unquoteCsvCell(cells[textIdx]);
      const messages = parseConversationText(text);
      if (messages.length >= 4) {
        sessions.push({ sessionId: `row_${index}`, messages });
      }
    }
    return sessions;
  }

  if (sessionIdx >= 0 && (contextIdx >= 0 || assistantIdx >= 0)) {
    const grouped = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
    for (let index = 1; index < records.length; index += 1) {
      const cells = splitCsvLine(records[index]);
      const sessionId = unquoteCsvCell(cells[sessionIdx]) || `row_${index}`;
      const context = contextIdx >= 0 ? parseConversationText(unquoteCsvCell(cells[contextIdx])) : [];
      const response = assistantIdx >= 0 ? parseConversationText(unquoteCsvCell(cells[assistantIdx])) : [];
      const merged = [...context, ...response].filter(Boolean);
      if (merged.length === 0) continue;
      const existing = grouped.get(sessionId) ?? [];
      grouped.set(sessionId, [...existing, ...merged]);
    }
    return [...grouped.entries()]
      .map(([sessionId, messages]) => ({ sessionId, messages }))
      .filter((entry) => entry.messages.length >= 4);
  }

  if (userIdx >= 0 && assistantIdx >= 0) {
    const sessions: Array<{ sessionId: string; messages: Array<{ role: "user" | "assistant"; content: string }> }> = [];
    for (let index = 1; index < records.length; index += 1) {
      const cells = splitCsvLine(records[index]);
      const user = unquoteCsvCell(cells[userIdx]);
      const assistant = unquoteCsvCell(cells[assistantIdx]);
      if (!user && !assistant) continue;
      sessions.push({
        sessionId: `row_${index}`,
        messages: [
          ...(user ? [{ role: "user" as const, content: user }] : []),
          ...(assistant ? [{ role: "assistant" as const, content: assistant }] : []),
        ],
      });
    }
    const grouped = groupSingleTurnRows(
      sessions.map((session) => ({
        session_id: session.sessionId,
        messages: session.messages,
      })),
    );
    return grouped.map((item, index) => ({
      sessionId: String(item.session_id ?? `group_${index + 1}`),
      messages: flattenGeneric(item),
    }));
  }

  const inputIdx = findIdx(/^input$|instruction|question|query|prompt$/);
  const outputIdx = findIdx(/^output$|response|answer|reply$/);
  if (inputIdx >= 0 && outputIdx >= 0) {
    const sessions: Array<{ sessionId: string; messages: Array<{ role: "user" | "assistant"; content: string }> }> = [];
    for (let index = 1; index < records.length; index += 1) {
      const cells = splitCsvLine(records[index]);
      const user = unquoteCsvCell(cells[inputIdx]);
      const assistant = unquoteCsvCell(cells[outputIdx]);
      if (!user && !assistant) continue;
      sessions.push({
        sessionId: `row_${index}`,
        messages: [
          ...(user ? [{ role: "user" as const, content: user }] : []),
          ...(assistant ? [{ role: "assistant" as const, content: assistant }] : []),
        ],
      });
    }
    const grouped = groupSingleTurnRows(
      sessions.map((session) => ({
        session_id: session.sessionId,
        messages: session.messages,
      })),
    );
    return grouped.map((item, index) => ({
      sessionId: String(item.session_id ?? `group_${index + 1}`),
      messages: flattenGeneric(item),
    }));
  }

  return [];
}

function parseZevalCsvPool(
  rawText: string,
  searchProfile: string,
  maxSessions: number,
): DialogueSessionPoolItem[] {
  const lines = rawText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const grouped = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();
  for (const line of lines.slice(1)) {
    const cells = splitCsvLine(line);
    if (cells.length < 4) continue;
    const sessionId = cells[0]?.replace(/^"|"$/g, "").trim();
    const roleRaw = cells[2]?.replace(/^"|"$/g, "").trim().toLowerCase();
    const content = cells[3]?.replace(/^"|"$/g, "").replace(/""/g, '"').trim();
    if (!sessionId || !content) continue;
    const role = /assistant|agent|bot/.test(roleRaw) ? ("assistant" as const) : ("user" as const);
    const messages = grouped.get(sessionId) ?? [];
    messages.push({ role, content });
    grouped.set(sessionId, messages);
  }

  return [...grouped.entries()]
    .map(([sessionId, messages], index) => ({
      poolId: `pool_${String(index + 1).padStart(3, "0")}`,
      messages,
      relevanceScore: scoreByProfile(messages.map((message) => message.content).join(" "), searchProfile),
      preview: buildSessionPreview(messages),
    }))
    .filter((entry) => entry.messages.length >= 4)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || right.messages.length - left.messages.length)
    .slice(0, maxSessions);
}

function buildPoolFromCpsy(data: CpsyItem[], input: ExtractSessionPoolInput): DialogueSessionPoolItem[] {
  const maxSessions = input.maxSessions ?? 60;
  return data
    .map((item, index) => {
      const messages = flattenCpsy(item);
      return {
        poolId: `pool_${String(index + 1).padStart(3, "0")}`,
        messages,
        relevanceScore: scoreByProfile(cpsyText(item), input.searchProfile),
        preview: buildSessionPreview(messages),
        turns: countCpsyTurns(item),
      };
    })
    .filter((entry) => entry.turns >= 4)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || right.turns - left.turns)
    .slice(0, maxSessions)
    .map(({ poolId, messages, relevanceScore, preview }) => ({ poolId, messages, relevanceScore, preview }));
}

function buildPoolFromEsconv(data: EsconvItem[], input: ExtractSessionPoolInput): DialogueSessionPoolItem[] {
  const maxSessions = input.maxSessions ?? 60;
  return data
    .map((item, index) => {
      const messages = flattenEsconv(item);
      return {
        poolId: `pool_${String(index + 1).padStart(3, "0")}`,
        messages,
        relevanceScore: scoreByProfile(JSON.stringify(item.dialog ?? []), input.searchProfile),
        preview: buildSessionPreview(messages),
      };
    })
    .filter((entry) => entry.messages.length >= 4)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || right.messages.length - left.messages.length)
    .slice(0, maxSessions);
}

function buildPoolFromParsedSessions(
  sessions: Array<{ sessionId: string; messages: Array<{ role: "user" | "assistant"; content: string }> }>,
  input: ExtractSessionPoolInput,
): DialogueSessionPoolItem[] {
  const maxSessions = input.maxSessions ?? 60;
  return sessions
    .map((session, index) => ({
      poolId: `pool_${String(index + 1).padStart(3, "0")}`,
      messages: session.messages,
      relevanceScore: scoreByProfile(
        session.messages.map((message) => message.content).join(" "),
        input.searchProfile,
      ),
      preview: buildSessionPreview(session.messages),
    }))
    .filter((entry) => entry.messages.length >= 4)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || right.messages.length - left.messages.length)
    .slice(0, maxSessions);
}

function buildPoolFromConversationText(
  data: ConversationTextItem[],
  input: ExtractSessionPoolInput,
): DialogueSessionPoolItem[] {
  const maxSessions = input.maxSessions ?? 60;
  return data
    .map((item, index) => {
      const text = String(item.conversation ?? item.dialogue ?? item.dia ?? item.chat ?? item.context ?? "").trim();
      const messages =
        typeof item.dialog === "string"
          ? parseConversationText(item.dialog)
          : Array.isArray(item.dialog)
            ? flattenEsconv({ dialog: item.dialog as EsconvItem["dialog"] })
            : parseConversationText(text);
      return {
        poolId: `pool_${String(index + 1).padStart(3, "0")}`,
        messages,
        relevanceScore: scoreByProfile(text || JSON.stringify(item), input.searchProfile),
        preview: buildSessionPreview(messages),
      };
    })
    .filter((entry) => entry.messages.length >= 4)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || right.messages.length - left.messages.length)
    .slice(0, maxSessions);
}

function buildPoolFromInputOutput(
  data: InputOutputItem[],
  input: ExtractSessionPoolInput,
): DialogueSessionPoolItem[] {
  const grouped = groupSingleTurnRows(
    data.map((item, index) => ({
      session_id: `row_${index + 1}`,
      messages: flattenInputOutput(item),
    })),
  );
  return buildPoolFromGenericDialogue(grouped, input);
}

function buildPoolFromGenericDialogue(
  data: GenericDialogueItem[],
  input: ExtractSessionPoolInput,
): DialogueSessionPoolItem[] {
  const maxSessions = input.maxSessions ?? 60;
  return data
    .map((item, index) => {
      const messages = flattenGeneric(item);
      return {
        poolId: `pool_${String(index + 1).padStart(3, "0")}`,
        messages,
        relevanceScore: scoreByProfile(JSON.stringify(item), input.searchProfile),
        preview: buildSessionPreview(messages),
      };
    })
    .filter((entry) => entry.messages.length >= 4)
    .sort((left, right) => right.relevanceScore - left.relevanceScore || right.messages.length - left.messages.length)
    .slice(0, maxSessions);
}

function buildSessionPreview(messages: Array<{ role: "user" | "assistant"; content: string }>): string {
  const text = messages
    .slice(0, 4)
    .map((message) => `${message.role}: ${message.content}`)
    .join(" | ");
  return text.length > 220 ? `${text.slice(0, 217)}...` : text;
}

function normalizeJsonDataset(parsed: unknown, input: NormalizeCsvInput): string | null {
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  if (looksLikeCpsy(parsed[0])) {
    return buildCsvFromCpsy(parsed as CpsyItem[], input);
  }
  if (looksLikeEsconv(parsed[0])) {
    return buildCsvFromEsconv(parsed as EsconvItem[], input);
  }
  if (looksLikeConversationText(parsed[0])) {
    return buildCsvFromSessionPool(buildPoolFromConversationText(parsed as ConversationTextItem[], input), input);
  }
  if (looksLikeInputOutput(parsed[0])) {
    return buildCsvFromSessionPool(buildPoolFromInputOutput(parsed as InputOutputItem[], input), input);
  }
  if (looksLikeGenericDialogue(parsed[0])) {
    return buildCsvFromGenericDialogue(parsed as GenericDialogueItem[], input);
  }
  return null;
}

function buildCsvFromSessionPool(pool: DialogueSessionPoolItem[], input: NormalizeCsvInput): string | null {
  const ranked = [...pool].sort(
    (left, right) => right.relevanceScore - left.relevanceScore || right.messages.length - left.messages.length,
  );
  const positives = ranked.slice(0, input.positiveCount);
  const negatives = ranked.slice(input.positiveCount, input.positiveCount + input.negativeCount);
  return sessionsToCsv(
    [
      ...positives.map((entry, index) => ({
        sessionId: `${input.sessionPrefix}pos_${String(index + 1).padStart(2, "0")}`,
        messages: entry.messages,
        label: "positive" as const,
      })),
      ...negatives.map((entry, index) => ({
        sessionId: `${input.sessionPrefix}neg_${String(index + 1).padStart(2, "0")}`,
        messages: entry.messages,
        label: "negative" as const,
      })),
    ],
    input.positiveCount + input.negativeCount,
  );
}

function looksLikeCpsy(value: unknown): value is CpsyItem {
  return Boolean(value && typeof value === "object" && Array.isArray((value as CpsyItem).history));
}

function looksLikeEsconv(value: unknown): value is EsconvItem {
  return Boolean(value && typeof value === "object" && Array.isArray((value as EsconvItem).dialog));
}

function looksLikeGenericDialogue(value: unknown): value is GenericDialogueItem {
  if (!value || typeof value !== "object") return false;
  const record = value as GenericDialogueItem;
  return Array.isArray(record.messages) || Array.isArray(record.conversations);
}

function looksLikeConversationText(value: unknown): value is ConversationTextItem {
  if (!value || typeof value !== "object") return false;
  const record = value as ConversationTextItem;
  return Boolean(
    record.conversation?.trim() ||
      record.dialogue?.trim() ||
      record.dia?.trim() ||
      record.chat?.trim() ||
      (typeof record.dialog === "string" && record.dialog.trim()),
  );
}

function looksLikeInputOutput(value: unknown): value is InputOutputItem {
  if (!value || typeof value !== "object") return false;
  const record = value as InputOutputItem;
  const hasUser = Boolean(
    record.input?.trim() ||
      record.instruction?.trim() ||
      record.question?.trim() ||
      record.prompt?.trim() ||
      record.query?.trim(),
  );
  const hasAssistant = Boolean(record.output?.trim() || record.response?.trim() || record.answer?.trim());
  return hasUser && hasAssistant;
}

function looksLikeJsonl(rawText: string): boolean {
  const lines = rawText.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return false;
  return lines.slice(0, Math.min(4, lines.length)).every((line) => {
    try {
      const parsed = JSON.parse(line) as unknown;
      return Boolean(parsed) && typeof parsed === "object";
    } catch {
      return false;
    }
  });
}

function parseJsonlRecords(rawText: string): unknown[] {
  const records: unknown[] = [];
  for (const line of rawText.trim().split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as unknown);
    } catch {
      return [];
    }
  }
  return records;
}

function flattenInputOutput(item: InputOutputItem): Array<{ role: "user" | "assistant"; content: string }> {
  const user = String(
    item.input ?? item.instruction ?? item.question ?? item.prompt ?? item.query ?? "",
  ).trim();
  const assistant = String(item.output ?? item.response ?? item.answer ?? "").trim();
  return [
    ...(user ? [{ role: "user" as const, content: user }] : []),
    ...(assistant ? [{ role: "assistant" as const, content: assistant }] : []),
  ];
}

function unquoteCsvCell(value?: string): string {
  return (value ?? "").replace(/^"|"$/g, "").replace(/""/g, '"').trim();
}

function buildCsvFromCpsy(data: CpsyItem[], input: NormalizeCsvInput): string {
  const ranked = data
    .map((item, index) => ({
      item,
      index,
      turns: countCpsyTurns(item),
      score: scoreByProfile(cpsyText(item), input.searchProfile),
    }))
    .filter((entry) => entry.turns >= 4)
    .sort((left, right) => right.score - left.score || right.turns - left.turns);

  const positives = ranked.slice(0, input.positiveCount);
  const negatives = ranked.slice(input.positiveCount, input.positiveCount + input.negativeCount);
  return sessionsToCsv(
    [
      ...positives.map((entry, index) => ({
        sessionId: `${input.sessionPrefix}pos_${String(index + 1).padStart(2, "0")}`,
        messages: flattenCpsy(entry.item),
        label: "positive" as const,
      })),
      ...negatives.map((entry, index) => ({
        sessionId: `${input.sessionPrefix}neg_${String(index + 1).padStart(2, "0")}`,
        messages: flattenCpsy(entry.item),
        label: "negative" as const,
      })),
    ],
    input.positiveCount + input.negativeCount,
  );
}

function buildCsvFromEsconv(data: EsconvItem[], input: NormalizeCsvInput): string {
  const ranked = data
    .map((item) => ({
      item,
      turns: Array.isArray(item.dialog) ? item.dialog.length : 0,
      score: scoreByProfile(JSON.stringify(item.dialog ?? []), input.searchProfile),
    }))
    .filter((entry) => entry.turns >= 4)
    .sort((left, right) => right.score - left.score || right.turns - left.turns);

  const positives = ranked.slice(0, input.positiveCount);
  const negatives = ranked.slice(input.positiveCount, input.positiveCount + input.negativeCount);
  return sessionsToCsv(
    [
      ...positives.map((entry, index) => ({
        sessionId: `${input.sessionPrefix}pos_${String(index + 1).padStart(2, "0")}`,
        messages: flattenEsconv(entry.item),
        label: "positive" as const,
      })),
      ...negatives.map((entry, index) => ({
        sessionId: `${input.sessionPrefix}neg_${String(index + 1).padStart(2, "0")}`,
        messages: flattenEsconv(entry.item),
        label: "negative" as const,
      })),
    ],
    input.positiveCount + input.negativeCount,
  );
}

function buildCsvFromGenericDialogue(data: GenericDialogueItem[], input: NormalizeCsvInput): string {
  const sessions = data
    .map((item, index) => ({
      sessionId:
        String(item.session_id ?? item.sessionId ?? `session_${index + 1}`),
      messages: flattenGeneric(item),
      score: scoreByProfile(JSON.stringify(item), input.searchProfile),
    }))
    .filter((entry) => entry.messages.length >= 4)
    .sort((left, right) => right.score - left.score || right.messages.length - left.messages.length);

  const positives = sessions.slice(0, input.positiveCount);
  const negatives = sessions.slice(input.positiveCount, input.positiveCount + input.negativeCount);
  return sessionsToCsv(
    [
      ...positives.map((entry, index) => ({
        sessionId: `${input.sessionPrefix}pos_${String(index + 1).padStart(2, "0")}`,
        messages: entry.messages,
        label: "positive" as const,
      })),
      ...negatives.map((entry, index) => ({
        sessionId: `${input.sessionPrefix}neg_${String(index + 1).padStart(2, "0")}`,
        messages: entry.messages,
        label: "negative" as const,
      })),
    ],
    input.positiveCount + input.negativeCount,
  );
}

function normalizeLooseCsv(rawText: string, input: NormalizeCsvInput): string | null {
  const pool = extractLooseCsvSessionPool(rawText, input);
  return buildCsvFromSessionPool(pool, input);
}

/**
 * Merge adjacent single-turn rows into multi-turn sessions for loose CSV sources.
 *
 * @param sessions Parsed single-turn sessions.
 * @returns Grouped sessions with at least four turns when possible.
 */
function groupSingleTurnRows(
  sessions: Array<{
    session_id: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
  }>,
): GenericDialogueItem[] {
  if (sessions.every((session) => session.messages.length >= 4)) {
    return sessions;
  }

  const grouped: GenericDialogueItem[] = [];
  for (let index = 0; index < sessions.length; index += 2) {
    const first = sessions[index];
    const second = sessions[index + 1];
    if (!first) break;
    const messages = [...first.messages, ...(second?.messages ?? [])];
    if (messages.length >= 4) {
      grouped.push({
        session_id: `group_${grouped.length + 1}`,
        messages,
      });
    }
  }
  return grouped.length > 0 ? grouped : sessions;
}

function sessionsToCsv(
  sessions: Array<{
    sessionId: string;
    messages: Array<{ role: "user" | "assistant"; content: string }>;
    label: "positive" | "negative";
  }>,
  minSessions: number,
): string | null {
  const usable = sessions.filter((session) => session.messages.length > 0);
  if (usable.length < Math.min(2, minSessions)) return null;

  const rows: string[] = ["sessionId,timestamp,role,content"];
  const base = Date.parse("2026-05-01T20:00:00+08:00");
  usable.forEach((session, sessionIndex) => {
    let timestamp = base + sessionIndex * 3_600_000;
    for (const message of session.messages) {
      rows.push(
        [
          session.sessionId,
          new Date(timestamp).toISOString(),
          message.role,
          `"${message.content.replace(/"/g, '""')}"`,
        ].join(","),
      );
      timestamp += 20_000;
    }
  });
  return `${rows.join("\n")}\n`;
}

function flattenCpsy(item: CpsyItem): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const pair of item.history ?? []) {
    if (!Array.isArray(pair) || pair.length < 2) continue;
    messages.push({ role: "user", content: String(pair[0] ?? "") });
    messages.push({ role: "assistant", content: String(pair[1] ?? "") });
  }
  const instruction = String(item.instruction ?? "").trim();
  if (instruction) messages.push({ role: "user", content: instruction });
  const output = String(item.output ?? "").trim();
  if (output) messages.push({ role: "assistant", content: output });
  return messages.filter((message) => message.content.trim());
}

function flattenEsconv(item: EsconvItem): Array<{ role: "user" | "assistant"; content: string }> {
  const messages: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const turn of item.dialog ?? []) {
    const speaker = String(turn.speaker ?? "").toLowerCase();
    const role =
      speaker === "sys" || speaker === "listener" || speaker === "assistant" || speaker === "counselor"
        ? "assistant"
        : "user";
    const content = String(turn.content ?? turn.text ?? "").trim();
    if (content) messages.push({ role, content });
  }
  return messages;
}

function flattenGeneric(item: GenericDialogueItem): Array<{ role: "user" | "assistant"; content: string }> {
  if (Array.isArray(item.messages)) {
    return item.messages
      .map((message) => ({
        role: /assistant|agent|bot|counselor|listener/.test(String(message.role ?? "").toLowerCase())
          ? ("assistant" as const)
          : ("user" as const),
        content: String(message.content ?? message.text ?? "").trim(),
      }))
      .filter((message) => message.content);
  }

  if (Array.isArray(item.conversations)) {
    return item.conversations
      .map((message) => ({
        role: /assistant|agent|bot|gpt|listener/.test(String(message.from ?? message.role ?? "").toLowerCase())
          ? ("assistant" as const)
          : ("user" as const),
        content: String(message.value ?? message.content ?? "").trim(),
      }))
      .filter((message) => message.content);
  }

  return [];
}

function countCpsyTurns(item: CpsyItem): number {
  const history = Array.isArray(item.history) ? item.history : [];
  let turns = history.length * 2;
  if (String(item.instruction ?? "").trim()) turns += 1;
  if (String(item.output ?? "").trim()) turns += 1;
  return turns;
}

function cpsyText(item: CpsyItem): string {
  return flattenCpsy(item).map((message) => message.content).join(" ");
}

function scoreByProfile(text: string, searchProfile: string): number {
  const keywords = extractSearchKeywords(searchProfile);
  if (keywords.length === 0) return 1;
  const hitCount = keywords.filter((keyword) => text.toLowerCase().includes(keyword.toLowerCase())).length;
  return hitCount;
}

/**
 * @param searchProfile Combined requirement and rubric text.
 * @returns Keyword list for ranking.
 */
export function extractSearchKeywords(searchProfile: string): string[] {
  const chunks = searchProfile
    .split(/[\s,，。！？；;、\n]+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 2 && part.length <= 16);
  return [...new Set(chunks)].slice(0, 24);
}

/**
 * Split CSV text into logical records while preserving quoted multiline cells.
 *
 * @param rawText Raw CSV text.
 * @returns CSV records excluding empty trailing lines.
 */
function splitCsvRecords(rawText: string): string[] {
  const records: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < rawText.length; index += 1) {
    const char = rawText[index];
    if (char === '"') {
      if (quoted && rawText[index + 1] === '"') {
        current += '""';
        index += 1;
        continue;
      }
      quoted = !quoted;
      current += char;
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && rawText[index + 1] === "\n") index += 1;
      if (current.trim()) records.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) records.push(current);
  return records;
}

function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells;
}
