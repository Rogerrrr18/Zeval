/**
 * @fileoverview Zeval Agent GitHub MCP 工具
 *
 * 模仿 Codex CLI 的 GitHub 集成能力：
 * - github_read_file:     读取仓库文件内容
 * - github_list_dir:      列出仓库目录
 * - github_search_code:   在仓库中搜索代码
 * - github_search_repos:  搜索仓库
 * - github_get_issue:     读取 Issue 详情
 * - github_list_issues:   列出 Issues
 * - github_create_issue:  创建 Issue（需要 token）
 * - github_get_commit:    读取 Commit 详情
 * - github_list_commits:  列出 Commit 历史
 * - github_get_pr:        读取 PR 详情
 * - github_create_pr:     创建 PR（需要 token）
 */

import type { AgentToolHandler, AgentToolRegistry, AgentToolResult, AgentToolSchema } from "./types";

const GITHUB_API_BASE = "https://api.github.com";

// ───────────────────────────────────────────────
// Schema 定义
// ───────────────────────────────────────────────

const githubReadFileSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_read_file",
    description: "读取 GitHub 仓库中的文件内容",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "仓库所有者用户名或组织名" },
        repo: { type: "string", description: "仓库名称" },
        path: { type: "string", description: "文件路径，如 src/index.ts" },
        ref: { type: "string", description: "分支名或 commit SHA，默认 main" },
      },
      required: ["owner", "repo", "path"],
    },
  },
};

const githubListDirSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_list_dir",
    description: "列出 GitHub 仓库中的目录内容",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "仓库所有者" },
        repo: { type: "string", description: "仓库名称" },
        path: { type: "string", description: "目录路径，不传则列根目录" },
        ref: { type: "string", description: "分支名，默认 main" },
      },
      required: ["owner", "repo"],
    },
  },
};

const githubSearchCodeSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_search_code",
    description: "在 GitHub 上搜索代码（跨仓库或限定仓库）",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词，如 filename:package.json" },
        owner: { type: "string", description: "限定仓库所有者（可选）" },
        repo: { type: "string", description: "限定仓库名称（可选）" },
        language: { type: "string", description: "限定编程语言（可选）" },
        limit: { type: "number", description: "返回数量上限，默认 10" },
      },
      required: ["query"],
    },
  },
};

const githubSearchReposSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_search_repos",
    description: "在 GitHub 上搜索仓库",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "搜索关键词" },
        language: { type: "string", description: "限定编程语言" },
        sort: { type: "string", description: "排序方式：stars/forks/updated", enum: ["stars", "forks", "updated"] },
        limit: { type: "number", description: "返回数量上限，默认 10" },
      },
      required: ["query"],
    },
  },
};

const githubGetIssueSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_get_issue",
    description: "读取 GitHub Issue 详情",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "仓库所有者" },
        repo: { type: "string", description: "仓库名称" },
        issueNumber: { type: "number", description: "Issue 编号" },
      },
      required: ["owner", "repo", "issueNumber"],
    },
  },
};

const githubListIssuesSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_list_issues",
    description: "列出 GitHub 仓库的 Issues",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "仓库所有者" },
        repo: { type: "string", description: "仓库名称" },
        state: { type: "string", description: "状态筛选", enum: ["open", "closed", "all"] },
        labels: { type: "string", description: "标签筛选，逗号分隔" },
        limit: { type: "number", description: "返回数量上限，默认 10" },
      },
      required: ["owner", "repo"],
    },
  },
};

const githubCreateIssueSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_create_issue",
    description: "在 GitHub 仓库创建 Issue（需要 GITHUB_TOKEN 环境变量）",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "仓库所有者" },
        repo: { type: "string", description: "仓库名称" },
        title: { type: "string", description: "Issue 标题" },
        body: { type: "string", description: "Issue 内容" },
        labels: { type: "array", description: "标签列表", items: { type: "string" } },
      },
      required: ["owner", "repo", "title", "body"],
    },
  },
};

const githubGetCommitSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_get_commit",
    description: "读取 GitHub Commit 详情",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "仓库所有者" },
        repo: { type: "string", description: "仓库名称" },
        sha: { type: "string", description: "Commit SHA" },
      },
      required: ["owner", "repo", "sha"],
    },
  },
};

const githubListCommitsSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_list_commits",
    description: "列出 GitHub 仓库的 Commit 历史",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "仓库所有者" },
        repo: { type: "string", description: "仓库名称" },
        path: { type: "string", description: "限定文件路径" },
        sha: { type: "string", description: "分支名，默认 main/master" },
        limit: { type: "number", description: "返回数量上限，默认 10" },
      },
      required: ["owner", "repo"],
    },
  },
};

const githubGetPRSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_get_pr",
    description: "读取 GitHub Pull Request 详情",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "仓库所有者" },
        repo: { type: "string", description: "仓库名称" },
        pullNumber: { type: "number", description: "PR 编号" },
      },
      required: ["owner", "repo", "pullNumber"],
    },
  },
};

const githubCreatePRSchema: AgentToolSchema = {
  type: "function",
  function: {
    name: "github_create_pr",
    description: "创建 GitHub Pull Request（需要 GITHUB_TOKEN 环境变量）",
    parameters: {
      type: "object",
      properties: {
        owner: { type: "string", description: "仓库所有者" },
        repo: { type: "string", description: "仓库名称" },
        title: { type: "string", description: "PR 标题" },
        body: { type: "string", description: "PR 描述" },
        head: { type: "string", description: "源分支名" },
        base: { type: "string", description: "目标分支名，默认 main" },
      },
      required: ["owner", "repo", "title", "body", "head"],
    },
  },
};

// ───────────────────────────────────────────────
// GitHub API 请求封装
// ───────────────────────────────────────────────

function getGithubToken(): string | undefined {
  return process.env.GITHUB_TOKEN ?? process.env.GITHUB_API_TOKEN ?? undefined;
}

async function githubApi(path: string, options: RequestInit = {}): Promise<unknown> {
  const token = getGithubToken();
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${GITHUB_API_BASE}${path}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(20000),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`GitHub API ${response.status}: ${errorBody.slice(0, 200)}`);
  }

  return response.json();
}

// ───────────────────────────────────────────────
// 工具实现
// ───────────────────────────────────────────────

