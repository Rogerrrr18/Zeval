/**
 * @fileoverview Build DeepEval-style evaluation cases from normalized chatlogs.
 */

import type { EvalCapabilityReport, EvalCase, EvalCaseBundle, EvalCaseToolCall } from "@/types/eval-case";
import type { EvalRequiredField } from "@/types/eval-metric";
import type { EvalTrace } from "@/types/eval-trace";
import type { EnrichedChatlogRow } from "@/types/pipeline";
import type { StructuredTaskMetrics } from "@/types/rich-conversation";

const ALL_REQUIRED_FIELDS: EvalRequiredField[] = [
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
  "schema",
];

/**
 * Build canonical evaluation cases and a dataset capability report.
 * @param rows Enriched chat rows after parser and normalizer stages.
 * @param structuredTaskMetrics Optional structured benchmark metrics.
 * @param trace Optional agent trace attached to the run.
 * @returns Case bundle used by metric gating and future metric runners.
 */
export function buildEvalCaseBundle(
  rows: EnrichedChatlogRow[],
  structuredTaskMetrics?: StructuredTaskMetrics,
  trace?: EvalTrace,
): EvalCaseBundle {
  const cases = buildEvalCases(rows, trace);
  const capabilityReport = buildEvalCapabilityReport(rows, structuredTaskMetrics, trace);
  return {
    generatedAt: new Date().toISOString(),
    caseCount: cases.length,
    cases,
    capabilityReport,
  };
}

/**
 * Build session-level test cases from enriched rows.
 * @param rows Enriched chat rows.
 * @param trace Optional trace to attach when its sessionId matches a case.
 * @returns Canonical evaluation cases.
 */
function buildEvalCases(rows: EnrichedChatlogRow[], trace?: EvalTrace): EvalCase[] {
  const grouped = groupRowsBySession(rows);
  return Array.from(grouped.entries()).map(([sessionId, sessionRows]) => {
    const sortedRows = [...sessionRows].sort((left, right) => left.turnIndex - right.turnIndex);
    const firstUser = sortedRows.find((row) => row.role === "user") ?? sortedRows[0];
    const lastAssistant = [...sortedRows].reverse().find((row) => row.role === "assistant") ?? sortedRows.at(-1);
    const caseTrace = trace?.sessionId === sessionId || !trace?.sessionId ? trace : undefined;
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
        timestamp: row.timestamp,
      })),
      toolsCalled,
      expectedTools: [],
      trace: caseTrace,
      metadata: {
        messageCount: sortedRows.length,
        userMessageCount: sortedRows.filter((row) => row.role === "user").length,
        assistantMessageCount: sortedRows.filter((row) => row.role === "assistant").length,
      },
    };
  });
}

/**
 * Build a field capability report from cases, trace and structured annotations.
 * @param rows Enriched chat rows.
 * @param structuredTaskMetrics Optional structured benchmark metrics.
 * @param trace Optional agent trace attached to the run.
 * @returns Dataset-level capability report.
 */
function buildEvalCapabilityReport(
  rows: EnrichedChatlogRow[],
  structuredTaskMetrics?: StructuredTaskMetrics,
  trace?: EvalTrace,
): EvalCapabilityReport {
  const traceToolCallCount = trace?.spans.filter((span) => span.type === "tool").length ?? 0;
  const availableFields: Record<EvalRequiredField, boolean> = {
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
    schema: Boolean(structuredTaskMetrics?.schemaServiceCount),
  };
  const fieldSources = buildFieldSources(availableFields, structuredTaskMetrics, trace);
  const missingFields = ALL_REQUIRED_FIELDS.filter((field) => !availableFields[field]);
  return {
    availableFields,
    fieldSources,
    missingFields,
    enabledMetricGroups: buildEnabledMetricGroups(availableFields),
    disabledMetricGroups: buildDisabledMetricGroups(availableFields),
    warnings: buildCapabilityWarnings(availableFields, structuredTaskMetrics),
  };
}

/**
 * Group rows by session id while preserving input order inside each group.
 * @param rows Enriched chat rows.
 * @returns Session row map.
 */
function groupRowsBySession(rows: EnrichedChatlogRow[]): Map<string, EnrichedChatlogRow[]> {
  return rows.reduce((groups, row) => {
    groups.set(row.sessionId, [...(groups.get(row.sessionId) ?? []), row]);
    return groups;
  }, new Map<string, EnrichedChatlogRow[]>());
}

