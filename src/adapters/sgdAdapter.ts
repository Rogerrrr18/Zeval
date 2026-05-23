/**
 * @fileoverview Adapter from DSTC8 Schema-Guided Dialogue into rich conversation cases.
 */

import type {
  RichConversationCase,
  RichDialogueAction,
  RichDialogueStateSnapshot,
  RichServiceSchema,
  RichServiceCall,
  RichServiceResult,
  RichSlotMention,
  RichTurnFrame,
  StructuredTaskMetrics,
} from "@/types/rich-conversation";
import type { ChatRole } from "@/types/pipeline";

const SCHEMA_SLOT_REFERENCE_IGNORE_SET = new Set(["intent", "count"]);

type SgdDialogue = {
  dialogue_id?: unknown;
  services?: unknown;
  turns?: unknown;
};

type SgdTurn = {
  speaker?: unknown;
  utterance?: unknown;
  frames?: unknown;
};

type SgdFrame = {
  service?: unknown;
  actions?: unknown;
  slots?: unknown;
  state?: unknown;
  service_call?: unknown;
  service_results?: unknown;
};

type SgdAction = {
  act?: unknown;
  slot?: unknown;
  values?: unknown;
  canonical_values?: unknown;
};

type SgdSlot = {
  slot?: unknown;
  start?: unknown;
  exclusive_end?: unknown;
};

type SgdState = {
  active_intent?: unknown;
  requested_slots?: unknown;
  slot_values?: unknown;
};

type SgdServiceCall = {
  method?: unknown;
  parameters?: unknown;
};

type SgdPayload = {
  dialogues: SgdDialogue[];
  schema: RichServiceSchema[];
};

/**
 * Parse SGD JSON text into rich conversation cases.
 * @param text SGD dialogue JSON text.
 * @returns Rich conversation cases, or an empty list when the payload is not SGD-shaped.
 */
export function parseSgdRichConversationCases(text: string): RichConversationCase[] {
  const payload = parseSgdPayload(text);
  return payload.dialogues.map((dialogue, dialogueIndex) =>
    convertSgdDialogue(dialogue, dialogueIndex, payload.schema),
  );
}

/**
 * Build first-pass structured metrics from SGD annotations.
 * @param cases Rich SGD cases.
 * @returns Structured task metrics.
 */
