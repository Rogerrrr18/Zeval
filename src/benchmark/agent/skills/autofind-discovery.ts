/**
 * @fileoverview AutoFind dataset discovery via HuggingFace / GitHub / web_search tools.
 */

import { createGitHubToolRegistry } from "@/benchmark/agent/github-tools";
import { createNetworkToolRegistry } from "@/benchmark/agent/network-tools";
import type { AgentExecutionContext, AgentToolResult } from "@/benchmark/agent/types";
import {
  extractHuggingFaceDatasetId,
  isFetchableUrl,
  unwrapRedirectUrl,
} from "@/benchmark/agent/url-utils";
import type { AutoFindDatasetProfile } from "./autofind-types";
import { extractSearchKeywords, normalizeDatasetToCsv } from "./autofind-normalizers";
import {
  downloadResolvedUrl,
  resolveCandidateDownloadUrls,
} from "./autofind-source-resolver";
import {
  filterValidCandidates,
  validateCandidate,
  validateDownloadedPayload,
  validateNormalizedCsv,
} from "./autofind-validation";

export type { DatasetCandidate, DatasetCandidateSource } from "./autofind-types";
import type { DatasetCandidate } from "./autofind-types";

export type AutoFindDiscoveryInput = {
  searchProfile: string;
  datasetProfile: AutoFindDatasetProfile;
  positiveCount: number;
  negativeCount: number;
  sessionPrefix?: string;
  /** 可选：由 AutoFind Agent 生成的检索词，覆盖规则模板。 */
  queries?: string[];
};

export type AutoFindDiscoveryDeps = {
  searchHuggingFace: (query: string) => Promise<DatasetCandidate[]>;
  searchGitHub: (query: string) => Promise<DatasetCandidate[]>;
  webSearch: (query: string) => Promise<DatasetCandidate[]>;
  downloadText: (url: string) => Promise<{ text: string; contentType?: string }>;
};

export type AutoFindDiscoveryResult = {
  csvText: string;
  sources: string[];
  warnings: string[];
  candidates: DatasetCandidate[];
  selectedCandidate: DatasetCandidate;
  verifiedDownloadUrl: string;
};

