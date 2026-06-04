/**
 * @fileoverview Zeval Agent 工具注册表
 *
 * 面向评测垂直领域的核心工具集：
 * - evaluate_metric:      评估单个指标
 * - compare_submissions:  横向对比多个 Agent 提交
 * - analyze_rubric:       分析 Rubric 的覆盖度和质量
 * - mine_badcases:        从评测结果中挖掘 badcase
 * - generate_report:      生成评测报告
 * - search_cases:         按条件搜索案例
 * - summarize_capability: 按能力维度汇总分数
 */

import type {
  BenchmarkAgentSubmission,
  BenchmarkCase,
  BenchmarkCapabilityDimension,
  BenchmarkMetricEvaluationResult,
  BenchmarkRubricMetric,
  BenchmarkRunResult,
  BenchmarkTaskPackage,
} from "@/benchmark/types";
import type {
  AgentExecutionContext,
  AgentToolCall,
  AgentToolHandler,
  AgentToolRegistry,
  AgentToolResult,
  AgentToolSchema,
} from "./types";

// ───────────────────────────────────────────────
// 工具 Schema 定义
// ───────────────────────────────────────────────

const evaluateMetricSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "evaluate_metric",
    description: "评估单个指标：对比 Agent 输出与预期结果，给出分数和理由",
    parameters: {
      type: "object",
      properties: {
        caseId: { type: "string", description: "案例 ID" },
        metricKey: { type: "string", description: "指标键名，如 decision_accuracy" },
        submissionOutput: { type: "string", description: "Agent 的原始输出" },
        expectedOutput: { type: "string", description: "预期输出" },
        criteria: { type: "string", description: "评估标准/准则" },
      },
      required: ["caseId", "metricKey", "submissionOutput", "expectedOutput", "criteria"],
    },
  },
};

const compareSubmissionsSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "compare_submissions",
    description: "横向对比多个 Agent 框架在同一案例上的提交，找出差异和优劣",
    parameters: {
      type: "object",
      properties: {
        caseId: { type: "string", description: "案例 ID" },
        frameworkIds: {
          type: "array",
          description: "要对比的 Agent 框架 ID 列表",
          items: { type: "string" },
        },
        focusMetrics: {
          type: "array",
          description: "重点关注的指标键名列表",
          items: { type: "string" },
        },
      },
      required: ["caseId", "frameworkIds"],
    },
  },
};

const analyzeRubricSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "analyze_rubric",
    description: "分析 Rubric 的质量：检查指标覆盖度、权重合理性、评分标准清晰度",
    parameters: {
      type: "object",
      properties: {
        rubricId: { type: "string", description: "Rubric ID" },
        checkCoverage: { type: "boolean", description: "是否检查能力维度覆盖度" },
        checkWeights: { type: "boolean", description: "是否检查权重合理性" },
        suggestImprovements: { type: "boolean", description: "是否生成改进建议" },
      },
      required: ["rubricId"],
    },
  },
};

const mineBadcasesSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "mine_badcases",
    description: "从评测结果中挖掘 badcase：找出表现差的案例，分析根因",
    parameters: {
      type: "object",
      properties: {
        minScore: { type: "number", description: "分数阈值，低于此值的视为 badcase" },
        capability: { type: "string", description: "按能力维度筛选，如 reasoning_quality" },
        limit: { type: "number", description: "返回的最大 badcase 数量" },
        includeAnalysis: { type: "boolean", description: "是否包含根因分析" },
      },
      required: ["minScore"],
    },
  },
};

const generateReportSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "generate_report",
    description: "生成评测报告：汇总所有指标结果，生成可读的分析报告",
    parameters: {
      type: "object",
      properties: {
        reportType: {
          type: "string",
          description: "报告类型",
          enum: ["summary", "detailed", "leaderboard", "badcase_analysis"],
        },
        format: {
          type: "string",
          description: "输出格式",
          enum: ["markdown", "json", "html"],
        },
        includeCharts: { type: "boolean", description: "是否包含图表数据" },
      },
      required: ["reportType"],
    },
  },
};

const searchCasesSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "search_cases",
    description: "按条件搜索案例：根据分数、标签、能力维度等筛选",
    parameters: {
      type: "object",
      properties: {
        capability: { type: "string", description: "能力维度筛选" },
        minScore: { type: "number", description: "最低分数" },
        maxScore: { type: "number", description: "最高分数" },
        tags: { type: "array", description: "标签筛选", items: { type: "string" } },
        frameworkId: { type: "string", description: "Agent 框架筛选" },
        limit: { type: "number", description: "返回数量限制" },
      },
      required: [],
    },
  },
};

const summarizeCapabilitySchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "summarize_capability",
    description: "按能力维度汇总分数：计算每个能力维度的平均分、通过率",
    parameters: {
      type: "object",
      properties: {
        capability: {
          type: "string",
          description: "能力维度，如 task_completion。不传则汇总所有维度",
        },
        groupBy: {
          type: "string",
          description: "分组方式",
          enum: ["framework", "model", "case"],
        },
      },
      required: [],
    },
  },
};

// ───────────────────────────────────────────────
// 工具实现
// ───────────────────────────────────────────────

const evaluateMetricHandler: AgentToolHandler = async (args, ctx) => {
  const caseId = String(args.caseId ?? "");
  const metricKey = String(args.metricKey ?? "");
  const submissionOutput = String(args.submissionOutput ?? "");
  const expectedOutput = String(args.expectedOutput ?? "");
  const criteria = String(args.criteria ?? "");

  if (!caseId || !metricKey) {
    return {
      tool_call_id: "",
      name: "evaluate_metric",
      status: "error",
      result: null,
      error: "caseId 和 metricKey 是必填参数",
    };
  }

  // 查找当前案例的 metric
  const metric = ctx.currentMetric;
  const submission = ctx.currentSubmission;

  // 简单规则匹配评估
  let score = 0;
  let passed = false;
  const evidence: string[] = [];

  const subNorm = submissionOutput.toLowerCase().trim();
  const expNorm = expectedOutput.toLowerCase().trim();

  if (subNorm === expNorm) {
    score = 1;
    passed = true;
    evidence.push("输出与预期完全匹配");
  } else if (subNorm.includes(expNorm) || expNorm.includes(subNorm)) {
    score = 0.7;
    passed = true;
    evidence.push("输出与预期部分匹配");
  } else {
    score = 0;
    passed = false;
    evidence.push("输出与预期不匹配");
  }

  // 如果有详细的 criteria，可以进一步分析
  if (criteria) {
    evidence.push(`评估标准: ${criteria.slice(0, 100)}`);
  }

  return {
    tool_call_id: "",
    name: "evaluate_metric",
    status: "success",
    result: {
      caseId,
      metricKey,
      score,
      passed,
      normalizedScore: score,
      evidence,
      reason: passed ? "符合预期" : "不符合预期",
      confidence: 0.8,
    },
  };
};

const compareSubmissionsHandler: AgentToolHandler = async (args, ctx) => {
  const caseId = String(args.caseId ?? "");
  const frameworkIds = Array.isArray(args.frameworkIds) ? args.frameworkIds.map(String) : [];
  const focusMetrics = Array.isArray(args.focusMetrics) ? args.focusMetrics.map(String) : [];

  if (!caseId || frameworkIds.length === 0) {
    return {
      tool_call_id: "",
      name: "compare_submissions",
      status: "error",
      result: null,
      error: "caseId 和 frameworkIds 是必填参数",
    };
  }

  // 从上下文中查找该案例的所有提交
  const allResults = ctx.metricResults.filter((r) => r.caseId === caseId);
  const byFramework: Record<string, BenchmarkMetricEvaluationResult[]> = {};

  for (const fwId of frameworkIds) {
    byFramework[fwId] = allResults.filter((r) => r.agentFramework === fwId);
  }

  const comparison = frameworkIds.map((fwId) => {
    const results = byFramework[fwId] ?? [];
    const avgScore = results.length > 0
      ? results.reduce((s, r) => s + r.normalizedScore, 0) / results.length
      : 0;
    return {
      frameworkId: fwId,
      resultCount: results.length,
      averageScore: Number(avgScore.toFixed(3)),
      passedCount: results.filter((r) => r.passed).length,
    };
  });

  // 找出最佳表现
  const best = comparison.reduce((a, b) => (a.averageScore >= b.averageScore ? a : b));

  return {
    tool_call_id: "",
    name: "compare_submissions",
    status: "success",
    result: {
      caseId,
      comparison,
      bestFramework: best.frameworkId,
      bestScore: best.averageScore,
      focusMetrics,
      totalMetricsEvaluated: allResults.length,
    },
  };
};