export function buildSgdStructuredTaskMetrics(cases: RichConversationCase[]): StructuredTaskMetrics {
  const frames = cases.flatMap((item) => item.annotations.frames);
  const actions = cases.flatMap((item) => item.annotations.actions);
  const slotMentions = cases.flatMap((item) => item.annotations.slotMentions);
  const states = cases.flatMap((item) => item.annotations.dialogueStates);
  const serviceCalls = cases.flatMap((item) => item.annotations.serviceCalls);
  const serviceResults = cases.flatMap((item) => item.annotations.serviceResults);
  const services = new Set(cases.flatMap((item) => item.services));
  const schema = dedupeSchemas(cases.flatMap((item) => item.schema ?? []));
  const schemaServices = new Set(schema.map((item) => item.serviceName));
  const schemaIntentCount = schema.reduce((sum, item) => sum + item.intents.length, 0);
  const schemaSlotCount = schema.reduce((sum, item) => sum + item.slots.length, 0);
  const schemaValidation = buildSchemaValidationMetrics(cases, schema);

  const stateWithIntentCount = states.filter((item) => item.activeIntent && item.activeIntent !== "NONE").length;
  const stateWithSlotsCount = states.filter((item) => Object.keys(item.slotValues).length > 0).length;
  const serviceCallGroundingRate = buildServiceCallGroundingRate(cases);
  const serviceResultAvailabilityRate = serviceCalls.length
    ? rate(
        serviceCalls.length,
        serviceCalls.filter((call) =>
          serviceResults.some((result) => result.turnIndex === call.turnIndex && result.service === call.service),
        ).length,
      )
    : 0;
  const transactionalConfirmationRate = buildTransactionalConfirmationRate(cases);
  const warnings: string[] = [];
  if (serviceCalls.length > 0 && serviceResultAvailabilityRate < 1) {
    warnings.push("部分 SGD service_call 未检测到同 turn/service 的 service_results。");
  }
  if (serviceCalls.length > 0 && serviceCallGroundingRate < 0.8) {
    warnings.push("部分 service_call 参数无法从此前 dialogue state 中稳定追溯。");
  }
  if (cases.length > 0 && schema.length === 0) {
    warnings.push("未检测到 schema/service definitions，schema-aware slot/intent 校验已跳过。");
  }
  if (schemaValidation.unknownIntentReferenceCount > 0) {
    warnings.push(`检测到 ${schemaValidation.unknownIntentReferenceCount} 个 active_intent 不在 schema 中。`);
  }
  if (schemaValidation.unknownSlotReferenceCount > 0) {
    warnings.push(`检测到 ${schemaValidation.unknownSlotReferenceCount} 个 slot 引用不在 schema 中。`);
  }

  return {
    status: cases.length > 0 ? "ready" : "unavailable",
    sourceFormat: "sgd",
    caseCount: cases.length,
    serviceCount: services.size,
    schemaServiceCount: schemaServices.size,
    schemaIntentCount,
    schemaSlotCount,
    frameCount: frames.length,
    actionCount: actions.length,
    slotMentionCount: slotMentions.length,
    dialogueStateCount: states.length,
    serviceCallCount: serviceCalls.length,
    serviceResultCount: serviceResults.length,
    intentCoverageRate: states.length ? rate(states.length, stateWithIntentCount) : 0,
    stateSlotCoverageRate: states.length ? rate(states.length, stateWithSlotsCount) : 0,
    schemaServiceCoverageRate: schemaValidation.schemaServiceCoverageRate,
    schemaIntentCoverageRate: schemaValidation.schemaIntentCoverageRate,
    schemaSlotCoverageRate: schemaValidation.schemaSlotCoverageRate,
    unknownIntentReferenceCount: schemaValidation.unknownIntentReferenceCount,
    unknownSlotReferenceCount: schemaValidation.unknownSlotReferenceCount,
    serviceCallGroundingRate,
    serviceResultAvailabilityRate,
    transactionalConfirmationRate,
    warnings,
  };
}

/**
 * Convert one SGD dialogue into a rich conversation case.
 * @param dialogue SGD dialogue.
 * @param dialogueIndex Index fallback.
 * @param schema Available service schema definitions.
 * @returns Rich conversation case.
 */
function convertSgdDialogue(
  dialogue: SgdDialogue,
  dialogueIndex: number,
  schema: RichServiceSchema[],
): RichConversationCase {
  const caseId = String(dialogue.dialogue_id ?? `sgd_dialogue_${dialogueIndex + 1}`);
  const services = asStringArray(dialogue.services);
  const caseSchema = schema.filter((item) => services.includes(item.serviceName));
  const turns = Array.isArray(dialogue.turns) ? (dialogue.turns as SgdTurn[]) : [];
  const actions: RichDialogueAction[] = [];
  const slotMentions: RichSlotMention[] = [];
  const dialogueStates: RichDialogueStateSnapshot[] = [];
  const serviceCalls: RichServiceCall[] = [];
  const serviceResults: RichServiceResult[] = [];
  const richFrames: RichTurnFrame[] = [];

  const messages = turns.flatMap((turn, turnIndex) => {
    const role = mapSgdSpeakerToRole(turn.speaker);
    const content = typeof turn.utterance === "string" ? turn.utterance : "";
    if (!role || !content) {
      return [];
    }
    const turnFrames = Array.isArray(turn.frames) ? (turn.frames as SgdFrame[]) : [];
    turnFrames.forEach((frame) => {
      const richFrame = convertSgdFrame(frame, {
        turnIndex: turnIndex + 1,
        role,
        utterance: content,
      });
      actions.push(...richFrame.actions);
      slotMentions.push(...richFrame.slotMentions);
      if (richFrame.state) dialogueStates.push(richFrame.state);
      if (richFrame.serviceCall) serviceCalls.push(richFrame.serviceCall);
      serviceResults.push(...richFrame.serviceResults);
      richFrames.push(richFrame);
    });
    return [
      {
        sessionId: caseId,
        timestamp: new Date(Date.UTC(2020, 0, 1, 0, 0, turnIndex)).toISOString(),
        role,
        content,
        turnIndex: turnIndex + 1,
      },
    ];
  });

  return {
    caseId,
    sourceFormat: "sgd",
    services,
    messages,
    schema: caseSchema.length > 0 ? caseSchema : undefined,
    annotations: {
      frames: richFrames,
      actions,
      slotMentions,
      dialogueStates,
      serviceCalls,
      serviceResults,
    },
  };
}

