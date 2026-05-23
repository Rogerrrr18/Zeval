/**
 * @fileoverview Eval Copilot Skill Registry.
 *
 * 把 Zeval 现有的内部 API 包装成 Chat 可调度的 skill。每个 skill 有：
 *   - name / description / paramsSchema：给 LLM 看的契约
 *   - execute()：实际调度内部模块（直接调 pipeline，不走 HTTP，省一次序列化）
 *
 * MVP 阶段优先实现对 Chat 主链路最有价值的 skill：
 *   1. run_evaluate    —— 把日志/对话转成评估结果
 *   2. summarize_findings —— 从评估结果里提炼 top 风险（仅本地聚合，无 LLM）
 *   3. build_remediation —— 基于 bad case 生成 Skill bundle 调优包
 *   4. save_baseline / run_validation / compare_baselines —— 串起基线、回放与对比
 */

import { z } from "zod";
import { readZevalEnvValue } from "@/lib/siliconflow";
import { replayAssistantRowsWithHttpApi, resolveReplyEndpoint } from "@/online-eval/replayAssistant";
import { runEvaluatePipeline } from "@/pipeline/evaluateRun";
import { buildRemediationPackage, createRemediationPackageStore, type RemediationPackageSnapshot } from "@/remediation";
import { rawChatlogRowSchema } from "@/schemas/api";
import {
  createValidationRunStore,
  runOfflineEvalValidation,
  runReplayValidation,
  type ValidationRunSnapshot,
} from "@/validation";
import { createWorkbenchBaselineStore, type WorkbenchBaselineSnapshot } from "@/workbench";
import type { EvaluateResponse, RawChatlogRow } from "@/types/pipeline";

/**
 * Skill 执行上下文（由 orchestrator 注入）。
 */
export type SkillContext = {
  /** 一次会话内共享的 KV 状态（前一个 skill 的输出可被后一个引用） */
  scratch: Record<string, unknown>;
  /** 触发上下文（用于落库、追踪） */
  workspaceId?: string;
};

/**
 * Skill 执行结果（结构化，便于 LLM 继续推理 + 前端渲染）。
 */
export type SkillResult = {
  ok: boolean;
  /** 给 LLM 看的简明文本（比 raw 数据小得多） */
  summary: string;
  /** 完整结果（前端可渲染卡片，LLM 不需要全部看到） */
  data?: unknown;
  /** 失败时的错误 */
  error?: string;
};

/**
 * 单个 skill 的形态。
 */
export type Skill = {
  name: string;
  /** 给 LLM 的英文/中文描述（用于规划） */
  description: string;
  /** Zod 参数 schema，用于校验 LLM 输出 */
  paramsSchema: z.ZodTypeAny;
  /** 实际执行 */
  execute: (params: unknown, ctx: SkillContext) => Promise<SkillResult>;
};

// -------- Skill 1: run_evaluate ------------------------------------------------

const runEvaluateParams = z.object({
  /** 用户给的对话日志（标准 raw rows 格式） */
  rawRows: z.array(rawChatlogRowSchema).min(1),
  /** 业务场景（可选） */
  scenarioId: z.string().optional(),
  /** 是否使用 LLM judge（成本较高，默认 false） */
  useLlm: z.boolean().optional().default(false),
});

const runEvaluateSkill: Skill = {
  name: "run_evaluate",
  description: "对一批对话日志运行 Zeval 评估管线，返回核心指标 + bad case + 扩展指标。",
  paramsSchema: runEvaluateParams,
  async execute(params, ctx) {
    const args = runEvaluateParams.parse(params);
    const result = await runEvaluatePipeline(args.rawRows as RawChatlogRow[], {
      runId: `copilot_${Date.now()}`,
      scenarioId: args.scenarioId,
      useLlm: args.useLlm ?? false,
    });
    ctx.scratch.lastEvaluate = result;

    const cards = result.summaryCards ?? [];
    const top = cards.slice(0, 4).map((c) => `${c.label}: ${c.value}`).join("；");
    const badCount = result.badCaseAssets?.length ?? 0;

    return {
      ok: true,
      summary: `已评估 ${args.rawRows.length} 条消息。${top}。bad case ${badCount} 条。`,
      data: {
        runId: result.runId,
        summaryCards: cards,
        badCaseCount: badCount,
        extendedMetrics: result.extendedMetrics ?? null,
      },
    };
  },
};

