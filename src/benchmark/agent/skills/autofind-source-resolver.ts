/**
 * @fileoverview Resolve discovered dataset URLs into downloadable dialogue file URLs.
 */

import { extractHuggingFaceDatasetId, isFetchableUrl, unwrapRedirectUrl } from "@/benchmark/agent/url-utils";
import type { DatasetCandidate } from "./autofind-types";

export type HuggingFaceTreeEntry = {
  path: string;
  type: "file" | "directory";
  size?: number;
};

const DATA_FILE_PATTERN = /\.(json|jsonl|csv)$/i;
const SKIP_FILE_PATTERN = /(?:^|\/)(?:readme|license|gitattributes)(?:\.[^/]+)?$|\.git/i;
const DIALOGUE_FILE_PATTERN = /convo|conversation|dialogue|dialog|chat|e2e|support|customer|train|data/i;

/**
 * Rank downloadable data files by dialogue relevance and size.
 *
 * @param files Candidate file paths with optional byte size.
 * @returns Sorted file list (best first).
 */
export function rankHuggingFaceDataFiles(
  files: Array<{ path: string; size?: number }>,
): Array<{ path: string; size?: number }> {
  return [...files]
    .filter((file) => DATA_FILE_PATTERN.test(file.path) && !SKIP_FILE_PATTERN.test(file.path))
    .sort((left, right) => scoreDataFile(right) - scoreDataFile(left));
}

/**
 * List json/csv/jsonl files under a HuggingFace dataset repo (recursive).
 *
 * @param datasetId HuggingFace dataset id.
 * @param maxDepth Maximum directory depth to traverse.
 * @returns Ranked downloadable file paths.
 */
export async function listHuggingFaceDataFiles(
  datasetId: string,
  maxDepth = 3,
): Promise<Array<{ path: string; size?: number; branch: string }>> {
  const collected: Array<{ path: string; size?: number; branch: string }> = [];

  for (const branch of ["main", "master"]) {
    await walkHuggingFaceTree(datasetId, branch, "", 0, maxDepth, collected);
    if (collected.length > 0) break;
  }

  return rankHuggingFaceDataFiles(collected).map((file) => ({
    ...file,
    branch: collected.find((entry) => entry.path === file.path)?.branch ?? "main",
  }));
}

/**
 * Resolve one or more concrete HuggingFace file URLs for a dataset id.
 *
 * @param datasetId HuggingFace dataset id.
 * @returns Absolute resolve URLs ordered by relevance.
 */
export async function resolveHuggingFaceDownloadUrls(datasetId: string): Promise<string[]> {
  const files = await listHuggingFaceDataFiles(datasetId);
  if (files.length > 0) {
    return files.map(
      (file) => `https://huggingface.co/datasets/${datasetId}/resolve/${file.branch}/${file.path}`,
    );
  }

  const rowsJson = await fetchHuggingFaceRowsAsJson(datasetId);
  if (rowsJson) {
    return [`hf-rows://${datasetId}`];
  }

  throw new Error(`HuggingFace 数据集未找到 json/csv/jsonl 数据文件：${datasetId}`);
}

/**
 * Resolve all download URLs for a dataset candidate.
 *
 * @param candidate Discovered dataset candidate.
 * @returns Ordered absolute URLs or virtual HF rows URLs.
 */
