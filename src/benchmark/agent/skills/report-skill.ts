/**
 * @fileoverview 报告技能 — 生成评测报告
 *
 * 垂直能力：
 * - 汇总报告：整体评测概览
 * - 排行榜：Agent 框架排名
 * - Badcase 分析报告：问题根因分析
 * - 能力维度报告：各能力维度表现
 * - HTML/Markdown/JSON 多格式输出
 */

import type {
  BenchmarkMetricEvaluationResult,
  BenchmarkRunResult,
} from "@/benchmark/types";
import type { AgentSkillResult } from "../types";

export type ReportSkillInput = {
  result: BenchmarkRunResult;
  reportType: "summary" | "leaderboard" | "badcase_analysis" | "capability_report" | "full";
  format: "markdown" | "json" | "html";
};

/**
 * 生成评测报告
 */
export function generateReport(input: ReportSkillInput): AgentSkillResult {
  const started = Date.now();

  switch (input.reportType) {
    case "summary":
      return {
        skillType: "report_generation",
        success: true,
        output: { report: generateSummaryReport(input.result, input.format) },
        reasoning: "生成汇总报告",
        durationMs: Date.now() - started,
      };
    case "leaderboard":
      return {
        skillType: "report_generation",
        success: true,
        output: { report: generateLeaderboardReport(input.result, input.format) },
        reasoning: "生成排行榜报告",
        durationMs: Date.now() - started,
      };
    case "badcase_analysis":
      return {
        skillType: "report_generation",
        success: true,
        output: { report: generateBadcaseReport(input.result, input.format) },
        reasoning: "生成 Badcase 分析报告",
        durationMs: Date.now() - started,
      };
    case "capability_report":
      return {
        skillType: "report_generation",
        success: true,
        output: { report: generateCapabilityReport(input.result, input.format) },
        reasoning: "生成能力维度报告",
        durationMs: Date.now() - started,
      };
    case "full":
      return {
        skillType: "report_generation",
        success: true,
        output: {
          report: {
            summary: generateSummaryReport(input.result, input.format),
            leaderboard: generateLeaderboardReport(input.result, input.format),
            badcase: generateBadcaseReport(input.result, input.format),
            capability: generateCapabilityReport(input.result, input.format),
          },
        },
        reasoning: "生成完整评测报告",
        durationMs: Date.now() - started,
      };
  }
}

// ───────────────────────────────────────────────
// 汇总报告
// ───────────────────────────────────────────────

function generateSummaryReport(result: BenchmarkRunResult, format: string): unknown {
  const summary = result.summary;

  if (format === "json") {
    return summary;
  }

  const lines = [
    "# Zeval 评测汇总报告",
    ``,
    `| 指标 | 数值 |`,
    `|------|------|`,
    `| 评测案例数 | ${summary.caseCount} |`,
    `| 提交总数 | ${summary.submissionCount} |`,
    `| 指标评估数 | ${summary.metricResultCount} |`,
    `| 平均分数 | ${(summary.averageScore * 100).toFixed(1)}% |`,
    `| Badcase 候选数 | ${summary.badcaseCandidateCount} |`,
    `| Golden Case 候选数 | ${summary.goldencaseCandidateCount} |`,
    `| 需人工复核数 | ${summary.needsHumanReviewCount} |`,
    ``,
    `## 评测矩阵`,
    result.matrix.map((m) => `- ${m.agentFramework} + ${m.model}`).join("\n"),
  ];

  return lines.join("\n");
}

// ───────────────────────────────────────────────
// 排行榜报告
// ───────────────────────────────────────────────

function generateLeaderboardReport(result: BenchmarkRunResult, format: string): unknown {
  const board = result.leaderboard;

  if (format === "json") {
    return board;
  }

  const lines = [
    "# 评测排行榜",
    ``,
    `| 排名 | Agent 框架 | 模型 | 平均分数 | 通过率 | 案例数 |`,
    `|------|-----------|------|---------|--------|--------|`,
    ...board.map((row, i) => `| ${i + 1} | ${row.agentFramework} | ${row.model} | ${(row.averageScore * 100).toFixed(1)}% | ${(row.passRate * 100).toFixed(1)}% | ${row.caseCount} |`),
    ``,
    "## 能力维度明细",
    ...board.flatMap((row) => [
      `### ${row.agentFramework} + ${row.model}`,
      ...row.capabilityScores.map(
        (c) => `- ${c.capability}: ${(c.score * 100).toFixed(1)}% (${c.passedMetricCount}/${c.metricCount})`,
      ),
      "",
    ]),
  ];

  return lines.join("\n");
}