// -------- Skill 2: summarize_findings -----------------------------------------

const summarizeParams = z.object({
  /** 默认从 scratch.lastEvaluate 取，无需参数 */
  topN: z.number().int().min(1).max(10).optional().default(3),
});

/**
 * 从 evaluate 结果里聚类 top 失败模式。本地规则聚合（按 tag），无 LLM 调用。
 */
const summarizeSkill: Skill = {
  name: "summarize_findings",
  description: "把上一次 run_evaluate 的 bad case 按 tag 聚类，输出 top N 风险模式。",
  paramsSchema: summarizeParams,
  async execute(params, ctx) {
    const args = summarizeParams.parse(params);
    const last = ctx.scratch.lastEvaluate as EvaluateResponse | undefined;
    if (!last) {
      return {
        ok: false,
        summary: "没有可总结的评估结果，请先调用 run_evaluate。",
        error: "MISSING_EVALUATE_RESULT",
      };
    }
    const counter = new Map<string, { count: number; samples: string[] }>();
    for (const bc of last.badCaseAssets ?? []) {
      const tags = (bc.tags && bc.tags.length > 0 ? bc.tags : ["未分类"]) as string[];
      for (const tag of tags) {
        const slot = counter.get(tag) ?? { count: 0, samples: [] };
        slot.count += 1;
        if (slot.samples.length < 2 && bc.sessionId) slot.samples.push(bc.sessionId);
        counter.set(tag, slot);
      }
    }
    const ranked = [...counter.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, args.topN)
      .map(([tag, v]) => ({ tag, count: v.count, sampleSessionIds: v.samples }));

    if (ranked.length === 0) {
      return { ok: true, summary: "本批未发现明显失败模式。", data: { topRisks: [] } };
    }
    const text = ranked.map((r, i) => `${i + 1}. ${r.tag}（${r.count} 例）`).join("；");
    return {
      ok: true,
      summary: `Top ${ranked.length} 风险：${text}`,
      data: { topRisks: ranked },
    };
  },
};

// -------- Skill 3: build_remediation ------------------------------------------

const buildRemediationParams = z.object({
  baselineVersion: z.string().optional(),
  /** 可选业务场景，用于调优包文案 */
  scenarioId: z.string().optional(),
});

const buildRemediationSkill: Skill = {
  name: "build_remediation",
  description:
    "基于上一次 run_evaluate 的 bad case 生成 Claude Code / Codex 可读的 Skill bundle 调优包。",
  paramsSchema: buildRemediationParams,
  async execute(params, ctx) {
    const args = buildRemediationParams.parse(params);
    const last = await ensureEvaluateResult(ctx, {
      scenarioId: args.scenarioId,
      useLlm: false,
    });
    if (!last.evaluate) {
      return {
        ok: false,
        summary: last.error ?? "没有可用的评估结果，请先附加日志或 run_evaluate。",
        error: "MISSING_EVALUATE_RESULT",
      };
    }
    if (!last.evaluate.badCaseAssets?.length) {
      return {
        ok: true,
        summary: "无 bad case，跳过调优包生成。",
        data: { skipped: true },
      };
    }

    const built = buildRemediationPackage({
      evaluate: last.evaluate,
      baselineCustomerId: args.baselineVersion,
    });
    if (built.skipped || !built.package) {
      return {
        ok: true,
        summary: built.message ?? "无可生成内容，已跳过。",
        data: { skipped: true },
      };
    }
    const store = createRemediationPackageStore();
    await store.save(built.package);
    ctx.scratch.lastRemediation = built.package;
    return {
      ok: true,
      summary: `已生成调优包 ${built.package.packageId}，产物是 Skill 文件夹：${built.package.skillFolder ?? built.package.artifactDir}。`,
      data: built.package,
    };
  },
};

// -------- Skill 4: save_baseline ----------------------------------------------

const saveBaselineParams = z.object({
  customerId: z.string().min(1).max(64).optional().default("chat_default"),
  label: z.string().max(200).optional(),
  sourceFileName: z.string().max(500).optional(),
  rawRows: z.array(rawChatlogRowSchema).min(1).optional(),
  scenarioId: z.string().optional(),
  useLlm: z.boolean().optional().default(false),
});