export async function resolveCandidateDownloadUrls(candidate: DatasetCandidate): Promise<string[]> {
  let url = unwrapRedirectUrl(candidate.downloadUrl ?? candidate.url);
  if (!isFetchableUrl(url)) {
    throw new Error(`无效下载 URL: ${candidate.url}`);
  }

  const datasetId = extractHuggingFaceDatasetId(url);
  if (datasetId && !url.includes("/resolve/") && !url.startsWith("hf-rows://")) {
    return resolveHuggingFaceDownloadUrls(datasetId);
  }

  const ghMatch = url.match(/github\.com\/([^/]+)\/([^/?#]+)/i);
  if (ghMatch && !url.includes("/raw/") && !url.includes("raw.githubusercontent.com")) {
    const repo = ghMatch[2].replace(/\.git$/i, "");
    const githubUrls = await listGitHubDataFileUrls(ghMatch[1], repo);
    if (githubUrls.length === 0) {
      throw new Error("GitHub 仓库未找到可下载的 json/csv/jsonl 数据文件");
    }
    return githubUrls;
  }

  return [url];
}

/**
 * Download dataset payload for a resolved URL.
 *
 * @param url Absolute file URL or `hf-rows://owner/name`.
 * @param downloadText Injectable text downloader.
 * @returns Raw text and content type.
 */
export async function downloadResolvedUrl(
  url: string,
  downloadText: (url: string) => Promise<{ text: string; contentType?: string }>,
): Promise<{ text: string; contentType?: string; verifiedDownloadUrl: string }> {
  if (url.startsWith("hf-rows://")) {
    const datasetId = url.slice("hf-rows://".length);
    const text = await fetchHuggingFaceRowsAsJson(datasetId);
    if (!text) {
      throw new Error(`HuggingFace datasets-server 无可用行数据：${datasetId}`);
    }
    return { text, contentType: "application/json", verifiedDownloadUrl: url };
  }

  const downloaded = await downloadText(url);
  return { ...downloaded, verifiedDownloadUrl: url };
}

/**
 * Fetch parquet-only HuggingFace datasets via datasets-server rows API.
 *
 * @param datasetId HuggingFace dataset id.
 * @returns JSON array text or null when unavailable.
 */
export async function fetchHuggingFaceRowsAsJson(datasetId: string): Promise<string | null> {
  const infoResponse = await fetch(`https://datasets-server.huggingface.co/info?dataset=${datasetId}`, {
    signal: AbortSignal.timeout(20000),
  });
  if (!infoResponse.ok) return null;

  const info = (await infoResponse.json()) as {
    dataset_info?: Record<string, { splits?: Record<string, { num_examples?: number }> }>;
  };
  const configName = Object.keys(info.dataset_info ?? {})[0];
  if (!configName) return null;

  const splitName = Object.keys(info.dataset_info?.[configName]?.splits ?? {})[0];
  if (!splitName) return null;

  const totalExamples = info.dataset_info?.[configName]?.splits?.[splitName]?.num_examples ?? 500;
  const length = Math.min(Math.max(totalExamples, 50), 800);
  const rowsResponse = await fetch(
    `https://datasets-server.huggingface.co/rows?dataset=${encodeURIComponent(datasetId)}&config=${encodeURIComponent(configName)}&split=${encodeURIComponent(splitName)}&offset=0&length=${length}`,
    { signal: AbortSignal.timeout(60000) },
  );
  if (!rowsResponse.ok) return null;

  const payload = (await rowsResponse.json()) as {
    rows?: Array<{ row?: Record<string, unknown> }>;
  };
  const rows = (payload.rows ?? []).map((entry) => entry.row).filter(Boolean);
  if (rows.length === 0) return null;
  return JSON.stringify(rows);
}

async function walkHuggingFaceTree(
  datasetId: string,
  branch: string,
  path: string,
  depth: number,
  maxDepth: number,
  collected: Array<{ path: string; size?: number; branch: string }>,
): Promise<void> {
  const apiPath = path
    ? `https://huggingface.co/api/datasets/${datasetId}/tree/${branch}/${path}`
    : `https://huggingface.co/api/datasets/${datasetId}/tree/${branch}`;
  const response = await fetch(apiPath, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) return;

  const entries = (await response.json()) as HuggingFaceTreeEntry[];
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    if (!entry.path) continue;
    if (entry.type === "file") {
      if (DATA_FILE_PATTERN.test(entry.path) && !SKIP_FILE_PATTERN.test(entry.path)) {
        collected.push({ path: entry.path, size: entry.size, branch });
      }
      continue;
    }
    if (entry.type === "directory" && depth < maxDepth) {
      await walkHuggingFaceTree(datasetId, branch, entry.path, depth + 1, maxDepth, collected);
    }
  }
}

async function listGitHubDataFileUrls(owner: string, repo: string): Promise<string[]> {
  const searchRoots = ["", "data", "dataset", "datasets", "dialogue", "dialogues", "src/data"];
  const files: string[] = [];

  for (const root of searchRoots) {
    await collectGitHubFiles(owner, repo, root, 0, 2, files);
  }

  return rankHuggingFaceDataFiles(files.map((path) => ({ path }))).map(
    (file) => `https://raw.githubusercontent.com/${owner}/${repo}/main/${file.path}`,
  );
}

async function collectGitHubFiles(
  owner: string,
  repo: string,
  path: string,
  depth: number,
  maxDepth: number,
  files: string[],
): Promise<void> {
  const apiPath = path
    ? `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
    : `https://api.github.com/repos/${owner}/${repo}/contents/`;
  const response = await fetch(apiPath, {
    headers: {
      "User-Agent": "ZevalAutoFind/1.0",
      Accept: "application/vnd.github+json",
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) return;

  const entries = (await response.json()) as Array<{
    name?: string;
    path?: string;
    type?: string;
    download_url?: string;
  }>;
  if (!Array.isArray(entries)) return;

  for (const entry of entries) {
    if (!entry.path) continue;
    if (entry.type === "file") {
      if (DATA_FILE_PATTERN.test(entry.name ?? entry.path)) {
        files.push(entry.path);
      }
      continue;
    }
    if (entry.type === "dir" && depth < maxDepth) {
      await collectGitHubFiles(owner, repo, entry.path, depth + 1, maxDepth, files);
    }
  }
}

function scoreDataFile(file: { path: string; size?: number }): number {
  let score = Math.min(8, Math.log10((file.size ?? 1) + 10));
  if (DIALOGUE_FILE_PATTERN.test(file.path)) score += 12;
  if (/\.jsonl$/i.test(file.path)) score += 2;
  if (/\.csv$/i.test(file.path)) score += 1;
  if (/sample|test|dev|val/i.test(file.path)) score -= 4;
  return score;
}
