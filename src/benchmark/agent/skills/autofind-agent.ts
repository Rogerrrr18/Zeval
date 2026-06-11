/**
 * @fileoverview AutoFind Agent — 用 LLM 编排检索词、候选数据集选择与 20 条 session 整理。
 *
 * 降级：任一 LLM 阶段失败时回退到规则模板 / 排序 / 关键词筛选，并写入 warnings。
 */

import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import type { AutoFindRubricContext } from "./autofind-types";
import {
  buildDiscoveryQueries,
  buildSessionPrefix,
  createDefaultAutoFindDiscoveryDeps,
  describeToolingSources,
  discoverDatasetCandidates,
  downloadDatasetPayloads,
  prioritizeCandidates,
  rankDatasetCandidates,
  type AutoFindDiscoveryDeps,
  type AutoFindDiscoveryInput,
  type AutoFindDiscoveryResult,
} from "./autofind-discovery";
import {
  buildCsvFromCuratedSessions,
  extractDialogueSessionPool,
  fallbackCurateSessions,
  type CuratedDialogueSessions,
  type DialogueSessionPoolItem,
} from "./autofind-normalizers";
import type { AutoFindDatasetProfile } from "./autofind-types";
import type { DatasetCandidate } from "./autofind-types";
import { filterValidCandidates, validateCandidate, validateDownloadedPayload, validateNormalizedCsv } from "./autofind-validation";

export type AutoFindAgentInput = AutoFindDiscoveryInput & {
  rubricContext?: AutoFindRubricContext;
};

export type AutoFindAgentResult = AutoFindDiscoveryResult & {
  agentTrace: string[];
  llmAssisted: boolean;
};

export type AutoFindAgentLlmDeps = {
  complete: (messages: Array<{ role: "system" | "user"; content: string }>, stage: string) => Promise<string>;
};

type QueryPlanPayload = {
  queries?: string[];
  reasoning?: string;
};

type CandidateSelectPayload = {
  candidateId?: string;
  reasoning?: string;
};

type SessionCuratePayload = {
  positivePoolIds?: string[];
  negativePoolIds?: string[];
  reasoning?: string;
};

/**
 * 执行 AutoFind Agent：LLM 生成检索词 → 工具发现 → LLM 选集 → LLM 整理 10 正 + 10 负。
 *
 * @param input 任务需求、数据集 profile 与 rubric 上下文。
 * @param deps 可注入的发现/下载依赖（测试用）。
 * @param llmDeps 可注入的 LLM 依赖（测试用）。
 * @returns Zeval CSV、来源与 agent 决策轨迹。
 */
