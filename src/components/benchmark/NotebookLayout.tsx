/**
 * @fileoverview NotebookLLM 风格的三栏布局
 *
 * ┌─────────────────┬──────────────────────────┬──────────────────┐
 * │  Sources        │   Chat (评测工作台)       │   Copilot Chat   │
 * │  (知识库)        │                          │   (助手)          │
 * └─────────────────┴──────────────────────────┴──────────────────┘
 *
 * 设计参考：
 * - 深色主题 (#1a1a2e 基底)
 * - 圆角消息气泡
 * - 简洁头部
 * - 左侧文件列表 + 中间主内容 + 右侧聊天
 */

"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import Link from "next/link";
import type {
  BenchmarkCase,
  BenchmarkCaseScore,
  BenchmarkMetricEvaluationResult,
  BenchmarkMetricReference,
  BenchmarkRubricMetric,
  BenchmarkRubricScoreLevel,
  BenchmarkRubricSet,
  BenchmarkRunResult,
} from "@/benchmark/types";
import type { BenchmarkProgressSnapshot } from "@/benchmark/progress";
import { approveRubricMetrics, cloneRubric, toggleMetricApproval } from "@/benchmark/rubric";
import type {
  BenchmarkDatasetSnapshot,
  BenchmarkChatTurn,
  BenchmarkHumanReviewRecord,
  BenchmarkRunHistoryItem,
  BenchmarkWorkspaceSession,
  BenchmarkWorkspaceViewMode,
} from "@/benchmark/session-store";
import type {
  AutoFindRubricContext,
  AutoFindWorkflowState,
} from "@/benchmark/agent/skills/autofind-data-skill";
import type { IngestResponse, UploadFormat } from "@/types/pipeline";
import { useProject } from "@/components/shell/ProjectContext";
import { DEFAULT_PROJECT } from "@/lib/projectStore";
import { MarkdownMessage } from "@/components/shared/MarkdownMessage";
import { RubricGraphView } from "./RubricGraphView";
import styles from "./notebookLayout.module.css";

// ─── Types ──────────────────────────────────────────────────────────

type ChatTurn = BenchmarkChatTurn;

type KnowledgeFile = {
  fileId: string;
  fileName: string;
  fileType: string;
  sizeBytes: number;
  tags: string[];
  description: string;
  uploadedAt: string;
};

type ViewMode = BenchmarkWorkspaceViewMode;
type BenchmarkSession = BenchmarkWorkspaceSession;

type StartBenchmarkRunResponse = {
  runId?: string;
  error?: string;
};

type BenchmarkRunStatusResponse = {
  source?: "memory" | "artifact" | "none";
  stale?: boolean;
  snapshot?: BenchmarkProgressSnapshot | null;
  error?: string;
};

type BenchmarkRubricAgentResponse = {
  reply?: string;
  requirementText?: string;
  rubric?: BenchmarkRubricSet | null;
  toolCalls?: Array<{ name: string; summary: string }>;
  warnings?: string[];
  error?: string;
};

type BenchmarkAutoFindResponse = {
  reply?: string;
  state?: AutoFindWorkflowState;
  suggestedActions?: string[];
  error?: string;
};

type CopilotTabId = "rubric" | "autofind";

type BenchmarkDataUploadState = "idle" | "uploading" | "ready" | "error";

type BenchmarkAdmitCasesResponse = {
  savedCount?: number;
  savedCaseIds?: string[];
  skippedDuplicates?: number;
  acceptedBySource?: Record<string, number>;
  admittedCases?: Array<{
    caseId: string;
    source: string;
    caseSetType: "goodcase" | "badcase";
    reviewStatus: string;
    metricKey: string;
    benchmarkCaseId: string;
    decision?: HumanReviewDecision;
  }>;
  candidateCount?: number;
  error?: string;
  detail?: string;
};

const DEFAULT_COPILOT_TURNS: ChatTurn[] = [
  { kind: "ai", text: "你好，我是 Zeval 评测 Agent。你可以直接告诉我评测任务、业务约束或想调整的评分标准，我会调用工具生成、修改、确认或解释当前 rubric。" },
];

const DEFAULT_AUTOFIND_TURNS: ChatTurn[] = [
  {
    kind: "ai",
    text: "我是 AutoFind 数据助手。我会调用模型根据你的评测需求生成检索词、选择公开数据集，并整理 10 正 + 10 负多轮对话。回复「开始搜索」或点击下方快捷操作即可。",
  },
];

const SESSION_STORAGE_PREFIX = "zeval:benchmark-sessions";
const ACTIVE_SESSION_STORAGE_PREFIX = "zeval:benchmark-active-session";

const METRIC_NAME_ZH: Record<string, string> = {
  task_success: "任务完成度",
  decision_accuracy: "筛选决策准确率",
  entity_f1: "关键信息覆盖率",
  output_schema_valid: "输出格式合规性",
  reason_alignment: "理由一致性",
  citation_accuracy: "证据准确性",
  tool_call_success: "工具调用成功率",
  runtime_within_budget: "运行效率达标率",
  policy_safe: "安全与合规性",
  business_acceptance: "业务可接受度",
};

const CAPABILITY_NAME_ZH: Record<string, string> = {
  task_completion: "任务完成",
  instruction_following: "指令遵循",
  factual_grounding: "事实依据",
  data_extraction: "信息抽取",
  reasoning_quality: "推理质量",
  tool_use_correctness: "工具使用",
  format_compliance: "格式合规",
  latency_efficiency: "效率表现",
  safety_policy: "安全合规",
  business_judgment: "业务判断",
};

const EVALUATOR_NAME_ZH: Record<string, string> = {
  exact_match: "精确匹配",
  regex_match: "格式匹配",
  numeric_tolerance: "数值容差",
  f1_match: "覆盖率匹配",
  code_exec: "代码执行",
  unit_test: "单元测试",
  environment_state_test: "环境状态检测",
  llm_judge: "模型评审",
  human_label: "人工标注",
  hybrid: "混合评估",
};

const EVALUATOR_OPTIONS: Array<{ value: BenchmarkRubricMetric["evaluatorType"]; label: string }> = [
  { value: "llm_judge", label: "模型评审" },
  { value: "human_label", label: "人工标注" },
  { value: "exact_match", label: "精确匹配" },
  { value: "regex_match", label: "格式匹配" },
  { value: "numeric_tolerance", label: "数值容差" },
  { value: "f1_match", label: "覆盖率匹配" },
  { value: "code_exec", label: "代码执行" },
  { value: "unit_test", label: "单元测试" },
  { value: "environment_state_test", label: "环境状态检测" },
  { value: "hybrid", label: "混合评估" },
];

function hasChineseText(value: string): boolean {
  return /[\u3400-\u9fff]/.test(value);
}

function humanizeMetricKey(metricKey: string): string {
  const translatedParts = metricKey
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => {
      const normalized = part.toLowerCase();
      const wordMap: Record<string, string> = {
        overall: "整体",
        compliance: "合规",
        task: "任务",
        success: "完成",
        decision: "决策",
        accuracy: "准确",
        entity: "信息",
        output: "输出",
        schema: "格式",
        valid: "合规",
        reason: "理由",
        alignment: "一致",
        citation: "证据",
        tool: "工具",
        call: "调用",
        runtime: "运行",
        within: "符合",
        budget: "预算",
        policy: "策略",
        safe: "安全",
        business: "业务",
        acceptance: "可接受",
        evidence: "证据",
        coverage: "覆盖",
        quality: "质量",
      };
      return wordMap[normalized] ?? part;
    })
    .filter((part) => !["metric", "indicator", "rubric"].includes(part.toLowerCase()));
  return translatedParts.length ? translatedParts.join("") : metricKey;
}

function metricDisplayName(metric: BenchmarkRubricMetric): string {
  if (hasChineseText(metric.displayName)) return metric.displayName;
  return METRIC_NAME_ZH[metric.metricKey] ?? humanizeMetricKey(metric.metricKey);
}

function buildMetricDisplayNameMap(rubric: BenchmarkRubricSet | null): Map<string, string> {
  const metricNameMap = new Map<string, string>();
  if (!rubric) return metricNameMap;
  for (const metric of rubric.modules.flatMap((module) => module.metrics)) {
    metricNameMap.set(metric.metricKey, metricDisplayName(metric));
  }
  return metricNameMap;
}

function capabilityDisplayName(capability: string, fallback: string): string {
  if (hasChineseText(fallback)) return fallback;
  return CAPABILITY_NAME_ZH[capability] ?? "能力维度";
}

function evaluatorDisplayName(evaluatorType: string): string {
  return EVALUATOR_NAME_ZH[evaluatorType] ?? "自定义评估";
}

function metricDescriptionZh(metric: BenchmarkRubricMetric): string {
  if (hasChineseText(metric.description)) return metric.description;
  return `用于判断「${metricDisplayName(metric)}」是否达到本次评测任务的业务验收要求。`;
}

function defaultMetricRubricForm(metric: BenchmarkRubricMetric): BenchmarkRubricScoreLevel[] {
  const name = metricDisplayName(metric);
  return [
    { score: 5, label: "优秀", description: `完全满足「${name}」要求，证据充分且无明显缺陷。` },
    { score: 3, label: "合格", description: `基本满足「${name}」要求，但存在轻微遗漏或表达不够充分。` },
    { score: 1, label: "不合格", description: `未能满足「${name}」核心要求，存在关键错误、缺失或无证据支撑。` },
  ];
}

function metricReferences(metric: BenchmarkRubricMetric): BenchmarkMetricReference[] {
  return metric.config?.references ?? [];
}

function countUniqueMetricReferences(metrics: BenchmarkRubricMetric[]): number {
  return new Set(
    metrics.flatMap((metric) =>
      metricReferences(metric).map((reference) =>
        (reference.referenceId ?? reference.url ?? reference.title).trim().toLowerCase(),
      ),
    ),
  ).size;
}

function referenceSourceDisplayName(sourceType: BenchmarkMetricReference["sourceType"]): string {
  const names: Record<BenchmarkMetricReference["sourceType"], string> = {
    paper: "论文",
    public_benchmark: "公开 Benchmark",
    standard: "标准",
    dataset: "数据集",
    framework: "框架",
    documentation: "文档",
    research_report: "研究报告",
  };
  return names[sourceType] ?? "来源";
}

function referenceMeta(reference: BenchmarkMetricReference): string {
  return [
    referenceSourceDisplayName(reference.sourceType),
    reference.benchmarkName,
    reference.publisher,
    reference.year ? String(reference.year) : "",
  ].filter(Boolean).join(" · ");
}

function localizeRubricForDisplay(rubric: BenchmarkRubricSet): BenchmarkRubricSet {
  return {
    ...rubric,
    title: hasChineseText(rubric.title)
      ? rubric.title.replace("HR Resume Screening Rubric", "HR 简历筛选评分标准")
      : "评测任务评分标准",
    description: hasChineseText(rubric.description)
      ? rubric.description
      : "根据当前业务需求生成的可审核评分标准。",
    modules: rubric.modules.map((module) => ({
      ...module,
      displayName: capabilityDisplayName(module.capability, module.displayName),
      description: hasChineseText(module.description) ? module.description : "该能力维度用于衡量任务执行质量。",
      metrics: module.metrics.map((metric) => ({
        ...metric,
        displayName: metricDisplayName(metric),
        description: metricDescriptionZh(metric),
        config: {
          ...metric.config,
          criteria: hasChineseText(metric.config?.criteria ?? "")
            ? metric.config?.criteria
            : `请按照「${metricDisplayName(metric)}」的业务要求进行 0 到 5 分评分，并给出证据。`,
          rubricForm: metric.config?.rubricForm?.length ? metric.config.rubricForm : defaultMetricRubricForm(metric),
        },
      })),
    })),
  };
}

function clampMetricWeight(value: number): number {
  if (!Number.isFinite(value)) return 3;
  return Math.max(1, Math.min(10, Math.round(value)));
}

function updateMetricWeight(rubric: BenchmarkRubricSet, metricKey: string, weight: number): BenchmarkRubricSet {
  const nextWeight = clampMetricWeight(weight);
  return updateMetricPatch(rubric, metricKey, { weight: nextWeight });
}

function updateMetricPatch(
  rubric: BenchmarkRubricSet,
  metricKey: string,
  patch: Partial<Omit<BenchmarkRubricMetric, "metricKey" | "capability">>,
): BenchmarkRubricSet {
  return localizeRubricForDisplay({
    ...rubric,
    updatedAt: new Date().toISOString(),
    modules: rubric.modules.map((module) => ({
      ...module,
      metrics: module.metrics.map((metric) =>
        metric.metricKey === metricKey ? { ...metric, ...patch } : metric,
      ),
    })),
  });
}

function benchmarkSessionsKey(projectId: string): string {
  return `${SESSION_STORAGE_PREFIX}:${projectId}`;
}

function activeBenchmarkSessionKey(projectId: string): string {
  return `${ACTIVE_SESSION_STORAGE_PREFIX}:${projectId}`;
}

function createBenchmarkSession(projectId: string): BenchmarkSession {
  const now = new Date().toISOString();
  return {
    id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId,
    title: "新评测任务",
    titleManuallySet: false,
    description: "尚未生成评分标准",
    createdAt: now,
    updatedAt: now,
    requirement: "",
    useLlm: true,
    rubric: null,
    viewMode: "rubric",
    copilotTurns: [...DEFAULT_COPILOT_TURNS],
    selectedFileId: null,
    dataset: null,
    runResult: null,
    progress: null,
    runHistory: [],
    humanReviewRecords: [],
    autofindState: null,
    autofindTurns: [...DEFAULT_AUTOFIND_TURNS],
  };
}

function readBenchmarkSessions(projectId: string): BenchmarkSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(benchmarkSessionsKey(projectId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as BenchmarkSession[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((session) => typeof session?.id === "string")
      .map((session) => ({
        ...createBenchmarkSession(projectId),
        ...session,
        projectId,
        title: session.title === "新评测会话" ? "新评测任务" : session.title,
        titleManuallySet: session.titleManuallySet ?? false,
        rubric: session.rubric ? localizeRubricForDisplay(session.rubric) : null,
        dataset: session.dataset ?? null,
        runResult: session.runResult ?? session.runHistory?.[0]?.result ?? null,
        progress: session.progress ?? session.runHistory?.[0]?.progress ?? null,
        runHistory: session.runHistory ?? [],
        humanReviewRecords: session.humanReviewRecords ?? [],
        copilotTurns: Array.isArray(session.copilotTurns) && session.copilotTurns.length > 0
          ? session.copilotTurns
          : [...DEFAULT_COPILOT_TURNS],
        viewMode: session.viewMode ?? "rubric",
        autofindState: session.autofindState ?? null,
        autofindTurns:
          Array.isArray(session.autofindTurns) && session.autofindTurns.length > 0
            ? session.autofindTurns
            : [...DEFAULT_AUTOFIND_TURNS],
      }));
  } catch {
    return [];
  }
}

function writeBenchmarkSessions(projectId: string, sessions: BenchmarkSession[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(benchmarkSessionsKey(projectId), JSON.stringify(sessions));
  } catch {
    // localStorage may be unavailable or full.
  }
}

async function fetchRemoteBenchmarkSessions(projectId: string): Promise<{
  sessions: BenchmarkSession[];
  activeSessionId: string | null;
} | null> {
  try {
    const response = await fetch(`/api/benchmarks/sessions?projectId=${encodeURIComponent(projectId)}`);
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      sessions?: BenchmarkSession[];
      activeSessionId?: string | null;
    };
    return {
      sessions: Array.isArray(payload.sessions)
        ? payload.sessions.map((session) => ({
            ...session,
            title: session.title === "新评测会话" ? "新评测任务" : session.title,
            titleManuallySet: session.titleManuallySet ?? false,
            rubric: session.rubric ? localizeRubricForDisplay(session.rubric) : null,
            dataset: session.dataset ?? null,
            runResult: session.runResult ?? session.runHistory?.[0]?.result ?? null,
            progress: session.progress ?? session.runHistory?.[0]?.progress ?? null,
            runHistory: session.runHistory ?? [],
            humanReviewRecords: session.humanReviewRecords ?? [],
            viewMode: session.viewMode ?? "rubric",
            autofindState: session.autofindState ?? null,
            autofindTurns:
              Array.isArray(session.autofindTurns) && session.autofindTurns.length > 0
                ? session.autofindTurns
                : [...DEFAULT_AUTOFIND_TURNS],
          }))
        : [],
      activeSessionId: payload.activeSessionId ?? null,
    };
  } catch {
    return null;
  }
}

