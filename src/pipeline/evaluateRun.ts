/**
 * @fileoverview Shared evaluation pipeline used by HTTP routes and batch jobs.
 *
 * P1 重构：
 *  - enrichRows 现为同步函数，不再返回 topicSegments
 *  - 新增 enableDynamicReplay / agentApiEndpoint 选项
 *  - dynamicReplayStatus 始终在响应中返回
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildBadCaseAssets } from "@/pipeline/badCases";
import { buildChartPayloads } from "@/pipeline/chartBuilder";
import { enrichRows, toEnrichedCsv } from "@/pipeline/enrich";
import { buildEvalCaseBundle } from "@/pipeline/evalCaseBuilder";
import { buildExtendedMetrics } from "@/pipeline/extendedMetrics";
import { extractIntentSequences } from "@/pipeline/intentExtract";
import { computeIntentMetrics } from "@/pipeline/intentMetrics";
import { buildMetricRegistrySnapshot } from "@/pipeline/metricRegistry";
import { buildObjectiveMetrics } from "@/pipeline/objectiveMetrics";
import { evaluateScenarioTemplate } from "@/pipeline/scenarioEvaluator";
import { runSimUserReplay } from "@/pipeline/simUser";
import { buildSubjectiveMetrics } from "@/pipeline/subjectiveMetrics";
import { buildSuggestions } from "@/pipeline/suggest";
import { buildSummaryCards } from "@/pipeline/summary";
import { getScenarioTemplateById } from "@/scenarios";
import type {
  DynamicReplayStatus,
  EvaluateResponse,
  IntentEvalMetrics,
  IntentRunLog,
  IntentSequenceDoc,
  RawChatlogRow,
  ScenarioEvaluateContext,
} from "@/types/pipeline";
import type { StructuredTaskMetrics } from "@/types/rich-conversation";
import type { EvalTrace } from "@/types/eval-trace";
import type { EvaluationProgressEvent, EvaluationStageKey } from "@/types/evaluation-progress";
import type {
  KnowledgeRetentionFact,
  RetrievalContext,
  RoleProfile,
  ToolCallRecord,
} from "@/types/extended-metrics";

export type EvaluateRunOptions = {
  useLlm: boolean;
  judgeRequired?: boolean;
  runId: string;
  scenarioId?: string;
  scenarioContext?: ScenarioEvaluateContext;
  structuredTaskMetrics?: StructuredTaskMetrics;
  trace?: EvalTrace;
  persistArtifact?: boolean;
  artifactBaseName?: string;
  /**
   * Enable SimUser intent pointer dynamic replay (P1).
   * Default: false. When false, dynamicReplayStatus="skipped" and intent fields are null.
   */
  enableDynamicReplay?: boolean;
  /**
   * Agent HTTP endpoint for SimUser to call during dynamic replay.
   * Required when enableDynamicReplay=true.
   */
  agentApiEndpoint?: string;
  /**
   * Optional inputs for DeepEval-aligned extended metrics.
   */
  extendedInputs?: {
    retrievalContexts?: RetrievalContext[];
    toolCalls?: ToolCallRecord[];
    retentionFacts?: KnowledgeRetentionFact[];
    roleProfile?: RoleProfile;
  };
  /**
   * Optional stage event callback used by streamed HTTP evaluation.
   * The pipeline keeps working when the callback throws.
   */
  onProgress?: (event: EvaluationProgressEvent) => void;
};

/**
 * Run full enrich → metrics → charts → (optional) dynamic replay pipeline on raw rows.
 * @param rawRows Canonical raw chatlog rows.
 * @param options Execution options.
 * @returns Evaluate response plus optional artifact path.
 */