export async function runAutoFindAgent(
  input: AutoFindAgentInput,
  deps: AutoFindDiscoveryDeps = createDefaultAutoFindDiscoveryDeps(),
  llmDeps: AutoFindAgentLlmDeps = createDefaultAutoFindAgentLlmDeps(),
): Promise<AutoFindAgentResult> {
  const warnings: string[] = [];
  const agentTrace: string[] = [];
  let llmAssisted = false;

  const sessionPrefix = input.sessionPrefix ?? buildSessionPrefix(input.datasetProfile);
  const searchProfile = input.searchProfile;
  const discoveryInput: AutoFindDiscoveryInput = { ...input, sessionPrefix };

  let queries: string[];
  if (input.queries?.length) {
    queries = input.queries;
    agentTrace.push(`检索词（指定）：${queries.join(" | ")}`);
  } else {
    try {
      const planned = await planAutoFindQueries(
        {
          searchProfile,
          datasetProfile: input.datasetProfile,
          rubricContext: input.rubricContext,
        },
        llmDeps,
      );
      queries = planned.queries;
      llmAssisted = true;
      agentTrace.push(`检索词（模型）：${queries.join(" | ")}`);
      if (planned.reasoning) agentTrace.push(`检索理由：${planned.reasoning}`);
    } catch (error) {
      queries = buildDiscoveryQueries(searchProfile, input.datasetProfile);
      warnings.push(`检索词模型不可用，回退规则模板：${formatError(error)}`);
      agentTrace.push(`检索词（规则）：${queries.join(" | ")}`);
    }
  }

  const discovered = await discoverDatasetCandidates(queries, discoveryInput, deps);
  const ranked = rankDatasetCandidates(discovered, searchProfile);
  const candidates = prioritizeCandidates(filterValidCandidates(ranked));

  if (candidates.length === 0) {
    const rejected = ranked.length - candidates.length;
    throw new Error(
      rejected > 0
        ? `发现 ${ranked.length} 个候选，但 ${rejected} 个因虚构/不可信 URL 被过滤，无可用数据集。`
        : "未发现可用的公开数据集候选。",
    );
  }

  let preferredCandidate: DatasetCandidate;
  try {
    preferredCandidate = await selectAutoFindCandidate(
      {
        searchProfile,
        datasetProfile: input.datasetProfile,
        rubricContext: input.rubricContext,
        candidates: candidates.slice(0, 12),
      },
      llmDeps,
    );
    llmAssisted = true;
    agentTrace.push(`选中数据集（模型）：${preferredCandidate.title}`);
  } catch (error) {
    preferredCandidate = candidates[0]!;
    warnings.push(`候选选择模型不可用，回退排序第一：${formatError(error)}`);
    agentTrace.push(`选中数据集（规则）：${preferredCandidate.title}`);
  }

  const tryCandidates = [
    preferredCandidate,
    ...candidates.filter((candidate) => candidate.id !== preferredCandidate.id).slice(0, 7),
  ];

  for (const candidate of tryCandidates) {
    const candidateCheck = validateCandidate(candidate);
    if (!candidateCheck.ok) {
      warnings.push(`${candidate.title}: ${candidateCheck.reason}`);
      continue;
    }

    try {
      const payloads = await downloadDatasetPayloads(candidate, deps);
      for (const payload of payloads) {
        const payloadCheck = validateDownloadedPayload(payload.text, payload.contentType);
        if (!payloadCheck.ok) {
          warnings.push(`${candidate.title} (${payload.verifiedDownloadUrl}): ${payloadCheck.reason}`);
          continue;
        }

        const pool = extractDialogueSessionPool({
          rawText: payload.text,
          contentType: payload.contentType,
          searchProfile,
          maxSessions: 60,
        });
        const requiredSessions = input.positiveCount + input.negativeCount;
        if (pool.length < requiredSessions) {
          warnings.push(
            `${candidate.title} (${payload.verifiedDownloadUrl}): 会话池仅 ${pool.length} 条，不足 ${requiredSessions} 条`,
          );
          continue;
        }

        let curated: CuratedDialogueSessions;
        try {
          curated = await curateAutoFindSessions(
            {
              searchProfile,
              rubricContext: input.rubricContext,
              pool,
              positiveCount: input.positiveCount,
              negativeCount: input.negativeCount,
            },
            llmDeps,
          );
          llmAssisted = true;
          agentTrace.push(`会话整理（模型）：${curated.positive.length} 正 + ${curated.negative.length} 负`);
        } catch (error) {
          curated = fallbackCurateSessions(pool, input.positiveCount, input.negativeCount);
          warnings.push(`会话整理模型不可用，回退关键词排序：${formatError(error)}`);
          agentTrace.push(`会话整理（规则）：${curated.positive.length} 正 + ${curated.negative.length} 负`);
        }

        const csvText = buildCsvFromCuratedSessions(curated, sessionPrefix);
        const csvCheck = validateNormalizedCsv(csvText, {
          positiveCount: input.positiveCount,
          negativeCount: input.negativeCount,
        });
        if (!csvCheck.ok) {
          warnings.push(`${candidate.title} (${payload.verifiedDownloadUrl}): ${csvCheck.reason}`);
          continue;
        }

        return {
          csvText,
          sources: [
            `${candidate.title} (${candidate.source})`,
            `数据文件：${payload.verifiedDownloadUrl}`,
            `数据集页面：${candidate.url}`,
            llmAssisted ? "编排：AutoFind Agent（LLM + 工具）" : "编排：AutoFind Agent（规则降级）",
            ...describeToolingSources(),
          ],
          warnings,
          candidates,
          selectedCandidate: candidate,
          verifiedDownloadUrl: payload.verifiedDownloadUrl,
          agentTrace,
          llmAssisted,
        };
      }
    } catch (error) {
      warnings.push(`${candidate.title}: ${formatError(error)}`);
    }
  }

  throw new Error(
    warnings.length > 0
      ? `已发现 ${candidates.length} 个候选数据集，但均未能归一化为评测 CSV：${warnings.join("；")}`
      : "未能从候选数据集中提取可用对话样本。",
  );
}