/**
 * Extract tool calls from trace spans into the internal case shape.
 * @param trace Optional execution trace.
 * @returns Tool call summaries.
 */
function extractTraceToolCalls(trace?: EvalTrace): EvalCaseToolCall[] {
  return (trace?.spans ?? [])
    .filter((span) => span.type === "tool")
    .map((span) => ({
      name: span.name,
      status: span.status === "success" || span.status === "error" || span.status === "warning" ? span.status : "unknown",
      input: span.input,
      output: span.output,
      source: "trace",
    }));
}

/**
 * Build source labels for available fields.
 * @param availableFields Field availability map.
 * @param structuredTaskMetrics Optional structured benchmark metrics.
 * @param trace Optional agent trace.
 * @returns Field source map.
 */
function buildFieldSources(
  availableFields: Record<EvalRequiredField, boolean>,
  structuredTaskMetrics?: StructuredTaskMetrics,
  trace?: EvalTrace,
): Partial<Record<EvalRequiredField, string[]>> {
  const sources: Partial<Record<EvalRequiredField, string[]>> = {};
  ALL_REQUIRED_FIELDS.forEach((field) => {
    if (!availableFields[field]) return;
    if (field === "turns") sources[field] = ["parser.normalizer"];
    else if (field === "trace" || field === "tools_called") sources[field] = trace?.spans.length ? ["eval_trace"] : ["structured_annotations"];
    else sources[field] = [`structured_${structuredTaskMetrics?.sourceFormat ?? "custom"}`];
  });
  return sources;
}

/**
 * Resolve enabled metric groups for the current data capability set.
 * @param availableFields Field availability map.
 * @returns Enabled metric group identifiers.
 */
function buildEnabledMetricGroups(availableFields: Record<EvalRequiredField, boolean>): string[] {
  const groups = ["basic_chat_eval"];
  if (availableFields.frames || availableFields.slots || availableFields.state) groups.push("schema_aware_eval");
  if (availableFields.slots) groups.push("slot_eval");
  if (availableFields.state) groups.push("state_tracking_eval");
  if (availableFields.service_call) groups.push("service_call_eval");
  if (availableFields.service_results) groups.push("service_result_grounding");
  if (availableFields.trace) groups.push("actual_tool_trace_eval");
  return groups;
}

/**
 * Resolve disabled metric groups and the fields that block them.
 * @param availableFields Field availability map.
 * @returns Disabled metric group summaries.
 */
function buildDisabledMetricGroups(
  availableFields: Record<EvalRequiredField, boolean>,
): EvalCapabilityReport["disabledMetricGroups"] {
  const requirements: Array<{ group: string; fields: EvalRequiredField[] }> = [
    { group: "schema_aware_eval", fields: ["frames", "slots", "state"] },
    { group: "service_call_eval", fields: ["service_call"] },
    { group: "service_result_grounding", fields: ["service_call", "service_results"] },
    { group: "actual_tool_trace_eval", fields: ["trace"] },
    { group: "retrieval_eval", fields: ["retrieval_context", "expected_output"] },
  ];
  return requirements
    .map((item) => ({
      group: item.group,
      missingFields: item.fields.filter((field) => !availableFields[field]),
      reason: "上传数据没有提供该指标组需要的字段。",
    }))
    .filter((item) => item.missingFields.length > 0);
}

/**
 * Build capability warnings for user-facing diagnosis.
 * @param availableFields Field availability map.
 * @param structuredTaskMetrics Optional structured benchmark metrics.
 * @returns Warning strings.
 */
function buildCapabilityWarnings(
  availableFields: Record<EvalRequiredField, boolean>,
  structuredTaskMetrics?: StructuredTaskMetrics,
): string[] {
  const warnings: string[] = [];
  if (!availableFields.expected_output) {
    warnings.push("缺少 expected_output，答案正确性类指标暂不能做严格对照评分。");
  }
  if (!availableFields.trace) {
    warnings.push("缺少真实 trace/span，Agent 执行效率与工具调用路径指标会跳过。");
  }
  if (structuredTaskMetrics?.status === "degraded") {
    warnings.push("结构化标注处于降级状态，schema/slot/service_call 指标应优先看趋势而不是单次 gate。");
  }
  return warnings;
}
