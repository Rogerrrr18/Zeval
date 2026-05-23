/**
 * @fileoverview Persistent remediation package viewer page.
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentRunIndexRow, AgentRunSnapshot, AgentRunStatus } from "@/agent-runs";
import { RemediationPackagePanel } from "@/components/home/RemediationPackagePanel";
import { AppShell, Stepper, type StepperStep } from "@/components/shell";
import type { SampleBatchRecord } from "@/eval-datasets/storage/types";
import {
  TEMP_EVAL_SAMPLE_BADCASE_TARGET,
  TEMP_EVAL_SAMPLE_GOODCASE_TARGET,
} from "@/eval-datasets/sample-defaults";
import { buildRemediationReleaseReadinessSummary } from "@/remediation/release-readiness";
import type {
  RemediationAgentTask,
  RemediationPackageIndexRow,
  RemediationPackageSnapshot,
  RemediationTaskFlowDraft,
} from "@/remediation";
import type { ValidationRunIndexRow, ValidationRunSnapshot } from "@/validation";
import styles from "./remediationConsole.module.css";

const LAST_CUSTOMER_ID_KEY = "zeval:lastCustomerId";
const LEGACY_LAST_CUSTOMER_ID_KEY = "zerore:lastCustomerId";

type PackageListResponse = {
  packages: RemediationPackageIndexRow[];
  count: number;
};

type PackageDetailResponse = {
  package: RemediationPackageSnapshot;
};

type AgentTaskResponse = {
  task: RemediationAgentTask;
};

type ValidationRunListResponse = {
  validationRuns: ValidationRunIndexRow[];
  count: number;
};

type ValidationRunDetailResponse = {
  validationRun: ValidationRunSnapshot;
};

type SampleBatchListResponse = {
  sampleBatches: SampleBatchRecord[];
  count: number;
};

type TaskFlowDraftResponse = {
  draft: RemediationTaskFlowDraft;
};

type AgentRunListResponse = {
  agentRuns: AgentRunIndexRow[];
  count: number;
};

type AgentRunDetailResponse = {
  agentRun: AgentRunSnapshot;
};

const STEPS: StepperStep[] = [
  { key: "select", title: "1 · 选调优包", hint: "内容 / blocker" },
  { key: "task", title: "2 · 生成任务", hint: "Prompt / Issue / PR" },
  { key: "agent", title: "3 · 跟踪修复", hint: "Agent run" },
  { key: "validate", title: "4 · 验证发布", hint: "Replay / Offline" },
];

/**
 * Render the persistent remediation package viewer.
 *
 * @returns Remediation console page content.
 */