/**
 * 用 LLM 根据任务上下文生成公开数据集检索词。
 *
 * @param input 任务 profile 与 rubric 摘要。
 * @param llmDeps LLM 依赖。
 * @returns 3-8 条英文/中文检索词。
 */
export async function planAutoFindQueries(
  input: {
    searchProfile: string;
    datasetProfile: AutoFindDatasetProfile;
    rubricContext?: AutoFindRubricContext;
  },
  llmDeps: AutoFindAgentLlmDeps,
): Promise<{ queries: string[]; reasoning?: string }> {
  const raw = await llmDeps.complete(
    [
      {
        role: "system",
        content: [
          "你是 Zeval AutoFind Agent，负责为对话评测任务生成公开数据集检索词。",
          "只输出 JSON 对象，格式：",
          '{"queries":["检索词1","检索词2"],"reasoning":"简短中文理由"}',
          "要求：",
          "- queries 3-8 条，优先 HuggingFace / GitHub 可搜到的英文数据集名 + 任务关键词",
          "- 结合用户需求与 rubric 指标，覆盖正/负样本可能来源",
          "- 不要输出虚构数据集名或占位 URL",
        ].join("\n"),
      },
      {
        role: "user",
        content: buildAgentContextPrompt(input.searchProfile, input.datasetProfile, input.rubricContext),
      },
    ],
    "autofind_query_plan",
  );

  const payload = parseJsonObjectFromLlmOutput(raw) as QueryPlanPayload;
  const queries = (payload.queries ?? [])
    .map((query) => String(query).trim())
    .filter((query) => query.length >= 2)
    .slice(0, 8);
  if (queries.length === 0) {
    throw new Error("模型未返回有效检索词。");
  }
  return { queries, reasoning: payload.reasoning?.trim() };
}

/**
 * 用 LLM 从候选列表中选择最匹配评测任务的数据集。
 *
 * @param input 候选列表与任务上下文。
 * @param llmDeps LLM 依赖。
 * @returns 选中的候选数据集。
 */
export async function selectAutoFindCandidate(
  input: {
    searchProfile: string;
    datasetProfile: AutoFindDatasetProfile;
    rubricContext?: AutoFindRubricContext;
    candidates: DatasetCandidate[];
  },
  llmDeps: AutoFindAgentLlmDeps,
): Promise<DatasetCandidate> {
  if (input.candidates.length === 0) {
    throw new Error("无候选数据集可选。");
  }

  const candidateLines = input.candidates
    .map(
      (candidate) =>
        `- id=${candidate.id}; source=${candidate.source}; title=${candidate.title}; score=${candidate.score}; url=${candidate.url}; desc=${candidate.description}`,
    )
    .join("\n");

  const raw = await llmDeps.complete(
    [
      {
        role: "system",
        content: [
          "你是 Zeval AutoFind Agent，负责从候选公开数据集中选择最适合当前评测任务的一个。",
          "只输出 JSON：{\"candidateId\":\"...\",\"reasoning\":\"...\"}",
          "必须选择列表中已有的 candidateId，优先多轮对话、与任务领域一致、HuggingFace 可信数据集。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          buildAgentContextPrompt(input.searchProfile, input.datasetProfile, input.rubricContext),
          "",
          "候选数据集：",
          candidateLines,
        ].join("\n"),
      },
    ],
    "autofind_candidate_select",
  );

  const payload = parseJsonObjectFromLlmOutput(raw) as CandidateSelectPayload;
  const candidateId = String(payload.candidateId ?? "").trim();
  const selected =
    input.candidates.find((candidate) => candidate.id === candidateId) ??
    input.candidates.find((candidate) => candidate.title === candidateId);
  if (!selected) {
    throw new Error(`模型返回未知 candidateId: ${candidateId || "(空)"}`);
  }
  return selected;
}

/**
 * 用 LLM 从会话池挑选正/负样本各 N 条。
 *
 * @param input 会话池与采样数量。
 * @param llmDeps LLM 依赖。
 * @returns 整理后的正/负 session 列表。
 */