/**
 * Convert one SGD frame.
 * @param frame SGD frame.
 * @param context Turn context.
 * @returns Rich turn frame.
 */
function convertSgdFrame(
  frame: SgdFrame,
  context: { turnIndex: number; role: ChatRole; utterance: string },
): RichTurnFrame {
  const service = String(frame.service ?? "unknown_service");
  const actions = Array.isArray(frame.actions)
    ? (frame.actions as SgdAction[]).map((action) => ({
        turnIndex: context.turnIndex,
        role: context.role,
        service,
        act: String(action.act ?? "UNKNOWN"),
        slot: action.slot === undefined ? undefined : String(action.slot),
        values: asStringArray(action.values),
        canonicalValues: asStringArray(action.canonical_values),
      }))
    : [];
  const slotMentions = Array.isArray(frame.slots)
    ? (frame.slots as SgdSlot[]).flatMap((slot) => convertSgdSlot(slot, service, context))
    : [];
  const state = isObject(frame.state) ? convertSgdState(frame.state as SgdState, service, context.turnIndex) : undefined;
  const serviceCall = isObject(frame.service_call)
    ? convertSgdServiceCall(frame.service_call as SgdServiceCall, service, context.turnIndex)
    : undefined;
  const serviceResults = Array.isArray(frame.service_results)
    ? (frame.service_results as unknown[]).filter(isObject).map((result) => ({
        turnIndex: context.turnIndex,
        service,
        result,
        source: "gold" as const,
      }))
    : [];

  return {
    turnIndex: context.turnIndex,
    role: context.role,
    service,
    actions,
    slotMentions,
    state,
    serviceCall,
    serviceResults,
  };
}

/**
 * Convert one SGD slot mention span.
 * @param slot SGD slot.
 * @param service Service name.
 * @param context Turn context.
 * @returns Slot mention if span is valid.
 */
function convertSgdSlot(
  slot: SgdSlot,
  service: string,
  context: { turnIndex: number; utterance: string },
): RichSlotMention[] {
  const slotName = String(slot.slot ?? "");
  const start = typeof slot.start === "number" ? slot.start : Number(slot.start);
  const exclusiveEnd = typeof slot.exclusive_end === "number" ? slot.exclusive_end : Number(slot.exclusive_end);
  if (!slotName || !Number.isFinite(start) || !Number.isFinite(exclusiveEnd) || exclusiveEnd <= start) {
    return [];
  }
  return [
    {
      turnIndex: context.turnIndex,
      service,
      slot: slotName,
      value: context.utterance.slice(start, exclusiveEnd),
      start,
      exclusiveEnd,
    },
  ];
}

/**
 * Convert SGD dialogue state.
 * @param state SGD state.
 * @param service Service name.
 * @param turnIndex Turn index.
 * @returns Rich state snapshot.
 */
function convertSgdState(state: SgdState, service: string, turnIndex: number): RichDialogueStateSnapshot {
  return {
    turnIndex,
    service,
    activeIntent: String(state.active_intent ?? "NONE"),
    requestedSlots: asStringArray(state.requested_slots),
    slotValues: normalizeSlotValues(state.slot_values),
  };
}

/**
 * Convert SGD service_call.
 * @param serviceCall SGD service call.
 * @param service Service name.
 * @param turnIndex Turn index.
 * @returns Rich service call.
 */
function convertSgdServiceCall(serviceCall: SgdServiceCall, service: string, turnIndex: number): RichServiceCall {
  return {
    turnIndex,
    service,
    method: String(serviceCall.method ?? "unknown_method"),
    parameters: normalizeParameters(serviceCall.parameters),
    source: "gold",
  };
}

/**
 * Compute how many service call parameters are grounded in latest prior state.
 * @param cases Rich cases.
 * @returns Rate in 0-1.
 */