const githubReadFileHandler: AgentToolHandler = async (args) => {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  const filePath = String(args.path ?? "");
  const ref = String(args.ref ?? "main");

  if (!owner || !repo || !filePath) {
    return errorResult("github_read_file", "owner, repo, path 是必填参数");
  }

  try {
    const data = await githubApi(`/repos/${owner}/${repo}/contents/${filePath}?ref=${ref}`) as {
      content?: string;
      encoding?: string;
      size?: number;
      html_url?: string;
      path?: string;
      type?: string;
      message?: string;
    };

    if (data.message) {
      return errorResult("github_read_file", data.message);
    }

    if (data.type === "dir") {
      return errorResult("github_read_file", "路径指向目录，请使用 github_list_dir");
    }

    let content = "";
    if (data.content && data.encoding === "base64") {
      content = Buffer.from(data.content, "base64").toString("utf8");
    }

    return successResult("github_read_file", {
      owner,
      repo,
      path: data.path ?? filePath,
      size: data.size ?? 0,
      htmlUrl: data.html_url,
      content: content.slice(0, 10000),
      truncated: content.length > 10000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_read_file", `读取失败: ${message}`);
  }
};

const githubListDirHandler: AgentToolHandler = async (args) => {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  const dirPath = String(args.path ?? "");
  const ref = String(args.ref ?? "main");

  if (!owner || !repo) {
    return errorResult("github_list_dir", "owner 和 repo 是必填参数");
  }

  try {
    const apiPath = dirPath
      ? `/repos/${owner}/${repo}/contents/${dirPath}?ref=${ref}`
      : `/repos/${owner}/${repo}/contents?ref=${ref}`;

    const data = await githubApi(apiPath) as Array<{
      name: string;
      path: string;
      type: string;
      size: number;
      html_url: string;
      download_url?: string;
    }>;

    return successResult("github_list_dir", {
      owner,
      repo,
      path: dirPath || "/",
      items: data.map((item) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        htmlUrl: item.html_url,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_list_dir", `列出目录失败: ${message}`);
  }
};

const githubSearchCodeHandler: AgentToolHandler = async (args) => {
  const query = String(args.query ?? "");
  const owner = args.owner ? String(args.owner) : undefined;
  const repo = args.repo ? String(args.repo) : undefined;
  const language = args.language ? String(args.language) : undefined;
  const limit = Math.min(Number(args.limit ?? 10), 30);

  if (!query) {
    return errorResult("github_search_code", "搜索关键词不能为空");
  }

  let searchQuery = query;
  if (owner && repo) {
    searchQuery += ` repo:${owner}/${repo}`;
  } else if (owner) {
    searchQuery += ` user:${owner}`;
  }
  if (language) {
    searchQuery += ` language:${language}`;
  }

  try {
    const data = await githubApi(`/search/code?q=${encodeURIComponent(searchQuery)}&per_page=${limit}`) as {
      total_count: number;
      items: Array<{
        name: string;
        path: string;
        html_url: string;
        repository: { full_name: string; html_url: string };
        text_matches?: Array<{ fragment: string }>;
      }>;
    };

    return successResult("github_search_code", {
      query: searchQuery,
      totalCount: data.total_count,
      results: data.items.map((item) => ({
        name: item.name,
        path: item.path,
        repository: item.repository.full_name,
        htmlUrl: item.html_url,
        snippet: item.text_matches?.[0]?.fragment?.slice(0, 300) ?? "",
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_search_code", `搜索失败: ${message}`);
  }
};

const githubSearchReposHandler: AgentToolHandler = async (args) => {
  const query = String(args.query ?? "");
  const language = args.language ? String(args.language) : undefined;
  const sort = String(args.sort ?? "stars");
  const limit = Math.min(Number(args.limit ?? 10), 30);

  if (!query) {
    return errorResult("github_search_repos", "搜索关键词不能为空");
  }

  let searchQuery = query;
  if (language) {
    searchQuery += ` language:${language}`;
  }

  try {
    const data = await githubApi(`/search/repositories?q=${encodeURIComponent(searchQuery)}&sort=${sort}&per_page=${limit}`) as {
      total_count: number;
      items: Array<{
        full_name: string;
        description: string;
        html_url: string;
        stargazers_count: number;
        language: string;
        updated_at: string;
      }>;
    };

    return successResult("github_search_repos", {
      query: searchQuery,
      totalCount: data.total_count,
      results: data.items.map((item) => ({
        name: item.full_name,
        description: item.description,
        htmlUrl: item.html_url,
        stars: item.stargazers_count,
        language: item.language,
        updatedAt: item.updated_at,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_search_repos", `搜索失败: ${message}`);
  }
};

const githubGetIssueHandler: AgentToolHandler = async (args) => {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  const issueNumber = Number(args.issueNumber ?? 0);

  if (!owner || !repo || !issueNumber) {
    return errorResult("github_get_issue", "owner, repo, issueNumber 是必填参数");
  }

  try {
    const data = await githubApi(`/repos/${owner}/${repo}/issues/${issueNumber}`) as {
      number: number;
      title: string;
      body: string;
      state: string;
      html_url: string;
      user: { login: string };
      labels: Array<{ name: string }>;
      comments: number;
      created_at: string;
      closed_at: string | null;
    };

    return successResult("github_get_issue", {
      number: data.number,
      title: data.title,
      body: data.body?.slice(0, 5000) ?? "",
      state: data.state,
      author: data.user.login,
      labels: data.labels.map((l) => l.name),
      comments: data.comments,
      htmlUrl: data.html_url,
      createdAt: data.created_at,
      closedAt: data.closed_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_get_issue", `读取失败: ${message}`);
  }
};

const githubListIssuesHandler: AgentToolHandler = async (args) => {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  const state = String(args.state ?? "open") as "open" | "closed" | "all";
  const labels = args.labels ? String(args.labels) : undefined;
  const limit = Math.min(Number(args.limit ?? 10), 30);

  if (!owner || !repo) {
    return errorResult("github_list_issues", "owner 和 repo 是必填参数");
  }

  try {
    let url = `/repos/${owner}/${repo}/issues?state=${state}&per_page=${limit}`;
    if (labels) {
      url += `&labels=${encodeURIComponent(labels)}`;
    }

    const data = await githubApi(url) as Array<{
      number: number;
      title: string;
      body: string;
      state: string;
      html_url: string;
      user: { login: string };
      labels: Array<{ name: string }>;
      comments: number;
      created_at: string;
    }>;

    // 过滤掉 PR（GitHub API 把 PR 也返回在 issues 中）
    const issues = data.filter((item) => !("pull_request" in item));

    return successResult("github_list_issues", {
      owner,
      repo,
      state,
      count: issues.length,
      issues: issues.map((item) => ({
        number: item.number,
        title: item.title,
        state: item.state,
        author: item.user.login,
        labels: item.labels.map((l) => l.name),
        comments: item.comments,
        htmlUrl: item.html_url,
        createdAt: item.created_at,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_list_issues", `列出失败: ${message}`);
  }
};

const githubCreateIssueHandler: AgentToolHandler = async (args) => {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  const title = String(args.title ?? "");
  const body = String(args.body ?? "");
  const labels = Array.isArray(args.labels) ? args.labels.map(String) : [];

  if (!owner || !repo || !title || !body) {
    return errorResult("github_create_issue", "owner, repo, title, body 是必填参数");
  }

  const token = getGithubToken();
  if (!token) {
    return errorResult("github_create_issue", "创建 Issue 需要 GITHUB_TOKEN 环境变量");
  }

  try {
    const data = await githubApi(`/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, labels }),
    }) as {
      number: number;
      title: string;
      html_url: string;
      state: string;
    };

    return successResult("github_create_issue", {
      number: data.number,
      title: data.title,
      htmlUrl: data.html_url,
      state: data.state,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_create_issue", `创建失败: ${message}`);
  }
};

const githubGetCommitHandler: AgentToolHandler = async (args) => {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  const sha = String(args.sha ?? "");

  if (!owner || !repo || !sha) {
    return errorResult("github_get_commit", "owner, repo, sha 是必填参数");
  }

  try {
    const data = await githubApi(`/repos/${owner}/${repo}/commits/${sha}`) as {
      sha: string;
      commit: {
        message: string;
        author: { name: string; date: string };
      };
      html_url: string;
      stats: { additions: number; deletions: number; total: number };
      files: Array<{ filename: string; status: string; additions: number; deletions: number }>;
    };

    return successResult("github_get_commit", {
      sha: data.sha,
      message: data.commit.message,
      author: data.commit.author.name,
      date: data.commit.author.date,
      htmlUrl: data.html_url,
      stats: data.stats,
      files: data.files.map((f) => ({
        filename: f.filename,
        status: f.status,
        additions: f.additions,
        deletions: f.deletions,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_get_commit", `读取失败: ${message}`);
  }
};

const githubListCommitsHandler: AgentToolHandler = async (args) => {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  const path = args.path ? String(args.path) : undefined;
  const sha = String(args.sha ?? "main");
  const limit = Math.min(Number(args.limit ?? 10), 30);

  if (!owner || !repo) {
    return errorResult("github_list_commits", "owner 和 repo 是必填参数");
  }

  try {
    let url = `/repos/${owner}/${repo}/commits?sha=${sha}&per_page=${limit}`;
    if (path) {
      url += `&path=${encodeURIComponent(path)}`;
    }

    const data = await githubApi(url) as Array<{
      sha: string;
      commit: {
        message: string;
        author: { name: string; date: string };
      };
      html_url: string;
      author: { login: string } | null;
    }>;

    return successResult("github_list_commits", {
      owner,
      repo,
      branch: sha,
      count: data.length,
      commits: data.map((item) => ({
        sha: item.sha,
        message: item.commit.message.slice(0, 200),
        author: item.author?.login ?? item.commit.author.name,
        date: item.commit.author.date,
        htmlUrl: item.html_url,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_list_commits", `列出失败: ${message}`);
  }
};

const githubGetPRHandler: AgentToolHandler = async (args) => {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  const pullNumber = Number(args.pullNumber ?? 0);

  if (!owner || !repo || !pullNumber) {
    return errorResult("github_get_pr", "owner, repo, pullNumber 是必填参数");
  }

  try {
    const data = await githubApi(`/repos/${owner}/${repo}/pulls/${pullNumber}`) as {
      number: number;
      title: string;
      body: string;
      state: string;
      html_url: string;
      user: { login: string };
      head: { ref: string; sha: string };
      base: { ref: string };
      additions: number;
      deletions: number;
      changed_files: number;
      merged: boolean;
      created_at: string;
    };

    return successResult("github_get_pr", {
      number: data.number,
      title: data.title,
      body: data.body?.slice(0, 3000) ?? "",
      state: data.state,
      author: data.user.login,
      headBranch: data.head.ref,
      headSha: data.head.sha,
      baseBranch: data.base.ref,
      additions: data.additions,
      deletions: data.deletions,
      changedFiles: data.changed_files,
      merged: data.merged,
      htmlUrl: data.html_url,
      createdAt: data.created_at,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_get_pr", `读取失败: ${message}`);
  }
};

const githubCreatePRHandler: AgentToolHandler = async (args) => {
  const owner = String(args.owner ?? "");
  const repo = String(args.repo ?? "");
  const title = String(args.title ?? "");
  const body = String(args.body ?? "");
  const head = String(args.head ?? "");
  const base = String(args.base ?? "main");

  if (!owner || !repo || !title || !body || !head) {
    return errorResult("github_create_pr", "owner, repo, title, body, head 是必填参数");
  }

  const token = getGithubToken();
  if (!token) {
    return errorResult("github_create_pr", "创建 PR 需要 GITHUB_TOKEN 环境变量");
  }

  try {
    const data = await githubApi(`/repos/${owner}/${repo}/pulls`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, body, head, base }),
    }) as {
      number: number;
      title: string;
      html_url: string;
      state: string;
    };

    return successResult("github_create_pr", {
      number: data.number,
      title: data.title,
      htmlUrl: data.html_url,
      state: data.state,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorResult("github_create_pr", `创建失败: ${message}`);
  }
};

// ───────────────────────────────────────────────
// 注册表
// ───────────────────────────────────────────────

export function createGitHubToolRegistry(): AgentToolRegistry {
  const registry = new Map();
  registry.set("github_read_file", { schema: githubReadFileSchema, handler: githubReadFileHandler });
  registry.set("github_list_dir", { schema: githubListDirSchema, handler: githubListDirHandler });
  registry.set("github_search_code", { schema: githubSearchCodeSchema, handler: githubSearchCodeHandler });
  registry.set("github_search_repos", { schema: githubSearchReposSchema, handler: githubSearchReposHandler });
  registry.set("github_get_issue", { schema: githubGetIssueSchema, handler: githubGetIssueHandler });
  registry.set("github_list_issues", { schema: githubListIssuesSchema, handler: githubListIssuesHandler });
  registry.set("github_create_issue", { schema: githubCreateIssueSchema, handler: githubCreateIssueHandler });
  registry.set("github_get_commit", { schema: githubGetCommitSchema, handler: githubGetCommitHandler });
  registry.set("github_list_commits", { schema: githubListCommitsSchema, handler: githubListCommitsHandler });
  registry.set("github_get_pr", { schema: githubGetPRSchema, handler: githubGetPRHandler });
  registry.set("github_create_pr", { schema: githubCreatePRSchema, handler: githubCreatePRHandler });
  return registry;
}

// ───────────────────────────────────────────────
// 辅助函数
// ───────────────────────────────────────────────

function successResult(name: string, result: unknown): AgentToolResult {
  return { tool_call_id: "", name, status: "success", result };
}

function errorResult(name: string, error: string): AgentToolResult {
  return { tool_call_id: "", name, status: "error", result: null, error };
}