// ───────────────────────────────────────────────
// Badcase 分析报告
// ───────────────────────────────────────────────

function generateBadcaseReport(result: BenchmarkRunResult, format: string): unknown {
  const badcases = result.metricResults.filter((r) => !r.passed);
  const groupedByCase = groupBy(badcases, (r) => r.caseId);

  if (format === "json") {
    return {
      totalBadcases: badcases.length,
      byCase: Object.fromEntries(
        Object.entries(groupedByCase).map(([caseId, items]) => [
          caseId,
          {
            failedMetrics: items.length,
            frameworks: [...new Set(items.map((i) => i.agentFramework))],
            topIssues: [...new Set(items.map((i) => i.reason))].slice(0, 3),
          },
        ]),
      ),
    };
  }

  const lines = [
    "# Badcase 分析报告",
    ``,
    `共发现 ${badcases.length} 个失败的指标评估。`,
    ``,
    "## 按案例分组",
    ...Object.entries(groupedByCase).flatMap(([caseId, items]) => [
      `### ${caseId}`,
      `- 失败指标数: ${items.length}`,
      `- 涉及框架: ${[...new Set(items.map((i) => i.agentFramework))].join(", ")}`,
      `- 主要问题:`,
      ...[...new Set(items.map((i) => i.reason))].slice(0, 3).map((r) => `  - ${r}`),
      "",
    ]),
    "## 按能力维度统计",
    ...Object.entries(groupBy(badcases, (r: BenchmarkMetricEvaluationResult) => r.capability)).map(([cap, items]) => {
      const typedItems = items as BenchmarkMetricEvaluationResult[];
      const frameworks = [...new Set(typedItems.map((i) => i.agentFramework))];
      return `- ${cap}: ${typedItems.length} 次失败 (${frameworks.join(", ")})`;
    }),
  ];

  return lines.join("\n");
}

// ───────────────────────────────────────────────
// 能力维度报告
// ───────────────────────────────────────────────

function generateCapabilityReport(result: BenchmarkRunResult, format: string): unknown {
  const allCaps = extractAllCapabilities(result);

  if (format === "json") {
    return {
      capabilities: allCaps.map((cap) => ({
        capability: cap,
        frameworks: result.leaderboard.map((row) => {
          const capScore = row.capabilityScores.find((c) => c.capability === cap);
          return {
            framework: row.agentFramework,
            model: row.model,
            score: capScore?.score ?? 0,
            passed: capScore?.passedMetricCount ?? 0,
            total: capScore?.metricCount ?? 0,
          };
        }),
      })),
    };
  }

  const lines = [
    "# 能力维度评测报告",
    ``,
    ...allCaps.flatMap((cap) => {
      const rows = result.leaderboard.map((row) => {
        const cs = row.capabilityScores.find((c) => c.capability === cap);
        return `| ${row.agentFramework} | ${row.model} | ${((cs?.score ?? 0) * 100).toFixed(1)}% | ${cs?.passedMetricCount ?? 0}/${cs?.metricCount ?? 0} |`;
      });

      return [
        `## ${cap}`,
        ``,
        `| Agent 框架 | 模型 | 分数 | 通过/总数 |`,
        `|-----------|------|------|----------|`,
        ...rows,
        ``,
      ];
    }),
  ];

  return lines.join("\n");
}

// ───────────────────────────────────────────────
// 辅助函数
// ───────────────────────────────────────────────

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

function extractAllCapabilities(result: BenchmarkRunResult): string[] {
  const caps = new Set<string>();
  for (const row of result.leaderboard) {
    for (const cs of row.capabilityScores) {
      caps.add(cs.capability);
    }
  }
  return [...caps];
}