export async function curateAutoFindSessions(
  input: {
    searchProfile: string;
    rubricContext?: AutoFindRubricContext;
    pool: DialogueSessionPoolItem[];
    positiveCount: number;
    negativeCount: number;
  },
  llmDeps: AutoFindAgentLlmDeps,
): Promise<CuratedDialogueSessions> {
  const poolLines = input.pool
    .slice(0, 40)
    .map(
      (item) =>
        `- ${item.poolId}: relevance=${item.relevanceScore}; turns=${item.messages.length}; preview=${item.preview}`,
    )
    .join("\n");

  const raw = await llmDeps.complete(
    [
      {
        role: "system",
        content: [
          "你是 Zeval AutoFind Agent，负责为对话评测挑选正样本与负样本 session。",
          "只输出 JSON：",
          '{"positivePoolIds":["pool_001"],"negativePoolIds":["pool_002"],"reasoning":"..."}',
          `正样本 ${input.positiveCount} 条：符合 rubric、回复质量高、与任务高度相关。`,
          `负样本 ${input.negativeCount} 条：明显不达标、答非所问、缺乏共情/事实错误或应转人工却硬答等。`,
          "poolId 必须来自给定列表，且正负不可重复。",
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          buildAgentContextPrompt(input.searchProfile, "general", input.rubricContext),
          "",
          `需要：${input.positiveCount} 正 + ${input.negativeCount} 负`,
          "",
          "会话池：",
          poolLines,
        ].join("\n"),
      },
    ],
    "autofind_session_curate",
  );

  const payload = parseJsonObjectFromLlmOutput(raw) as SessionCuratePayload;
  const positiveIds = (payload.positivePoolIds ?? []).map((id) => String(id).trim()).filter(Boolean);
  const negativeIds = (payload.negativePoolIds ?? []).map((id) => String(id).trim()).filter(Boolean);

  const positive = mapPoolIdsToSessions(input.pool, positiveIds, input.positiveCount);
  const negative = mapPoolIdsToSessions(
    input.pool.filter((item) => !positiveIds.includes(item.poolId)),
    negativeIds,
    input.negativeCount,
  );

  if (positive.length < input.positiveCount || negative.length < input.negativeCount) {
    throw new Error(
      `模型返回 session 数量不足：正 ${positive.length}/${input.positiveCount}，负 ${negative.length}/${input.negativeCount}`,
    );
  }

  return { positive, negative };
}

/**
 * 创建默认 LLM 依赖（SiliconFlow）。
 *
 * @returns 生产环境 LLM 调用封装。
 */
export function createDefaultAutoFindAgentLlmDeps(): AutoFindAgentLlmDeps {
  return {
    complete: async (messages, stage) =>
      requestSiliconFlowChatCompletion(messages, {
        stage: `autofind_agent_${stage}`,
      }),
  };
}

function mapPoolIdsToSessions(
  pool: DialogueSessionPoolItem[],
  poolIds: string[],
  requiredCount: number,
): Array<{ messages: Array<{ role: "user" | "assistant"; content: string }> }> {
  const byId = new Map(pool.map((item) => [item.poolId, item]));
  const picked: Array<{ messages: Array<{ role: "user" | "assistant"; content: string }> }> = [];

  for (const poolId of poolIds) {
    const item = byId.get(poolId);
    if (item && item.messages.length >= 4) {
      picked.push({ messages: item.messages });
    }
    if (picked.length >= requiredCount) break;
  }

  if (picked.length < requiredCount) {
    for (const item of pool) {
      if (picked.some((entry) => entry.messages === item.messages)) continue;
      picked.push({ messages: item.messages });
      if (picked.length >= requiredCount) break;
    }
  }

  return picked.slice(0, requiredCount);
}

function buildAgentContextPrompt(
  searchProfile: string,
  datasetProfile: AutoFindDatasetProfile,
  rubricContext?: AutoFindRubricContext,
): string {
  const lines = [
    `任务需求：${searchProfile}`,
    `数据集类型：${datasetProfile}`,
  ];
  if (rubricContext?.rubricTitle) lines.push(`评分标准：${rubricContext.rubricTitle}`);
  if (rubricContext?.rubricDescription) lines.push(`标准说明：${rubricContext.rubricDescription}`);
  if (rubricContext?.rubricMetrics?.length) {
    lines.push(`指标：${rubricContext.rubricMetrics.join("、")}`);
  }
  if (rubricContext?.rubricDialogue?.length) {
    const snippet = rubricContext.rubricDialogue
      .slice(0, 4)
      .map((turn) => `${turn.role}: ${turn.text}`)
      .join(" | ");
    lines.push(`参考对话：${snippet}`);
  }
  return lines.join("\n");
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
