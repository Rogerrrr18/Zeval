/**
 * @fileoverview Rich conversation contracts for schema-aware benchmark evaluation.
 */

import type { ChatRole, RawChatlogRow } from "@/types/pipeline";

/**
 * Minimal service schema extracted from benchmark datasets such as SGD.
 */
export type RichServiceSchema = {
  serviceName: string;
  description?: string;
  intents: Array<{
    name: string;
    requiredSlots: string[];
    optionalSlots: string[];
    resultSlots: string[];
  }>;
  slots: Array<{
    name: string;
    description?: string;
    isCategorical?: boolean;
    possibleValues?: string[];
  }>;
};

/**
 * One dialogue act attached to a turn frame.
 */
export type RichDialogueAction = {
  turnIndex: number;
  role: ChatRole;
  service: string;
  act: string;
  slot?: string;
  values: string[];
  canonicalValues: string[];
};

/**
 * One text span that mentions a slot value.
 */
export type RichSlotMention = {
  turnIndex: number;
  service: string;
  slot: string;
  value: string;
  start?: number;
  exclusiveEnd?: number;
};

/**
 * Dialogue-state snapshot for one service at one turn.
 */
export type RichDialogueStateSnapshot = {
  turnIndex: number;
  service: string;
  activeIntent: string;
  requestedSlots: string[];
  slotValues: Record<string, string[]>;
};

/**
 * Tool/service call expected or executed in a task-oriented dialogue.
 */
export type RichServiceCall = {
  turnIndex: number;
  service: string;
  method: string;
  parameters: Record<string, string | number | boolean | string[] | number[]>;
  source: "gold" | "actual" | "unknown";
};

/**
 * Service result returned by a tool/API.
 */
export type RichServiceResult = {
  turnIndex: number;
  service: string;
  result: Record<string, unknown>;
  source: "gold" | "actual" | "unknown";
};

/**
 * Rich frame assembled from dataset annotations.
 */
export type RichTurnFrame = {
  turnIndex: number;
  role: ChatRole;
  service: string;
  actions: RichDialogueAction[];
  slotMentions: RichSlotMention[];
  state?: RichDialogueStateSnapshot;
  serviceCall?: RichServiceCall;
  serviceResults: RichServiceResult[];
};

/**
 * One benchmark-ready conversation case.
 */
export type RichConversationCase = {
  caseId: string;
  sourceFormat: "sgd" | "assetops" | "custom";
  services: string[];
  messages: Array<RawChatlogRow & { turnIndex: number }>;
  schema?: RichServiceSchema[];
  annotations: {
    frames: RichTurnFrame[];
    actions: RichDialogueAction[];
    slotMentions: RichSlotMention[];
    dialogueStates: RichDialogueStateSnapshot[];
    serviceCalls: RichServiceCall[];
    serviceResults: RichServiceResult[];
  };
};

/**
 * Optional structured metrics produced when benchmark annotations are available.
 */
export type StructuredTaskMetrics = {
  status: "ready" | "unavailable" | "degraded";
  sourceFormat: "sgd" | "assetops" | "custom";
  caseCount: number;
  serviceCount: number;
  schemaServiceCount?: number;
  schemaIntentCount?: number;
  schemaSlotCount?: number;
  frameCount: number;
  actionCount: number;
  slotMentionCount: number;
  dialogueStateCount: number;
  serviceCallCount: number;
  serviceResultCount: number;
  intentCoverageRate: number;
  stateSlotCoverageRate: number;
  schemaServiceCoverageRate?: number;
  schemaIntentCoverageRate?: number;
  schemaSlotCoverageRate?: number;
  unknownIntentReferenceCount?: number;
  unknownSlotReferenceCount?: number;
  serviceCallGroundingRate: number;
  serviceResultAvailabilityRate: number;
  transactionalConfirmationRate: number;
  warnings: string[];
};