const saveBaselineSkill: Skill = {
  name: "save_baseline",
  description: "把最近一次评估保存成可回放 baseline；如果还没评估但有附件日志，会先跑一次评估再保存。",
  paramsSchema: saveBaselineParams,
  async execute(params, ctx) {
    const args = saveBaselineParams.parse(params);
    const evaluated = await ensureEvaluateResult(ctx, {
      rawRows: args.rawRows,
      scenarioId: args.scenarioId,
      useLlm: args.useLlm,
    });
    if (!evaluated.evaluate || !evaluated.rawRows) {
      return { ok: false, summary: evaluated.error ?? "没有可保存的评估结果。", error: "MISSING_EVALUATE_RESULT" };
    }

    const snapshot: WorkbenchBaselineSnapshot = {
      schemaVersion: 1,
      customerId: args.customerId,
      runId: evaluated.evaluate.runId,
      createdAt: new Date().toISOString(),
      label: args.label ?? `Chat 基线 ${new Date().toLocaleString("zh-CN")}`,
      sourceFileName: args.sourceFileName ?? getScratchString(ctx, "attachedFileName") ?? "chat-upload",
      evaluate: evaluated.evaluate,
      rawRows: evaluated.rawRows,
    };
    const store = createWorkbenchBaselineStore({ workspaceId: ctx.workspaceId });
    await store.save(snapshot);
    ctx.scratch.lastBaseline = { customerId: snapshot.customerId, snapshot };

    return {
      ok: true,
      summary: `已保存基线 ${snapshot.runId}。后续可以用它做回放验证和新旧表现对比。`,
      data: { customerId: snapshot.customerId, runId: snapshot.runId, createdAt: snapshot.createdAt },
    };
  },
};

// -------- Skill 5: run_validation ---------------------------------------------

const runValidationParams = z.object({
  packageId: z.string().min(1).optional(),
  mode: z.enum(["replay", "offline_eval"]).optional().default("replay"),
  baselineCustomerId: z.string().min(1).optional(),
  replyApiBaseUrl: z.string().min(1).max(2000).optional(),
  sampleBatchId: z.string().min(1).optional(),
  useLlm: z.boolean().optional().default(false),
  replyTimeoutMs: z.number().int().min(3000).max(120000).optional(),
});

const runValidationSkill: Skill = {
  name: "run_validation",
  description: "对最近的调优包运行 replay 或 offline validation，告诉 PM 这次修复是否比基线更好。",
  paramsSchema: runValidationParams,
  async execute(params, ctx) {
    const args = runValidationParams.parse(params);
    const packageSnapshot = await resolveRemediationPackage(ctx, args.packageId);
    if (!packageSnapshot) {
      return {
        ok: false,
        summary: "还没有可验证的调优包。请先生成调优包，再运行 validation。",
        error: "MISSING_REMEDIATION_PACKAGE",
      };
    }

    const validationRun =
      args.mode === "replay"
        ? await runReplayValidation({
            packageSnapshot,
            baselineCustomerId: args.baselineCustomerId ?? getLastBaselineCustomerId(ctx),
            replyApiBaseUrl: args.replyApiBaseUrl,
            useLlm: args.useLlm,
            replyTimeoutMs: args.replyTimeoutMs,
            workspaceId: ctx.workspaceId,
          })
        : await runOfflineEvalValidation({
            packageSnapshot,
            sampleBatchId: args.sampleBatchId,
            replyApiBaseUrl: args.replyApiBaseUrl,
            useLlm: args.useLlm,
            replyTimeoutMs: args.replyTimeoutMs,
            workspaceId: ctx.workspaceId,
          });
    const store = createValidationRunStore();
    await store.save(validationRun);
    ctx.scratch.lastValidationRun = validationRun;

    return {
      ok: validationRun.status === "passed",
      summary: summarizeValidationRun(validationRun),
      data: validationRun,
    };
  },
};

// -------- Skill 6: compare_baselines ------------------------------------------

const compareBaselinesParams = z.object({
  baselineCustomerId: z.string().min(1).optional(),
  baselineRunId: z.string().min(1).optional(),
  rawRows: z.array(rawChatlogRowSchema).min(1).optional(),
  replyApiBaseUrl: z.string().min(1).max(2000).optional(),
  scenarioId: z.string().optional(),
  useLlm: z.boolean().optional().default(false),
  replyTimeoutMs: z.number().int().min(3000).max(120000).optional(),
});