function buildServiceCallGroundingRate(cases: RichConversationCase[]): number {
  const scores = cases.flatMap((item) =>
    item.annotations.serviceCalls.map((call) => {
      const latestState = [...item.annotations.dialogueStates]
        .filter((state) => state.service === call.service && state.turnIndex <= call.turnIndex)
        .sort((left, right) => right.turnIndex - left.turnIndex)[0];
      const params = Object.entries(call.parameters);
      if (params.length === 0) {
        return 1;
      }
      if (!latestState) {
        return 0;
      }
      const grounded = params.filter(([slot, value]) => {
        const stateValues = latestState.slotValues[slot] ?? [];
        const callValues = Array.isArray(value) ? value.map(String) : [String(value)];
        return callValues.every((candidate) => stateValues.includes(candidate));
      }).length;
      return grounded / params.length;
    }),
  );
  return average(scores);
}

/**
 * Compute whether transactional service calls were preceded by confirmation-like behavior.
 * @param cases Rich cases.
 * @returns Confirmation rate.
 */
function buildTransactionalConfirmationRate(cases: RichConversationCase[]): number {
  const transactionCalls = cases.flatMap((item) =>
    item.annotations.serviceCalls
      .filter((call) => /(Reserve|Book|Buy|Transfer|Payment|Make|Add)/i.test(call.method))
      .map((call) => ({ call, caseItem: item })),
  );
  if (transactionCalls.length === 0) {
    return 1;
  }
  const confirmed = transactionCalls.filter(({ call, caseItem }) => {
    const priorFrames = caseItem.annotations.frames.filter(
      (frame) => frame.service === call.service && frame.turnIndex < call.turnIndex && frame.role === "assistant",
    );
    return priorFrames.some((frame) =>
      frame.actions.some((action) => /CONFIRM|OFFER|NOTIFY_SUCCESS/i.test(action.act)),
    );
  }).length;
  return rate(transactionCalls.length, confirmed);
}

/**
 * Compute schema consistency metrics when service definitions are available.
 * @param cases Rich cases.
 * @param schema Service schema definitions.
 * @returns Schema validation rates and unknown reference counts.
 */
function buildSchemaValidationMetrics(
  cases: RichConversationCase[],
  schema: RichServiceSchema[],
): {
  schemaServiceCoverageRate: number;
  schemaIntentCoverageRate: number;
  schemaSlotCoverageRate: number;
  unknownIntentReferenceCount: number;
  unknownSlotReferenceCount: number;
} {
  if (schema.length === 0) {
    return {
      schemaServiceCoverageRate: 0,
      schemaIntentCoverageRate: 0,
      schemaSlotCoverageRate: 0,
      unknownIntentReferenceCount: 0,
      unknownSlotReferenceCount: 0,
    };
  }
  const schemaByService = new Map(schema.map((item) => [item.serviceName, item]));
  const usedServices = [...new Set(cases.flatMap((item) => item.services))];
  const knownServices = usedServices.filter((service) => schemaByService.has(service)).length;
  const intentReferences = cases.flatMap((item) =>
    item.annotations.dialogueStates
      .filter((state) => state.activeIntent && state.activeIntent !== "NONE")
      .map((state) => ({ service: state.service, intent: state.activeIntent })),
  );
  const knownIntentReferences = intentReferences.filter((item) => hasSchemaIntent(schemaByService, item)).length;
  const slotReferences = cases.flatMap(collectSlotReferences);
  const knownSlotReferences = slotReferences.filter((item) => hasSchemaSlot(schemaByService, item)).length;

  return {
    schemaServiceCoverageRate: usedServices.length ? rate(usedServices.length, knownServices) : 1,
    schemaIntentCoverageRate: intentReferences.length ? rate(intentReferences.length, knownIntentReferences) : 1,
    schemaSlotCoverageRate: slotReferences.length ? rate(slotReferences.length, knownSlotReferences) : 1,
    unknownIntentReferenceCount: intentReferences.length - knownIntentReferences,
    unknownSlotReferenceCount: slotReferences.length - knownSlotReferences,
  };
}

/**
 * Collect slot references from actions, spans, state, requests and service calls.
 * @param caseItem Rich case.
 * @returns Slot references with service names.
 */