const analyzeRubricHandler: AgentToolHandler = async (args, ctx) => {
  const rubricId = String(args.rubricId ?? "");
  const checkCoverage = Boolean(args.checkCoverage ?? true);
  const checkWeights = Boolean(args.checkWeights ?? true);
  const suggestImprovements = Boolean(args.suggestImprovements ?? true);

  const task = ctx.task;
  if (!task?.rubric) {
    return {
      tool_call_id: "",
      name: "analyze_rubric",
      status: "error",
      result: null,
      error: "当前上下文中没有 Rubric 信息",
    };
  }

  const rubric = task.rubric;
  const modules = rubric.modules;
  const allMetrics = modules.flatMap((m) => m.metrics);

  const analysis: Record<string, unknown> = {
    rubricId,
    totalModules: modules.length,
    totalMetrics: allMetrics.length,
    capabilities: modules.map((m) => m.capability),
  };

  if (checkCoverage) {
    const allCapabilities = new Set(modules.map((m) => m.capability));
    analysis.coverageScore = allCapabilities.size / 10; // 假设有 10 个能力维度
    analysis.coverageMissing = ["safety_policy", "latency_efficiency", "tool_use_correctness"].filter(
      (c) => !allCapabilities.has(c as BenchmarkCapabilityDimension),
    );
  }

  if (checkWeights) {
    const totalWeight = modules.reduce((s, m) => s + m.weight, 0);
    analysis.totalWeight = totalWeight;
    analysis.weightBalanced = Math.abs(totalWeight - 1) < 0.1;
    analysis.moduleWeights = modules.map((m) => ({
      capability: m.capability,
      weight: m.weight,
      metricCount: m.metrics.length,
    }));
  }

  if (suggestImprovements) {
    analysis.improvements = [
      "建议增加 safety_policy 维度的指标，确保 Agent 输出安全合规",
      "建议对 reasoning_quality 维度增加细分子指标，提高评估粒度",
      "建议设置 human_approval_required 标志，对关键指标增加人工审核",
    ].filter(() => allMetrics.some((m) => m.humanApprovalRequired === false));
  }

  return {
    tool_call_id: "",
    name: "analyze_rubric",
    status: "success",
    result: analysis,
  };
};

const mineBadcasesHandler: AgentToolHandler = async (args, ctx) => {
  const minScore = Number(args.minScore ?? 0.5);
  const capability = args.capability ? String(args.capability) : undefined;
  const limit = Number(args.limit ?? 10);
  const includeAnalysis = Boolean(args.includeAnalysis ?? true);

  const results = ctx.metricResults;
  let badcases = results.filter((r) => r.normalizedScore < minScore);

  if (capability) {
    badcases = badcases.filter((r) => r.capability === capability);
  }

  badcases = badcases.slice(0, limit);

  const mined = badcases.map((r) => ({
    caseId: r.caseId,
    frameworkId: r.agentFramework,
    model: r.model,
    metricKey: r.metricKey,
    score: r.normalizedScore,
    reason: r.reason,
    evidence: r.evidence,
    ...(includeAnalysis
      ? {
          rootCause: `在 ${r.capability} 能力维度上表现不佳，可能是 ${r.agentFramework} 对 ${r.metricKey} 的处理策略有缺陷`,
          suggestion: `建议检查 ${r.agentFramework} 的 prompt 设计或增加该场景的 few-shot 示例`,
        }
      : {}),
  }));

  return {
    tool_call_id: "",
    name: "mine_badcases",
    status: "success",
    result: {
      threshold: minScore,
      totalBadcases: mined.length,
      capabilityFilter: capability,
      badcases: mined,
      summary: `共发现 ${mined.length} 个 badcase，主要问题集中在 ${capability ?? "多个维度"}`,
    },
  };
};