const EMPTY_AGENT_CONTEXT = {
  runId: "autofind-discovery",
  metricResults: [],
  metadata: {},
  state: {
    runId: "autofind-discovery",
    status: "acting",
    currentPhase: "acting",
    turns: [],
    messages: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
} as AgentExecutionContext;

/**
 * Build search queries for dataset discovery.
 *
 * @param searchProfile Combined task requirement and rubric text.
 * @param datasetProfile Scenario profile used to bias discovery.
 * @returns Unique discovery queries.
 */
export function buildDiscoveryQueries(
  searchProfile: string,
  datasetProfile: AutoFindDatasetProfile,
): string[] {
  const keywords = extractSearchKeywords(searchProfile).slice(0, 6);
  const keywordPhrase = keywords.slice(0, 4).join(" ").trim();
  const profileQueries: string[] = [];
  const genericQueries = [
    `${keywordPhrase} conversation dataset`,
    `${keywordPhrase} dialogue dataset huggingface`,
    `${keywordPhrase} chat dataset github`,
    `site:huggingface.co datasets ${keywordPhrase}`,
  ];

  if (datasetProfile === "companion") {
    profileQueries.push("CPsyCoun", "ESConv emotional support", "counseling dialogue dataset");
  }
  if (datasetProfile === "customer_service") {
    profileQueries.push("bitext customer support", "customer service chatbot", "ecommerce support dialogue");
  }

  return [...new Set([...profileQueries, ...genericQueries].map((query) => query.trim()).filter(Boolean))];
}

/**
 * Rank dataset candidates by relevance to the current task.
 *
 * @param candidates Candidate datasets.
 * @param searchProfile Combined task text.
 * @returns Sorted candidates (highest score first).
 */
export function rankDatasetCandidates(
  candidates: DatasetCandidate[],
  searchProfile: string,
): DatasetCandidate[] {
  const keywords = extractSearchKeywords(searchProfile);
  const deduped = new Map<string, DatasetCandidate>();

  for (const candidate of candidates) {
    const dedupeKey = buildCandidateDedupeKey(candidate);
    const existing = deduped.get(dedupeKey);
    const overlap = scoreCandidateText(
      `${candidate.title} ${candidate.description} ${candidate.url}`,
      keywords,
    );
    const merged: DatasetCandidate = {
      ...candidate,
      score: candidate.score + overlap + sourcePriorityBonus(candidate),
    };
    if (!existing || merged.score > existing.score) {
      deduped.set(dedupeKey, merged);
    }
  }

  return [...deduped.values()].sort((left, right) => right.score - left.score);
}

/**
 * Discover, download and normalize datasets for the current benchmark task.
 *
 * @param input Discovery options.
 * @param deps Injectable network/tool dependencies (for tests).
 * @returns Zeval CSV and provenance metadata.
 */
export async function runAutoFindDiscovery(
  input: AutoFindDiscoveryInput,
  deps: AutoFindDiscoveryDeps = createDefaultAutoFindDiscoveryDeps(),
): Promise<AutoFindDiscoveryResult> {
  const warnings: string[] = [];
  const queries =
    input.queries?.length
      ? input.queries
      : buildDiscoveryQueries(input.searchProfile, input.datasetProfile);
  const sessionPrefix = input.sessionPrefix ?? buildSessionPrefix(input.datasetProfile);

  const discovered = await discoverDatasetCandidates(queries, input, deps);
  const ranked = rankDatasetCandidates(discovered, input.searchProfile);
  const candidates = prioritizeCandidates(filterValidCandidates(ranked));

  if (candidates.length === 0) {
    const rejected = ranked.length - candidates.length;
    throw new Error(
      rejected > 0
        ? `发现 ${ranked.length} 个候选，但 ${rejected} 个因虚构/不可信 URL 被过滤，无可用数据集。`
        : "未发现可用的公开数据集候选。",
    );
  }

  for (const candidate of candidates.slice(0, 8)) {
    const candidateCheck = validateCandidate(candidate);
    if (!candidateCheck.ok) {
      warnings.push(`${candidate.title}: ${candidateCheck.reason}`);
      continue;
    }

    try {
      const resolved = await downloadAndNormalizeCandidate(candidate, input, deps, sessionPrefix);
      if (!resolved) {
        warnings.push(`${candidate.title}: 归一化失败（格式不支持或样本不足）`);
        continue;
      }

      const csvCheck = validateNormalizedCsv(resolved.csvText, {
        positiveCount: input.positiveCount,
        negativeCount: input.negativeCount,
      });
      if (!csvCheck.ok) {
        warnings.push(`${candidate.title}: ${csvCheck.reason}`);
        continue;
      }

      return {
        csvText: resolved.csvText,
        sources: [
          `${candidate.title} (${candidate.source})`,
          `数据文件：${resolved.verifiedDownloadUrl}`,
          `数据集页面：${candidate.url}`,
          ...describeToolingSources(),
        ],
        warnings,
        candidates,
        selectedCandidate: candidate,
        verifiedDownloadUrl: resolved.verifiedDownloadUrl,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`${candidate.title}: ${message}`);
    }
  }

  throw new Error(
    warnings.length > 0
      ? `已发现 ${candidates.length} 个候选数据集，但均未能归一化为评测 CSV：${warnings.join("；")}`
      : "未能从候选数据集中提取可用对话样本。",
  );
}

/**
 * Discover dataset candidates across HuggingFace, GitHub and web search.
 *
 * @param queries Search queries.
 * @param input Discovery options.
 * @param deps Injectable dependencies.
 * @returns Raw candidate list before ranking.
 */
export async function discoverDatasetCandidates(
  queries: string[],
  input: AutoFindDiscoveryInput,
  deps: AutoFindDiscoveryDeps,
): Promise<DatasetCandidate[]> {
  const results: DatasetCandidate[] = [];
  for (const query of queries.slice(0, 8)) {
    const [hf, gh, web] = await Promise.all([
      deps.searchHuggingFace(query).catch(() => []),
      deps.searchGitHub(query).catch(() => []),
      deps.webSearch(query).catch(() => []),
    ]);
    results.push(...hf, ...gh, ...web);
  }
  return rankDatasetCandidates(results, input.searchProfile);
}

/**
 * Create default discovery dependencies wired to Agent network/GitHub tools.
 *
 * @returns Production discovery dependency bundle.
 */
export function createDefaultAutoFindDiscoveryDeps(): AutoFindDiscoveryDeps {
  const networkTools = createNetworkToolRegistry();
  const githubTools = createGitHubToolRegistry();

  return {
    searchHuggingFace: searchHuggingFaceDatasets,
    searchGitHub: async (query) => searchGitHubDatasets(query, githubTools),
    webSearch: async (query) => searchWebDatasets(query, networkTools),
    downloadText: downloadTextFromUrl,
  };
}

async function downloadAndNormalizeCandidate(
  candidate: DatasetCandidate,
  input: AutoFindDiscoveryInput,
  deps: AutoFindDiscoveryDeps,
  sessionPrefix: string,
): Promise<{ csvText: string; verifiedDownloadUrl: string } | null> {
  const payloads = await downloadDatasetPayloads(candidate, deps);
  let lastError = "归一化失败（格式不支持或样本不足）";

  for (const downloaded of payloads) {
    const payloadCheck = validateDownloadedPayload(downloaded.text, downloaded.contentType);
    if (!payloadCheck.ok) {
      lastError = payloadCheck.reason;
      continue;
    }

    const csvText = normalizeDatasetToCsv({
      rawText: downloaded.text,
      contentType: downloaded.contentType,
      searchProfile: input.searchProfile,
      positiveCount: input.positiveCount,
      negativeCount: input.negativeCount,
      sessionPrefix,
    });
    if (!csvText) continue;
    return { csvText, verifiedDownloadUrl: downloaded.verifiedDownloadUrl };
  }

  throw new Error(lastError);
}

function buildCandidateDedupeKey(candidate: DatasetCandidate): string {
  const datasetId = extractHuggingFaceDatasetId(candidate.url);
  if (datasetId) return `hf-dataset:${datasetId}`;
  return candidate.id;
}

/**
 * Build Zeval sessionId prefix from dataset profile.
 *
 * @param profile Dataset profile.
 * @returns Session prefix such as `cs_` or `companion_`.
 */
export function buildSessionPrefix(profile: AutoFindDatasetProfile): string {
  if (profile === "customer_service") return "cs_";
  if (profile === "companion") return "companion_";
  return "autofind_";
}

/**
 * Download one or more candidate dataset payloads after resolving concrete file URLs.
 *
 * @param candidate Ranked dataset candidate.
 * @param deps Injectable download dependencies.
 * @returns Downloaded payloads ordered by resolver priority.
 */
export async function downloadDatasetPayloads(
  candidate: DatasetCandidate,
  deps: AutoFindDiscoveryDeps,
): Promise<Array<{ text: string; contentType?: string; verifiedDownloadUrl: string }>> {
  const urls = await resolveCandidateDownloadUrls(candidate);
  const payloads: Array<{ text: string; contentType?: string; verifiedDownloadUrl: string }> = [];
  const errors: string[] = [];

  for (const url of urls.slice(0, 8)) {
    try {
      payloads.push(await downloadResolvedUrl(url, deps.downloadText));
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (payloads.length === 0) {
    throw new Error(errors.join("；") || "未能下载任何数据文件");
  }
  return payloads;
}

/**
 * Download the first available candidate dataset payload.
 *
 * @param candidate Ranked dataset candidate.
 * @param deps Injectable download dependencies.
 * @returns Raw text, content type and verified download URL.
 */
export async function downloadDatasetPayload(
  candidate: DatasetCandidate,
  deps: AutoFindDiscoveryDeps,
): Promise<{ text: string; contentType?: string; verifiedDownloadUrl: string }> {
  const payloads = await downloadDatasetPayloads(candidate, deps);
  return payloads[0]!;
}

function sourcePriorityBonus(candidate: DatasetCandidate): number {
  if (candidate.source === "huggingface") return 6;
  if (candidate.source === "github") return 0;
  return -2;
}

function scoreCandidateText(text: string, keywords: string[]): number {
  const normalized = text.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (normalized.includes(keyword.toLowerCase())) score += 2;
  }
  if (/dialogue|conversation|chat|counsel|support|customer|service|multi-turn|multiturn/.test(normalized)) {
    score += 3;
  }
  if (/huggingface\.co\/datasets|github\.com/.test(normalized)) score += 1;
  return score;
}

/**
 * Describe external tooling used during dataset discovery.
 *
 * @returns Human-readable provenance lines.
 */
export function describeToolingSources(): string[] {
  return [
    "发现：HuggingFace Datasets API",
    "发现：GitHub Search API (github_search_repos)",
    "发现：web_search",
  ];
}

async function searchHuggingFaceDatasets(query: string): Promise<DatasetCandidate[]> {
  const response = await fetch(
    `https://huggingface.co/api/datasets?search=${encodeURIComponent(query)}&limit=12`,
    { signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) {
    throw new Error(`HuggingFace API ${response.status}`);
  }

  const payload = (await response.json()) as Array<{
    id?: string;
    description?: string;
    downloads?: number;
    tags?: string[];
  }>;

  const candidates: DatasetCandidate[] = [];
  for (const item of payload) {
    if (!item.id || isFictionalHuggingFaceId(item.id)) continue;
    candidates.push({
      id: `hf:${item.id}`,
      source: "huggingface",
      title: item.id,
      description: item.description ?? "",
      url: `https://huggingface.co/datasets/${item.id}`,
      score: Math.min(8, Math.round(Math.log10((item.downloads ?? 0) + 10)) + 2),
    });
  }
  return candidates;
}

function isFictionalHuggingFaceId(datasetId: string): boolean {
  return /(?:^|\/)(mock|fake|placeholder|example)(?:\/|$)/i.test(datasetId);
}

async function searchGitHubDatasets(
  query: string,
  githubTools: ReturnType<typeof createGitHubToolRegistry>,
): Promise<DatasetCandidate[]> {
  const handler = githubTools.get("github_search_repos")?.handler;
  if (!handler) return [];

  const result = await handler(
    { query: `${query} dataset conversation`, limit: 8 },
    EMPTY_AGENT_CONTEXT,
  );
  return mapGitHubCandidates(result);
}

async function searchWebDatasets(
  query: string,
  networkTools: ReturnType<typeof createNetworkToolRegistry>,
): Promise<DatasetCandidate[]> {
  const handler = networkTools.get("web_search")?.handler;
  if (!handler) return [];

  const result = await handler({ query, limit: 6 }, EMPTY_AGENT_CONTEXT);
  return mapWebCandidates(result);
}

function mapGitHubCandidates(result: AgentToolResult): DatasetCandidate[] {
  if (result.status !== "success" || !result.result || typeof result.result !== "object") return [];
  const payload = result.result as {
    results?: Array<{ name?: string; description?: string; htmlUrl?: string; stars?: number }>;
  };
  return (payload.results ?? [])
    .filter((item) => Boolean(item.htmlUrl))
    .map((item) => ({
      id: `gh:${item.name ?? item.htmlUrl ?? "unknown"}`,
      source: "github" as const,
      title: item.name ?? "GitHub repository",
      description: item.description ?? "",
      url: item.htmlUrl ?? "",
      downloadUrl: item.htmlUrl,
      score: Math.min(5, Math.round((item.stars ?? 0) / 200)),
    }));
}

function mapWebCandidates(result: AgentToolResult): DatasetCandidate[] {
  if (result.status !== "success" || !result.result || typeof result.result !== "object") return [];
  const payload = result.result as {
    results?: Array<{ title?: string; url?: string; snippet?: string }>;
  };
  return (payload.results ?? [])
    .map((item) => {
      const url = unwrapRedirectUrl(item.url ?? "");
      return {
        title: item.title,
        snippet: item.snippet,
        url,
      };
    })
    .filter((item) => isFetchableUrl(item.url))
    .filter((item) => /huggingface\.co\/datasets|github\.com|kaggle\.com/i.test(item.url))
    .map((item) => {
      const datasetId = extractHuggingFaceDatasetId(item.url);
      const source: DatasetCandidate["source"] = datasetId
        ? "huggingface"
        : /github\.com/i.test(item.url)
          ? "github"
          : "web";
      const pageUrl = datasetId
        ? `https://huggingface.co/datasets/${datasetId}`
        : item.url;
      return {
        id: datasetId ? `hf:${datasetId}` : `${source}:${item.url}`,
        source,
        title: datasetId ?? item.title ?? item.url ?? "Web result",
        description: item.snippet ?? "",
        url: pageUrl,
        downloadUrl: item.url,
        score: source === "huggingface" ? 4 : 1,
      };
    });
}

/**
 * Prefer HuggingFace over GitHub over web, then sort by relevance score.
 *
 * @param candidates Filtered candidate list.
 * @returns Prioritized candidates.
 */
export function prioritizeCandidates(candidates: DatasetCandidate[]): DatasetCandidate[] {
  const sourceRank: Record<DatasetCandidate["source"], number> = {
    huggingface: 0,
    github: 1,
    web: 2,
  };
  return [...candidates].sort((left, right) => {
    const sourceDelta = sourceRank[left.source] - sourceRank[right.source];
    if (sourceDelta !== 0) return sourceDelta;
    return right.score - left.score;
  });
}

async function downloadTextFromUrl(url: string): Promise<{ text: string; contentType?: string }> {
  const resolved = unwrapRedirectUrl(url);
  if (!isFetchableUrl(resolved)) {
    throw new Error(`无效下载 URL: ${url}`);
  }
  const response = await fetch(resolved, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; ZevalAutoFind/1.0)" },
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) {
    throw new Error(`下载失败 ${response.status}: ${url}`);
  }
  const contentType = response.headers.get("content-type") ?? undefined;
  const text = await response.text();
  return { text, contentType };
}