function collectSlotReferences(caseItem: RichConversationCase): Array<{ service: string; slot: string }> {
  const actionSlots = caseItem.annotations.actions.flatMap((action) =>
    action.slot && !SCHEMA_SLOT_REFERENCE_IGNORE_SET.has(action.slot)
      ? [{ service: action.service, slot: action.slot }]
      : [],
  );
  const spanSlots = caseItem.annotations.slotMentions.map((item) => ({ service: item.service, slot: item.slot }));
  const stateSlots = caseItem.annotations.dialogueStates.flatMap((state) => [
    ...Object.keys(state.slotValues).map((slot) => ({ service: state.service, slot })),
    ...state.requestedSlots.map((slot) => ({ service: state.service, slot })),
  ]);
  const serviceCallSlots = caseItem.annotations.serviceCalls.flatMap((call) =>
    Object.keys(call.parameters).map((slot) => ({ service: call.service, slot })),
  );
  return [...actionSlots, ...spanSlots, ...stateSlots, ...serviceCallSlots].filter((item) => item.slot);
}

/**
 * Check whether an intent reference exists in schema.
 * @param schemaByService Schema map.
 * @param reference Intent reference.
 * @returns True when schema contains the intent.
 */
function hasSchemaIntent(
  schemaByService: Map<string, RichServiceSchema>,
  reference: { service: string; intent: string },
): boolean {
  return Boolean(schemaByService.get(reference.service)?.intents.some((intent) => intent.name === reference.intent));
}

/**
 * Check whether a slot reference exists in schema.
 * @param schemaByService Schema map.
 * @param reference Slot reference.
 * @returns True when schema contains the slot.
 */
function hasSchemaSlot(
  schemaByService: Map<string, RichServiceSchema>,
  reference: { service: string; slot: string },
): boolean {
  const serviceSchema = schemaByService.get(reference.service);
  if (!serviceSchema) {
    return false;
  }
  if (serviceSchema.slots.some((slot) => slot.name === reference.slot)) {
    return true;
  }
  return serviceSchema.intents.some((intent) =>
    [...intent.requiredSlots, ...intent.optionalSlots, ...intent.resultSlots].includes(reference.slot),
  );
}

/**
 * Parse JSON array, JSON object wrapper, or JSONL into candidate dialogue records.
 * @param text Uploaded source text.
 * @returns Candidate dialogue records and optional service schema.
 */
function parseSgdPayload(text: string): SgdPayload {
  const parsed = parseJsonOrJsonl(text);
  const dialogues = parsed.flatMap((item) => {
    if (Array.isArray(item)) {
      return item.filter(isSgdDialogue);
    }
    if (isObject(item) && Array.isArray(item.dialogues)) {
      return item.dialogues.filter(isSgdDialogue);
    }
    if (isObject(item) && Array.isArray(item.data)) {
      return item.data.filter(isSgdDialogue);
    }
    return isSgdDialogue(item) ? [item] : [];
  });
  const schema = parsed.flatMap(extractSgdSchema);
  return { dialogues, schema: dedupeSchemas(schema) };
}

/**
 * Extract SGD service schema definitions from a JSON item.
 * @param item Parsed JSON item.
 * @returns Service schema definitions.
 */
function extractSgdSchema(item: unknown): RichServiceSchema[] {
  if (Array.isArray(item) && item.some(isSgdSchemaRecord)) {
    return item.filter(isSgdSchemaRecord).map(convertSgdServiceSchema);
  }
  if (!isObject(item)) {
    return [];
  }
  if (Array.isArray(item.schema)) {
    return item.schema.filter(isSgdSchemaRecord).map(convertSgdServiceSchema);
  }
  if (isObject(item.schema) && Array.isArray(item.schema.services)) {
    return item.schema.services.filter(isSgdSchemaRecord).map(convertSgdServiceSchema);
  }
  if (Array.isArray(item.services) && item.services.some(isSgdSchemaRecord)) {
    return item.services.filter(isSgdSchemaRecord).map(convertSgdServiceSchema);
  }
  return [];
}

type SgdSchemaRecord = {
  service_name?: unknown;
  description?: unknown;
  slots?: unknown;
  intents?: unknown;
};