export function RemediationConsole() {
  const [packages, setPackages] = useState<RemediationPackageIndexRow[]>([]);
  const [selectedPackage, setSelectedPackage] = useState<RemediationPackageSnapshot | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [baselineCustomerId, setBaselineCustomerId] = useState("default");
  const [replyApiBaseUrl, setReplyApiBaseUrl] = useState("");
  const [sampleBatchId, setSampleBatchId] = useState("");
  const [agentTask, setAgentTask] = useState<RemediationAgentTask | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [taskFlowDraft, setTaskFlowDraft] = useState<RemediationTaskFlowDraft | null>(null);
  const [taskFlowLoading, setTaskFlowLoading] = useState(false);
  const [copiedPrompt, setCopiedPrompt] = useState(false);
  const [copiedIssue, setCopiedIssue] = useState(false);
  const [copiedPr, setCopiedPr] = useState(false);
  const [agentRuns, setAgentRuns] = useState<AgentRunIndexRow[]>([]);
  const [allAgentRuns, setAllAgentRuns] = useState<AgentRunIndexRow[]>([]);
  const [selectedAgentRunId, setSelectedAgentRunId] = useState("");
  const [selectedAgentRun, setSelectedAgentRun] = useState<AgentRunSnapshot | null>(null);
  const [agentRunStatus, setAgentRunStatus] = useState<AgentRunStatus>("draft");
  const [agentRunNotes, setAgentRunNotes] = useState("");
  const [agentRunReplayValidationId, setAgentRunReplayValidationId] = useState("");
  const [agentRunOfflineValidationId, setAgentRunOfflineValidationId] = useState("");
  const [agentRunListLoading, setAgentRunListLoading] = useState(false);
  const [agentRunDetailLoading, setAgentRunDetailLoading] = useState(false);
  const [agentRunCreating, setAgentRunCreating] = useState(false);
  const [agentRunSaving, setAgentRunSaving] = useState(false);
  const [validationRuns, setValidationRuns] = useState<ValidationRunIndexRow[]>([]);
  const [allValidationRuns, setAllValidationRuns] = useState<ValidationRunIndexRow[]>([]);
  const [selectedValidationRunId, setSelectedValidationRunId] = useState("");
  const [selectedValidationRun, setSelectedValidationRun] = useState<ValidationRunSnapshot | null>(null);
  const [validationListLoading, setValidationListLoading] = useState(false);
  const [validationDetailLoading, setValidationDetailLoading] = useState(false);
  const [validationRunning, setValidationRunning] = useState(false);
  const [sampleBatches, setSampleBatches] = useState<SampleBatchRecord[]>([]);
  const [sampleBatchLoading, setSampleBatchLoading] = useState(false);
  const [sampleBatchCreating, setSampleBatchCreating] = useState(false);
  const [packageUpdating, setPackageUpdating] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const stored =
      window.localStorage.getItem(LAST_CUSTOMER_ID_KEY) ??
      window.localStorage.getItem(LEGACY_LAST_CUSTOMER_ID_KEY);
    if (stored) {
      setBaselineCustomerId(stored);
    }
  }, []);

  /**
   * Load one issue/PR/task-flow draft bundle for the selected remediation package.
   *
   * @param packageId Package identifier.
   */
  const loadTaskFlowDraft = useCallback(async (packageId: string) => {
    if (!packageId) {
      setTaskFlowDraft(null);
      return;
    }

    setTaskFlowLoading(true);
    try {
      const response = await fetch(`/api/remediation-packages/${encodeURIComponent(packageId)}/task-flow`);
      const data = (await response.json()) as Partial<TaskFlowDraftResponse> & { error?: string; detail?: string };
      if (!response.ok || !data.draft) {
        throw new Error(data.detail ?? data.error ?? "加载 task-flow draft 失败");
      }
      setTaskFlowDraft(data.draft);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 task-flow draft 失败");
      setTaskFlowDraft(null);
    } finally {
      setTaskFlowLoading(false);
    }
  }, []);

  /**
   * Load the remediation package list.
   */
  const loadPackages = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/remediation-packages");
      const data = (await response.json()) as Partial<PackageListResponse> & { error?: string; detail?: string };
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "加载调优包列表失败");
      }

      const nextPackages = data.packages ?? [];
      setPackages(nextPackages);
      setNotice(`已加载 ${data.count ?? nextPackages.length} 份调优包。`);
      if (!selectedPackageId && nextPackages[0]) {
        setSelectedPackageId(nextPackages[0].packageId);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载调优包列表失败");
    } finally {
      setLoading(false);
    }
  }, [selectedPackageId]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  /**
   * Load one remediation package by id.
   *
   * @param packageId Package identifier.
   */
  const loadPackageDetail = useCallback(async (packageId: string) => {
    if (!packageId) {
      setSelectedPackage(null);
      return;
    }

    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/remediation-packages/${encodeURIComponent(packageId)}`);
      const data = (await response.json()) as Partial<PackageDetailResponse> & { error?: string; detail?: string };
      if (!response.ok || !data.package) {
        throw new Error(data.detail ?? data.error ?? "加载调优包详情失败");
      }
      setSelectedPackage(data.package);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载调优包详情失败");
      setSelectedPackage(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedPackageId) {
      return;
    }
    void loadPackageDetail(selectedPackageId);
  }, [loadPackageDetail, selectedPackageId]);

  /**
   * Load one emitted agent task from the selected remediation package.
   *
   * @param packageId Package identifier.
   */
  const loadAgentTask = useCallback(async (packageId: string) => {
    if (!packageId) {
      setAgentTask(null);
      return;
    }

    setTaskLoading(true);
    try {
      const response = await fetch(`/api/remediation-packages/${encodeURIComponent(packageId)}/agent-task`);
      const data = (await response.json()) as Partial<AgentTaskResponse> & { error?: string; detail?: string };
      if (!response.ok || !data.task) {
        throw new Error(data.detail ?? data.error ?? "加载 agent task 失败");
      }
      setAgentTask(data.task);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 agent task 失败");
      setAgentTask(null);
    } finally {
      setTaskLoading(false);
    }
  }, []);

  /**
   * Load validation run index rows for one remediation package.
   *
   * @param packageId Package identifier.
   */
  const loadValidationRuns = useCallback(async (packageId: string) => {
    if (!packageId) {
      setValidationRuns([]);
      setSelectedValidationRunId("");
      setSelectedValidationRun(null);
      return;
    }

    setValidationListLoading(true);
    try {
      const response = await fetch(`/api/validation-runs?packageId=${encodeURIComponent(packageId)}`);
      const data = (await response.json()) as Partial<ValidationRunListResponse> & { error?: string; detail?: string };
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "加载 validation runs 失败");
      }
      const runs = data.validationRuns ?? [];
      setValidationRuns(runs);
      setSelectedValidationRunId((current) => (runs.some((item) => item.validationRunId === current) ? current : (runs[0]?.validationRunId ?? "")));
      if (runs.length === 0) {
        setSelectedValidationRun(null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 validation runs 失败");
      setValidationRuns([]);
      setSelectedValidationRun(null);
    } finally {
      setValidationListLoading(false);
    }
  }, []);

  /**
   * Load tracked agent runs for one remediation package.
   *
   * @param packageId Package identifier.
   */
  const loadAgentRuns = useCallback(async (packageId: string) => {
    if (!packageId) {
      setAgentRuns([]);
      setSelectedAgentRunId("");
      setSelectedAgentRun(null);
      return;
    }

    setAgentRunListLoading(true);
    try {
      const response = await fetch(`/api/agent-runs?packageId=${encodeURIComponent(packageId)}`);
      const data = (await response.json()) as Partial<AgentRunListResponse> & { error?: string; detail?: string };
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "加载 agent runs 失败");
      }
      const runs = data.agentRuns ?? [];
      setAgentRuns(runs);
      setSelectedAgentRunId((current) => (runs.some((item) => item.agentRunId === current) ? current : (runs[0]?.agentRunId ?? "")));
      if (runs.length === 0) {
        setSelectedAgentRun(null);
      }
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 agent runs 失败");
      setAgentRuns([]);
      setSelectedAgentRun(null);
    } finally {
      setAgentRunListLoading(false);
    }
  }, []);

  /**
   * Load all tracked agent runs for package-list release readiness rendering.
   */
  const loadAllAgentRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/agent-runs");
      const data = (await response.json()) as Partial<AgentRunListResponse> & { error?: string; detail?: string };
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "加载 agent runs 总览失败");
      }
      setAllAgentRuns(data.agentRuns ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 agent runs 总览失败");
      setAllAgentRuns([]);
    }
  }, []);

  /**
   * Load one tracked agent run by id.
   *
   * @param agentRunId Agent run identifier.
   */
  const loadAgentRunDetail = useCallback(async (agentRunId: string) => {
    if (!agentRunId) {
      setSelectedAgentRun(null);
      return;
    }

    setAgentRunDetailLoading(true);
    try {
      const response = await fetch(`/api/agent-runs/${encodeURIComponent(agentRunId)}`);
      const data = (await response.json()) as Partial<AgentRunDetailResponse> & { error?: string; detail?: string };
      if (!response.ok || !data.agentRun) {
        throw new Error(data.detail ?? data.error ?? "加载 agent run 详情失败");
      }
      setSelectedAgentRun(data.agentRun);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 agent run 详情失败");
      setSelectedAgentRun(null);
    } finally {
      setAgentRunDetailLoading(false);
    }
  }, []);

  /**
   * Load all validation run index rows for workflow status rendering.
   */
  const loadAllValidationRuns = useCallback(async () => {
    try {
      const response = await fetch("/api/validation-runs");
      const data = (await response.json()) as Partial<ValidationRunListResponse> & { error?: string; detail?: string };
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "加载 validation runs 总览失败");
      }
      setAllValidationRuns(data.validationRuns ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 validation runs 总览失败");
      setAllValidationRuns([]);
    }
  }, []);

  /**
   * Load one saved validation run by id.
   *
   * @param validationRunId Validation run identifier.
   */
  const loadValidationDetail = useCallback(async (validationRunId: string) => {
    if (!validationRunId) {
      setSelectedValidationRun(null);
      return;
    }

    setValidationDetailLoading(true);
    try {
      const response = await fetch(`/api/validation-runs/${encodeURIComponent(validationRunId)}`);
      const data = (await response.json()) as Partial<ValidationRunDetailResponse> & { error?: string; detail?: string };
      if (!response.ok || !data.validationRun) {
        throw new Error(data.detail ?? data.error ?? "加载 validation run 详情失败");
      }
      setSelectedValidationRun(data.validationRun);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 validation run 详情失败");
      setSelectedValidationRun(null);
    } finally {
      setValidationDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedPackageId) {
      setAgentTask(null);
      setTaskFlowDraft(null);
      setAgentRuns([]);
      setSelectedAgentRun(null);
      setValidationRuns([]);
      setSelectedValidationRun(null);
      return;
    }
    void loadAgentTask(selectedPackageId);
    void loadTaskFlowDraft(selectedPackageId);
    void loadAgentRuns(selectedPackageId);
    void loadValidationRuns(selectedPackageId);
  }, [loadAgentTask, loadTaskFlowDraft, loadAgentRuns, loadValidationRuns, selectedPackageId]);

  /**
   * Load saved sample batches for offline validation selection.
   */
  const loadSampleBatches = useCallback(async () => {
    setSampleBatchLoading(true);
    try {
      const response = await fetch("/api/eval-datasets/sample-batches");
      const data = (await response.json()) as Partial<SampleBatchListResponse> & { error?: string; detail?: string };
      if (!response.ok) {
        throw new Error(data.detail ?? data.error ?? "加载 sample batch 列表失败");
      }
      setSampleBatches(data.sampleBatches ?? []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "加载 sample batch 列表失败");
      setSampleBatches([]);
    } finally {
      setSampleBatchLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadSampleBatches();
  }, [loadSampleBatches]);

  useEffect(() => {
    void loadAllValidationRuns();
  }, [loadAllValidationRuns]);

  useEffect(() => {
    void loadAllAgentRuns();
  }, [loadAllAgentRuns]);

  useEffect(() => {
    if (!selectedValidationRunId) {
      setSelectedValidationRun(null);
      return;
    }
    void loadValidationDetail(selectedValidationRunId);
  }, [loadValidationDetail, selectedValidationRunId]);

  useEffect(() => {
    if (!selectedAgentRunId) {
      setSelectedAgentRun(null);
      return;
    }
    void loadAgentRunDetail(selectedAgentRunId);
  }, [loadAgentRunDetail, selectedAgentRunId]);

  useEffect(() => {
    if (selectedPackage?.acceptanceGate.replay.baselineCustomerId) {
      setBaselineCustomerId(selectedPackage.acceptanceGate.replay.baselineCustomerId);
    }
    if (selectedPackage?.acceptanceGate.offlineEval.sampleBatchId) {
      setSampleBatchId(selectedPackage.acceptanceGate.offlineEval.sampleBatchId);
    }
  }, [selectedPackage]);

  useEffect(() => {
    setAgentRunStatus(selectedAgentRun?.status ?? "draft");
    setAgentRunNotes(selectedAgentRun?.notes ?? "");
    setAgentRunReplayValidationId(selectedAgentRun?.validationLinks.replayValidationRunId ?? "");
    setAgentRunOfflineValidationId(selectedAgentRun?.validationLinks.offlineValidationRunId ?? "");
  }, [selectedAgentRun]);

  /**
   * Copy the current agent prompt to clipboard.
   */
  async function handleCopyPrompt() {
    if (!agentTask) {
      return;
    }
    setCopiedPrompt(await copyText(agentTask.prompt));
    if (typeof window !== "undefined") {
      window.setTimeout(() => setCopiedPrompt(false), 1600);
    }
  }

  /**
   * Execute one replay or offline validation run for the selected package.
   *
   * @param mode Validation mode.
   */
  async function handleRunValidation(mode: "replay" | "offline_eval") {
    if (!selectedPackageId) {
      return;
    }

    setValidationRunning(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/validation-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: selectedPackageId,
          mode,
          baselineCustomerId: baselineCustomerId.trim() || undefined,
          replyApiBaseUrl: replyApiBaseUrl.trim() || undefined,
          sampleBatchId: sampleBatchId.trim() || undefined,
          useLlm: true,
        }),
      });
      const data = (await response.json()) as Partial<ValidationRunDetailResponse> & { error?: string; detail?: string };
      if (!response.ok || !data.validationRun) {
        throw new Error(data.detail ?? data.error ?? "执行 validation run 失败");
      }
      if (baselineCustomerId.trim()) {
        window.localStorage.setItem(LAST_CUSTOMER_ID_KEY, baselineCustomerId.trim());
      }

      if (selectedAgentRunId) {
        await fetch(`/api/agent-runs/${encodeURIComponent(selectedAgentRunId)}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "replay"
              ? {
                  replayValidationRunId: data.validationRun.validationRunId,
                }
              : {
                  offlineValidationRunId: data.validationRun.validationRunId,
                },
          ),
        });
      }

      setSelectedValidationRun(data.validationRun);
      setSelectedValidationRunId(data.validationRun.validationRunId);
      await loadValidationRuns(selectedPackageId);
      await loadAllValidationRuns();
      await loadAllAgentRuns();
      await loadTaskFlowDraft(selectedPackageId);
      if (selectedAgentRunId) {
        await loadAgentRuns(selectedPackageId);
        await loadAgentRunDetail(selectedAgentRunId);
      }
      setNotice(
        `${mode === "replay" ? "Replay" : "Offline"} validation 已完成：${data.validationRun.validationRunId} · ${data.validationRun.status}`,
      );
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "执行 validation run 失败");
    } finally {
      setValidationRunning(false);
    }
  }

  /**
   * Create one tracked agent run from the current prompt / issue / PR draft.
   *
   * @param channel Source channel for the tracked run.
   */
  async function handleCreateAgentRun(channel: "prompt" | "issue" | "pr") {
    if (!selectedPackageId) {
      return;
    }

    const draft = resolveAgentRunDraft(channel, agentTask, taskFlowDraft);
    if (!draft) {
      return;
    }

    setAgentRunCreating(true);
    setError("");
    try {
      const response = await fetch("/api/agent-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          packageId: selectedPackageId,
          channel,
          title: draft.title,
          summary: draft.summary,
          content: draft.content,
          replayValidationRunId: selectedReplayRun?.validationRunId ?? null,
          offlineValidationRunId: selectedOfflineRun?.validationRunId ?? null,
        }),
      });
      const data = (await response.json()) as Partial<AgentRunDetailResponse> & { error?: string; detail?: string };
      if (!response.ok || !data.agentRun) {
        throw new Error(data.detail ?? data.error ?? "创建 agent run 失败");
      }
      setSelectedAgentRun(data.agentRun);
      setSelectedAgentRunId(data.agentRun.agentRunId);
      await loadAgentRuns(selectedPackageId);
      await loadAllAgentRuns();
      await loadTaskFlowDraft(selectedPackageId);
      setNotice(`已创建 agent run：${data.agentRun.agentRunId} · ${data.agentRun.channel}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "创建 agent run 失败");
    } finally {
      setAgentRunCreating(false);
    }
  }

  /**
   * Persist one manual status update for the selected agent run.
   */
  async function handleSaveAgentRun() {
    if (!selectedAgentRunId) {
      return;
    }

    setAgentRunSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/agent-runs/${encodeURIComponent(selectedAgentRunId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: agentRunStatus,
          notes: agentRunNotes,
          replayValidationRunId: agentRunReplayValidationId || null,
          offlineValidationRunId: agentRunOfflineValidationId || null,
        }),
      });
      const data = (await response.json()) as Partial<AgentRunDetailResponse> & { error?: string; detail?: string };
      if (!response.ok || !data.agentRun) {
        throw new Error(data.detail ?? data.error ?? "更新 agent run 失败");
      }
      setSelectedAgentRun(data.agentRun);
      if (selectedPackageId) {
        await loadAgentRuns(selectedPackageId);
        await loadAllAgentRuns();
        await loadTaskFlowDraft(selectedPackageId);
      }
      setNotice(`已更新 agent run：${data.agentRun.agentRunId} · ${data.agentRun.status}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "更新 agent run 失败");
    } finally {
      setAgentRunSaving(false);
    }
  }

  /**
   * Persist replay/offline gate config back into the selected remediation package.
   */
  async function handleSaveGateConfig() {
    await persistGateConfig(baselineCustomerId.trim() || null, sampleBatchId.trim() || null);
  }

  /**
   * Persist replay/offline gate config back into the selected remediation package.
   *
   * @param nextBaselineCustomerId Baseline customer id to save.
   * @param nextSampleBatchId Sample batch id to save.
   */
  async function persistGateConfig(nextBaselineCustomerId: string | null, nextSampleBatchId: string | null) {
    if (!selectedPackageId) {
      return;
    }

    setPackageUpdating(true);
    setError("");
    try {
      const response = await fetch(`/api/remediation-packages/${encodeURIComponent(selectedPackageId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          acceptanceGate: {
            replay: {
              baselineCustomerId: nextBaselineCustomerId,
            },
            offlineEval: {
              sampleBatchId: nextSampleBatchId,
            },
          },
        }),
      });
      const data = (await response.json()) as Partial<PackageDetailResponse> & { error?: string; detail?: string };
      if (!response.ok || !data.package) {
        throw new Error(data.detail ?? data.error ?? "保存 acceptance gate 失败");
      }
      setSelectedPackage(data.package);
      await loadAgentTask(selectedPackageId);
      await loadTaskFlowDraft(selectedPackageId);
      setNotice(`已更新调优包 gate：baselineCustomerId=${nextBaselineCustomerId || "未设置"}，sampleBatchId=${nextSampleBatchId || "未设置"}。`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "保存 acceptance gate 失败");
    } finally {
      setPackageUpdating(false);
    }
  }

  /**
   * Create one default fixed sample batch and bind it to the selected remediation package.
   */
  async function handleCreateDefaultSampleBatch() {
    if (!selectedPackage) {
      return;
    }

    setSampleBatchCreating(true);
    setError("");
    try {
      const response = await fetch("/api/eval-datasets/sample-batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedGoodcaseCount: TEMP_EVAL_SAMPLE_GOODCASE_TARGET,
          requestedBadcaseCount: Math.max(TEMP_EVAL_SAMPLE_BADCASE_TARGET, selectedPackage.selectedCaseCount),
          seed: `remediation_${selectedPackage.packageId}`,
          strategy: "remediation_regression_v1",
          targetVersion: selectedPackage.runId,
        }),
      });
      const data = (await response.json()) as { sampleBatch?: SampleBatchRecord; error?: string; detail?: string };
      if (!response.ok || !data.sampleBatch) {
        throw new Error(data.detail ?? data.error ?? "生成固定 sample batch 失败");
      }

      setSampleBatchId(data.sampleBatch.sampleBatchId);
      await loadSampleBatches();
      await persistGateConfig(baselineCustomerId.trim() || null, data.sampleBatch.sampleBatchId);
      setNotice(`已生成并绑定固定回归集：${data.sampleBatch.sampleBatchId} · cases=${data.sampleBatch.caseIds.length}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "生成固定 sample batch 失败");
    } finally {
      setSampleBatchCreating(false);
    }
  }

  const selectedWorkflowStatus = resolvePackageWorkflowStatus(selectedPackageId, allValidationRuns);
  const selectedReplayRun = getLatestValidationRun(validationRuns, selectedPackageId, "replay");
  const selectedOfflineRun = getLatestValidationRun(validationRuns, selectedPackageId, "offline_eval");
  const linkedReplayRun = getValidationRunById(validationRuns, selectedAgentRun?.validationLinks.replayValidationRunId ?? null);
  const linkedOfflineRun = getValidationRunById(validationRuns, selectedAgentRun?.validationLinks.offlineValidationRunId ?? null);
  const executionTimeline = buildAgentRunTimelineEntries(agentRuns, validationRuns);
  const releaseReadinessSummary = taskFlowDraft?.releaseReadinessSummary ?? null;
  const selectedListReleaseReadiness = buildPackageReleaseReadinessSummary(
    selectedPackageId,
    allAgentRuns,
    allValidationRuns,
  );
  const completedStep = selectedValidationRun ? 3 : selectedAgentRun ? 2 : agentTask || taskFlowDraft ? 1 : 0;
  const maxReachableStep = selectedPackageId ? 3 : 0;

  function goToStep(index: number) {
    if (index < 0 || index >= STEPS.length) {
      return;
    }
    if (index > maxReachableStep) {
      return;
    }
    setCurrentStep(index);
  }

  return (
    <AppShell
      subheader={
        <Stepper
          steps={STEPS}
          current={currentStep}
          completed={completedStep}
          maxReachable={maxReachableStep}
          onSelect={goToStep}
        />
      }
    >
      <div className={styles.page}>
        <main className={styles.main}>
        <header className={styles.topBar}>
          <div className={styles.titleBlock}>
            <h1>调优包</h1>
            <p>选包 → 生成任务 → 跟踪 agent 修复 → 回放验证。调优交付物和执行记录在这里闭环。</p>
          </div>
        </header>

        <section className={styles.layout}>
          <aside className={styles.sidebar}>
            <div className={styles.sidebarHeader}>
              <div>
                <h2>已生成调优包</h2>
                <p>按创建时间倒序展示。</p>
              </div>
              <button className={styles.secondaryButton} type="button" disabled={loading} onClick={() => void loadPackages()}>
                {loading ? "刷新中…" : "刷新"}
              </button>
            </div>
            {error ? <p className={styles.error}>{error}</p> : null}
            {notice ? <p className={styles.notice}>{notice}</p> : null}
            <div className={styles.packageList}>
              {packages.length > 0 ? (
                packages.map((item) => {
                  const workflowStatus = resolvePackageWorkflowStatus(item.packageId, allValidationRuns);
                  const releaseReadiness = buildPackageReleaseReadinessSummary(
                    item.packageId,
                    allAgentRuns,
                    allValidationRuns,
                  );
                  return (
                    <button
                      className={item.packageId === selectedPackageId ? styles.packageItemActive : styles.packageItem}
                      key={item.packageId}
                      type="button"
                      onClick={() => {
                        setSelectedPackageId(item.packageId);
                        setCurrentStep(0);
                      }}
                    >
                      <div className={styles.packageTitleRow}>
                        <strong>{item.title}</strong>
                        <div className={styles.packageStatusBadges}>
                          <span className={getWorkflowStatusClassName(workflowStatus.tone, styles)}>{workflowStatus.label}</span>
                          <span className={getReleaseReadinessClassName(releaseReadiness.status, styles)}>
                            {releaseReadiness.status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                      <span>
                        {item.priority} · {item.scenarioId ?? "generic"} · {item.selectedCaseCount} cases
                      </span>
                      <small>{releaseReadiness.headline}</small>
                      <small>{item.createdAt}</small>
                    </button>
                  );
                })
              ) : (
                <div className={styles.emptyState}>当前还没有已保存的调优包。</div>
              )}
            </div>
          </aside>

          <section className={styles.viewer}>
            <div className={styles.viewerHeader}>
              <div>
                <h2>包内容</h2>
                <p>可持久浏览与复制，适合直接交给 coding agent。</p>
              </div>
              <div className={styles.headerMetaRow}>
                {selectedPackageId ? (
                  <div className={styles.packageStatusBadges}>
                    <span className={getWorkflowStatusClassName(selectedWorkflowStatus.tone, styles)}>{selectedWorkflowStatus.label}</span>
                    <span className={getReleaseReadinessClassName(selectedListReleaseReadiness.status, styles)}>
                      {selectedListReleaseReadiness.status.toUpperCase()}
                    </span>
                  </div>
                ) : null}
                <span className={styles.meta}>{selectedPackageId || "未选择"}</span>
              </div>
            </div>
            {currentStep === 0 ? (
              <>
                <RemediationPackagePanel
                  packageSnapshot={selectedPackage}
                  loading={detailLoading}
                  canGenerate={false}
                  onGenerate={() => undefined}
                  showGenerateAction={false}
                />

                <section className={styles.viewerSection}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3>Workflow Status</h3>
                  <p>把 package 当前所处的闭环阶段压缩成一眼可读的状态。</p>
                </div>
              </div>
              <div className={styles.inlineMetaGrid}>
                <article className={styles.metaCard}>
                  <span>Package Status</span>
                  <strong>{selectedWorkflowStatus.label}</strong>
                  <small>{selectedWorkflowStatus.detail}</small>
                </article>
                <article className={styles.metaCard}>
                  <span>Latest Replay</span>
                  <strong>{selectedReplayRun?.status ?? "not_run"}</strong>
                  <small>{selectedReplayRun?.createdAt ?? "尚未执行 replay validation"}</small>
                </article>
                <article className={styles.metaCard}>
                  <span>Latest Offline</span>
                  <strong>{selectedOfflineRun?.status ?? "not_run"}</strong>
                  <small>{selectedOfflineRun?.createdAt ?? "尚未执行 offline validation"}</small>
                </article>
              </div>
              {taskFlowLoading && selectedPackageId ? (
                <div className={styles.emptyInline}>加载 blocker summary…</div>
              ) : taskFlowDraft ? (
                <div className={styles.workflowSummaryBlock}>
                  <div className={styles.workflowSummaryHeader}>
                    <div>
                      <strong>{taskFlowDraft.workflowSummary.headline}</strong>
                      <p>{taskFlowDraft.workflowSummary.nextAction}</p>
                    </div>
                    <span className={getWorkflowStatusClassName(selectedWorkflowStatus.tone, styles)}>
                      {selectedWorkflowStatus.label}
                    </span>
                  </div>
                  {taskFlowDraft.workflowSummary.blockers.length > 0 ? (
                    <div className={styles.blockerGrid}>
                      {taskFlowDraft.workflowSummary.blockers.map((item, index) => (
                        <article
                          className={item.severity === "error" ? styles.blockerCardError : styles.blockerCardWarning}
                          key={`${item.scope}_${item.title}_${index}`}
                        >
                          <div className={styles.blockerHeader}>
                            <span className={styles.blockerScope}>{formatBlockerScope(item.scope)}</span>
                            <strong>{item.title}</strong>
                          </div>
                          <p>{item.detail}</p>
                        </article>
                      ))}
                    </div>
                  ) : (
                    <div className={styles.emptyInline}>当前没有 blocker，可以继续进入 issue / PR 执行流。</div>
                  )}
                  {releaseReadinessSummary ? (
                    <div className={styles.resultSection}>
                      <div className={styles.sectionHeader}>
                        <div>
                          <h4>Release Readiness</h4>
                          <p>{releaseReadinessSummary.headline}</p>
                        </div>
                        <span className={getReleaseReadinessClassName(releaseReadinessSummary.status, styles)}>
                          {releaseReadinessSummary.status.toUpperCase()}
                        </span>
                      </div>
                      <div className={styles.inlineMetaGrid}>
                        <article className={styles.metaCard}>
                          <span>Latest Linked Replay</span>
                          <strong>{releaseReadinessSummary.latestReplayStatus}</strong>
                        </article>
                        <article className={styles.metaCard}>
                          <span>Latest Linked Offline</span>
                          <strong>{releaseReadinessSummary.latestOfflineStatus}</strong>
                        </article>
                        <article className={styles.metaCard}>
                          <span>Recent Agent Runs</span>
                          <strong>{releaseReadinessSummary.recentAgentRunCount}</strong>
                          <small>{releaseReadinessSummary.latestAgentRunId ?? "当前还没有 tracked run"}</small>
                        </article>
                        <article className={styles.metaCard}>
                          <span>Trend Mix</span>
                          <strong>
                            +{releaseReadinessSummary.improvedRunCount + releaseReadinessSummary.progressedRunCount} / -
                            {releaseReadinessSummary.regressedRunCount}
                          </strong>
                          <small>
                            refreshed={releaseReadinessSummary.refreshedRunCount} · unchanged=
                            {releaseReadinessSummary.unchangedRunCount}
                          </small>
                        </article>
                      </div>
                      <div className={styles.sampleBatchMeta}>
                        <p>{releaseReadinessSummary.nextAction}</p>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={styles.emptyInline}>选择调优包后即可查看 blocker summary。</div>
              )}
                </section>
              </>
            ) : null}

            {currentStep === 1 ? (
              <>
                <section className={styles.viewerSection}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3>Agent Task</h3>
                  <p>把调优包编译成一段可直接交给 Claude Code / Codex 的执行 prompt。</p>
                </div>
                <div className={styles.sectionActions}>
                  <button className={styles.secondaryButton} type="button" disabled={taskLoading || !selectedPackageId} onClick={() => void loadAgentTask(selectedPackageId)}>
                    {taskLoading ? "刷新中…" : "刷新 Prompt"}
                  </button>
                  <button className={styles.secondaryButton} type="button" disabled={!agentTask} onClick={() => void handleCopyPrompt()}>
                    {copiedPrompt ? "已复制" : "复制 Prompt"}
                  </button>
                </div>
              </div>
              {agentTask ? (
                <div className={styles.stack}>
                  <div className={styles.inlineMetaGrid}>
                    <article className={styles.metaCard}>
                      <span>Task</span>
                      <strong>{agentTask.taskId}</strong>
                    </article>
                    <article className={styles.metaCard}>
                      <span>Branch</span>
                      <strong>{agentTask.branchName}</strong>
                    </article>
                    <article className={styles.metaCard}>
                      <span>Artifacts</span>
                      <strong>{agentTask.artifactPaths.length}</strong>
                    </article>
                  </div>
                  <pre className={styles.promptPreview}>{agentTask.prompt}</pre>
                </div>
              ) : (
                <div className={styles.emptyState}>选择调优包后即可生成 agent task prompt。</div>
              )}
                </section>

                <section className={styles.viewerSection}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3>Task Flow Draft</h3>
                  <p>把调优包挂到 issue / PR / 任务流的最小草稿，适合直接贴到协作系统。</p>
                </div>
                <div className={styles.sectionActions}>
                  <button className={styles.secondaryButton} type="button" disabled={taskFlowLoading || !selectedPackageId} onClick={() => void loadTaskFlowDraft(selectedPackageId)}>
                    {taskFlowLoading ? "刷新中…" : "刷新 Draft"}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={!taskFlowDraft}
                    onClick={async () => {
                      if (!taskFlowDraft) {
                        return;
                      }
                      setCopiedIssue(await copyText(`# ${taskFlowDraft.issueTitle}\n\n${taskFlowDraft.issueBody}`));
                      if (typeof window !== "undefined") {
                        window.setTimeout(() => setCopiedIssue(false), 1600);
                      }
                    }}
                  >
                    {copiedIssue ? "Issue 已复制" : "复制 Issue Draft"}
                  </button>
                  <button
                    className={styles.secondaryButton}
                    type="button"
                    disabled={!taskFlowDraft}
                    onClick={async () => {
                      if (!taskFlowDraft) {
                        return;
                      }
                      setCopiedPr(await copyText(`# ${taskFlowDraft.prTitle}\n\n${taskFlowDraft.prBody}`));
                      if (typeof window !== "undefined") {
                        window.setTimeout(() => setCopiedPr(false), 1600);
                      }
                    }}
                  >
                    {copiedPr ? "PR 已复制" : "复制 PR Draft"}
                  </button>
                </div>
              </div>
              {taskFlowDraft ? (
                <div className={styles.stack}>
                  <div className={styles.inlineMetaGrid}>
                    <article className={styles.metaCard}>
                      <span>Workflow</span>
                      <strong>{taskFlowDraft.workflowStatus}</strong>
                      <small>{taskFlowDraft.taskSummary}</small>
                    </article>
                    <article className={styles.metaCard}>
                      <span>Issue</span>
                      <strong>{taskFlowDraft.issueTitle}</strong>
                    </article>
                    <article className={styles.metaCard}>
                      <span>PR</span>
                      <strong>{taskFlowDraft.prTitle}</strong>
                    </article>
                  </div>
                  <div className={styles.reportGrid}>
                    <article className={styles.reportCard}>
                      <h4>Issue Draft</h4>
                      <pre className={styles.promptPreview}>{taskFlowDraft.issueBody}</pre>
                    </article>
                    <article className={styles.reportCard}>
                      <h4>PR Draft</h4>
                      <pre className={styles.promptPreview}>{taskFlowDraft.prBody}</pre>
                    </article>
                  </div>
                </div>
              ) : (
                <div className={styles.emptyState}>选择调优包后即可生成 issue / PR draft。</div>
              )}
                </section>
              </>
            ) : null}

            {currentStep === 2 ? (
              <section className={styles.viewerSection}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3>Agent Runs</h3>
                  <p>把 prompt / issue / PR 草稿挂成可持久更新的执行记录，先形成人工协作闭环。</p>
                </div>
                <div className={styles.sectionActions}>
                  <button className={styles.secondaryButton} type="button" disabled={!agentTask || agentRunCreating} onClick={() => void handleCreateAgentRun("prompt")}>
                    {agentRunCreating ? "创建中…" : "Track Prompt Run"}
                  </button>
                  <button className={styles.secondaryButton} type="button" disabled={!taskFlowDraft || agentRunCreating} onClick={() => void handleCreateAgentRun("issue")}>
                    {agentRunCreating ? "创建中…" : "Track Issue Run"}
                  </button>
                  <button className={styles.secondaryButton} type="button" disabled={!taskFlowDraft || agentRunCreating} onClick={() => void handleCreateAgentRun("pr")}>
                    {agentRunCreating ? "创建中…" : "Track PR Run"}
                  </button>
                  <button className={styles.secondaryButton} type="button" disabled={agentRunListLoading || !selectedPackageId} onClick={() => void loadAgentRuns(selectedPackageId)}>
                    {agentRunListLoading ? "刷新中…" : "刷新 Agent Runs"}
                  </button>
                </div>
              </div>
              <div className={styles.validationGrid}>
                <aside className={styles.validationSidebar}>
                  <p className={styles.sectionCaption}>执行记录</p>
                  <div className={styles.validationList}>
                    {agentRuns.length > 0 ? (
                      agentRuns.map((item) => (
                        <button
                          className={item.agentRunId === selectedAgentRunId ? styles.validationItemActive : styles.validationItem}
                          key={item.agentRunId}
                          type="button"
                          onClick={() => setSelectedAgentRunId(item.agentRunId)}
                        >
                          <strong>{item.channel.toUpperCase()}</strong>
                          <span>{item.status}</span>
                          <small>{item.updatedAt}</small>
                        </button>
                      ))
                    ) : (
                      <div className={styles.emptyInline}>当前还没有 agent run history。</div>
                    )}
                  </div>
                </aside>
                <div className={styles.validationDetail}>
                  <p className={styles.sectionCaption}>当前详情</p>
                  {agentRunDetailLoading ? (
                    <div className={styles.emptyInline}>加载 agent run detail…</div>
                  ) : selectedAgentRun ? (
                    <div className={styles.stack}>
                      <div className={styles.inlineMetaGrid}>
                        <article className={styles.metaCard}>
                          <span>Channel</span>
                          <strong>{selectedAgentRun.channel}</strong>
                        </article>
                        <article className={styles.metaCard}>
                          <span>Status</span>
                          <strong>{selectedAgentRun.status}</strong>
                        </article>
                        <article className={styles.metaCard}>
                          <span>Updated</span>
                          <strong>{selectedAgentRun.updatedAt}</strong>
                        </article>
                      </div>
                      <div className={styles.resultSection}>
                        <h4>{selectedAgentRun.title}</h4>
                        <div className={styles.formGrid}>
                          <label className={styles.field}>
                            Run Status
                            <select className={styles.input} value={agentRunStatus} onChange={(event) => setAgentRunStatus(event.target.value as AgentRunStatus)}>
                              <option value="draft">draft</option>
                              <option value="queued">queued</option>
                              <option value="running">running</option>
                              <option value="blocked">blocked</option>
                              <option value="completed">completed</option>
                            </select>
                          </label>
                          <label className={styles.field}>
                            Summary
                            <input className={styles.input} value={selectedAgentRun.summary} readOnly />
                          </label>
                          <label className={styles.field}>
                            Agent Run Id
                            <input className={styles.input} value={selectedAgentRun.agentRunId} readOnly />
                          </label>
                        </div>
                        <div className={styles.reportGrid}>
                          <article className={styles.reportCard}>
                            <h4>Replay Transition</h4>
                            <p className={styles.timelineTransition}>
                              {buildValidationTransitionLabel(
                                selectedAgentRun.startingValidationLinks.replayValidationRunId,
                                selectedAgentRun.validationLinks.replayValidationRunId,
                                validationRuns,
                              )}
                            </p>
                          </article>
                          <article className={styles.reportCard}>
                            <h4>Offline Transition</h4>
                            <p className={styles.timelineTransition}>
                              {buildValidationTransitionLabel(
                                selectedAgentRun.startingValidationLinks.offlineValidationRunId,
                                selectedAgentRun.validationLinks.offlineValidationRunId,
                                validationRuns,
                              )}
                            </p>
                          </article>
                        </div>
                        <div className={styles.inlineMetaGrid}>
                          <article className={styles.metaCard}>
                            <span>Linked Replay</span>
                            <strong>{linkedReplayRun?.status ?? "not_linked"}</strong>
                            <small>{linkedReplayRun?.validationRunId ?? "当前未绑定 replay validation"}</small>
                          </article>
                          <article className={styles.metaCard}>
                            <span>Linked Offline</span>
                            <strong>{linkedOfflineRun?.status ?? "not_linked"}</strong>
                            <small>{linkedOfflineRun?.validationRunId ?? "当前未绑定 offline validation"}</small>
                          </article>
                          <article className={styles.metaCard}>
                            <span>Current Package Gates</span>
                            <strong>{selectedWorkflowStatus.label}</strong>
                            <small>{taskFlowDraft?.workflowSummary.headline ?? "当前没有 workflow summary"}</small>
                          </article>
                        </div>
                        <div className={styles.sectionActions}>
                          <button
                            className={styles.secondaryButton}
                            type="button"
                            disabled={!linkedReplayRun}
                            onClick={() => setSelectedValidationRunId(linkedReplayRun?.validationRunId ?? "")}
                          >
                            打开 Linked Replay
                          </button>
                          <button
                            className={styles.secondaryButton}
                            type="button"
                            disabled={!linkedOfflineRun}
                            onClick={() => setSelectedValidationRunId(linkedOfflineRun?.validationRunId ?? "")}
                          >
                            打开 Linked Offline
                          </button>
                        </div>
                        <div className={styles.formGrid}>
                          <label className={styles.field}>
                            Linked Replay Validation
                            <select
                              className={styles.input}
                              value={agentRunReplayValidationId}
                              onChange={(event) => setAgentRunReplayValidationId(event.target.value)}
                            >
                              <option value="">不绑定 replay validation</option>
                              {validationRuns
                                .filter((item) => item.mode === "replay")
                                .map((item) => (
                                  <option key={item.validationRunId} value={item.validationRunId}>
                                    {item.validationRunId} · {item.status} · {item.createdAt}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            Linked Offline Validation
                            <select
                              className={styles.input}
                              value={agentRunOfflineValidationId}
                              onChange={(event) => setAgentRunOfflineValidationId(event.target.value)}
                            >
                              <option value="">不绑定 offline validation</option>
                              {validationRuns
                                .filter((item) => item.mode === "offline_eval")
                                .map((item) => (
                                  <option key={item.validationRunId} value={item.validationRunId}>
                                    {item.validationRunId} · {item.status} · {item.createdAt}
                                  </option>
                                ))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            Quick Link
                            <button
                              className={styles.secondaryButton}
                              type="button"
                              onClick={() => {
                                setAgentRunReplayValidationId(selectedReplayRun?.validationRunId ?? "");
                                setAgentRunOfflineValidationId(selectedOfflineRun?.validationRunId ?? "");
                              }}
                            >
                              绑定当前最新验证
                            </button>
                          </label>
                        </div>
                        <label className={styles.field}>
                          Notes
                          <textarea className={styles.textarea} value={agentRunNotes} onChange={(event) => setAgentRunNotes(event.target.value)} rows={4} />
                        </label>
                        <div className={styles.sectionActions}>
                          <button className={styles.secondaryButton} type="button" disabled={agentRunSaving} onClick={() => void handleSaveAgentRun()}>
                            {agentRunSaving ? "保存中…" : "保存 Agent Run"}
                          </button>
                        </div>
                      </div>
                      <div className={styles.resultSection}>
                        <h4>Payload Preview</h4>
                        <pre className={styles.promptPreview}>{selectedAgentRun.content}</pre>
                      </div>
                      <div className={styles.resultSection}>
                        <h4>Execution Timeline</h4>
                        {executionTimeline.length > 0 ? (
                          <div className={styles.timelineList}>
                            {executionTimeline.map((item) => (
                              <article className={styles.timelineCard} key={item.agentRunId}>
                                <div className={styles.timelineHeader}>
                                  <div>
                                    <strong>{item.title}</strong>
                                    <p>
                                      {item.channel.toUpperCase()} · {item.status} · {item.updatedAt}
                                    </p>
                                  </div>
                                  <span className={styles.meta}>{item.agentRunId}</span>
                                </div>
                                <p className={styles.timelineSummary}>{item.summary}</p>
                                <div className={styles.inlineMetaGrid}>
                                  <article className={styles.metaCard}>
                                    <span>Replay</span>
                                    <strong>{item.replayChanged ? "changed" : "unchanged"}</strong>
                                    <small>{item.replayTransition}</small>
                                  </article>
                                  <article className={styles.metaCard}>
                                    <span>Offline</span>
                                    <strong>{item.offlineChanged ? "changed" : "unchanged"}</strong>
                                    <small>{item.offlineTransition}</small>
                                  </article>
                                  <article className={styles.metaCard}>
                                    <span>Current Validation Delta</span>
                                    <strong>{item.validationDeltaLabel}</strong>
                                    <small>{item.currentHeadline}</small>
                                  </article>
                                </div>
                                <div className={styles.sectionActions}>
                                  <button
                                    className={styles.secondaryButton}
                                    type="button"
                                    onClick={() => setSelectedAgentRunId(item.agentRunId)}
                                  >
                                    查看 Agent Run
                                  </button>
                                  <button
                                    className={styles.secondaryButton}
                                    type="button"
                                    disabled={!item.currentReplayValidationRunId}
                                    onClick={() => setSelectedValidationRunId(item.currentReplayValidationRunId ?? "")}
                                  >
                                    查看 Replay
                                  </button>
                                  <button
                                    className={styles.secondaryButton}
                                    type="button"
                                    disabled={!item.currentOfflineValidationRunId}
                                    onClick={() => setSelectedValidationRunId(item.currentOfflineValidationRunId ?? "")}
                                  >
                                    查看 Offline
                                  </button>
                                </div>
                              </article>
                            ))}
                          </div>
                        ) : (
                          <div className={styles.emptyInline}>当前还没有 execution timeline。</div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className={styles.emptyInline}>创建一个 tracked agent run 后可在这里更新状态与备注。</div>
                  )}
                </div>
              </div>
              </section>
            ) : null}

            {currentStep === 3 ? (
              <section className={styles.viewerSection}>
              <div className={styles.sectionHeader}>
                <div>
                  <h3>Validation Loop</h3>
                  <p>在调优包页直接发起 replay / offline validation，并持久查看历史结果。</p>
                </div>
                <div className={styles.sectionActions}>
                  <button className={styles.secondaryButton} type="button" disabled={!selectedPackage || sampleBatchCreating} onClick={() => void handleCreateDefaultSampleBatch()}>
                    {sampleBatchCreating ? "生成中…" : "生成默认回归集"}
                  </button>
                  <button className={styles.secondaryButton} type="button" disabled={sampleBatchLoading} onClick={() => void loadSampleBatches()}>
                    {sampleBatchLoading ? "刷新样本中…" : "刷新 Sample Batches"}
                  </button>
                  <button className={styles.secondaryButton} type="button" disabled={validationListLoading || !selectedPackageId} onClick={() => void loadValidationRuns(selectedPackageId)}>
                    {validationListLoading ? "刷新中…" : "刷新历史"}
                  </button>
                </div>
              </div>
              <div className={styles.formGrid}>
                <label className={styles.field}>
                  Replay customerId
                  <input
                    className={styles.input}
                    value={baselineCustomerId}
                    onChange={(event) => setBaselineCustomerId(event.target.value)}
                    placeholder="default"
                  />
                </label>
                <label className={styles.field}>
                  Reply API Base URL
                  <input
                    className={styles.input}
                    value={replyApiBaseUrl}
                    onChange={(event) => setReplyApiBaseUrl(event.target.value)}
                    placeholder="可选，默认读取环境变量"
                  />
                </label>
                <label className={styles.field}>
                  Fixed Sample Batch
                  <select
                    className={styles.input}
                    value={sampleBatchId}
                    onChange={(event) => setSampleBatchId(event.target.value)}
                  >
                    <option value="">不指定，退化为 package badcases</option>
                    {sampleBatches.map((item) => (
                      <option key={item.sampleBatchId} value={item.sampleBatchId}>
                        {item.sampleBatchId} · cases={item.caseIds.length} · {item.createdAt}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {sampleBatchId && sampleBatches.find((item) => item.sampleBatchId === sampleBatchId) ? (
                <div className={styles.sampleBatchMeta}>
                  {(() => {
                    const selectedSampleBatch = sampleBatches.find((item) => item.sampleBatchId === sampleBatchId);
                    if (!selectedSampleBatch) {
                      return null;
                    }
                    return (
                      <>
                        <p>
                          当前固定回归集：<strong>{selectedSampleBatch.sampleBatchId}</strong> ·
                          cases={selectedSampleBatch.caseIds.length} · strategy={selectedSampleBatch.strategy}
                        </p>
                        {selectedSampleBatch.warnings?.length ? (
                          <p>warnings: {selectedSampleBatch.warnings.join(" | ")}</p>
                        ) : null}
                      </>
                    );
                  })()}
                </div>
              ) : null}
              <div className={styles.sectionActions}>
                <button className={styles.secondaryButton} type="button" disabled={!selectedPackageId || packageUpdating} onClick={() => void handleSaveGateConfig()}>
                  {packageUpdating ? "保存中…" : "保存 Gate 配置"}
                </button>
                <button className={styles.secondaryButton} type="button" disabled={!selectedPackageId || validationRunning} onClick={() => void handleRunValidation("replay")}>
                  {validationRunning ? "执行中…" : "执行 Replay Validation"}
                </button>
                <button className={styles.secondaryButton} type="button" disabled={!selectedPackageId || validationRunning} onClick={() => void handleRunValidation("offline_eval")}>
                  {validationRunning ? "执行中…" : "执行 Offline Validation"}
                </button>
              </div>
              <div className={styles.validationGrid}>
                <aside className={styles.validationSidebar}>
                  <p className={styles.sectionCaption}>历史记录</p>
                  <div className={styles.validationList}>
                    {validationRuns.length > 0 ? (
                      validationRuns.map((item) => (
                        <button
                          className={item.validationRunId === selectedValidationRunId ? styles.validationItemActive : styles.validationItem}
                          key={item.validationRunId}
                          type="button"
                          onClick={() => setSelectedValidationRunId(item.validationRunId)}
                        >
                          <strong>{item.mode === "replay" ? "Replay" : "Offline"}</strong>
                          <span>{item.status}</span>
                          <small>{item.createdAt}</small>
                        </button>
                      ))
                    ) : (
                      <div className={styles.emptyInline}>当前还没有 validation history。</div>
                    )}
                  </div>
                </aside>
                <div className={styles.validationDetail}>
                  <p className={styles.sectionCaption}>当前详情</p>
                  {validationDetailLoading ? (
                    <div className={styles.emptyInline}>加载 validation detail…</div>
                  ) : selectedValidationRun ? (
                    selectedValidationRun.summary.type === "replay" ? (
                      <div className={styles.stack}>
                        <div className={styles.inlineMetaGrid}>
                          <article className={styles.metaCard}>
                            <span>Status</span>
                            <strong>{selectedValidationRun.status}</strong>
                          </article>
                          <article className={styles.metaCard}>
                            <span>Win Rate</span>
                            <strong>{selectedValidationRun.summary.winRate.toFixed(4)}</strong>
                          </article>
                          <article className={styles.metaCard}>
                            <span>Replay Rows</span>
                            <strong>{selectedValidationRun.summary.replayedRowCount}</strong>
                          </article>
                        </div>
                        <div className={styles.resultSection}>
                          <h4>Target Metrics</h4>
                          <div className={styles.resultList}>
                            {selectedValidationRun.summary.targetMetricResults.map((item) => (
                              <article className={styles.resultCard} key={item.metricId}>
                                <strong>{item.displayName}</strong>
                                <p>
                                  baseline {item.baselineValue.toFixed(4)} → current {item.currentValue?.toFixed(4) ?? "--"} · target {item.targetValue.toFixed(4)}
                                </p>
                                <small>{item.detail}</small>
                              </article>
                            ))}
                          </div>
                        </div>
                        <div className={styles.resultSection}>
                          <h4>Guards</h4>
                          <div className={styles.resultList}>
                            {selectedValidationRun.summary.guardResults.map((item) => (
                              <article className={styles.resultCard} key={item.guardKey}>
                                <strong>{item.guardKey}</strong>
                                <p>
                                  {item.comparator} {String(item.threshold)} · current {item.currentValue === null ? "--" : String(item.currentValue)}
                                </p>
                                <small>{item.detail}</small>
                              </article>
                            ))}
                          </div>
                        </div>
                        {selectedValidationRun.summary.warnings.length > 0 ? (
                          <div className={styles.warningBlock}>
                            {selectedValidationRun.summary.warnings.map((item) => (
                              <p key={item}>{item}</p>
                            ))}
                          </div>
                        ) : null}
                        {selectedValidationRun.files.length > 0 ? (
                          <div className={styles.resultSection}>
                            <h4>Validation Report</h4>
                            <div className={styles.reportGrid}>
                              {selectedValidationRun.files.map((file) => (
                                <article className={styles.reportCard} key={file.fileName}>
                                  <div className={styles.reportHeader}>
                                    <strong>{file.fileName}</strong>
                                    <span>{file.relativePath}</span>
                                  </div>
                                  <pre className={styles.reportPreview}>{file.content}</pre>
                                </article>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className={styles.stack}>
                        <div className={styles.inlineMetaGrid}>
                          <article className={styles.metaCard}>
                            <span>Status</span>
                            <strong>{selectedValidationRun.status}</strong>
                          </article>
                          <article className={styles.metaCard}>
                            <span>Executed</span>
                            <strong>{selectedValidationRun.summary.executedCases}</strong>
                          </article>
                          <article className={styles.metaCard}>
                            <span>Regressions</span>
                            <strong>{selectedValidationRun.summary.regressedCases}</strong>
                          </article>
                        </div>
                        <div className={styles.resultSection}>
                          <h4>Case Results</h4>
                          <div className={styles.resultList}>
                            {selectedValidationRun.summary.caseResults.map((item) => (
                              <article className={styles.resultCard} key={item.caseId}>
                                <strong>{item.label}</strong>
                                <p>
                                  baseline {item.baselineCaseScore.toFixed(4)} → current {item.currentCaseScore?.toFixed(4) ?? "--"} · delta {item.scoreDelta?.toFixed(4) ?? "--"}
                                </p>
                                <small>{item.reason}</small>
                              </article>
                            ))}
                          </div>
                        </div>
                        {selectedValidationRun.summary.warnings.length > 0 ? (
                          <div className={styles.warningBlock}>
                            {selectedValidationRun.summary.warnings.map((item) => (
                              <p key={item}>{item}</p>
                            ))}
                          </div>
                        ) : null}
                        {selectedValidationRun.files.length > 0 ? (
                          <div className={styles.resultSection}>
                            <h4>Validation Report</h4>
                            <div className={styles.reportGrid}>
                              {selectedValidationRun.files.map((file) => (
                                <article className={styles.reportCard} key={file.fileName}>
                                  <div className={styles.reportHeader}>
                                    <strong>{file.fileName}</strong>
                                    <span>{file.relativePath}</span>
                                  </div>
                                  <pre className={styles.reportPreview}>{file.content}</pre>
                                </article>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    )
                  ) : (
                    <div className={styles.emptyInline}>运行一次 validation 后可在这里查看详细结果。</div>
                  )}
                </div>
              </div>
              </section>
            ) : null}
          </section>
        </section>
        </main>
      </div>
    </AppShell>
  );
}

type PackageWorkflowStatus = {
  label: string;
  tone: "neutral" | "warn" | "success" | "danger";
  detail: string;
};

type AgentRunTimelineEntry = {
  agentRunId: string;
  title: string;
  summary: string;
  channel: AgentRunIndexRow["channel"];
  status: AgentRunStatus;
  updatedAt: string;
  replayChanged: boolean;
  replayTransition: string;
  currentReplayValidationRunId: string | null;
  offlineChanged: boolean;
  offlineTransition: string;
  currentOfflineValidationRunId: string | null;
  validationDeltaLabel: string;
  currentHeadline: string;
};

/**
 * Resolve one remediation package workflow status from latest validation runs.
 *
 * @param packageId Package identifier.
 * @param runs All known validation run index rows.
 * @returns Human-readable workflow status.
 */
function resolvePackageWorkflowStatus(packageId: string, runs: ValidationRunIndexRow[]): PackageWorkflowStatus {
  const replay = getLatestValidationRun(runs, packageId, "replay");
  const offline = getLatestValidationRun(runs, packageId, "offline_eval");

  if (!replay && !offline) {
    return {
      label: "READY",
      tone: "neutral",
      detail: "调优包已生成，尚未进入验证。",
    };
  }
  if (replay?.status === "passed" && offline?.status === "passed") {
    return {
      label: "PASSED",
      tone: "success",
      detail: "replay 与 offline gate 最近一轮都通过。",
    };
  }
  if (replay?.status === "failed" || offline?.status === "failed") {
    return {
      label: "FAILED",
      tone: "danger",
      detail: "最近一轮至少有一个 gate 未通过。",
    };
  }
  return {
    label: "PARTIAL",
    tone: "warn",
    detail: "已有部分验证结果，但闭环还未跑满。",
  };
}

/**
 * Read the latest validation run by package and mode from a sorted index list.
 *
 * @param runs Validation run index rows.
 * @param packageId Package identifier.
 * @param mode Validation mode.
 * @returns Latest matching validation run or null.
 */
function getLatestValidationRun(
  runs: ValidationRunIndexRow[],
  packageId: string,
  mode: ValidationRunIndexRow["mode"],
): ValidationRunIndexRow | null {
  return runs.find((item) => item.packageId === packageId && item.mode === mode) ?? null;
}

/**
 * Read one validation run by id from the current package-scoped index rows.
 *
 * @param runs Validation run index rows.
 * @param validationRunId Validation run identifier.
 * @returns Matching validation run or null.
 */
function getValidationRunById(
  runs: ValidationRunIndexRow[],
  validationRunId: string | null,
): ValidationRunIndexRow | null {
  if (!validationRunId) {
    return null;
  }
  return runs.find((item) => item.validationRunId === validationRunId) ?? null;
}

/**
 * Build package-scoped execution timeline rows from tracked agent runs.
 *
 * @param agentRuns Agent run index rows.
 * @param validationRuns Validation run index rows.
 * @returns Timeline entries ordered by latest updates first.
 */
function buildAgentRunTimelineEntries(
  agentRuns: AgentRunIndexRow[],
  validationRuns: ValidationRunIndexRow[],
): AgentRunTimelineEntry[] {
  return agentRuns.map((item) => {
    const replayChanged = didValidationLinkChange(
      item.startingValidationLinks.replayValidationRunId,
      item.validationLinks.replayValidationRunId,
    );
    const offlineChanged = didValidationLinkChange(
      item.startingValidationLinks.offlineValidationRunId,
      item.validationLinks.offlineValidationRunId,
    );

    const replayTransition = buildValidationTransitionLabel(
      item.startingValidationLinks.replayValidationRunId,
      item.validationLinks.replayValidationRunId,
      validationRuns,
    );
    const offlineTransition = buildValidationTransitionLabel(
      item.startingValidationLinks.offlineValidationRunId,
      item.validationLinks.offlineValidationRunId,
      validationRuns,
    );

    const currentReplay = formatValidationReference(
      getValidationRunById(validationRuns, item.validationLinks.replayValidationRunId),
      item.validationLinks.replayValidationRunId,
    );
    const currentOffline = formatValidationReference(
      getValidationRunById(validationRuns, item.validationLinks.offlineValidationRunId),
      item.validationLinks.offlineValidationRunId,
    );

    return {
      agentRunId: item.agentRunId,
      title: item.title,
      summary: item.summary,
      channel: item.channel,
      status: item.status,
      updatedAt: item.updatedAt,
      replayChanged,
      replayTransition,
      currentReplayValidationRunId: item.validationLinks.replayValidationRunId,
      offlineChanged,
      offlineTransition,
      currentOfflineValidationRunId: item.validationLinks.offlineValidationRunId,
      validationDeltaLabel: replayChanged || offlineChanged ? "new validation linked" : "no link change",
      currentHeadline: `replay=${currentReplay} · offline=${currentOffline}`,
    };
  });
}

/**
 * Build one package-level release readiness summary from the list-view datasets.
 *
 * @param packageId Package identifier.
 * @param agentRuns All known agent runs.
 * @param validationRuns All known validation runs.
 * @returns Release readiness summary for one package.
 */
function buildPackageReleaseReadinessSummary(
  packageId: string,
  agentRuns: AgentRunIndexRow[],
  validationRuns: ValidationRunIndexRow[],
) {
  return buildRemediationReleaseReadinessSummary({
    packageId,
    agentRuns: agentRuns.filter((item) => item.packageId === packageId),
    validationRuns: validationRuns.filter((item) => item.packageId === packageId),
  });
}

/**
 * Format one before/after validation link transition.
 *
 * @param previousValidationRunId Validation id seen when the agent run was created.
 * @param currentValidationRunId Validation id currently linked to the agent run.
 * @param validationRuns Validation run index rows.
 * @returns Human-readable transition text.
 */
function buildValidationTransitionLabel(
  previousValidationRunId: string | null,
  currentValidationRunId: string | null,
  validationRuns: ValidationRunIndexRow[],
): string {
  const previousLabel = formatValidationReference(
    getValidationRunById(validationRuns, previousValidationRunId),
    previousValidationRunId,
  );
  const currentLabel = formatValidationReference(
    getValidationRunById(validationRuns, currentValidationRunId),
    currentValidationRunId,
  );
  return `${previousLabel} -> ${currentLabel}`;
}

/**
 * Render one validation run reference into a compact label.
 *
 * @param validationRun Validation run index row.
 * @param validationRunId Validation identifier.
 * @returns Renderable label.
 */
function formatValidationReference(
  validationRun: ValidationRunIndexRow | null,
  validationRunId: string | null,
): string {
  if (!validationRunId) {
    return "not_linked";
  }
  if (!validationRun) {
    return `missing (${validationRunId})`;
  }
  return `${validationRun.status} (${validationRun.validationRunId})`;
}

/**
 * Detect whether one validation link changed after the agent run was created.
 *
 * @param previousValidationRunId Validation id seen when the run was created.
 * @param currentValidationRunId Validation id currently linked to the run.
 * @returns Whether the link changed.
 */
function didValidationLinkChange(
  previousValidationRunId: string | null,
  currentValidationRunId: string | null,
): boolean {
  return previousValidationRunId !== currentValidationRunId;
}

/**
 * Map workflow status tone to one CSS class name.
 *
 * @param tone Status tone.
 * @param scopedStyles Module-scoped styles.
 * @returns CSS class name.
 */
function getWorkflowStatusClassName(
  tone: PackageWorkflowStatus["tone"],
  scopedStyles: Record<string, string>,
): string {
  if (tone === "success") {
    return scopedStyles.statusSuccess;
  }
  if (tone === "danger") {
    return scopedStyles.statusDanger;
  }
  if (tone === "warn") {
    return scopedStyles.statusWarn;
  }
  return scopedStyles.statusNeutral;
}

/**
 * Map release readiness status to one CSS class name.
 *
 * @param status Release readiness label.
 * @param scopedStyles Module-scoped styles.
 * @returns CSS class name.
 */
function getReleaseReadinessClassName(
  status: "ready" | "improving" | "regressing" | "stalled",
  scopedStyles: Record<string, string>,
): string {
  if (status === "ready") {
    return scopedStyles.statusSuccess;
  }
  if (status === "regressing") {
    return scopedStyles.statusDanger;
  }
  if (status === "improving") {
    return scopedStyles.statusWarn;
  }
  return scopedStyles.statusNeutral;
}

/**
 * Copy one text payload to clipboard and return whether it succeeded.
 *
 * @param content Text content to copy.
 * @returns Whether clipboard write succeeded.
 */
async function copyText(content: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(content);
    return true;
  } catch {
    return false;
  }
}

/**
 * Format blocker scope into a short user-facing label.
 *
 * @param scope Workflow blocker scope.
 * @returns Render label.
 */
function formatBlockerScope(scope: "package" | "replay" | "offline_eval"): string {
  if (scope === "offline_eval") {
    return "OFFLINE";
  }
  return scope.toUpperCase();
}

/**
 * Resolve one tracked agent run payload from the current page state.
 *
 * @param channel Delivery channel to persist.
 * @param agentTask Current emitted agent task.
 * @param taskFlowDraft Current task-flow draft bundle.
 * @returns Persistable agent run draft or null when unavailable.
 */
function resolveAgentRunDraft(
  channel: "prompt" | "issue" | "pr",
  agentTask: RemediationAgentTask | null,
  taskFlowDraft: RemediationTaskFlowDraft | null,
): { title: string; summary: string; content: string } | null {
  if (channel === "prompt") {
    if (!agentTask) {
      return null;
    }
    return {
      title: agentTask.title,
      summary: `${agentTask.taskId} · branch=${agentTask.branchName}`,
      content: agentTask.prompt,
    };
  }

  if (!taskFlowDraft) {
    return null;
  }

  if (channel === "issue") {
    return {
      title: taskFlowDraft.issueTitle,
      summary: taskFlowDraft.taskSummary,
      content: `# ${taskFlowDraft.issueTitle}\n\n${taskFlowDraft.issueBody}`,
    };
  }

  return {
    title: taskFlowDraft.prTitle,
    summary: taskFlowDraft.taskSummary,
    content: `# ${taskFlowDraft.prTitle}\n\n${taskFlowDraft.prBody}`,
  };
}