async function persistRemoteBenchmarkSessions(
  projectId: string,
  sessions: BenchmarkSession[],
  activeSessionId: string | null,
): Promise<void> {
  try {
    await fetch("/api/benchmarks/sessions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, sessions, activeSessionId }),
    });
  } catch {
    // The local cache remains available if the server write is interrupted.
  }
}

function readActiveBenchmarkSessionId(projectId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(activeBenchmarkSessionKey(projectId));
  } catch {
    return null;
  }
}

function writeActiveBenchmarkSessionId(projectId: string, sessionId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(activeBenchmarkSessionKey(projectId), sessionId);
  } catch {
    // localStorage may be unavailable.
  }
}

function buildSessionTitle(requirement: string, rubric: BenchmarkRubricSet | null): string {
  if (rubric?.title.trim()) return rubric.title.trim();
  const firstLine = requirement.trim().split(/\n+/)[0]?.trim();
  if (!firstLine) return "新评测任务";
  return firstLine.length > 22 ? `${firstLine.slice(0, 22)}...` : firstLine;
}

function buildSessionDescription(requirement: string, rubric: BenchmarkRubricSet | null): string {
  if (rubric) {
    const metricCount = rubric.modules.reduce((sum, module) => sum + module.metrics.length, 0);
    return `${rubric.modules.length} 个能力维度 · ${metricCount} 项指标`;
  }
  return requirement.trim() ? "已填写需求，等待生成评分标准" : "尚未生成评分标准";
}

/**
 * Inline title editor for benchmark session names.
 */
function SessionTitleField(props: {
  title: string;
  onRename: (title: string) => void;
  buttonClassName?: string;
  inputClassName?: string;
  placeholder?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(props.title);

  useEffect(() => {
    if (!editing) setDraft(props.title);
  }, [editing, props.title]);

  function commitRename() {
    const trimmed = draft.trim();
    if (trimmed) props.onRename(trimmed);
    setEditing(false);
  }

  if (editing) {
    return (
      <input
        className={props.inputClassName ?? styles.titleRenameInput}
        value={draft}
        placeholder={props.placeholder ?? "输入评测任务名称"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitRename}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commitRename();
          }
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft(props.title);
            setEditing(false);
          }
        }}
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      className={props.buttonClassName ?? styles.titleRenameButton}
      title="点击重命名评测任务"
      onClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      {props.title}
    </button>
  );
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

// ─── NotebookLayout ─────────────────────────────────────────────────