const generateReportHandler: AgentToolHandler = async (args, ctx) => {
  const reportType = String(args.reportType ?? "summary") as "summary" | "detailed" | "leaderboard" | "badcase_analysis";
  const format = String(args.format ?? "markdown") as "markdown" | "json" | "html";
  const includeCharts = Boolean(args.includeCharts ?? true);

  const results = ctx.metricResults;
  const frameworks = [...new Set(results.map((r) => r.agentFramework))];

  let report: Record<string, unknown> = {};

  switch (reportType) {
    case "summary": {
      const totalCases = new Set(results.map((r) => r.caseId)).size;
      const avgScore = results.length > 0
        ? results.reduce((s, r) => s + r.normalizedScore, 0) / results.length
        : 0;
      report = {
        title: "评测汇总报告",
        totalEvaluations: results.length,
        totalCases,
        averageScore: Number(avgScore.toFixed(3)),
        passRate: Number(((results.filter((r) => r.passed).length / Math.max(results.length, 1)) * 100).toFixed(1)),
        frameworkCount: frameworks.length,
        frameworks,
      };
      break;
    }
    case "leaderboard": {
      report = {
        title: "评测排行榜",
        leaderboard: frameworks.map((fw) => {
          const fwResults = results.filter((r) => r.agentFramework === fw);
          const avgScore = fwResults.length > 0
            ? fwResults.reduce((s, r) => s + r.normalizedScore, 0) / fwResults.length
            : 0;
          return {
            frameworkId: fw,
            averageScore: Number(avgScore.toFixed(3)),
            caseCount: new Set(fwResults.map((r) => r.caseId)).size,
            passRate: Number(((fwResults.filter((r) => r.passed).length / Math.max(fwResults.length, 1)) * 100).toFixed(1)),
          };
        }).sort((a, b) => b.averageScore - a.averageScore),
      };
      break;
    }
    case "badcase_analysis": {
      const badcases = results.filter((r) => !r.passed);
      report = {
        title: "Badcase 分析报告",
        totalBadcases: badcases.length,
        byCapability: Object.fromEntries(
          [...new Set(badcases.map((r) => r.capability))].map((cap) => [
            cap,
            badcases.filter((r) => r.capability === cap).length,
          ]),
        ),
        topIssues: [...new Set(badcases.map((r) => r.reason))].slice(0, 5),
      };
      break;
    }
    default:
      report = { title: "详细报告", results };
  }

  return {
    tool_call_id: "",
    name: "generate_report",
    status: "success",
    result: {
      reportType,
      format,
      includeCharts,
      generatedAt: new Date().toISOString(),
      report,
    },
  };
};

const searchCasesHandler: AgentToolHandler = async (args, ctx) => {
  const capability = args.capability ? String(args.capability) : undefined;
  const minScore = args.minScore !== undefined ? Number(args.minScore) : undefined;
  const maxScore = args.maxScore !== undefined ? Number(args.maxScore) : undefined;
  const tags = Array.isArray(args.tags) ? args.tags.map(String) : [];
  const frameworkId = args.frameworkId ? String(args.frameworkId) : undefined;
  const limit = Number(args.limit ?? 20);

  let filtered = ctx.metricResults;

  if (capability) {
    filtered = filtered.filter((r) => r.capability === capability);
  }
  if (minScore !== undefined) {
    filtered = filtered.filter((r) => r.normalizedScore >= minScore);
  }
  if (maxScore !== undefined) {
    filtered = filtered.filter((r) => r.normalizedScore <= maxScore);
  }
  if (frameworkId) {
    filtered = filtered.filter((r) => r.agentFramework === frameworkId);
  }
  if (tags.length > 0) {
    filtered = filtered.filter((r) => tags.some((t) => r.failureTags.includes(t)));
  }

  filtered = filtered.slice(0, limit);

  return {
    tool_call_id: "",
    name: "search_cases",
    status: "success",
    result: {
      totalMatches: filtered.length,
      filters: { capability, minScore, maxScore, tags, frameworkId },
      cases: filtered.map((r) => ({
        caseId: r.caseId,
        frameworkId: r.agentFramework,
        model: r.model,
        metricKey: r.metricKey,
        score: r.normalizedScore,
        passed: r.passed,
        reason: r.reason,
      })),
    },
  };
};