export async function runEvaluatePipeline(
  rawRows: RawChatlogRow[],
  options: EvaluateRunOptions,
): Promise<EvaluateResponse & { artifactPath?: string }> {
  const warnings: string[] = [];
  const judgeRequired = options.judgeRequired ?? options.useLlm;
  const enableDynamicReplay = options.enableDynamicReplay ?? false;

  if (!rawRows.every((row) => Boolean(row.timestamp))) {
    warnings.push("检测到缺失 timestamp，部分时序指标已降级。");
  }
  if (judgeRequired && !options.useLlm) {
    throw new Error("LLM Judge 是当前评估的强依赖，但本次请求关闭了 useLlm。");
  }
  if (enableDynamicReplay && !options.agentApiEndpoint) {
    throw new Error("enableDynamicReplay=true 时必须提供 agentApiEndpoint。");
  }

  // ── Stage: enrich (synchronous) ─────────────────────────────────────────────
  const { enrichedRows } = runEvaluateStageSync(options, "parse", "解析数据", () =>
    enrichRows(rawRows),
  );
  const enrichedCsv = toEnrichedCsv(enrichedRows);
  const evalCaseBundle = buildEvalCaseBundle(enrichedRows, options.structuredTaskMetrics, options.trace);

  // ── Stages: objective / subjective / extended — no mutual data dependency,
  //    run in parallel.  Bad-case extraction depends on obj+subj so waits after.
  //    Note: subjectiveMetrics drives N concurrent LLM calls (session judging);
  //    extendedMetrics drives up to 10 concurrent LLM calls via Promise.all.
  //    Together they stay within a reasonable API fan-out for typical batch sizes.
  const extendedInputs = options.extendedInputs ?? {};
  const hasAnyExtendedInput = Boolean(
    extendedInputs.retrievalContexts?.length ||
      extendedInputs.toolCalls?.length ||
      extendedInputs.retentionFacts?.length ||
      extendedInputs.roleProfile,
  );

  const [objectiveMetrics, subjectiveMetrics, extendedMetrics] = await Promise.all([
    runEvaluateStage(options, "objective", "客观指标", () => buildObjectiveMetrics(enrichedRows)),
    runEvaluateStage(options, "subjective", "主观指标", () =>
      buildSubjectiveMetrics(enrichedRows, options.useLlm, options.runId, { judgeRequired }),
    ),
    runEvaluateStage(options, "extended", "扩展指标", () =>
      hasAnyExtendedInput
        ? buildExtendedMetrics({ ...extendedInputs, useLlm: options.useLlm, runId: options.runId })
        : Promise.resolve(undefined),
    ),
  ]);

  // ── Scenario evaluation (sync, needs obj+subj) ───────────────────────────────
  const scenarioTemplate = options.scenarioId ? getScenarioTemplateById(options.scenarioId) : null;
  if (options.scenarioId && !scenarioTemplate) {
    warnings.push(`未找到场景模板：${options.scenarioId}，本次按通用评估返回。`);
  }
  const scenarioEvaluation = scenarioTemplate
    ? evaluateScenarioTemplate(scenarioTemplate, {
        rows: enrichedRows,
        objectiveMetrics,
        subjectiveMetrics,
      })
    : null;

  const metricRegistry = buildMetricRegistrySnapshot({
    objectiveMetrics,
    subjectiveMetrics,
    structuredTaskMetrics: options.structuredTaskMetrics,
    trace: options.trace,
    capabilities: evalCaseBundle.capabilityReport,
    scenarioEvaluation,
    scenarioTemplate,
  });

  // ── Bad case extraction (needs obj+subj) ─────────────────────────────────────
  const badCaseAssets = await runEvaluateStage(options, "badcase", "bad case 抽取", () =>
    buildBadCaseAssets(enrichedRows, objectiveMetrics, subjectiveMetrics, {
      runId: options.runId,
      scenarioId: options.scenarioId,
    }),
  );

  // ── Charts, suggestions, summary ─────────────────────────────────────────────
  const { charts, suggestions, summaryCards } = await runEvaluateStage(
    options,
    "complete",
    "图表与建议",
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
        options.structuredTaskMetrics,
      ),
    }),
  );

  // ── Dynamic replay (intent pointer evaluation) ────────────────────────────────
  let dynamicReplayStatus: DynamicReplayStatus = "skipped";
  let intentSequences: IntentSequenceDoc[] | null = null;
  let intentRunLogsBySession: IntentRunLog[][] | null = null;
  let intentMetrics: IntentEvalMetrics | null = null;

  if (enableDynamicReplay && options.agentApiEndpoint) {
    try {
      const extracted = await runEvaluateStage(
        options,
        "parse",
        "意图序列提取",
        () => extractIntentSequences(enrichedRows, options.useLlm, options.runId),
      );

      if (extracted.length === 0) {
        dynamicReplayStatus = "failed";
        warnings.push("意图序列提取未产出任何结果，dynamic replay 跳过。");
      } else {
        intentSequences = extracted;
        const runLogs = await runEvaluateStage(
          options,
          "subjective",
          "SimUser 回放",
          () =>
            runSimUserReplay(extracted, enrichedRows, options.useLlm, {
              agentApiEndpoint: options.agentApiEndpoint!,
              runId: options.runId,
            }),
        );
        intentRunLogsBySession = runLogs;
        intentMetrics = computeIntentMetrics(runLogs, extracted, enrichedRows);

        const successfulSessions = runLogs.filter((s) => s.length > 0).length;
        dynamicReplayStatus =
          successfulSessions === extracted.length
            ? "completed"
            : successfulSessions > 0
              ? "partial"
              : "failed";
      }
    } catch (error) {
      dynamicReplayStatus = "failed";
      const msg = error instanceof Error ? error.message : String(error);
      warnings.push(`Dynamic replay 失败：${msg}`);
      console.error("[evaluateRun] Dynamic replay pipeline failed:", error);
    }
  }

  if (subjectiveMetrics.status !== "ready" && !judgeRequired) {
    warnings.push("主观评估当前为降级模式（LLM judge 调用失败或未启用）。");
  }

  // ── Artifact persistence ──────────────────────────────────────────────────────
  let artifactPath: string | undefined;
  if (options.persistArtifact ?? Boolean(options.artifactBaseName)) {
    const artifactBaseName = sanitizeArtifactBaseName(options.artifactBaseName ?? options.runId);
    const artifactDirectory = path.join("mock-chatlog", "enriched-data");
    artifactPath = path.join(artifactDirectory, `${artifactBaseName}.enriched.csv`);
    await mkdir(artifactDirectory, { recursive: true });
    await writeFile(artifactPath, enrichedCsv, "utf8");
  }

  const response: EvaluateResponse & { artifactPath?: string } = {
    runId: options.runId,
    meta: {
      sessions: new Set(rawRows.map((row) => row.sessionId)).size,
      messages: rawRows.length,
      hasTimestamp: rawRows.every((row) => Boolean(row.timestamp)),
      generatedAt: new Date().toISOString(),
      warnings,
      scenarioContext: options.scenarioContext,
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
    intentRunLogs: intentRunLogsBySession,
  };

  return response;
}