const compareBaselinesSkill: Skill = {
  name: "compare_baselines",
  description: "用最近 baseline 或指定 baseline 做一次在线回放评估，并用业务语言比较这次比上次好了还是变差了。",
  paramsSchema: compareBaselinesParams,
  async execute(params, ctx) {
    const args = compareBaselinesParams.parse(params);
    const baseline = await resolveBaselineSnapshot(ctx, args.baselineCustomerId, args.baselineRunId);
    const rawRows = args.rawRows ?? baseline?.snapshot.rawRows ?? getAttachedRawRows(ctx);
    if (!rawRows?.length) {
      return { ok: false, summary: "没有可对比的基线或附件日志。", error: "MISSING_ROWS" };
    }

    const baseUrl =
      args.replyApiBaseUrl?.trim() ||
      readZevalEnvValue(["SILICONFLOW_CUSTOMER_API_URL", "ZEVAL_CUSTOMER_API_URL"])?.trim() ||
      "http://127.0.0.1:4200";
    const replyEndpoint = resolveReplyEndpoint(baseUrl);
    const replayedRows = await replayAssistantRowsWithHttpApi(rawRows, replyEndpoint, {
      timeoutMs: args.replyTimeoutMs,
    });
    const current = await runEvaluatePipeline(replayedRows, {
      useLlm: args.useLlm,
      runId: `copilot_compare_${Date.now()}`,
      scenarioId: args.scenarioId ?? baseline?.snapshot.evaluate.scenarioEvaluation?.scenarioId,
    });
    ctx.scratch.lastEvaluate = current;

    return {
      ok: true,
      summary: summarizeBaselineComparison(baseline?.snapshot.evaluate, current),
      data: {
        baselineRunId: baseline?.snapshot.runId,
        currentRunId: current.runId,
        replyEndpoint,
        comparison: buildBaselineComparisonData(baseline?.snapshot.evaluate, current),
      },
    };
  },
};

// -------- Registry -------------------------------------------------------------

export const SKILL_REGISTRY: Record<string, Skill> = {
  [runEvaluateSkill.name]: runEvaluateSkill,
  [summarizeSkill.name]: summarizeSkill,
  [buildRemediationSkill.name]: buildRemediationSkill,
  [saveBaselineSkill.name]: saveBaselineSkill,
  [runValidationSkill.name]: runValidationSkill,
  [compareBaselinesSkill.name]: compareBaselinesSkill,
};

/**
 * Resolve or create an evaluation result for skills that depend on one.
 *
 * @param ctx Skill context.
 * @param options Optional raw rows and evaluation settings.
 * @returns Existing or newly computed evaluation plus source rows.
 */
async function ensureEvaluateResult(
  ctx: SkillContext,
  options: {
    rawRows?: RawChatlogRow[];
    scenarioId?: string;
    useLlm?: boolean;
  },
): Promise<{ evaluate?: EvaluateResponse; rawRows?: RawChatlogRow[]; error?: string }> {
  const existing = ctx.scratch.lastEvaluate as EvaluateResponse | undefined;
  const rawRows = options.rawRows ?? getAttachedRawRows(ctx);
  if (existing) {
    return { evaluate: existing, rawRows };
  }
  if (!rawRows?.length) {
    return { error: "没有附件日志，无法自动跑评估。" };
  }
  const evaluate = await runEvaluatePipeline(rawRows, {
    runId: `copilot_${Date.now()}`,
    scenarioId: options.scenarioId ?? getScratchString(ctx, "attachedScenarioId"),
    useLlm: options.useLlm ?? false,
  });
  ctx.scratch.lastEvaluate = evaluate;
  return { evaluate, rawRows };
}

/**
 * Read attached raw rows from scratch and validate the canonical row shape.
 *
 * @param ctx Skill context.
 * @returns Valid raw rows or undefined when unavailable.
 */