const summarizeCapabilityHandler: AgentToolHandler = async (args, ctx) => {
  const capability = args.capability ? String(args.capability) : undefined;
  const groupBy = String(args.groupBy ?? "framework") as "framework" | "model" | "case";

  let results = ctx.metricResults;

  if (capability) {
    results = results.filter((r) => r.capability === capability);
  }

  const groupKey = (r: BenchmarkMetricEvaluationResult) => {
    switch (groupBy) {
      case "model":
        return r.model;
      case "case":
        return r.caseId;
      default:
        return r.agentFramework;
    }
  };

  const groups = new Map<string, BenchmarkMetricEvaluationResult[]>();
  for (const r of results) {
    const key = groupKey(r);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const summary = Array.from(groups.entries()).map(([key, items]) => {
    const avgScore = items.reduce((s, r) => s + r.normalizedScore, 0) / items.length;
    const passCount = items.filter((r) => r.passed).length;
    return {
      group: key,
      groupBy,
      metricCount: items.length,
      averageScore: Number(avgScore.toFixed(3)),
      passRate: Number(((passCount / items.length) * 100).toFixed(1)),
      capabilities: [...new Set(items.map((r) => r.capability))],
    };
  }).sort((a, b) => b.averageScore - a.averageScore);

  return {
    tool_call_id: "",
    name: "summarize_capability",
    status: "success",
    result: {
      capabilityFilter: capability ?? "all",
      groupBy,
      summary,
      overallAverage: Number((summary.reduce((s, r) => s + r.averageScore, 0) / Math.max(summary.length, 1)).toFixed(3)),
    },
  };
};

// ───────────────────────────────────────────────
// 工具注册表构建
// ───────────────────────────────────────────────

export function createEvalToolRegistry(): AgentToolRegistry {
  const registry = new Map();

  registry.set("evaluate_metric", { schema: evaluateMetricSchema, handler: evaluateMetricHandler });
  registry.set("compare_submissions", { schema: compareSubmissionsSchema, handler: compareSubmissionsHandler });
  registry.set("analyze_rubric", { schema: analyzeRubricSchema, handler: analyzeRubricHandler });
  registry.set("mine_badcases", { schema: mineBadcasesSchema, handler: mineBadcasesHandler });
  registry.set("generate_report", { schema: generateReportSchema, handler: generateReportHandler });
  registry.set("search_cases", { schema: searchCasesSchema, handler: searchCasesHandler });
  registry.set("summarize_capability", { schema: summarizeCapabilitySchema, handler: summarizeCapabilityHandler });

  return registry;
}

/**
 * 创建完整的工具注册表（评测 + 文件 + 网络 + GitHub）
 */
export function createFullToolRegistry(): AgentToolRegistry {
  const registry = createEvalToolRegistry();

  // 合并文件系统工具
  const { createFileToolRegistry } = require("./file-tools");
  const fileRegistry = createFileToolRegistry();
  for (const [name, entry] of fileRegistry) {
    registry.set(name, entry);
  }

  // 合并网络工具
  const { createNetworkToolRegistry } = require("./network-tools");
  const networkRegistry = createNetworkToolRegistry();
  for (const [name, entry] of networkRegistry) {
    registry.set(name, entry);
  }

  // 合并 GitHub MCP 工具
  const { createGitHubToolRegistry } = require("./github-tools");
  const githubRegistry = createGitHubToolRegistry();
  for (const [name, entry] of githubRegistry) {
    registry.set(name, entry);
  }

  return registry;
}

/**
 * 获取所有工具的 Schema 列表（用于 LLM 系统提示）
 */
export function getToolSchemas(registry: AgentToolRegistry): AgentToolSchema[] {
  return Array.from(registry.values()).map((entry) => entry.schema);
}

/**
 * 执行单个工具调用
 */
export async function executeToolCall(
  call: AgentToolCall,
  registry: AgentToolRegistry,
  context: AgentExecutionContext,
): Promise<AgentToolResult> {
  const entry = registry.get(call.name);
  if (!entry) {
    return {
      tool_call_id: call.id,
      name: call.name,
      status: "error",
      result: null,
      error: `未知工具: ${call.name}。可用工具: ${Array.from(registry.keys()).join(", ")}`,
    };
  }

  try {
    const result = await entry.handler(call.arguments, context);
    return { ...result, tool_call_id: call.id, name: call.name };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      tool_call_id: call.id,
      name: call.name,
      status: "error",
      result: null,
      error: message,
    };
  }
}