/**
 * Run a synchronous evaluation stage and emit observable progress events.
 */
function runEvaluateStageSync<T>(
  options: EvaluateRunOptions,
  stage: EvaluationStageKey,
  label: string,
  operation: () => T,
): T {
  emitProgress(options, { type: "stage", stage, status: "running", message: `${label}进行中` });
  try {
    const result = operation();
    emitProgress(options, { type: "stage", stage, status: "done", message: `${label}完成` });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emitProgress(options, { type: "stage", stage, status: "failed", message: `${label}失败`, detail });
    throw error;
  }
}

/**
 * Run one named async evaluation stage and emit observable progress events.
 */
async function runEvaluateStage<T>(
  options: EvaluateRunOptions,
  stage: EvaluationStageKey,
  label: string,
  operation: () => Promise<T> | T,
): Promise<T> {
  emitProgress(options, { type: "stage", stage, status: "running", message: `${label}进行中` });
  try {
    const result = await operation();
    emitProgress(options, { type: "stage", stage, status: "done", message: `${label}完成` });
    return result;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    emitProgress(options, { type: "stage", stage, status: "failed", message: `${label}失败`, detail });
    throw error;
  }
}

function emitProgress(options: EvaluateRunOptions, event: EvaluationProgressEvent): void {
  try {
    options.onProgress?.(event);
  } catch (error) {
    console.warn(
      `[EVALUATE] progress callback failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function sanitizeArtifactBaseName(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "enriched-artifact";
}