function getAttachedRawRows(ctx: SkillContext): RawChatlogRow[] | undefined {
  const parsed = z.array(rawChatlogRowSchema).safeParse(ctx.scratch.attachedRawRows);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Read one string scratch value.
 *
 * @param ctx Skill context.
 * @param key Scratch key.
 * @returns String value when present.
 */
function getScratchString(ctx: SkillContext, key: string): string | undefined {
  const value = ctx.scratch[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * Resolve the most recent remediation package, optionally loading by id.
 *
 * @param ctx Skill context.
 * @param packageId Optional package id.
 * @returns Package snapshot or null.
 */
async function resolveRemediationPackage(
  ctx: SkillContext,
  packageId?: string,
): Promise<RemediationPackageSnapshot | null> {
  if (packageId) {
    return createRemediationPackageStore().read(packageId);
  }
  const existing = ctx.scratch.lastRemediation as RemediationPackageSnapshot | undefined;
  if (existing) {
    return existing;
  }
  const evaluated = await ensureEvaluateResult(ctx, { useLlm: false });
  if (!evaluated.evaluate?.badCaseAssets?.length) {
    return null;
  }
  const built = buildRemediationPackage({
    evaluate: evaluated.evaluate,
    baselineCustomerId: getLastBaselineCustomerId(ctx),
  });
  if (built.skipped || !built.package) {
    return null;
  }
  const store = createRemediationPackageStore();
  await store.save(built.package);
  ctx.scratch.lastRemediation = built.package;
  return built.package;
}

/**
 * Resolve a saved baseline snapshot from scratch or persistent storage.
 *
 * @param ctx Skill context.
 * @param customerId Optional customer id.
 * @param runId Optional run id.
 * @returns Baseline lookup when found.
 */
async function resolveBaselineSnapshot(
  ctx: SkillContext,
  customerId?: string,
  runId?: string,
): Promise<{ customerId: string; snapshot: WorkbenchBaselineSnapshot } | null> {
  const last = ctx.scratch.lastBaseline as
    | { customerId: string; snapshot: WorkbenchBaselineSnapshot }
    | undefined;
  if (!customerId && !runId && last) {
    return last;
  }
  const store = createWorkbenchBaselineStore({ workspaceId: ctx.workspaceId });
  if (customerId && runId) {
    const snapshot = await store.read(customerId, runId);
    return snapshot ? { customerId, snapshot } : null;
  }
  if (runId) {
    return store.findByRunId(runId);
  }
  if (customerId) {
    const [latest] = await store.list(customerId);
    if (!latest) return null;
    const snapshot = await store.read(customerId, latest.runId);
    return snapshot ? { customerId, snapshot } : null;
  }
  return null;
}

/**
 * Get the last saved baseline customer id from scratch.
 *
 * @param ctx Skill context.
 * @returns Customer id when present.
 */
function getLastBaselineCustomerId(ctx: SkillContext): string | undefined {
  const last = ctx.scratch.lastBaseline as { customerId?: string } | undefined;
  return typeof last?.customerId === "string" ? last.customerId : undefined;
}

/**
 * Convert one validation run into a PM-facing summary sentence.
 *
 * @param validationRun Validation run snapshot.
 * @returns User-facing summary.
 */
function summarizeValidationRun(validationRun: ValidationRunSnapshot): string {
  if (validationRun.mode === "replay" && validationRun.summary.type === "replay") {
    const summary = validationRun.summary;
    return `回放验证 ${validationRun.status === "passed" ? "通过" : "未通过"}：win rate ${formatPercent(summary.winRate)}，${summary.improvedMetricCount}/${summary.totalTargetMetricCount} 个目标指标变好，回放了 ${summary.replayedRowCount} 条消息。`;
  }
  if (validationRun.summary.type === "offline_eval") {
    const summary = validationRun.summary;
    return `离线验证 ${validationRun.status === "passed" ? "通过" : "未通过"}：${summary.improvedCases} 个 case 变好，${summary.regressedCases} 个 case 退化，执行 ${summary.executedCases}/${summary.totalCases} 个 case。`;
  }
  return `验证已完成，状态：${validationRun.status}。`;
}

/**
 * Build a compact comparison payload for UI/debug rendering.
 *
 * @param baseline Baseline evaluation if available.
 * @param current Current evaluation.
 * @returns Comparison values.
 */
function buildBaselineComparisonData(baseline: EvaluateResponse | undefined, current: EvaluateResponse) {
  return {
    scenarioScore: {
      baseline: baseline?.scenarioEvaluation?.averageScore ?? null,
      current: current.scenarioEvaluation?.averageScore ?? null,
    },
    badCaseCount: {
      baseline: baseline?.badCaseAssets?.length ?? null,
      current: current.badCaseAssets?.length ?? 0,
    },
    avgResponseGapSec: {
      baseline: baseline?.objectiveMetrics.avgResponseGapSec ?? null,
      current: current.objectiveMetrics.avgResponseGapSec,
    },
    escalationKeywordHitRate: {
      baseline: baseline?.objectiveMetrics.escalationKeywordHitRate ?? null,
      current: current.objectiveMetrics.escalationKeywordHitRate,
    },
  };
}

/**
 * Summarize current evaluation compared with baseline in product language.
 *
 * @param baseline Baseline evaluation if available.
 * @param current Current evaluation.
 * @returns User-facing comparison.
 */
function summarizeBaselineComparison(baseline: EvaluateResponse | undefined, current: EvaluateResponse): string {
  if (!baseline) {
    return `已完成在线回放评估：当前 bad case ${current.badCaseAssets?.length ?? 0} 条，业务 KPI ${formatNullableScore(current.scenarioEvaluation?.averageScore)}。`;
  }
  const baselineScore = baseline.scenarioEvaluation?.averageScore;
  const currentScore = current.scenarioEvaluation?.averageScore;
  const scoreDelta =
    typeof baselineScore === "number" && typeof currentScore === "number"
      ? currentScore - baselineScore
      : null;
  const badDelta = (current.badCaseAssets?.length ?? 0) - (baseline.badCaseAssets?.length ?? 0);
  const scoreText = scoreDelta === null ? "业务 KPI 暂无可比口径" : `业务 KPI ${formatSigned(scoreDelta)}`;
  const badText = badDelta === 0 ? "bad case 数持平" : `bad case ${badDelta > 0 ? "增加" : "减少"} ${Math.abs(badDelta)} 条`;
  return `对比完成：${scoreText}，${badText}。当前 runId=${current.runId}。`;
}

/**
 * Format one nullable 0-1 score.
 *
 * @param value Score value.
 * @returns Percentage text.
 */
function formatNullableScore(value: number | undefined): string {
  return typeof value === "number" ? formatPercent(value) : "未启用";
}

/**
 * Format a decimal delta as signed percentage points.
 *
 * @param value Delta value.
 * @returns Signed percentage-point string.
 */
function formatSigned(value: number): string {
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value * 100).toFixed(1)}pct`;
}

/**
 * Format a 0-1 rate as a percentage.
 *
 * @param value Rate value.
 * @returns Percentage string.
 */
function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

/**
 * Render a system-prompt-friendly description of all skills (for the LLM planner).
 *
 * @returns A markdown-flavored text block describing every skill and its params.
 */
export function renderSkillManifest(): string {
  return Object.values(SKILL_REGISTRY)
    .map((skill) => {
      // Lightweight schema serialization — avoid pulling zod-to-json-schema dep.
      const shape = describeZodSchema(skill.paramsSchema);
      return `- **${skill.name}**: ${skill.description}\n  参数: ${shape}`;
    })
    .join("\n");
}

/**
 * Describe a Zod schema as a flat one-liner (best-effort, MVP-only).
 *
 * @param schema A Zod schema.
 * @returns Human-readable shape string.
 */
function describeZodSchema(schema: z.ZodTypeAny): string {
  // MVP: zod 4 internals vary across builds, so we inspect runtime def cautiously.
  const def = (schema as unknown as { _def?: { typeName?: string }; def?: { type?: string } });
  const tn = def._def?.typeName || def.def?.type;
  if (tn === "ZodObject" || tn === "object") {
    const shape = (schema as unknown as { shape: Record<string, z.ZodTypeAny> }).shape ?? {};
    const entries = Object.entries(shape);
    return `{ ${entries
      .map(([k, v]) => {
        const opt =
          (v as unknown as { isOptional?: () => boolean }).isOptional?.() ?? false;
        return `${k}${opt ? "?" : ""}: ${zodTypeName(v)}`;
      })
      .join(", ")} }`;
  }
  return zodTypeName(schema);
}

/**
 * Best-effort Zod type name resolver (zod 4 friendly).
 *
 * @param schema A Zod schema.
 * @returns Type name.
 */
function zodTypeName(schema: z.ZodTypeAny): string {
  const def = (schema as unknown as { _def?: { typeName?: string }; def?: { type?: string } });
  const tn = def._def?.typeName || def.def?.type;
  switch (tn) {
    case "ZodString":
    case "string":
      return "string";
    case "ZodNumber":
    case "number":
      return "number";
    case "ZodBoolean":
    case "boolean":
      return "boolean";
    case "ZodArray":
    case "array":
      return "array";
    case "ZodObject":
    case "object":
      return "object";
    default:
      return "any";
  }
}