export function NotebookLayout() {
  const { activeProject, activeProjectId } = useProject();
  const fallbackSessionRef = useRef<BenchmarkSession | null>(null);
  if (!fallbackSessionRef.current) {
    fallbackSessionRef.current = createBenchmarkSession(activeProjectId);
  }

  // ── Panel visibility ─
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightPanelWidth, setRightPanelWidth] = useState(380);
  const [resizingRightPanel, setResizingRightPanel] = useState(false);

  // ── Copilot chat state ─
  const [activeCopilotTab, setActiveCopilotTab] = useState<CopilotTabId>("rubric");
  const [copilotInput, setCopilotInput] = useState("");
  const [copilotTurns, setCopilotTurns] = useState<ChatTurn[]>(DEFAULT_COPILOT_TURNS);
  const [copilotRunning, setCopilotRunning] = useState(false);
  const [autofindInput, setAutofindInput] = useState("");
  const [autofindTurns, setAutofindTurns] = useState<ChatTurn[]>(DEFAULT_AUTOFIND_TURNS);
  const [autofindState, setAutofindState] = useState<AutoFindWorkflowState | null>(null);
  const [autofindRunning, setAutofindRunning] = useState(false);
  const copilotInputRef = useRef<HTMLTextAreaElement>(null);
  const autofindInputRef = useRef<HTMLTextAreaElement>(null);
  const copilotScrollRef = useRef<HTMLDivElement>(null);

  // ── Benchmark state ─
  const [sessions, setSessions] = useState<BenchmarkSession[]>(() => [fallbackSessionRef.current!]);
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(() => fallbackSessionRef.current!.id);
  const [sessionHydrated, setSessionHydrated] = useState(false);
  const [requirement, setRequirement] = useState(() => fallbackSessionRef.current!.requirement);
  const [rubric, setRubric] = useState<BenchmarkRubricSet | null>(() => fallbackSessionRef.current!.rubric);
  const [dataset, setDataset] = useState<BenchmarkDatasetSnapshot | null>(() => fallbackSessionRef.current!.dataset);
  const [dataUploadState, setDataUploadState] = useState<BenchmarkDataUploadState>("idle");
  const [dataUploadError, setDataUploadError] = useState("");
  const [runResult, setRunResult] = useState<BenchmarkRunResult | null>(null);
  const [progress, setProgress] = useState<BenchmarkProgressSnapshot | null>(null);
  const [runHistory, setRunHistory] = useState<BenchmarkRunHistoryItem[]>([]);
  const [humanReviewRecords, setHumanReviewRecords] = useState<BenchmarkHumanReviewRecord[]>([]);
  const [runError, setRunError] = useState("");
  const [running, setRunning] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("rubric");
  const runStreamRef = useRef<EventSource | null>(null);

  // ── Knowledge files ─
  const [knowledgeFiles, setKnowledgeFiles] = useState<KnowledgeFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? null;
  const title = activeSession?.title ?? "新评测任务";
  const description = `${activeProject.name} · ${activeSession ? formatSessionTime(activeSession.updatedAt) : "未保存"}`;

  const applySession = useCallback((session: BenchmarkSession) => {
    setActiveSessionIdState(session.id);
    setRequirement(session.requirement);
    setRubric(session.rubric);
    setDataset(session.dataset ?? null);
    setDataUploadState(session.dataset ? "ready" : "idle");
    setDataUploadError("");
    setViewMode(session.viewMode);
    setCopilotTurns(session.copilotTurns);
    setSelectedFileId(session.selectedFileId);
    setRunning(false);
    setProgress(session.progress ?? session.runHistory?.[0]?.progress ?? null);
    setRunResult(session.runResult ?? session.runHistory?.[0]?.result ?? null);
    setRunHistory(session.runHistory ?? []);
    setHumanReviewRecords(session.humanReviewRecords ?? []);
    setAutofindState(session.autofindState ?? null);
    setAutofindTurns(
      Array.isArray(session.autofindTurns) && session.autofindTurns.length > 0
        ? session.autofindTurns
        : [...DEFAULT_AUTOFIND_TURNS],
    );
    setAutofindInput("");
    setAutofindRunning(false);
    setRunError("");
  }, []);

  useEffect(() => {
    return () => {
      runStreamRef.current?.close();
    };
  }, []);

  // ── Hydrate sessions for active project ─
  useEffect(() => {
    let cancelled = false;

    async function hydrateSessions() {
      setSessionHydrated(false);
      const remote = await fetchRemoteBenchmarkSessions(activeProjectId);
      if (cancelled) return;

      const localSessions = readBenchmarkSessions(activeProjectId);
      const storedSessions = remote?.sessions.length ? remote.sessions : localSessions;
      const nextSessions = storedSessions.length > 0 ? storedSessions : [createBenchmarkSession(activeProjectId)];
      const storedActiveId = remote?.activeSessionId ?? readActiveBenchmarkSessionId(activeProjectId);
      const nextActive = nextSessions.find((session) => session.id === storedActiveId) ?? nextSessions[0];

      setSessions(nextSessions);
      applySession(nextActive);
      writeBenchmarkSessions(activeProjectId, nextSessions);
      writeActiveBenchmarkSessionId(activeProjectId, nextActive.id);
      void persistRemoteBenchmarkSessions(activeProjectId, nextSessions, nextActive.id);
      setSessionHydrated(true);
    }

    void hydrateSessions();
    return () => {
      cancelled = true;
    };
  }, [activeProjectId, applySession]);

  // ── Persist active session state ─
  useEffect(() => {
    if (!sessionHydrated || !activeSessionId) return;

    setSessions((prev) => {
      const now = new Date().toISOString();
      const next = prev.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              title: session.titleManuallySet ? session.title : buildSessionTitle(requirement, rubric),
              description: buildSessionDescription(requirement, rubric),
              updatedAt: now,
              requirement,
              useLlm: true,
              rubric,
              dataset,
              viewMode,
              copilotTurns,
              selectedFileId,
              runResult,
              progress,
              runHistory,
              humanReviewRecords,
              autofindState,
              autofindTurns,
            }
          : session,
      );
      writeBenchmarkSessions(activeProjectId, next);
      writeActiveBenchmarkSessionId(activeProjectId, activeSessionId);
      void persistRemoteBenchmarkSessions(activeProjectId, next, activeSessionId);
      return next;
    });
  }, [
    activeProjectId,
    activeSessionId,
    autofindState,
    autofindTurns,
    copilotTurns,
    dataset,
    humanReviewRecords,
    requirement,
    rubric,
    runHistory,
    runResult,
    progress,
    selectedFileId,
    sessionHydrated,
    viewMode,
  ]);

  // ── Keyboard: Space toggles right panel ─
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (e.key !== " ") return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active?.getAttribute("contenteditable") === "true"
      ) {
        return;
      }
      const selection = window.getSelection()?.toString();
      if (selection && selection.length > 0) return;
      e.preventDefault();
      setRightOpen((prev) => !prev);
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // ── Auto-scroll copilot ─
  useEffect(() => {
    const el = copilotScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [copilotTurns, copilotRunning, autofindTurns, autofindRunning, activeCopilotTab]);

  useEffect(() => {
    if (!resizingRightPanel) return;

    function handleMouseMove(event: MouseEvent) {
      const nextWidth = Math.max(300, Math.min(620, window.innerWidth - event.clientX));
      setRightPanelWidth(nextWidth);
    }

    function handleMouseUp() {
      setResizingRightPanel(false);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingRightPanel]);

  // ── Fetch knowledge files ─
  useEffect(() => {
    fetchKnowledgeFiles();
  }, []);

  async function fetchKnowledgeFiles() {
    try {
      const res = await fetch("/api/benchmarks/knowledge?userId=default");
      const data = (await res.json()) as { files: KnowledgeFile[] };
      setKnowledgeFiles(data.files ?? []);
    } catch {
      // ignore
    }
  }

  // ── Upload file ─
  async function handleUpload(filesList: FileList | null) {
    if (!filesList || filesList.length === 0) return;
    setUploading(true);
    for (const file of Array.from(filesList)) {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("userId", "default");
      try {
        await fetch("/api/benchmarks/knowledge", { method: "POST", body: formData });
      } catch {
        // ignore
      }
    }
    setUploading(false);
    fetchKnowledgeFiles();
  }

  // ── Delete file ─
  async function handleDelete(fileId: string) {
    if (!confirm("确定删除？")) return;
    try {
      await fetch(`/api/benchmarks/knowledge?userId=default&fileId=${fileId}`, {
        method: "DELETE",
      });
      fetchKnowledgeFiles();
    } catch {
      // ignore
    }
  }

  function handleCreateSession() {
    const session = createBenchmarkSession(activeProjectId);
    const nextSessions = [session, ...sessions];
    setSessionHydrated(false);
    setSessions(nextSessions);
    writeBenchmarkSessions(activeProjectId, nextSessions);
    writeActiveBenchmarkSessionId(activeProjectId, session.id);
    void persistRemoteBenchmarkSessions(activeProjectId, nextSessions, session.id);
    applySession(session);
    setSessionHydrated(true);
    setViewMode("rubric");
  }

  function handleOpenSession(sessionId: string) {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session || session.id === activeSessionId) return;
    setSessionHydrated(false);
    writeActiveBenchmarkSessionId(activeProjectId, session.id);
    applySession(session);
    setSessionHydrated(true);
  }

  function renameSession(sessionId: string, nextTitle: string) {
    const trimmed = nextTitle.trim();
    if (!trimmed) return;
    const now = new Date().toISOString();
    setSessions((prev) => {
      const next = prev.map((session) =>
        session.id === sessionId
          ? { ...session, title: trimmed, titleManuallySet: true, updatedAt: now }
          : session,
      );
      writeBenchmarkSessions(activeProjectId, next);
      void persistRemoteBenchmarkSessions(activeProjectId, next, activeSessionId);
      return next;
    });
  }

  function handleDeleteSession(sessionId: string) {
    if (!confirm("确定删除这个评测任务？")) return;
    const remaining = sessions.filter((session) => session.id !== sessionId);
    const nextSessions = remaining.length > 0 ? remaining : [createBenchmarkSession(activeProjectId)];
    const nextActive = sessionId === activeSessionId
      ? nextSessions[0]
      : nextSessions.find((session) => session.id === activeSessionId) ?? nextSessions[0];

    setSessionHydrated(false);
    setSessions(nextSessions);
    writeBenchmarkSessions(activeProjectId, nextSessions);
    writeActiveBenchmarkSessionId(activeProjectId, nextActive.id);
    void persistRemoteBenchmarkSessions(activeProjectId, nextSessions, nextActive.id);
    applySession(nextActive);
    setSessionHydrated(true);
  }

  /**
   * Infer the ingest upload format from a selected benchmark data file.
   *
   * @param fileName Browser file name.
   * @returns Upload format supported by the ingest API.
   */
  function inferBenchmarkUploadFormat(fileName: string): UploadFormat {
    const extension = fileName.split(".").pop()?.toLowerCase();
    if (extension === "csv" || extension === "json" || extension === "jsonl" || extension === "txt" || extension === "md") {
      return extension;
    }
    return "txt";
  }

  /**
   * Upload and normalize the dataset used by the current benchmark run.
   *
   * @param file Browser file selected by the user.
   */
  async function handleBenchmarkDataFile(file: File) {
    const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
    if (!new Set(["csv", "json", "jsonl", "txt", "md"]).has(extension)) {
      setDataUploadState("error");
      setDataUploadError("文件类型不支持，请上传 csv、json、jsonl、txt 或 md。");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setDataUploadState("error");
      setDataUploadError("文件过大，请上传不超过 10MB 的评测数据。");
      return;
    }

    setDataUploadState("uploading");
    setDataUploadError("");
    setRunResult(null);
    setProgress(null);
    setRunHistory([]);
    setRunError("");
    try {
      const text = await file.text();
      const format = inferBenchmarkUploadFormat(file.name);
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, format, fileName: file.name }),
      });
      const result = (await response.json()) as Partial<IngestResponse> & { error?: string };
      if (!response.ok || !result.rawRows?.length || !result.ingestMeta) {
        throw new Error(result.error ?? "数据清洗失败，请检查字段或文本格式。");
      }

      const nextDataset: BenchmarkDatasetSnapshot = {
        fileName: result.fileName ?? file.name,
        format: result.format ?? format,
        rawRows: result.rawRows,
        previewTop20: result.previewTop20 ?? [],
        ingestMeta: result.ingestMeta,
        structuredTaskMetrics: result.structuredTaskMetrics,
        warnings: result.warnings ?? [],
        uploadedAt: new Date().toISOString(),
      };
      setDataset(nextDataset);
      setDataUploadState("ready");
    } catch (error) {
      setDataset(null);
      setDataUploadState("error");
      setDataUploadError(error instanceof Error ? error.message : "数据上传失败");
    }
  }

  /**
   * 将 CSV 文本通过 ingest 流程加载为当前评测数据集。
   *
   * @param csvText CSV 正文。
   * @param fileName 展示用文件名。
   */
  async function applyDatasetFromCsv(csvText: string, fileName: string) {
    setDataUploadState("uploading");
    setDataUploadError("");
    setRunResult(null);
    setProgress(null);
    setRunHistory([]);
    setRunError("");
    try {
      const response = await fetch("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: csvText, format: "csv", fileName }),
      });
      const result = (await response.json()) as Partial<IngestResponse> & { error?: string };
      if (!response.ok || !result.rawRows?.length || !result.ingestMeta) {
        throw new Error(result.error ?? "AutoFind 数据加载失败。");
      }
      setDataset({
        fileName: result.fileName ?? fileName,
        format: "csv",
        rawRows: result.rawRows,
        previewTop20: result.previewTop20 ?? [],
        ingestMeta: result.ingestMeta,
        structuredTaskMetrics: result.structuredTaskMetrics,
        warnings: result.warnings ?? [],
        uploadedAt: new Date().toISOString(),
      });
      setDataUploadState("ready");
    } catch (error) {
      setDataset(null);
      setDataUploadState("error");
      setDataUploadError(error instanceof Error ? error.message : "AutoFind 数据加载失败");
      throw error;
    }
  }

  /**
   * 组装 AutoFind 所需的 rubric 参考上下文。
   *
   * @returns 需求、评分标准生成对话与 rubric 摘要。
   */
  const buildAutoFindRubricContext = useCallback((): AutoFindRubricContext => {
    const rubricDialogue = copilotTurns
      .filter((turn): turn is Extract<ChatTurn, { kind: "user" | "ai" }> => turn.kind === "user" || turn.kind === "ai")
      .map((turn) => ({
        role: turn.kind === "user" ? ("user" as const) : ("assistant" as const),
        text: turn.text.trim(),
      }))
      .filter((turn) => turn.text.length > 0)
      .filter((turn, index) => {
        if (
          index === 0 &&
          turn.role === "assistant" &&
          turn.text === DEFAULT_COPILOT_TURNS[0]?.text
        ) {
          return false;
        }
        return true;
      });

    const metrics = rubric?.modules.flatMap((module) => module.metrics) ?? [];
    const approvedMetrics = metrics.filter((metric) => metric.approvalStatus === "approved");

    return {
      requirementText: requirement.trim(),
      rubricDialogue,
      rubricTitle: rubric?.title,
      rubricDescription: rubric?.description,
      rubricMetrics: (approvedMetrics.length > 0 ? approvedMetrics : metrics).map(
        (metric) => metric.displayName,
      ),
    };
  }, [copilotTurns, requirement, rubric]);

  /**
   * 打开 AutoFind 标签并启动数据工作流。
   */
  const handleAutoFindStart = useCallback(async () => {
    setRightOpen(true);
    setActiveCopilotTab("autofind");
    setAutofindRunning(true);
    setAutofindTurns([...DEFAULT_AUTOFIND_TURNS]);
    setAutofindState(null);
    const rubricContext = buildAutoFindRubricContext();
    try {
      const response = await fetch("/api/benchmarks/autofind", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          requirementText: requirement,
          rubricContext,
          state: null,
        }),
      });
      const data = (await response.json()) as BenchmarkAutoFindResponse;
      if (!response.ok || data.error) {
        throw new Error(data.error ?? "AutoFind 启动失败");
      }
      if (data.state) setAutofindState(data.state);
      if (data.reply) {
        setAutofindTurns((prev) => [...prev, { kind: "ai", text: data.reply! }]);
      }
    } catch (error) {
      setAutofindTurns((prev) => [
        ...prev,
        { kind: "error", text: error instanceof Error ? error.message : "AutoFind 启动失败" },
      ]);
    } finally {
      setAutofindRunning(false);
    }
  }, [buildAutoFindRubricContext, requirement]);

  /**
   * 向 AutoFind 工作流发送用户消息或快捷动作。
   *
   * @param message 用户输入；为空时使用输入框内容。
   */
  const sendAutoFind = useCallback(
    async (message?: string) => {
      const text = (message ?? autofindInput).trim();
      if (!text || autofindRunning) return;

      setAutofindTurns((prev) => [...prev, { kind: "user", text }]);
      setAutofindInput("");
      setAutofindRunning(true);

      try {
        const action =
          /开始|搜索|检索|find|search/i.test(text) ? "search"
          : /保存|save/i.test(text) ? "save"
          : "chat";

        const response = await fetch("/api/benchmarks/autofind", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            message: text,
            requirementText: requirement,
            rubricContext: buildAutoFindRubricContext(),
            state: autofindState,
          }),
        });
        const data = (await response.json()) as BenchmarkAutoFindResponse;
        if (!response.ok || data.error) {
          throw new Error(data.error ?? "AutoFind 调用失败");
        }
        if (data.state) setAutofindState(data.state);

        if (/应用|加载|导入|apply/i.test(text) && data.state?.csvText) {
          const fileName = data.state.fileName ?? "companion-autofind-20sessions.csv";
          if (data.state.phase !== "saved") {
            await fetch("/api/benchmarks/autofind", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "save", state: data.state }),
            });
          }
          await applyDatasetFromCsv(data.state.csvText, fileName);
          setAutofindTurns((prev) => [
            ...prev,
            {
              kind: "ai",
              text: `${data.reply ?? "已应用数据集。"}\n\n已加载到评测数据区，可直接开始评测。`,
            },
          ]);
          return;
        }

        setAutofindTurns((prev) => [...prev, { kind: "ai", text: data.reply ?? "已处理。" }]);
      } catch (error) {
        setAutofindTurns((prev) => [
          ...prev,
          { kind: "error", text: error instanceof Error ? error.message : "AutoFind 请求失败" },
        ]);
      } finally {
        setAutofindRunning(false);
      }
    },
    [autofindInput, autofindRunning, autofindState, buildAutoFindRubricContext, requirement],
  );

  async function handleRunBenchmark(resumeRunId?: string) {
    const safeResumeRunId = typeof resumeRunId === "string" ? resumeRunId : undefined;
    if (!rubric) {
      setRunError("请先生成评分标准。");
      setViewMode("progress");
      return;
    }

    const approvedMetricCount = rubric.modules
      .flatMap((module) => module.metrics)
      .filter((metric) => metric.approvalStatus === "approved").length;
    if (approvedMetricCount === 0) {
      setRunError("至少确认一个指标后才能运行评测。");
      setViewMode("progress");
      return;
    }
    if (!dataset?.rawRows.length) {
      setRunError("请先上传评测数据，并完成字段对齐和清洗。");
      setViewMode("rubric");
      return;
    }

    runStreamRef.current?.close();
    setRunning(true);
    setProgress(null);
    setRunResult(null);
    setRunError("");
    setViewMode("progress");

    try {
      const response = await fetch("/api/benchmarks/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requirementText: requirement,
          rubric,
          dataset,
          resumeRunId: safeResumeRunId,
        }),
      });
      const data = (await response.json()) as StartBenchmarkRunResponse;
      if (!response.ok || !data.runId) {
        throw new Error(data.error ?? "启动评测失败");
      }

      const source = new EventSource(`/api/benchmarks/run-stream?runId=${encodeURIComponent(data.runId)}`);
      runStreamRef.current = source;
      source.onmessage = (event) => {
        const snapshot = JSON.parse(event.data) as BenchmarkProgressSnapshot;
        setProgress(snapshot);
        if (snapshot.phase === "completed" && snapshot.result) {
          setRunResult(snapshot.result);
          setRunHistory((prev) => buildNextRunHistory(prev, snapshot.result!, snapshot));
          setRunning(false);
          setViewMode("result");
          source.close();
          runStreamRef.current = null;
        } else if (snapshot.phase === "failed") {
          setRunError(snapshot.error ?? "评测失败");
          setRunning(false);
          source.close();
          runStreamRef.current = null;
        }
      };
      source.onerror = () => {
        source.close();
        runStreamRef.current = null;
        void recoverBenchmarkRunStatus(data.runId!);
      };
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "启动评测失败");
      setRunning(false);
    }
  }

  async function recoverBenchmarkRunStatus(runId: string) {
    try {
      const response = await fetch(`/api/benchmarks/run-status?runId=${encodeURIComponent(runId)}`, {
        cache: "no-store",
      });
      const status = (await response.json()) as BenchmarkRunStatusResponse;
      if (!response.ok || status.error) {
        throw new Error(status.error ?? "无法恢复评测进度");
      }

      if (status.snapshot) {
        setProgress(status.snapshot);
        if (status.snapshot.phase === "completed" && status.snapshot.result) {
          setRunResult(status.snapshot.result);
          setRunHistory((prev) => buildNextRunHistory(prev, status.snapshot!.result!, status.snapshot!));
          setRunning(false);
          setViewMode("result");
          return;
        }
        if (status.snapshot.phase === "failed") {
          setRunError(status.snapshot.error ?? "评测失败");
          setRunning(false);
          return;
        }
      }

      setRunError(status.source === "none" ? "进度连接中断，且后端没有找到该 run 的状态。" : "进度连接中断，请稍后重试。");
      setRunning(false);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "进度连接中断，请稍后重试。");
      setRunning(false);
    }
  }

  // ── Copilot send ─
  const sendCopilot = useCallback(async () => {
    const text = copilotInput.trim();
    if (!text || copilotRunning) return;

    const nextTurns: ChatTurn[] = [...copilotTurns, { kind: "user", text }];
    setCopilotTurns(nextTurns);
    setCopilotInput("");
    setCopilotRunning(true);

    try {
      const messages = nextTurns.map((t) => ({
        role: (t.kind === "user" ? "user" : "assistant") as "user" | "assistant",
        content: t.text,
      }));

      const response = await fetch("/api/benchmarks/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          requirementText: requirement,
          rubric,
        }),
      });
      const data = (await response.json()) as BenchmarkRubricAgentResponse;

      if (!response.ok || data.error) {
        setCopilotTurns((prev) => [...prev, { kind: "error", text: data.error ?? "助手调用失败" }]);
      } else {
        if (typeof data.requirementText === "string") setRequirement(data.requirementText);
        if (data.rubric !== undefined) setRubric(data.rubric ? localizeRubricForDisplay(data.rubric) : null);
        setViewMode("rubric");
        setCopilotTurns((prev) => [...prev, { kind: "ai", text: data.reply ?? "已处理。" }]);
      }
    } catch {
      setCopilotTurns((prev) => [...prev, { kind: "error", text: "请求失败" }]);
    } finally {
      setCopilotRunning(false);
    }
  }, [copilotInput, copilotRunning, copilotTurns, requirement, rubric]);

  // ── Format bytes ─
  function formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / k ** i).toFixed(1))} ${sizes[i] ?? "B"}`;
  }

  function getFileIcon(type: string): string {
    switch (type) {
      case "text": return "文本";
      case "markdown": return "文档";
      case "json": return "数据";
      case "csv": return "表格";
      case "code": return "代码";
      case "pdf": return "文档";
      default: return "文件";
    }
  }

  // ── Render ─
  return (
    <div className={styles.notebookLayout}>
      {/* ═══════════════ HEADER ═══════════════ */}
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <Link href="/" className={styles.homeButton} title="返回主页">
            <span aria-hidden="true">←</span>
            主页
          </Link>
          <div className={styles.headerDivider} />
          {activeSessionId ? (
            <SessionTitleField
              title={title}
              buttonClassName={`${styles.titleRenameButton} ${styles.headerTitle}`}
              inputClassName={`${styles.titleRenameInput} ${styles.headerTitleInput}`}
              onRename={(nextTitle) => renameSession(activeSessionId, nextTitle)}
            />
          ) : (
            <span className={styles.headerTitle}>{title}</span>
          )}
          <span className={styles.headerSubtitle}>{description}</span>
        </div>
        <div className={styles.headerRight}>
          <ProjectMenu />
          <button
            className={`${styles.headerToggle} ${rightOpen ? styles.headerToggleActive : ""}`}
            onClick={() => setRightOpen((p) => !p)}
            title={rightOpen ? "收起助手" : "展开助手（空格键）"}
          >
            助手
            <span>{rightOpen ? "▶" : "◀"}</span>
          </button>
        </div>
      </header>

      {/* ═══════════════ MAIN ═══════════════ */}
      <div className={styles.main}>
        {!leftOpen && (
          <button
            className={styles.leftPanelRestore}
            type="button"
            onClick={() => setLeftOpen(true)}
            title="展开评测任务"
          >
            <span aria-hidden="true">▶</span>
            任务
          </button>
        )}

        {/* ── Left: Sources ─ */}
        <aside className={`${styles.leftPanel} ${leftOpen ? styles.panelOpen : styles.panelClosed}`}>
          <div className={styles.panelHeader}>
            <div className={styles.panelTitleGroup}>
              <button
                className={styles.panelCollapse}
                type="button"
                onClick={() => setLeftOpen(false)}
                title="收起评测任务"
              >
                <span aria-hidden="true">◀</span>
              </button>
              <h3>评测任务</h3>
            </div>
            <button className={styles.sessionCreate} type="button" onClick={handleCreateSession} aria-label="新建评测任务" title="新建评测任务">
              +
            </button>
          </div>

          <div className={styles.sessionList}>
            {sessions.map((session) => (
              <div
                key={session.id}
                className={`${styles.sessionItem} ${session.id === activeSessionId ? styles.sessionItemActive : ""}`}
                onClick={() => handleOpenSession(session.id)}
              >
                <div className={styles.sessionInfo}>
                  <SessionTitleField
                    title={session.title}
                    buttonClassName={`${styles.titleRenameButton} ${styles.sessionName}`}
                    inputClassName={styles.sessionRenameInput}
                    onRename={(nextTitle) => renameSession(session.id, nextTitle)}
                  />
                  <div className={styles.sessionMeta}>
                    {session.description} · {formatSessionTime(session.updatedAt)}
                  </div>
                </div>
                <button
                  className={styles.sessionDelete}
                  type="button"
                  title="删除评测任务"
                  onClick={(event) => {
                    event.stopPropagation();
                    handleDeleteSession(session.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className={styles.sourceSectionHeader}>
            <h3>知识库</h3>
            <span className={styles.panelCount}>{knowledgeFiles.length}</span>
          </div>

          <div className={styles.sourceList}>
            {knowledgeFiles.length === 0 && (
              <div className={styles.sourceEmpty}>
                暂无知识库文件
                <br />
                <small>拖拽文件到此处上传</small>
              </div>
            )}
            {knowledgeFiles.map((file) => (
              <div
                key={file.fileId}
                className={`${styles.sourceItem} ${selectedFileId === file.fileId ? styles.sourceItemActive : ""}`}
                onClick={() => setSelectedFileId(file.fileId === selectedFileId ? null : file.fileId)}
              >
                <div className={styles.sourceIcon}>{getFileIcon(file.fileType)}</div>
                <div className={styles.sourceInfo}>
                  <div className={styles.sourceName}>{file.fileName}</div>
                  <div className={styles.sourceMeta}>
                    {formatBytes(file.sizeBytes)}
                    {file.tags.length > 0 && ` · ${file.tags[0]}`}
                  </div>
                </div>
                <button
                  className={styles.sourceDelete}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(file.fileId);
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>

          <div className={styles.sourceUpload}>
            <label className={styles.uploadButton}>
              <input
                type="file"
                multiple
                style={{ display: "none" }}
                onChange={(e) => handleUpload(e.target.files)}
              />
              {uploading ? "上传中..." : "+ 添加文件"}
            </label>
          </div>
        </aside>

        {/* ── Center: Chat (评测工作台) ─ */}
        <main className={styles.centerPanel}>
          {/* View switcher */}
          <div className={styles.viewSwitcher}>
            <button
              className={viewMode === "rubric" ? styles.viewActive : ""}
              onClick={() => setViewMode("rubric")}
            >
              评分标准
            </button>
            <button
              className={viewMode === "progress" ? styles.viewActive : ""}
              onClick={() => setViewMode("progress")}
              disabled={!running && !progress}
            >
              评测进度
            </button>
            <button
              className={viewMode === "result" ? styles.viewActive : ""}
              onClick={() => setViewMode("result")}
              disabled={!runResult}
            >
              评测结果
            </button>
          </div>

          {/* Content area */}
          <div className={styles.centerContent}>
            {viewMode === "rubric" && (
              <RubricWorkspace
                rubric={rubric}
                onRubricChange={setRubric}
                onRun={handleRunBenchmark}
                taskTitle={title}
                requirement={requirement}
                onRequirementChange={setRequirement}
                dataset={dataset}
                dataUploadState={dataUploadState}
                dataUploadError={dataUploadError || runError}
                onDatasetFile={handleBenchmarkDataFile}
                onAutoFind={handleAutoFindStart}
              />
            )}
            {viewMode === "progress" && (
              <ProgressWorkspace
                progress={progress}
                running={running}
                error={runError}
                onContinue={() => progress?.runId && void handleRunBenchmark(progress.runId)}
                onRestart={() => void handleRunBenchmark()}
              />
            )}
            {viewMode === "result" && runResult && (
              <ResultWorkspace
                projectId={activeProjectId}
                result={runResult}
                rubric={rubric}
                history={runHistory}
                humanReviewRecords={humanReviewRecords}
                onHumanReviewRecordsChange={setHumanReviewRecords}
                onSelectRun={(item) => {
                  setRunResult(item.result);
                  setProgress(item.progress ?? null);
                  setViewMode("result");
                }}
              />
            )}
          </div>
        </main>

        {/* ── Right: Copilot Chat ─ */}
        {rightOpen && (
          <div
            className={`${styles.rightResizeHandle} ${resizingRightPanel ? styles.rightResizeHandleActive : ""}`}
            role="separator"
            aria-orientation="vertical"
            aria-label="调整助手栏宽度"
            onMouseDown={(event) => {
              event.preventDefault();
              setResizingRightPanel(true);
            }}
          />
        )}
        <aside
          className={`${styles.rightPanel} ${rightOpen ? styles.panelOpen : styles.panelClosed}`}
          style={rightOpen ? { width: rightPanelWidth } : undefined}
        >
          <div className={styles.panelHeader}>
            <h3>助手</h3>
            <div className={styles.copilotTabs}>
              <button
                type="button"
                className={activeCopilotTab === "rubric" ? styles.copilotTabActive : styles.copilotTab}
                onClick={() => setActiveCopilotTab("rubric")}
              >
                Rubric
              </button>
              <button
                type="button"
                className={activeCopilotTab === "autofind" ? styles.copilotTabActive : styles.copilotTab}
                onClick={() => setActiveCopilotTab("autofind")}
              >
                AutoFind
              </button>
            </div>
          </div>

          <div className={styles.chatMessages} ref={copilotScrollRef}>
            {activeCopilotTab === "rubric" ? (
              <>
                {requirement.trim() ? (
                  <div className={styles.requirementCard}>
                    <span>最初需求</span>
                    <p>{requirement.trim()}</p>
                  </div>
                ) : null}
                {copilotTurns.map((turn, i) => (
                  <div
                    key={`rubric-${i}`}
                    className={`${styles.chatBubble} ${
                      turn.kind === "user"
                        ? styles.chatBubbleUser
                        : turn.kind === "error"
                          ? styles.chatBubbleError
                          : styles.chatBubbleAi
                    }`}
                  >
                    {turn.kind === "user" ? turn.text : <MarkdownMessage text={turn.text} />}
                  </div>
                ))}
                {copilotRunning && (
                  <div className={styles.chatBubbleAi}>
                    <div className={styles.typingIndicator}>
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className={styles.requirementCard}>
                  <span>AutoFind 工作流</span>
                  <p>10 正样本 + 10 负样本 · 保存至 public/sample-data</p>
                </div>
                {autofindTurns.map((turn, i) => (
                  <div
                    key={`autofind-${i}`}
                    className={`${styles.chatBubble} ${
                      turn.kind === "user"
                        ? styles.chatBubbleUser
                        : turn.kind === "error"
                          ? styles.chatBubbleError
                          : styles.chatBubbleAi
                    }`}
                  >
                    {turn.kind === "user" ? turn.text : <MarkdownMessage text={turn.text} />}
                  </div>
                ))}
                {autofindRunning && (
                  <div className={styles.chatBubbleAi}>
                    <div className={styles.typingIndicator}>
                      <span />
                      <span />
                      <span />
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className={styles.chatInputArea}>
            {activeCopilotTab === "autofind" ? (
              <>
                <div className={styles.autofindQuickActions}>
                  {["开始搜索", "保存", "应用"].map((action) => (
                    <button
                      key={action}
                      type="button"
                      className={styles.autofindQuickAction}
                      disabled={autofindRunning}
                      onClick={() => void sendAutoFind(action)}
                    >
                      {action}
                    </button>
                  ))}
                </div>
                <textarea
                  ref={autofindInputRef}
                  value={autofindInput}
                  onChange={(e) => setAutofindInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      void sendAutoFind();
                    }
                  }}
                  rows={1}
                  placeholder="输入指令或补充检索条件…"
                />
                <button
                  onClick={() => void sendAutoFind()}
                  disabled={!autofindInput.trim() || autofindRunning}
                  className={styles.chatSendButton}
                >
                  ➤
                </button>
              </>
            ) : (
              <>
                <textarea
                  ref={copilotInputRef}
                  value={copilotInput}
                  onChange={(e) => setCopilotInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      sendCopilot();
                    }
                  }}
                  rows={1}
                />
                <button
                  onClick={sendCopilot}
                  disabled={!copilotInput.trim() || copilotRunning}
                  className={styles.chatSendButton}
                >
                  ➤
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════
// Sub-components
// ═════════════════════════════════════════════════════════════════════

function ProjectMenu() {
  const { projects, activeProject, switchProject, createProject, deleteProject } = useProject();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleMouseDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setCreating(false);
        setConfirmDeleteId(null);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [open]);

  function handleCreateProject() {
    const name = newName.trim();
    if (!name) return;
    const project = createProject(name);
    switchProject(project.id);
    setNewName("");
    setCreating(false);
    setOpen(false);
  }

  function handleDeleteProject(projectId: string, event: ReactMouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    if (confirmDeleteId === projectId) {
      deleteProject(projectId);
      setConfirmDeleteId(null);
      return;
    }
    setConfirmDeleteId(projectId);
  }

  return (
    <div className={styles.projectMenu} ref={menuRef}>
      <button
        className={`${styles.projectTrigger} ${open ? styles.projectTriggerOpen : ""}`}
        type="button"
        onClick={() => {
          setOpen((value) => !value);
          setCreating(false);
          setConfirmDeleteId(null);
        }}
      >
        <span>项目</span>
        <strong>{activeProject.name}</strong>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div className={styles.projectDropdown}>
          <div className={styles.projectList}>
            {projects.map((project) => {
              const active = project.id === activeProject.id;
              const confirming = confirmDeleteId === project.id;
              return (
                <div
                  key={project.id}
                  className={`${styles.projectItem} ${active ? styles.projectItemActive : ""}`}
                  onClick={() => {
                    switchProject(project.id);
                    setOpen(false);
                    setCreating(false);
                    setConfirmDeleteId(null);
                  }}
                >
                  <span className={styles.projectCheck}>{active ? "✓" : ""}</span>
                  <span className={styles.projectName}>{project.name}</span>
                  {project.id !== DEFAULT_PROJECT.id && (
                    <button
                      className={`${styles.projectDelete} ${confirming ? styles.projectDeleteConfirm : ""}`}
                      type="button"
                      onClick={(event) => handleDeleteProject(project.id, event)}
                    >
                      {confirming ? "确认" : "删"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {creating ? (
            <div className={styles.projectCreateForm}>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") handleCreateProject();
                  if (event.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                  }
                }}
                placeholder="项目名称"
                maxLength={48}
                autoFocus
              />
              <div className={styles.projectCreateActions}>
                <button type="button" onClick={handleCreateProject} disabled={!newName.trim()}>
                  创建
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              className={styles.projectCreateButton}
              type="button"
              onClick={() => setCreating(true)}
              aria-label="新建项目"
              title="新建项目"
            >
              +
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function RubricWorkspace(props: {
  rubric: BenchmarkRubricSet | null;
  onRubricChange: (r: BenchmarkRubricSet | null) => void;
  onRun: () => void;
  taskTitle: string;
  requirement: string;
  onRequirementChange: (value: string) => void;
  dataset: BenchmarkDatasetSnapshot | null;
  dataUploadState: BenchmarkDataUploadState;
  dataUploadError: string;
  onDatasetFile: (file: File) => void | Promise<void>;
  onAutoFind: () => void | Promise<void>;
}) {
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [highlightedMetricKey, setHighlightedMetricKey] = useState<string | null>(null);

  async function draftRubric() {
    setDrafting(true);
    setDraftError("");
    try {
      const res = await fetch("/api/benchmarks/rubric", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: props.taskTitle.trim() || "自定义评测任务",
          description: "根据当前业务需求生成可审核的通用评分标准",
          domain: "custom",
          requirementText: props.requirement,
          useLlm: true,
        }),
      });
      const data = (await res.json()) as {
        rubric?: BenchmarkRubricSet;
        error?: string;
        warnings?: string[];
      };
      if (!res.ok) {
        throw new Error(data.error ?? `生成评分标准失败（${res.status}）`);
      }
      if (data.rubric) {
        props.onRubricChange(localizeRubricForDisplay(cloneRubric(data.rubric)));
      }
      if (data.warnings?.length) {
        console.warn("[benchmark rubric]", data.warnings.join("；"));
        setDraftError(data.warnings.join("；"));
      }
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : "生成评分标准失败");
    } finally {
      setDrafting(false);
    }
  }

  async function redraftRubric() {
    if (
      props.rubric &&
      !confirm("重新生成将覆盖当前评分标准（含已确认指标）。是否继续？")
    ) {
      return;
    }
    await draftRubric();
  }

  const metrics = props.rubric?.modules.flatMap((m) => m.metrics) ?? [];
  const approvedMetrics = metrics.filter((m) => m.approvalStatus === "approved");
  const approvedMetricKeys = approvedMetrics.map((metric) => metric.metricKey);
  const referenceCount = countUniqueMetricReferences(metrics);
  const reviewedMetricKeys = new Set(approvedMetricKeys);
  const activeMetric = metrics.find((metric) => metric.metricKey === highlightedMetricKey) ?? metrics[0] ?? null;

  function toggleMetric(metricKey: string) {
    if (!props.rubric) return;
    props.onRubricChange(localizeRubricForDisplay(toggleMetricApproval(props.rubric, metricKey)));
  }

  function changeMetricWeight(metricKey: string, weight: number) {
    if (!props.rubric) return;
    props.onRubricChange(updateMetricWeight(props.rubric, metricKey, weight));
  }

  function changeMetricRubric(
    metricKey: string,
    patch: Partial<Omit<BenchmarkRubricMetric, "metricKey" | "capability">>,
  ) {
    if (!props.rubric) return;
    props.onRubricChange(updateMetricPatch(props.rubric, metricKey, patch));
  }

  function confirmAllMetrics() {
    if (!props.rubric) return;
    props.onRubricChange(localizeRubricForDisplay(approveRubricMetrics(props.rubric, metrics.map((metric) => metric.metricKey))));
  }

  return (
    <div className={styles.workspace}>
      {!props.rubric ? (
        <div className={styles.workspaceEmpty}>
          <h2>创建评测评分标准</h2>
          <p>定义评测维度，评估智能体框架的表现</p>
          <textarea
            className={styles.workspaceInput}
            value={props.requirement}
            onChange={(e) => props.onRequirementChange(e.target.value)}
            onInput={(e) => props.onRequirementChange(e.currentTarget.value)}
            placeholder="描述评测任务需求..."
            rows={6}
          />
          <div className={styles.workspaceActions}>
            <button className={styles.workspaceButton} onClick={draftRubric} disabled={drafting}>
              {drafting ? "生成中..." : "生成评分标准"}
            </button>
            {draftError && <p className={styles.datasetError}>{draftError}</p>}
          </div>
        </div>
      ) : (
        <div className={styles.workspace}>
          <div className={styles.rubricHeader}>
            <div>
              <h2>{props.rubric.title}</h2>
              <p>{props.rubric.description}</p>
              {props.rubric.researchSummary && (
                <p className={styles.rubricResearchSummary}>{props.rubric.researchSummary}</p>
              )}
            </div>
            <div className={styles.rubricHeaderMeta}>
              <span>{props.rubric.modules.length} 个能力维度</span>
              <span>{approvedMetrics.length} / {metrics.length} 项指标已确认</span>
              <span>{referenceCount} 个参考来源</span>
            </div>
          </div>

          <div className={styles.requirementPanel}>
            <div className={styles.requirementPanelHeader}>
              <strong>评测需求</strong>
              <span>修改后点击「重新生成评分标准」生效</span>
            </div>
            <textarea
              className={styles.requirementPanelInput}
              value={props.requirement}
              onChange={(event) => props.onRequirementChange(event.target.value)}
              placeholder="描述评测任务需求、业务约束与关注指标..."
              rows={3}
            />
          </div>

          <div className={styles.rubricGraphPanel}>
            <div className={styles.rubricGraphHeader}>
              <div>
                <strong>评分标准图谱</strong>
                <span>点击节点选择指标；按住 Ctrl / ⌘ 并滚动鼠标可缩放图谱</span>
              </div>
              <div className={styles.rubricGraphHeaderActions}>
                <button
                  className={styles.rubricHeaderActionSecondary}
                  type="button"
                  onClick={() => void redraftRubric()}
                  disabled={drafting || !props.requirement.trim()}
                  title={props.requirement.trim() ? "根据当前需求重新生成评分标准图谱" : "请先填写评测需求"}
                >
                  {drafting ? "生成中..." : "重新生成评分标准"}
                </button>
                <button className={styles.rubricHeaderAction} type="button" onClick={confirmAllMetrics}>
                  确认全部
                </button>
              </div>
            </div>
            {draftError && <p className={styles.datasetError}>{draftError}</p>}
            <RubricGraphView
              rubric={props.rubric}
              reviewedMetricKeys={reviewedMetricKeys}
              modifiedMetricKeys={new Set()}
              highlightedMetricKey={highlightedMetricKey}
              selectedMetricKeys={approvedMetricKeys}
              onToggleMetric={toggleMetric}
              onSelectMetric={setHighlightedMetricKey}
            />
          </div>

          <div className={styles.rubricEditorLayout}>
            <div className={styles.rubricModulesPanel}>
              <div className={styles.rubricPanelTitle}>
                <strong>指标清单</strong>
                <span>{metrics.length} 项</span>
              </div>
              <div className={styles.rubricModules}>
                {props.rubric.modules.map((module, moduleIndex) => (
                  <div key={`${module.capability}-${moduleIndex}`} className={styles.rubricModule}>
                    <div className={styles.rubricModuleHeader}>
                      <div>
                        <strong>{capabilityDisplayName(module.capability, module.displayName)}</strong>
                        <p>{module.description}</p>
                      </div>
                      <span>{module.metrics.filter((m) => m.approvalStatus === "approved").length}/{module.metrics.length}</span>
                    </div>
                    <div className={styles.rubricMetrics}>
                      {module.metrics.map((metric) => (
                        <MetricCard
                          key={metric.metricKey}
                          metric={metric}
                          selected={activeMetric?.metricKey === metric.metricKey}
                          highlighted={highlightedMetricKey === metric.metricKey}
                          onSelect={() => setHighlightedMetricKey(metric.metricKey)}
                          onToggle={() => toggleMetric(metric.metricKey)}
                          onWeightChange={(weight) => changeMetricWeight(metric.metricKey, weight)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className={styles.metricInspectorPanel}>
              {activeMetric ? (
                <MetricInspector
                  key={activeMetric.metricKey}
                  metric={activeMetric}
                  moduleName={
                    props.rubric.modules.find((module) =>
                      module.metrics.some((metric) => metric.metricKey === activeMetric.metricKey),
                    )?.displayName ?? "能力维度"
                  }
                  onToggle={() => toggleMetric(activeMetric.metricKey)}
                  onWeightChange={(weight) => changeMetricWeight(activeMetric.metricKey, weight)}
                  onRubricChange={(patch) => changeMetricRubric(activeMetric.metricKey, patch)}
                />
              ) : (
                <div className={styles.metricInspectorEmpty}>
                  <strong>暂无指标</strong>
                  <span>可以让右侧 Agent 生成或调整评分标准。</span>
                </div>
              )}
            </div>
          </div>

          <BenchmarkDatasetPanel
            dataset={props.dataset}
            uploadState={props.dataUploadState}
            error={props.dataUploadError}
            approvedMetricCount={approvedMetrics.length}
            onDatasetFile={props.onDatasetFile}
            onAutoFind={props.onAutoFind}
          />

          <div className={styles.rubricActions}>
            <button
              className={styles.workspaceButton}
              onClick={() => void props.onRun()}
              disabled={approvedMetrics.length === 0 || !props.dataset?.rawRows.length}
            >
              开始评测
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function BenchmarkDatasetPanel(props: {
  dataset: BenchmarkDatasetSnapshot | null;
  uploadState: BenchmarkDataUploadState;
  error: string;
  approvedMetricCount: number;
  onDatasetFile: (file: File) => void | Promise<void>;
  onAutoFind: () => void | Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const redaction = props.dataset?.ingestMeta.piiRedaction;
  const canRun = props.approvedMetricCount > 0 && Boolean(props.dataset?.rawRows.length);

  /**
   * Forward the selected file to the benchmark data ingest flow.
   *
   * @param event File input change event.
   */
  async function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await props.onDatasetFile(file);
    event.target.value = "";
  }

  return (
    <div className={styles.datasetPanel}>
      <div className={styles.datasetHeader}>
        <div className={styles.datasetHeaderIntro}>
          <strong>评测数据</strong>
          <span>确认指标框架后上传数据，系统会复用字段对齐、清洗、脱敏和样本切分流程。</span>
        </div>
        <div className={styles.datasetHeaderActions}>
          <button
            type="button"
            className={styles.datasetUploadButton}
            onClick={() => void props.onAutoFind()}
            disabled={props.uploadState === "uploading"}
            title="在右侧 AutoFind 标签中自动检索 10 正 + 10 负样本"
          >
            AutoFind
          </button>
          <label className={styles.datasetUploadButton}>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.json,.jsonl,.txt,.md"
              onChange={handleInputChange}
              disabled={props.uploadState === "uploading"}
            />
            {props.uploadState === "uploading" ? "清洗中..." : props.dataset ? "重新上传" : "上传数据"}
          </label>
        </div>
      </div>

      {props.dataset ? (
        <>
          <div className={styles.datasetSummaryGrid}>
            <div>
              <span>文件</span>
              <strong>{props.dataset.fileName}</strong>
            </div>
            <div>
              <span>消息数</span>
              <strong>{props.dataset.ingestMeta.rows}</strong>
            </div>
            <div>
              <span>会话数</span>
              <strong>{props.dataset.ingestMeta.sessions}</strong>
            </div>
            <div>
              <span>时间戳</span>
              <strong>{props.dataset.ingestMeta.hasTimestamp ? "完整" : "有缺失"}</strong>
            </div>
            <div>
              <span>脱敏</span>
              <strong>{redaction?.redactedFields ? `${redaction.redactedFields} 处` : "无变更"}</strong>
            </div>
            <div>
              <span>状态</span>
              <strong>{canRun ? "可评测" : "等待确认指标"}</strong>
            </div>
          </div>

          {props.dataset.warnings.length > 0 && (
            <div className={styles.datasetWarnings}>
              {props.dataset.warnings.map((warning) => (
                <span key={warning}>{warning}</span>
              ))}
            </div>
          )}

          {props.dataset.previewTop20.length > 0 && (
            <pre className={styles.datasetPreview}>
              {props.dataset.previewTop20.slice(0, 6).join("\n")}
            </pre>
          )}
        </>
      ) : (
        <div className={styles.datasetEmpty}>
          <span>{props.approvedMetricCount > 0 ? "等待上传评测数据" : "请先确认至少一个评测指标"}</span>
          <p>支持 csv、json、jsonl、txt、md。上传后会生成规范化样本，再进入评测器。</p>
        </div>
      )}

      {props.error && <div className={styles.datasetError}>{props.error}</div>}
    </div>
  );
}

function MetricCard(props: {
  metric: BenchmarkRubricMetric;
  selected: boolean;
  highlighted: boolean;
  onSelect: () => void;
  onToggle: () => void;
  onWeightChange: (weight: number) => void;
}) {
  const [editingWeight, setEditingWeight] = useState(false);
  const [weightDraft, setWeightDraft] = useState(String(props.metric.weight));
  const { metric } = props;
  const approved = metric.approvalStatus === "approved";
  const references = metricReferences(metric);

  function commitWeight() {
    const next = clampMetricWeight(Number(weightDraft));
    props.onWeightChange(next);
    setWeightDraft(String(next));
    setEditingWeight(false);
  }

  return (
    <div
      className={`${styles.metricCard} ${approved ? styles.metricApproved : ""} ${props.selected ? styles.metricSelected : ""} ${props.highlighted ? styles.metricHighlighted : ""}`}
      onClick={props.onSelect}
    >
      <div className={styles.metricCardContent}>
        <div className={styles.metricCardHeader}>
          <span className={styles.metricKey}>{approved ? "已确认" : "待确认"}</span>
          <span className={styles.metricWeight}>权重 {metric.weight}</span>
        </div>
        <div className={styles.metricName}>{metricDisplayName(metric)}</div>
        <p>{metricDescriptionZh(metric)}</p>
        <div className={styles.metricCardFooter}>
          <span>{evaluatorDisplayName(metric.evaluatorType)}</span>
          <span>阈值 {metric.scale.passThreshold}</span>
          {references.length > 0 && <span>依据 {references.length}</span>}
        </div>
      </div>
      <div className={styles.metricActions} onClick={(event) => event.stopPropagation()}>
        {editingWeight ? (
          <div className={styles.metricWeightEditor}>
            <button type="button" onClick={() => setWeightDraft(String(clampMetricWeight(Number(weightDraft) - 1)))}>
              -
            </button>
            <input
              type="number"
              min={1}
              max={10}
              value={weightDraft}
              onChange={(event) => setWeightDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitWeight();
                if (event.key === "Escape") setEditingWeight(false);
              }}
            />
            <button type="button" onClick={() => setWeightDraft(String(clampMetricWeight(Number(weightDraft) + 1)))}>
              +
            </button>
            <button type="button" className={styles.metricWeightSave} onClick={commitWeight}>
              保存
            </button>
          </div>
        ) : (
          <button
            className={styles.metricWeightEditButton}
            type="button"
            onClick={() => {
              setWeightDraft(String(metric.weight));
              setEditingWeight(true);
            }}
          >
            改权重
          </button>
        )}
        <button
          className={approved ? styles.metricConfirmSecondary : styles.metricConfirmButton}
          type="button"
          onClick={props.onToggle}
        >
          {approved ? "取消确认" : "确认指标"}
        </button>
      </div>
    </div>
  );
}

function MetricInspector(props: {
  metric: BenchmarkRubricMetric;
  moduleName: string;
  onToggle: () => void;
  onWeightChange: (weight: number) => void;
  onRubricChange: (patch: Partial<Omit<BenchmarkRubricMetric, "metricKey" | "capability">>) => void;
}) {
  const [editingWeight, setEditingWeight] = useState(false);
  const [weightDraft, setWeightDraft] = useState(String(props.metric.weight));
  const { metric } = props;
  const approved = metric.approvalStatus === "approved";
  const rubricForm = metric.config?.rubricForm?.length ? metric.config.rubricForm : defaultMetricRubricForm(metric);
  const references = metricReferences(metric);

  function commitWeight() {
    const next = clampMetricWeight(Number(weightDraft));
    props.onWeightChange(next);
    setWeightDraft(String(next));
    setEditingWeight(false);
  }

  function updateRubricFormLevel(index: number, field: "score" | "label" | "description", value: string) {
    const next = rubricForm.map((level, levelIndex) =>
      levelIndex === index
        ? {
            ...level,
            [field]: field === "score" ? Number(value) : value,
          }
        : level,
    );
    props.onRubricChange({
      config: {
        ...metric.config,
        rubricForm: next,
      },
    });
  }

  return (
    <div className={styles.metricInspector}>
      <div className={styles.metricInspectorHeader}>
        <div>
          <span>{props.moduleName}</span>
          <h3>{metricDisplayName(metric)}</h3>
        </div>
        <button
          className={approved ? styles.metricConfirmSecondary : styles.metricConfirmButton}
          type="button"
          onClick={props.onToggle}
        >
          {approved ? "取消确认" : "确认指标"}
        </button>
      </div>

      <div className={styles.metricInspectorMeta}>
        <span>{evaluatorDisplayName(metric.evaluatorType)}</span>
        <span>分值 {metric.scale.min}-{metric.scale.max}</span>
        <span>阈值 {metric.scale.passThreshold}</span>
        <span>{metric.evidenceRequired ? "需要证据" : "无需证据"}</span>
        <span>{references.length > 0 ? `依据 ${references.length}` : "依据待补充"}</span>
      </div>

      <MetricReferenceList references={references} />

      <div className={styles.metricInspectorWeight}>
        <strong>权重</strong>
        {editingWeight ? (
          <div className={styles.metricWeightEditor}>
            <button type="button" onClick={() => setWeightDraft(String(clampMetricWeight(Number(weightDraft) - 1)))}>
              -
            </button>
            <input
              type="number"
              min={1}
              max={10}
              value={weightDraft}
              onChange={(event) => setWeightDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitWeight();
                if (event.key === "Escape") setEditingWeight(false);
              }}
            />
            <button type="button" onClick={() => setWeightDraft(String(clampMetricWeight(Number(weightDraft) + 1)))}>
              +
            </button>
            <button type="button" className={styles.metricWeightSave} onClick={commitWeight}>
              保存
            </button>
          </div>
        ) : (
          <button
            className={styles.metricWeightPill}
            type="button"
            onClick={() => {
              setWeightDraft(String(metric.weight));
              setEditingWeight(true);
            }}
          >
            {metric.weight}
          </button>
        )}
      </div>

      <div className={styles.metricRubricForm}>
        <div className={styles.metricRubricFormHeader}>
          <strong>评分 Rubric 表单</strong>
          <span>编辑后会同步用于评测判断</span>
        </div>

        <label className={styles.metricFormField}>
          <span>指标说明</span>
          <textarea
            value={metric.description}
            rows={2}
            onChange={(event) => props.onRubricChange({ description: event.target.value })}
          />
        </label>

        <label className={styles.metricFormField}>
          <span>评分准则</span>
          <textarea
            value={metric.config?.criteria ?? ""}
            rows={4}
            onChange={(event) =>
              props.onRubricChange({
                config: {
                  ...metric.config,
                  criteria: event.target.value,
                  rubricForm,
                },
              })
            }
          />
        </label>

        <div className={styles.metricFormGrid}>
          <label className={styles.metricFormField}>
            <span>评估方式</span>
            <select
              value={metric.evaluatorType}
              onChange={(event) =>
                props.onRubricChange({
                  evaluatorType: event.target.value as BenchmarkRubricMetric["evaluatorType"],
                })
              }
            >
              {EVALUATOR_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.metricFormField}>
            <span>通过阈值</span>
            <input
              type="number"
              min={metric.scale.min}
              max={metric.scale.max}
              value={metric.scale.passThreshold}
              onChange={(event) =>
                props.onRubricChange({
                  scale: {
                    ...metric.scale,
                    passThreshold: Number(event.target.value),
                  },
                })
              }
            />
          </label>
        </div>

        <div className={styles.metricFormChecks}>
          <label>
            <input
              type="checkbox"
              checked={metric.evidenceRequired}
              onChange={(event) => props.onRubricChange({ evidenceRequired: event.target.checked })}
            />
            <span>需要证据</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={metric.humanApprovalRequired}
              onChange={(event) => props.onRubricChange({ humanApprovalRequired: event.target.checked })}
            />
            <span>需要人工复核</span>
          </label>
        </div>

        <div className={styles.metricScoreLevels}>
          {rubricForm.map((level, index) => (
            <div key={`${level.score}-${index}`} className={styles.metricScoreLevel}>
              <input
                type="number"
                min={metric.scale.min}
                max={metric.scale.max}
                value={level.score}
                onChange={(event) => updateRubricFormLevel(index, "score", event.target.value)}
                aria-label="分值"
              />
              <input
                value={level.label}
                onChange={(event) => updateRubricFormLevel(index, "label", event.target.value)}
                aria-label="等级"
              />
              <textarea
                value={level.description}
                rows={2}
                onChange={(event) => updateRubricFormLevel(index, "description", event.target.value)}
                aria-label="评分说明"
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MetricReferenceList(props: { references: BenchmarkMetricReference[] }) {
  if (props.references.length === 0) {
    return (
      <div className={styles.metricReferencePanel}>
        <div className={styles.metricReferenceHeader}>
          <strong>参考依据</strong>
          <span>待补充</span>
        </div>
        <p className={styles.metricReferenceEmpty}>该指标还没有绑定论文、公开 benchmark 或标准来源。</p>
      </div>
    );
  }

  return (
    <div className={styles.metricReferencePanel}>
      <div className={styles.metricReferenceHeader}>
        <strong>参考依据</strong>
        <span>{props.references.length} 项</span>
      </div>
      <div className={styles.metricReferenceList}>
        {props.references.map((reference, index) => (
          <article key={`${reference.referenceId ?? reference.title}-${index}`} className={styles.metricReferenceItem}>
            <div className={styles.metricReferenceItemHeader}>
              {reference.url ? (
                <a href={reference.url} target="_blank" rel="noreferrer">
                  {reference.referenceId ?? reference.title}
                </a>
              ) : (
                <strong>{reference.referenceId ?? reference.title}</strong>
              )}
              <span>{referenceMeta(reference)}</span>
            </div>
            <div className={styles.metricReferenceTitle}>{reference.title}</div>
            <p>{reference.relevance}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function ProgressWorkspace(props: {
  progress: BenchmarkProgressSnapshot | null;
  running: boolean;
  error: string;
  onContinue: () => void;
  onRestart: () => void;
}) {
  if (props.error && !props.progress) {
    return (
      <div className={styles.workspaceEmpty}>
        <h2>评测启动失败</h2>
        <p>{props.error}</p>
        <button type="button" className={styles.progressPrimaryButton} onClick={props.onRestart}>
          重新评测
        </button>
      </div>
    );
  }

  if (!props.progress) {
    return (
      <div className={styles.workspaceEmpty}>
        <div className={styles.spinner} />
        <p>{props.running ? "正在启动评测..." : "尚未开始评测"}</p>
      </div>
    );
  }

  const pct = props.progress.totalMetrics > 0
    ? Math.round((props.progress.evaluatedMetrics / props.progress.totalMetrics) * 100)
    : 0;
  const phaseLabel: Record<BenchmarkProgressSnapshot["phase"], string> = {
    preparing: "准备中",
    ingesting: "数据接入",
    building_cases: "构建案例",
    submitting: "生成输出",
    evaluating: "指标评审",
    completed: "完成",
    failed: "失败",
  };

  return (
    <div className={styles.workspace}>
      <div className={styles.progressHeader}>
        <div>
          <h2>评测进度</h2>
          {props.progress.updatedAt && <p>最近更新: {formatSessionTime(props.progress.updatedAt)}</p>}
        </div>
        <span className={styles.progressPhase}>{phaseLabel[props.progress.phase]}</span>
      </div>

      {(props.progress.phase === "failed" || props.error) && (
        <div className={styles.progressFailurePanel}>
          <div>
            <strong>评测已中断</strong>
            <p>{props.progress.error || props.error || "后端评测进程中断，请继续或重新运行。"}</p>
            <span>
              已完成 {props.progress.completedSubmissions}/{props.progress.totalSubmissions} 个被测输出，
              {props.progress.evaluatedMetrics}/{props.progress.totalMetrics} 个指标评审。继续评测会优先复用已落盘的结果。
            </span>
          </div>
          <div className={styles.progressFailureActions}>
            <button type="button" className={styles.progressPrimaryButton} onClick={props.onContinue} disabled={props.running}>
              继续评测
            </button>
            <button type="button" className={styles.progressSecondaryButton} onClick={props.onRestart} disabled={props.running}>
              从头重跑
            </button>
          </div>
        </div>
      )}

      <div className={styles.progressBar}>
        <div className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>
      <div className={styles.progressStats}>
        <span>{props.progress.completedSubmissions + props.progress.failedSubmissions} / {props.progress.totalSubmissions} 提交</span>
        <span>{props.progress.evaluatedMetrics} / {props.progress.totalMetrics} 指标</span>
      </div>

      {props.progress.datasetSummary && (
        <div className={styles.progressDatasetGrid}>
          <div>
            <span>数据文件</span>
            <strong>{props.progress.datasetSummary.fileName ?? "已上传数据"}</strong>
          </div>
          <div>
            <span>清洗后消息</span>
            <strong>{props.progress.datasetSummary.rows}</strong>
          </div>
          <div>
            <span>原始会话</span>
            <strong>{props.progress.datasetSummary.sessions}</strong>
          </div>
          <div>
            <span>评测案例</span>
            <strong>{props.progress.datasetSummary.sampledCaseCount}</strong>
          </div>
        </div>
      )}

      {props.progress.activeAnalysis && (
        <div className={styles.progressAnalysis}>
          <strong>当前分析过程</strong>
          <p>{props.progress.activeAnalysis}</p>
        </div>
      )}

      <div className={styles.progressGrid}>
        <div className={styles.progressTimeline}>
          <div className={styles.progressSectionTitle}>过程日志</div>
          {props.progress.events.length === 0 ? (
            <div className={styles.progressEmptyLine}>等待评测器返回过程事件。</div>
          ) : (
            props.progress.events.map((event) => (
              <div key={event.eventId} className={`${styles.progressEvent} ${styles[`progressEvent_${event.status}`]}`}>
                <div className={styles.progressEventDot} />
                <div className={styles.progressEventBody}>
                  <div className={styles.progressEventHeader}>
                    <strong>{event.metricName ? metricDisplayNameFromEvent(event.metricName) : event.title}</strong>
                    <span>{formatSessionTime(event.occurredAt)}</span>
                  </div>
                  <p>{event.detail}</p>
                  {event.evidence?.length ? (
                    <div className={styles.progressEvidence}>
                      {event.evidence.map((item, index) => (
                        <span key={`${event.eventId}-${index}`}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ))
          )}
        </div>

        <div className={styles.progressSidePanel}>
          <div className={styles.progressSectionTitle}>提交状态</div>
          {props.progress.matrixProgress.map((row) => (
            <div key={`${row.agentFramework}-${row.model}`} className={styles.progressRow}>
              <span>{agentFrameworkDisplayName(row.agentFramework)} · {row.model}</span>
              <span>{row.completed}/{row.total}</span>
            </div>
          ))}

          <div className={styles.progressSectionTitle}>最近案例</div>
          {props.progress.recentItems.length === 0 ? (
            <div className={styles.progressEmptyLine}>暂无案例状态。</div>
          ) : (
            props.progress.recentItems.slice(0, 6).map((item, index) => (
              <div key={`${item.caseId}-${item.status}-${index}`} className={styles.progressRecentItem}>
                <span>{item.caseId}</span>
                <strong>{item.status === "completed" ? "完成" : item.status === "failed" ? "失败" : item.status === "running" ? "运行中" : "等待"}</strong>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function metricDisplayNameFromEvent(metricName: string, metricNameMap?: Map<string, string>): string {
  const mappedName = metricNameMap?.get(metricName);
  if (mappedName) return mappedName;
  if (hasChineseText(metricName)) return metricName;
  return METRIC_NAME_ZH[metricName] ?? humanizeMetricKey(metricName);
}

function agentFrameworkDisplayName(value: string): string {
  if (value === "zeval") return "当前智能体";
  if (value === "zeval_advanced") return "增强智能体";
  if (value === "codex") return "代码智能体";
  if (value === "claude_code") return "代码智能体";
  return "被测智能体";
}

function buildNextRunHistory(
  current: BenchmarkRunHistoryItem[],
  result: BenchmarkRunResult,
  progress: BenchmarkProgressSnapshot,
): BenchmarkRunHistoryItem[] {
  const item: BenchmarkRunHistoryItem = {
    runId: result.runId,
    generatedAt: result.generatedAt,
    averageScore: result.summary.averageScore,
    caseCount: result.summary.caseCount,
    needsHumanReviewCount: result.summary.needsHumanReviewCount,
    result,
    progress,
  };
  return [item, ...current.filter((row) => row.runId !== result.runId)].slice(0, 8);
}

function ResultWorkspace(props: {
  projectId: string;
  result: BenchmarkRunResult;
  rubric: BenchmarkRubricSet | null;
  history: BenchmarkRunHistoryItem[];
  humanReviewRecords: BenchmarkHumanReviewRecord[];
  onHumanReviewRecordsChange: Dispatch<SetStateAction<BenchmarkHumanReviewRecord[]>>;
  onSelectRun: (item: BenchmarkRunHistoryItem) => void;
}) {
  const [admitting, setAdmitting] = useState(false);
  const [admissionMessage, setAdmissionMessage] = useState("");
  const [admissionError, setAdmissionError] = useState("");
  const [casePickerOpen, setCasePickerOpen] = useState(false);
  const [caseSearch, setCaseSearch] = useState("");
  const [caseFilter, setCaseFilter] = useState<CasePickerFilter>("all");
  const [caseSort, setCaseSort] = useState<CasePickerSort>("risk");
  const casePickerRef = useRef<HTMLDivElement>(null);
  const weakestMetrics = [...props.result.metricResults]
    .filter((result) => !result.passed || result.normalizedScore < 70)
    .sort((left, right) => left.normalizedScore - right.normalizedScore)
    .slice(0, 8);
  const capabilityGaps = buildCapabilityGapRows(props.result.caseScores);
  const runReviewRecords = props.humanReviewRecords.filter((record) => record.runId === props.result.runId);
  const reviewQueue = buildHumanReviewQueue(props.result.metricResults);
  const completedReviews = runReviewRecords.filter((record) => record.decision).length;
  const savedReviews = runReviewRecords.filter((record) => record.savedAt).length;
  const metricNameMap = buildMetricDisplayNameMap(props.rubric);
  const metricOrder = buildRubricMetricOrder(props.rubric);
  const sessionRows = buildResultSessionRows(props.result, runReviewRecords, metricNameMap, metricOrder);
  const defaultCaseId = sessionRows.find((row) => row.attentionMetricCount > 0)?.caseScore.caseId
    ?? sessionRows[0]?.caseScore.caseId
    ?? "";
  const [activeCaseId, setActiveCaseId] = useState(defaultCaseId);
  const selectedSession = sessionRows.find((row) => row.caseScore.caseId === activeCaseId) ?? sessionRows[0] ?? null;
  const selectedMetricResults = selectedSession?.metricResults ?? [];
  const selectedMetricKeyList = selectedMetricResults.map((result) => result.metricKey).join("|");
  const defaultMetricKey = selectedMetricResults.find(isMetricAttention)?.metricKey
    ?? selectedMetricResults[0]?.metricKey
    ?? "";
  const [activeMetricKey, setActiveMetricKey] = useState(defaultMetricKey);
  const selectedMetricResult = selectedMetricResults.find((result) => result.metricKey === activeMetricKey)
    ?? selectedMetricResults[0]
    ?? null;
  const selectedSessionIndex = selectedSession
    ? sessionRows.findIndex((row) => row.caseScore.caseId === selectedSession.caseScore.caseId)
    : -1;
  const previousSession = selectedSessionIndex > 0 ? sessionRows[selectedSessionIndex - 1] : null;
  const nextSession = selectedSessionIndex >= 0 && selectedSessionIndex < sessionRows.length - 1
    ? sessionRows[selectedSessionIndex + 1]
    : null;
  const selectedReview = selectedMetricResult ? findReview(selectedMetricResult) : undefined;
  const selectedRubricMetric = selectedMetricResult ? findRubricMetric(props.rubric, selectedMetricResult.metricKey) : null;
  const selectedTranscript = getBenchmarkCaseTranscript(selectedSession?.benchmarkCase);
  const selectedSessionReviews = selectedSession
    ? runReviewRecords.filter((record) => record.submissionId === selectedSession.caseScore.submissionId)
    : [];
  const saveableSessionReviews = selectedSessionReviews.filter((record) => record.decision && !record.savedAt);
  const selectedSaveableReview = selectedReview?.decision && !selectedReview.savedAt ? [selectedReview] : [];
  const selectedSessionPendingReviews = selectedMetricResults.filter((result) =>
    isMetricReviewCandidate(result) && !findReview(result)?.decision,
  ).length;
  const pickerRows = buildCasePickerRows(sessionRows, caseSearch, caseFilter, caseSort, metricNameMap);
  const explainSignalLabel = `${weakestMetrics.length} 个指标 · ${sessionRows.filter((row) => row.attentionMetricCount > 0).length} 个会话`;

  useEffect(() => {
    if (!defaultCaseId) return;
    setActiveCaseId((current) => sessionRows.some((row) => row.caseScore.caseId === current) ? current : defaultCaseId);
  }, [defaultCaseId, props.result.runId, sessionRows]);

  useEffect(() => {
    if (!defaultMetricKey) return;
    setActiveMetricKey((current) => selectedMetricResults.some((result) => result.metricKey === current) ? current : defaultMetricKey);
  }, [activeCaseId, defaultMetricKey, props.result.runId, selectedMetricKeyList, selectedMetricResults]);

  useEffect(() => {
    if (!casePickerOpen) return;
    function handleMouseDown(event: MouseEvent) {
      if (!casePickerRef.current?.contains(event.target as Node)) {
        setCasePickerOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setCasePickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleMouseDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [casePickerOpen]);

  function findReview(result: BenchmarkMetricEvaluationResult): BenchmarkHumanReviewRecord | undefined {
    return runReviewRecords.find((record) => record.submissionId === result.submissionId && record.metricKey === result.metricKey);
  }

  function selectSession(caseId: string) {
    setActiveCaseId(caseId);
    setCasePickerOpen(false);
  }

  function updateReview(
    result: BenchmarkMetricEvaluationResult,
    patch: Partial<BenchmarkHumanReviewRecord>,
  ) {
    props.onHumanReviewRecordsChange((current) => {
      const key = metricResultKey(result);
      const existing = current.find(
        (record) => record.runId === props.result.runId && metricResultKey(record) === key,
      );
      const nextRecord: BenchmarkHumanReviewRecord = {
        runId: props.result.runId,
        submissionId: result.submissionId,
        metricKey: result.metricKey,
        reviewer: existing?.reviewer ?? "benchmark-reviewer",
        note: existing?.note ?? "",
        reviewedAt: existing?.reviewedAt,
        ...existing,
        ...patch,
      };
      return existing
        ? current.map((record) => (record.runId === props.result.runId && metricResultKey(record) === key ? nextRecord : record))
        : [...current, nextRecord];
    });
  }

  async function admitReviewBatch(records: BenchmarkHumanReviewRecord[], emptyMessage: string) {
    const reviews = records.filter((record) => record.decision && !record.savedAt);
    if (reviews.length === 0) {
      setAdmissionError(emptyMessage);
      return;
    }

    setAdmitting(true);
    setAdmissionError("");
    setAdmissionMessage("");
    try {
      const response = await fetch("/api/benchmarks/admit-cases", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-zeval-project-id": props.projectId,
        },
        body: JSON.stringify({
          baselineVersion: props.result.runId,
          runResult: props.result,
          reviews: reviews.map((record) => ({
            submissionId: record.submissionId,
            metricKey: record.metricKey,
            decision: record.decision,
            reviewer: record.reviewer?.trim() || "benchmark-reviewer",
            note: record.note?.trim(),
            reviewedAt: record.reviewedAt ?? new Date().toISOString(),
          })),
        }),
      });
      const payload = (await response.json()) as BenchmarkAdmitCasesResponse;
      if (!response.ok) {
        throw new Error(payload.error ?? payload.detail ?? "入池失败。");
      }

      const admittedByKey = new Map((payload.admittedCases ?? []).map((item) => [
        `${item.decision ?? ""}:${item.metricKey}:${item.benchmarkCaseId}`,
        item,
      ]));
      const savedAt = new Date().toISOString();
      const submittedKeys = new Set(reviews.map((record) => `${record.submissionId}:${record.metricKey}`));
      props.onHumanReviewRecordsChange((current) => current.map((record) => {
        if (record.runId !== props.result.runId || !record.decision) return record;
        if (!submittedKeys.has(`${record.submissionId}:${record.metricKey}`)) return record;
        const result = props.result.metricResults.find(
          (item) => item.submissionId === record.submissionId && item.metricKey === record.metricKey,
        );
        const admitted = result
          ? admittedByKey.get(`${record.decision}:${record.metricKey}:${result.caseId}`)
          : undefined;
        return {
          ...record,
          savedAt,
          admission: admitted
            ? {
                caseId: admitted.caseId,
                source: admitted.source,
                caseSetType: admitted.caseSetType,
                reviewStatus: admitted.reviewStatus,
              }
            : record.admission,
        };
      }));

      const sourceText = formatAcceptedBySource(payload.acceptedBySource ?? {});
      setAdmissionMessage(
        `已保存 ${payload.savedCount ?? 0} 条，重复跳过 ${payload.skippedDuplicates ?? 0} 条${sourceText ? `，${sourceText}` : ""}。`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAdmissionError(message);
    } finally {
      setAdmitting(false);
    }
  }

  return (
    <div className={styles.workspace}>
      <div className={styles.resultHeader}>
        <div>
          <h2>评测结果</h2>
          <p>Run ID: {props.result.runId}</p>
        </div>
        <span className={styles.resultScore}>
          平均分: {props.result.summary.averageScore.toFixed(1)}%
        </span>
      </div>

      {props.history.length > 0 && (
        <div className={styles.runHistoryStrip}>
          <span>历史评测</span>
          {props.history.map((item) => (
            <button
              key={item.runId}
              type="button"
              className={item.runId === props.result.runId ? styles.runHistoryActive : ""}
              onClick={() => props.onSelectRun(item)}
            >
              <strong>{item.averageScore.toFixed(1)}%</strong>
              <small>{formatSessionTime(item.generatedAt)}</small>
            </button>
          ))}
        </div>
      )}

      <div className={styles.leaderboard}>
        {props.result.leaderboard.map((row, i) => (
          <div key={`${row.agentFramework}-${row.model}`} className={styles.leaderboardRow}>
            <span className={styles.leaderboardRank}>#{i + 1}</span>
            <span className={styles.leaderboardName}>{row.agentFramework}</span>
            <span className={styles.leaderboardModel}>{row.model}</span>
            <span className={styles.leaderboardScore}>{row.averageScore.toFixed(1)}%</span>
          </div>
        ))}
      </div>

      <div className={styles.resultSummary}>
        <div>案例数: {props.result.summary.caseCount}</div>
        <div>提交数: {props.result.summary.submissionCount}</div>
        <div>问题案例: {props.result.summary.badcaseCandidateCount}</div>
        <div>需人工复核: {props.result.summary.needsHumanReviewCount}</div>
      </div>

      <section className={styles.resultSection}>
        <div className={styles.resultSectionHeader}>
          <div>
            <h3>全局诊断摘要</h3>
            <p>保留跨会话的能力短板与重点指标，用来判断整体风险，不再混入逐条校验明细。</p>
          </div>
          <span>{explainSignalLabel}</span>
        </div>

        <div className={styles.explainGrid}>
          <div className={styles.explainPanel}>
            <strong>主要能力短板</strong>
            {capabilityGaps.length === 0 ? (
              <p className={styles.explainEmpty}>暂无明显能力短板。</p>
            ) : (
              <div className={styles.gapList}>
                {capabilityGaps.map((gap) => (
                  <div key={gap.capability} className={styles.gapRow}>
                    <span>{capabilityDisplayName(gap.capability, gap.capability)}</span>
                    <strong>{gap.score.toFixed(1)}%</strong>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={styles.explainPanel}>
            <strong>最需关注指标</strong>
            {weakestMetrics.length === 0 ? (
              <p className={styles.explainEmpty}>所有指标均已通过当前阈值。</p>
            ) : (
              <div className={styles.metricExplainList}>
                {weakestMetrics.map((result) => (
                  <MetricExplainCard key={metricResultKey(result)} result={result} metricNameMap={metricNameMap} compact />
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      <section className={styles.resultSection}>
        <div className={styles.resultSectionHeader}>
          <div>
            <h3>逐条校验工作台</h3>
            <p>先选择 Session ID，再选择二级指标；面板只展示当前 session × 当前指标的证据和人工判断。</p>
          </div>
          <span>{completedReviews}/{reviewQueue.length} 已处理 · {savedReviews} 已入池</span>
        </div>

        {admissionMessage && <div className={styles.reviewSuccess}>{admissionMessage}</div>}
        {admissionError && <div className={styles.reviewError}>{admissionError}</div>}

        {selectedSession && selectedMetricResult ? (
          <div className={styles.focusReviewPanel}>
            <div className={styles.focusToolbar}>
              <div>
                <strong>当前 Case 聚焦器</strong>
                <span>主界面只保留当前 case；完整列表收进可搜索面板。</span>
              </div>
              <button
                type="button"
                onClick={() => void admitReviewBatch(saveableSessionReviews, "当前 session 还没有可保存的人工判断。")}
                disabled={admitting || saveableSessionReviews.length === 0}
              >
                {admitting ? "保存中..." : `保存本 session 已审 (${saveableSessionReviews.length})`}
              </button>
            </div>

            <div className={styles.caseSelectorShell} ref={casePickerRef}>
              <div className={styles.caseFocusHeader}>
                <div className={styles.currentCaseCard}>
                  <div className={styles.currentCaseIdentity}>
                    <strong>{shortCaseId(selectedSession.caseScore.caseId)}</strong>
                    <span>{getSourceSessionLabel(selectedSession.benchmarkCase)}</span>
                  </div>
                  <div className={styles.currentCaseStats}>
                    <b>{selectedSession.caseScore.taskScore.toFixed(1)}%</b>
                    <span>tier: {scoreTierLabel(selectedSession.caseScore.taskScore)}</span>
                    <span>{selectedSessionPendingReviews} 待审</span>
                    {selectedSession.weakestMetric && (
                      <span>最弱：{metricDisplayNameFromEvent(selectedSession.weakestMetric.metricKey, metricNameMap)} {selectedSession.weakestMetric.normalizedScore.toFixed(0)}%</span>
                    )}
                  </div>
                  <button
                    type="button"
                    className={styles.caseDropdownButton}
                    aria-label={casePickerOpen ? "收起 Case 下拉选择器" : "打开 Case 下拉选择器"}
                    aria-expanded={casePickerOpen}
                    onClick={() => setCasePickerOpen((open) => !open)}
                  >
                    ▾
                  </button>
                </div>

                <div className={styles.caseNavActions}>
                  <button
                    type="button"
                    onClick={() => previousSession && selectSession(previousSession.caseScore.caseId)}
                    disabled={!previousSession}
                    aria-label="上一个 case"
                    title="上一个 case"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => nextSession && selectSession(nextSession.caseScore.caseId)}
                    disabled={!nextSession}
                    aria-label="下一个 case"
                    title="下一个 case"
                  >
                    ›
                  </button>
                </div>
              </div>

              {casePickerOpen && (
                <div className={styles.casePickerPanel}>
                  <div className={styles.casePickerControls}>
                    <label>
                      <span>搜索 Case</span>
                      <input
                        value={caseSearch}
                        placeholder="输入 case_023 或来源会话"
                        onChange={(event) => setCaseSearch(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>排序</span>
                      <select value={caseSort} onChange={(event) => setCaseSort(event.target.value as CasePickerSort)}>
                        <option value="risk">风险优先</option>
                        <option value="pending">待审优先</option>
                        <option value="score_asc">分数升序</option>
                        <option value="original">原始顺序</option>
                      </select>
                    </label>
                  </div>

                  <div className={styles.caseFilterChips}>
                    {CASE_PICKER_FILTERS.map((filter) => (
                      <button
                        key={filter.value}
                        type="button"
                        className={caseFilter === filter.value ? styles.caseFilterActive : ""}
                        onClick={() => setCaseFilter(filter.value)}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>

                  <div className={styles.casePickerList}>
                    {pickerRows.length === 0 ? (
                      <div className={styles.casePickerEmpty}>没有符合条件的 case。</div>
                    ) : (
                      pickerRows.map((row) => (
                        <button
                          key={row.caseScore.caseId}
                          type="button"
                          className={row.caseScore.caseId === selectedSession.caseScore.caseId ? styles.casePickerItemActive : ""}
                          onClick={() => selectSession(row.caseScore.caseId)}
                        >
                          <div>
                            <strong>{shortCaseId(row.caseScore.caseId)}</strong>
                            <span>{getSourceSessionLabel(row.benchmarkCase)}</span>
                          </div>
                          <div>
                            <b>{row.caseScore.taskScore.toFixed(1)}%</b>
                            <span>{row.pendingReviewCount} 待审 · {row.savedReviewCount} 已入池</span>
                          </div>
                          <em>{row.weakestMetric ? `最弱：${metricDisplayNameFromEvent(row.weakestMetric.metricKey, metricNameMap)} ${row.weakestMetric.normalizedScore.toFixed(0)}%` : "暂无指标"}</em>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className={styles.metricTabsBlock}>
              <div>
                <strong>二级标签 · 指标</strong>
                <span>只切换当前 session 下的评分维度。</span>
              </div>
              <div className={styles.metricTabs} role="tablist" aria-label="二级指标">
                {selectedMetricResults.map((result) => (
                <button
                  key={result.metricKey}
                  type="button"
                  className={result.metricKey === selectedMetricResult.metricKey ? styles.metricTabActive : ""}
                  onClick={() => setActiveMetricKey(result.metricKey)}
                >
                  <span>{metricDisplayNameFromEvent(result.metricKey, metricNameMap)}</span>
                  <b>{result.normalizedScore.toFixed(0)}%</b>
                </button>
              ))}
              </div>
            </div>

            <div className={styles.focusContentGrid}>
              <details className={styles.transcriptDrawer}>
                <summary>
                  <span>原始会话</span>
                  <b>{getSourceSessionLabel(selectedSession.benchmarkCase)} · {selectedTranscript ? "可展开对照证据" : "暂无 transcript"}</b>
                </summary>
                <pre>{selectedTranscript || "当前案例没有保存原始会话 transcript。"}</pre>
              </details>

              <SessionOverviewCard
                session={selectedSession}
                metricNameMap={metricNameMap}
                pendingReviewCount={selectedSessionPendingReviews}
              />

              <div className={styles.metricFocusCard}>
                <div className={styles.metricFocusHeader}>
                  <div>
                    <strong>当前维度：{metricDisplayNameFromEvent(selectedMetricResult.metricKey, metricNameMap)}</strong>
                    <span>{selectedMetricResult.evaluatorType ? evaluatorDisplayName(selectedMetricResult.evaluatorType) : "评估器"} · Channel: {reviewDecisionChannel(selectedMetricResult, selectedReview?.decision)}</span>
                  </div>
                  <b>{selectedMetricResult.normalizedScore.toFixed(1)}%</b>
                </div>
                <MetricExplainCard result={selectedMetricResult} metricNameMap={metricNameMap} />
              </div>

              <RubricFormCompare metric={selectedRubricMetric} result={selectedMetricResult} />

              <div className={styles.reviewFocusCard}>
                <div className={styles.reviewFocusHeader}>
                  <div>
                    <strong>人工校验</strong>
                    <span>{selectedReview?.decision ? humanReviewDecisionLabel(selectedReview.decision) : "待人工判断"} · {reviewDecisionChannel(selectedMetricResult, selectedReview?.decision)}</span>
                  </div>
                  {selectedReview?.admission && <b>{sourceDisplayName(selectedReview.admission.source)} · {selectedReview.admission.caseId}</b>}
                  {!selectedReview?.admission && selectedReview?.savedAt && <b>重复已跳过</b>}
                </div>

                <div className={styles.reviewDecisionButtons}>
                  <button
                    type="button"
                    className={selectedReview?.decision === "accepted" ? styles.reviewDecisionActive : ""}
                    onClick={() => updateReview(selectedMetricResult, {
                      decision: "accepted",
                      reviewedAt: new Date().toISOString(),
                      admission: undefined,
                      savedAt: undefined,
                    })}
                  >
                    认可
                  </button>
                  <button
                    type="button"
                    className={selectedReview?.decision === "rejected" ? styles.reviewDecisionActive : ""}
                    onClick={() => updateReview(selectedMetricResult, {
                      decision: "rejected",
                      reviewedAt: new Date().toISOString(),
                      admission: undefined,
                      savedAt: undefined,
                    })}
                  >
                    驳回
                  </button>
                  <button
                    type="button"
                    className={selectedReview?.decision === "needs_evidence" ? styles.reviewDecisionActive : ""}
                    onClick={() => updateReview(selectedMetricResult, {
                      decision: "needs_evidence",
                      reviewedAt: new Date().toISOString(),
                      admission: undefined,
                      savedAt: undefined,
                    })}
                  >
                    补证据
                  </button>
                </div>

                <div className={styles.reviewFocusFields}>
                  <label className={styles.reviewField}>
                    <span>审核人</span>
                    <input
                      value={selectedReview?.reviewer ?? "benchmark-reviewer"}
                      onChange={(event) => updateReview(selectedMetricResult, { reviewer: event.target.value })}
                    />
                  </label>
                  <label className={styles.reviewField}>
                    <span>人工备注</span>
                    <textarea
                      value={selectedReview?.note ?? ""}
                      placeholder="写下你认可 / 驳回 / 补证据的依据"
                      onChange={(event) => updateReview(selectedMetricResult, { note: event.target.value })}
                    />
                  </label>
                </div>

                <button
                  type="button"
                  className={styles.reviewSaveButton}
                  onClick={() => void admitReviewBatch(selectedSaveableReview, "请先完成当前指标的人工判断。")}
                  disabled={admitting || selectedSaveableReview.length === 0}
                >
                  {admitting ? "保存中..." : "保存本条入池"}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className={styles.reviewEmpty}>当前评测结果没有可校验的 session。</div>
        )}
      </section>
    </div>
  );
}

type HumanReviewDecision = "accepted" | "rejected" | "needs_evidence";
type CasePickerFilter = "all" | "pending" | "attention" | "saved";
type CasePickerSort = "risk" | "pending" | "score_asc" | "original";

const CASE_PICKER_FILTERS: Array<{ value: CasePickerFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待审" },
  { value: "attention", label: "低分 / 风险" },
  { value: "saved", label: "已入池" },
];

function buildHumanReviewQueue(results: BenchmarkMetricEvaluationResult[]): BenchmarkMetricEvaluationResult[] {
  return [...results]
    .filter((result) =>
      result.needsHumanReview ||
      result.status === "needs_human_review" ||
      !result.passed ||
      result.normalizedScore < 70 ||
      result.confidence < 0.65,
    )
    .sort((left, right) => {
      if (left.status === "needs_human_review" && right.status !== "needs_human_review") return -1;
      if (right.status === "needs_human_review" && left.status !== "needs_human_review") return 1;
      return left.normalizedScore - right.normalizedScore;
    })
    .slice(0, 24);
}

function buildCapabilityGapRows(caseScores: BenchmarkCaseScore[]): Array<{ capability: string; score: number }> {
  const grouped = new Map<string, number[]>();
  for (const caseScore of caseScores) {
    for (const capability of caseScore.capabilityScores) {
      if (!grouped.has(capability.capability)) grouped.set(capability.capability, []);
      grouped.get(capability.capability)!.push(capability.score);
    }
  }
  return [...grouped.entries()]
    .map(([capability, scores]) => ({
      capability,
      score: scores.reduce((sum, score) => sum + score, 0) / Math.max(1, scores.length),
    }))
    .sort((left, right) => left.score - right.score)
    .slice(0, 5);
}

type ResultSessionRow = {
  caseScore: BenchmarkCaseScore;
  benchmarkCase?: BenchmarkCase;
  metricResults: BenchmarkMetricEvaluationResult[];
  attentionMetricCount: number;
  pendingReviewCount: number;
  savedReviewCount: number;
  weakestMetric?: BenchmarkMetricEvaluationResult;
};

function buildResultSessionRows(
  result: BenchmarkRunResult,
  reviewRecords: BenchmarkHumanReviewRecord[],
  metricNameMap: Map<string, string>,
  metricOrder: Map<string, number>,
): ResultSessionRow[] {
  const casesById = new Map(result.cases.map((item) => [item.caseId, item]));
  const metricsByCase = new Map<string, BenchmarkMetricEvaluationResult[]>();
  for (const metricResult of result.metricResults) {
    if (!metricsByCase.has(metricResult.caseId)) metricsByCase.set(metricResult.caseId, []);
    metricsByCase.get(metricResult.caseId)!.push(metricResult);
  }

  return result.caseScores.map((caseScore) => {
    const metricResults = [...(metricsByCase.get(caseScore.caseId) ?? caseScore.metricResults)]
      .sort((left, right) => {
        const orderDiff = (metricOrder.get(left.metricKey) ?? 999) - (metricOrder.get(right.metricKey) ?? 999);
        if (orderDiff !== 0) return orderDiff;
        return metricDisplayNameFromEvent(left.metricKey, metricNameMap)
          .localeCompare(metricDisplayNameFromEvent(right.metricKey, metricNameMap), "zh-CN");
      });
    const caseReviews = reviewRecords.filter((record) => record.submissionId === caseScore.submissionId);
    const reviewByMetric = new Map(caseReviews.map((record) => [record.metricKey, record]));
    const weakestMetric = [...metricResults].sort((left, right) => left.normalizedScore - right.normalizedScore)[0];
    return {
      caseScore,
      benchmarkCase: casesById.get(caseScore.caseId),
      metricResults,
      attentionMetricCount: metricResults.filter(isMetricAttention).length,
      pendingReviewCount: metricResults.filter((metricResult) =>
        isMetricReviewCandidate(metricResult) && !reviewByMetric.get(metricResult.metricKey)?.decision,
      ).length,
      savedReviewCount: caseReviews.filter((record) => record.savedAt).length,
      weakestMetric,
    };
  });
}

function buildCasePickerRows(
  rows: ResultSessionRow[],
  search: string,
  filter: CasePickerFilter,
  sort: CasePickerSort,
  metricNameMap: Map<string, string>,
): ResultSessionRow[] {
  const query = search.trim().toLowerCase();
  return rows
    .filter((row) => {
      if (filter === "pending" && row.pendingReviewCount === 0) return false;
      if (filter === "attention" && row.attentionMetricCount === 0) return false;
      if (filter === "saved" && row.savedReviewCount === 0) return false;
      if (!query) return true;
      const haystack = [
        row.caseScore.caseId,
        shortCaseId(row.caseScore.caseId),
        getSourceSessionLabel(row.benchmarkCase),
        row.weakestMetric ? metricDisplayNameFromEvent(row.weakestMetric.metricKey, metricNameMap) : "",
      ].join(" ").toLowerCase();
      return haystack.includes(query);
    })
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      if (sort === "original") return left.index - right.index;
      if (sort === "score_asc") return left.row.caseScore.taskScore - right.row.caseScore.taskScore;
      if (sort === "pending") {
        const pendingDiff = right.row.pendingReviewCount - left.row.pendingReviewCount;
        if (pendingDiff !== 0) return pendingDiff;
        return left.row.caseScore.taskScore - right.row.caseScore.taskScore;
      }
      const attentionDiff = right.row.attentionMetricCount - left.row.attentionMetricCount;
      if (attentionDiff !== 0) return attentionDiff;
      const pendingDiff = right.row.pendingReviewCount - left.row.pendingReviewCount;
      if (pendingDiff !== 0) return pendingDiff;
      return left.row.caseScore.taskScore - right.row.caseScore.taskScore;
    })
    .map(({ row }) => row);
}

function buildRubricMetricOrder(rubric: BenchmarkRubricSet | null): Map<string, number> {
  const order = new Map<string, number>();
  let index = 0;
  for (const metric of rubric?.modules.flatMap((module) => module.metrics) ?? []) {
    order.set(metric.metricKey, index);
    index += 1;
  }
  return order;
}

function findRubricMetric(rubric: BenchmarkRubricSet | null, metricKey: string): BenchmarkRubricMetric | null {
  return rubric?.modules.flatMap((module) => module.metrics).find((metric) => metric.metricKey === metricKey) ?? null;
}

function isMetricAttention(result: BenchmarkMetricEvaluationResult): boolean {
  return !result.passed ||
    result.status === "needs_human_review" ||
    result.normalizedScore < 70 ||
    result.confidence < 0.65;
}

function isMetricReviewCandidate(result: BenchmarkMetricEvaluationResult): boolean {
  return result.needsHumanReview ||
    result.status === "needs_human_review" ||
    !result.passed ||
    result.normalizedScore < 70 ||
    result.confidence < 0.65;
}

function getBenchmarkCaseTranscript(benchmarkCase?: BenchmarkCase): string {
  const transcript = benchmarkCase?.input?.transcript;
  return typeof transcript === "string" ? transcript.trim() : "";
}

function getSourceSessionLabel(benchmarkCase?: BenchmarkCase): string {
  const sessionId = benchmarkCase?.input?.sessionId;
  return typeof sessionId === "string" && sessionId.trim() ? sessionId.trim() : "来源会话";
}

function shortCaseId(caseId: string): string {
  const match = caseId.match(/case[_-]?(\d+)$/i);
  return match ? `case_${match[1]}` : caseId;
}

function scoreTierLabel(score: number): string {
  if (score >= 90) return "gold";
  if (score >= 75) return "silver";
  if (score >= 60) return "bronze";
  return "risk";
}

function averageMetricConfidence(results: BenchmarkMetricEvaluationResult[]): number {
  if (results.length === 0) return 0;
  return results.reduce((sum, result) => sum + result.confidence, 0) / results.length;
}

function reviewDecisionChannel(
  result: BenchmarkMetricEvaluationResult,
  decision?: HumanReviewDecision,
): string {
  if (!decision) return result.needsHumanReview || result.status === "needs_human_review" ? "auto_uncertainty" : "待选择";
  if (decision === "needs_evidence") return "auto_uncertainty";
  if (decision === "accepted") return result.passed ? "manual_gold" : "auto_tp";
  return result.passed ? "auto_disagreement" : "manual_fp";
}

function SessionOverviewCard(props: {
  session: ResultSessionRow;
  metricNameMap: Map<string, string>;
  pendingReviewCount: number;
}) {
  const score = props.session.caseScore.taskScore;
  const qScore = averageMetricConfidence(props.session.metricResults);
  const weakestMetric = props.session.weakestMetric;
  return (
    <section className={styles.sessionOverviewCard}>
      <div className={styles.sessionOverviewHeader}>
        <div>
          <strong>本 Session 评测总览</strong>
          <span>{getSourceSessionLabel(props.session.benchmarkCase)}</span>
        </div>
        <b>{score.toFixed(1)}%</b>
      </div>
      <div className={styles.sessionOverviewMeta}>
        <span>Q 分 {(qScore * 100).toFixed(0)}</span>
        <span>tier: {scoreTierLabel(score)}</span>
        <span>{props.pendingReviewCount} 个待审</span>
        {weakestMetric && <span>最弱：{metricDisplayNameFromEvent(weakestMetric.metricKey, props.metricNameMap)} {weakestMetric.normalizedScore.toFixed(0)}%</span>}
      </div>
      <div className={styles.sessionMetricBars}>
        {props.session.metricResults.map((result) => (
          <div key={result.metricKey} className={styles.sessionMetricBar}>
            <span>{metricDisplayNameFromEvent(result.metricKey, props.metricNameMap)}</span>
            <div><i style={{ width: `${Math.max(2, Math.min(100, result.normalizedScore))}%` }} /></div>
            <b>{result.normalizedScore.toFixed(0)}%</b>
          </div>
        ))}
      </div>
    </section>
  );
}

function RubricFormCompare(props: { metric: BenchmarkRubricMetric | null; result: BenchmarkMetricEvaluationResult }) {
  const rubricForm = props.metric?.config?.rubricForm ?? [];
  return (
    <section className={styles.rubricCompareCard}>
      <div className={styles.rubricCompareHeader}>
        <div>
          <strong>rubricForm 对照</strong>
          <span>{props.metric?.config?.criteria ?? "当前指标没有保存单独的 rubricForm。"}</span>
        </div>
        <b>{props.result.score.toFixed(1)} / 5</b>
      </div>
      {rubricForm.length === 0 ? (
        <p className={styles.explainEmpty}>暂无评分档位。</p>
      ) : (
        <div className={styles.rubricCompareLevels}>
          {rubricForm.map((level) => (
            <div
              key={`${props.result.metricKey}-${level.score}-${level.label}`}
              className={Math.abs(level.score - props.result.score) < 0.5 ? styles.rubricCompareLevelActive : ""}
            >
              <span>{level.score} 分 · {level.label}</span>
              <p>{level.description}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function MetricExplainCard(props: {
  result: BenchmarkMetricEvaluationResult;
  metricNameMap: Map<string, string>;
  compact?: boolean;
}) {
  const statusText = props.result.status === "needs_human_review"
    ? "需人工复核"
    : props.result.passed
      ? "通过"
      : "未通过";
  return (
    <article className={`${styles.metricExplainCard} ${props.compact ? styles.metricExplainCardCompact : ""}`}>
      <div className={styles.metricExplainHeader}>
        <div>
          <strong>{metricDisplayNameFromEvent(props.result.metricKey, props.metricNameMap)}</strong>
          <span>{props.result.caseId}</span>
        </div>
        <b>{props.result.normalizedScore.toFixed(1)}%</b>
      </div>
      <div className={styles.metricExplainMeta}>
        <span>{statusText}</span>
        <span>置信度 {(props.result.confidence * 100).toFixed(0)}%</span>
        <span>{evaluatorDisplayName(props.result.evaluatorType)}</span>
        {props.result.judge && <span>{props.result.judge.mode === "panel" ? "Judge Panel" : "Single Judge"}</span>}
        {props.result.judge?.panelDisagree && <span>panel_disagree</span>}
        {props.result.labels?.slice(0, 3).map((label) => (
          <span key={`${props.result.submissionId}-${props.result.metricKey}-${label}`}>{label}</span>
        ))}
      </div>
      <p>{props.result.reason}</p>
      {!props.compact && props.result.judge && (
        <div className={styles.judgePanelTrace}>
          <div>
            <strong>{props.result.judge.mode === "panel" ? "Judge Panel 聚合" : "Judge 追踪"}</strong>
            <span>
              {props.result.judge.memberCount} 个成员 · {props.result.judge.aggregation} · 分歧 {props.result.judge.disagreement.toFixed(2)}
            </span>
          </div>
          {props.result.judge.members.slice(0, 4).map((member) => (
            <p key={`${props.result.submissionId}-${props.result.metricKey}-${member.judgeId}`}>
              <b>{member.judgeId}</b>
              <span>{formatJudgeMemberSummary(member.score, member.passed, member.family, member.comment)}</span>
            </p>
          ))}
        </div>
      )}
      {props.result.evidence.length > 0 && (
        <div className={styles.explainEvidence}>
          {props.result.evidence.slice(0, props.compact ? 2 : 5).map((item, index) => (
            <span key={`${props.result.submissionId}-${props.result.metricKey}-${index}`}>{item}</span>
          ))}
        </div>
      )}
      {!props.compact && (
        <details className={styles.compareDrawer}>
          <summary>
            <span>期望 / 实际对照</span>
            <b>{buildComparisonSummary(props.result.expected, props.result.actual)}</b>
          </summary>
          <ReadableComparison expected={props.result.expected} actual={props.result.actual} />
        </details>
      )}
    </article>
  );
}

function formatJudgeMemberSummary(score: number, passed: boolean, family: string | undefined, comment: string): string {
  const prefix = `${family ?? "judge"} · ${score.toFixed(1)} 分 · ${passed ? "通过" : "未通过"}`;
  return `${prefix} · ${comment.slice(0, 120)}`;
}

function ReadableComparison(props: { expected: unknown; actual: unknown }) {
  return (
    <div className={styles.readableCompare}>
      <ReadableValuePanel title="期望" value={props.expected} kind="expected" />
      <ReadableValuePanel title="实际" value={props.actual} kind="actual" />
    </div>
  );
}

function ReadableValuePanel(props: { title: string; value: unknown; kind: "expected" | "actual" }) {
  const normalizedValue = normalizeReadableValue(props.value);
  const blocks = buildReadableBlocks(normalizedValue, props.kind);
  return (
    <section className={styles.readablePanel}>
      <div className={styles.readablePanelTitle}>{props.title}</div>
      <div className={styles.readableBlocks}>
        {blocks.map((block, index) => (
          <div key={`${props.title}-${block.label}-${index}`} className={styles.readableBlock}>
            <span>{block.label}</span>
            {Array.isArray(block.value) ? (
              <ul>
                {block.value.map((item, itemIndex) => (
                  <li key={`${props.title}-${block.label}-${itemIndex}`}>{item}</li>
                ))}
              </ul>
            ) : (
              <p>{block.value}</p>
            )}
          </div>
        ))}
      </div>
      {(Array.isArray(normalizedValue) || isReadableRecord(normalizedValue)) && (
        <details className={styles.rawJsonDetails}>
          <summary>原始 JSON</summary>
          <pre>{formatJsonForDisplay(normalizedValue)}</pre>
        </details>
      )}
    </section>
  );
}

function metricResultKey(result: { submissionId: string; metricKey: string }): string {
  return `${result.submissionId}:${result.metricKey}`;
}

function humanReviewDecisionLabel(decision: HumanReviewDecision): string {
  if (decision === "accepted") return "已认可";
  if (decision === "rejected") return "已驳回";
  return "需补证据";
}

function sourceDisplayName(source: string): string {
  const names: Record<string, string> = {
    auto_tp: "坏例确认",
    manual_fp: "误报纠正",
    auto_fn: "漏报发现",
    auto_tn: "自动好例",
    auto_uncertainty: "边界复核",
    auto_disagreement: "人机分歧",
    manual_gold: "人工金标",
    imported: "导入",
  };
  return names[source] ?? source;
}

function formatAcceptedBySource(acceptedBySource: Record<string, number>): string {
  return Object.entries(acceptedBySource)
    .filter(([, count]) => count > 0)
    .map(([source, count]) => `${sourceDisplayName(source)} ${count} 条`)
    .join("，");
}

type ReadableBlock = {
  label: string;
  value: string | string[];
};

function buildReadableBlocks(value: unknown, kind: "expected" | "actual"): ReadableBlock[] {
  const normalizedValue = normalizeReadableValue(value);
  if (!isReadableRecord(normalizedValue)) {
    return [{ label: kind === "expected" ? "期望内容" : "实际输出", value: stringifyBrief(normalizedValue) }];
  }

  return kind === "expected"
    ? buildExpectedBlocks(normalizedValue)
    : buildActualBlocks(normalizedValue);
}

function buildExpectedBlocks(value: Record<string, unknown>): ReadableBlock[] {
  const blocks: ReadableBlock[] = [];
  pushStringBlock(blocks, "任务要求", value.requirement);
  pushAcceptanceCriteria(blocks, value.acceptanceCriteria);
  pushSourceSummary(blocks, value.sourceSummary);
  pushRemainingBlocks(blocks, value, new Set(["requirement", "acceptanceCriteria", "sourceSummary"]));
  return blocks.length ? blocks : [{ label: "期望内容", value: stringifyBrief(value) }];
}

function buildActualBlocks(value: Record<string, unknown>): ReadableBlock[] {
  const blocks: ReadableBlock[] = [];
  const expanded = expandEmbeddedActualJson(value);
  pushStringBlock(blocks, "决策", expanded.decision);
  pushStringBlock(blocks, "回答", expanded.answer);
  pushStringBlock(blocks, "理由", expanded.reason);
  pushStringBlock(blocks, "备注", expanded.notes);
  pushListBlock(blocks, "证据", expanded.evidence);
  pushRemainingBlocks(blocks, expanded, new Set(["decision", "answer", "reason", "notes", "evidence"]));
  return blocks.length ? blocks : [{ label: "实际输出", value: stringifyBrief(value) }];
}

function expandEmbeddedActualJson(value: Record<string, unknown>): Record<string, unknown> {
  const embedded =
    parseEmbeddedJsonRecord(value.answer) ??
    parseEmbeddedJsonRecord(value.rawOutput) ??
    parseEmbeddedJsonRecord(value.output);
  if (!embedded) return value;
  return {
    ...value,
    ...embedded,
    answer: typeof embedded.answer === "string" ? embedded.answer : undefined,
  };
}

function pushStringBlock(blocks: ReadableBlock[], label: string, value: unknown): void {
  if (typeof value !== "string" || !value.trim()) return;
  blocks.push({ label, value: value.trim() });
}

function pushListBlock(blocks: ReadableBlock[], label: string, value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) return;
  blocks.push({ label, value: value.map((item) => stringifyBrief(item)).filter(Boolean).slice(0, 8) });
}

function pushAcceptanceCriteria(blocks: ReadableBlock[], value: unknown): void {
  if (!Array.isArray(value) || value.length === 0) return;
  const criteria = value.map((item) => {
    if (!isReadableRecord(item)) return stringifyBrief(item);
    const metric = typeof item.metric === "string" ? item.metric : "指标";
    const criteriaText = typeof item.criteria === "string" ? item.criteria : stringifyBrief(item.criteria);
    return `${metric}: ${criteriaText}`;
  });
  blocks.push({ label: "验收标准", value: criteria.slice(0, 8) });
}

function pushSourceSummary(blocks: ReadableBlock[], value: unknown): void {
  if (!isReadableRecord(value)) return;
  const summary = Object.entries(value)
    .map(([key, item]) => `${fieldDisplayName(key)}: ${stringifyBrief(item)}`)
    .slice(0, 8);
  if (summary.length > 0) blocks.push({ label: "来源摘要", value: summary });
}

function pushRemainingBlocks(
  blocks: ReadableBlock[],
  value: Record<string, unknown>,
  consumedKeys: Set<string>,
): void {
  for (const [key, item] of Object.entries(value)) {
    if (consumedKeys.has(key) || item === undefined || item === null) continue;
    if (Array.isArray(item)) {
      pushListBlock(blocks, fieldDisplayName(key), item);
    } else {
      const text = stringifyBrief(item);
      if (text !== "无") blocks.push({ label: fieldDisplayName(key), value: text });
    }
  }
}

function fieldDisplayName(key: string): string {
  const names: Record<string, string> = {
    sessionId: "会话",
    messageCount: "消息数",
    hasTimestamp: "包含时间戳",
    sourceFileName: "来源文件",
    transcript: "对话内容",
    requirement: "任务要求",
    acceptanceCriteria: "验收标准",
    sourceSummary: "来源摘要",
  };
  return names[key] ?? humanizeMetricKey(key);
}

function stringifyBrief(value: unknown): string {
  const normalizedValue = normalizeReadableValue(value);
  if (normalizedValue !== value) return stringifyBrief(normalizedValue);
  if (value === undefined || value === null) return "无";
  if (typeof value === "string") return value.length > 260 ? `${value.slice(0, 260)}...` : value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((item) => stringifyBrief(item)).join("；");
  if (isReadableRecord(value)) {
    return Object.entries(value)
      .map(([key, item]) => `${fieldDisplayName(key)}: ${stringifyBrief(item)}`)
      .join("；");
  }
  try {
    const text = JSON.stringify(value);
    return text.length > 260 ? `${text.slice(0, 260)}...` : text;
  } catch {
    return String(value);
  }
}

function buildComparisonSummary(expected: unknown, actual: unknown): string {
  const expectedValue = normalizeReadableValue(expected);
  const actualValue = normalizeReadableValue(actual);
  const expectedBlocks = buildReadableBlocks(expectedValue, "expected").length;
  const actualBlocks = buildReadableBlocks(actualValue, "actual").length;
  return `${expectedBlocks} 项期望 · ${actualBlocks} 项实际`;
}

function normalizeReadableValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text || (!text.startsWith("{") && !text.startsWith("["))) return value;
  try {
    return JSON.parse(text);
  } catch {
    return value;
  }
}

function parseEmbeddedJsonRecord(value: unknown): Record<string, unknown> | null {
  const parsed = normalizeReadableValue(value);
  return isReadableRecord(parsed) ? parsed : null;
}

function formatJsonForDisplay(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isReadableRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