type SgdIntentRecord = {
  name?: unknown;
  required_slots?: unknown;
  optional_slots?: unknown;
  result_slots?: unknown;
};

type SgdSchemaSlotRecord = {
  name?: unknown;
  description?: unknown;
  is_categorical?: unknown;
  possible_values?: unknown;
};

/**
 * Detect SGD schema records.
 * @param value Candidate record.
 * @returns True when value looks like one service schema.
 */
function isSgdSchemaRecord(value: unknown): value is SgdSchemaRecord {
  return isObject(value) && "service_name" in value && Array.isArray(value.slots) && Array.isArray(value.intents);
}

/**
 * Convert one SGD service schema record into the internal service schema.
 * @param record SGD service schema record.
 * @returns Rich service schema.
 */
function convertSgdServiceSchema(record: SgdSchemaRecord): RichServiceSchema {
  const intents = Array.isArray(record.intents) ? record.intents.filter(isObject) : [];
  const slots = Array.isArray(record.slots) ? record.slots.filter(isObject) : [];
  return {
    serviceName: String(record.service_name ?? "unknown_service"),
    description: typeof record.description === "string" ? record.description : undefined,
    intents: intents.map((intent) => {
      const typedIntent = intent as SgdIntentRecord;
      return {
        name: String(typedIntent.name ?? "unknown_intent"),
        requiredSlots: asStringArray(typedIntent.required_slots),
        optionalSlots: normalizeOptionalSlots(typedIntent.optional_slots),
        resultSlots: asStringArray(typedIntent.result_slots),
      };
    }),
    slots: slots.map((slot) => {
      const typedSlot = slot as SgdSchemaSlotRecord;
      return {
        name: String(typedSlot.name ?? "unknown_slot"),
        description: typeof typedSlot.description === "string" ? typedSlot.description : undefined,
        isCategorical: typeof typedSlot.is_categorical === "boolean" ? typedSlot.is_categorical : undefined,
        possibleValues: asStringArray(typedSlot.possible_values),
      };
    }),
  };
}

/**
 * Parse JSON first and fall back to JSONL.
 * @param text Uploaded source text.
 * @returns Parsed JSON records.
 */
function parseJsonOrJsonl(text: string): unknown[] {
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as unknown);
  }
}

/**
 * Detect whether a candidate object is an SGD dialogue.
 * @param value Candidate record.
 * @returns True when the record has SGD dialogue shape.
 */
function isSgdDialogue(value: unknown): value is SgdDialogue {
  return isObject(value) && "dialogue_id" in value && "turns" in value;
}

function mapSgdSpeakerToRole(value: unknown): ChatRole | null {
  const normalized = String(value ?? "").toUpperCase();
  if (normalized === "USER") return "user";
  if (normalized === "SYSTEM") return "assistant";
  return null;
}

function normalizeSlotValues(value: unknown): Record<string, string[]> {
  if (!isObject(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, values]) => [key, asStringArray(values)]),
  );
}

function normalizeParameters(value: unknown): RichServiceCall["parameters"] {
  if (!isObject(value)) {
    return {};
  }
  const entries = Object.entries(value).map(([key, raw]) => {
    if (Array.isArray(raw)) {
      return [key, raw.map(String)];
    }
    if (typeof raw === "number" || typeof raw === "boolean") {
      return [key, raw];
    }
    return [key, String(raw)];
  });
  return Object.fromEntries(entries);
}

/**
 * Normalize SGD optional_slots, which may be an object of default values or an array.
 * @param value Raw optional_slots value.
 * @returns Optional slot names.
 */
function normalizeOptionalSlots(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }
  if (isObject(value)) {
    return Object.keys(value);
  }
  return [];
}

/**
 * Deduplicate service schema definitions by service name.
 * @param schema Schema definitions.
 * @returns Unique schema definitions.
 */
function dedupeSchemas(schema: RichServiceSchema[]): RichServiceSchema[] {
  const byService = new Map<string, RichServiceSchema>();
  schema.forEach((item) => {
    if (!byService.has(item.serviceName)) {
      byService.set(item.serviceName, item);
    }
  });
  return [...byService.values()];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => String(item));
}

function rate(total: number, part: number): number {
  return total === 0 ? 0 : Number((part / total).toFixed(4));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(4));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
