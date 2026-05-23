/**
 * @fileoverview Agent run store factory and helpers.
 */

import { randomBytes } from "node:crypto";
import type { AgentRunStore } from "@/agent-runs/agent-run-store";
import { FileSystemAgentRunStore } from "@/agent-runs/file-system-agent-run-store";
import type { AgentRunChannel, AgentRunSnapshot } from "@/agent-runs/types";

/**
 * Create the active agent run store.
 *
 * @returns Active store implementation.
 */
export function createAgentRunStore(): AgentRunStore {
  const provider = (process.env.AGENT_RUN_STORE_PROVIDER ?? "filesystem").trim().toLowerCase();
  if (provider === "filesystem") {
    return new FileSystemAgentRunStore();
  }
  throw new Error(`暂不支持的 agent run store provider: ${provider}`);
}

/**
 * Build one persistable agent run snapshot.
 *
 * @param params Snapshot payload.
 * @returns New agent run snapshot.
 */
export function buildAgentRunSnapshot(params: {
  packageId: string;
  channel: AgentRunChannel;
  title: string;
  summary: string;
  content: string;
  notes?: string;
  replayValidationRunId?: string | null;
  offlineValidationRunId?: string | null;
}): AgentRunSnapshot {
  const createdAt = new Date().toISOString();
  return {
    schemaVersion: 1,
    agentRunId: allocateAgentRunId(params.channel),
    packageId: params.packageId,
    channel: params.channel,
    status: "draft",
    title: params.title,
    summary: params.summary,
    content: params.content,
    notes: params.notes?.trim() ?? "",
    startingValidationLinks: {
      replayValidationRunId: params.replayValidationRunId ?? null,
      offlineValidationRunId: params.offlineValidationRunId ?? null,
    },
    validationLinks: {
      replayValidationRunId: params.replayValidationRunId ?? null,
      offlineValidationRunId: params.offlineValidationRunId ?? null,
    },
    createdAt,
    updatedAt: createdAt,
  };
}

/**
 * Allocate one filesystem-safe agent run id.
 *
 * @param channel Delivery channel label.
 * @returns Agent run identifier.
 */
function allocateAgentRunId(channel: AgentRunChannel): string {
  const timestamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 8);
  return `agent_${channel}_${timestamp}_${randomBytes(3).toString("hex")}`;
}

export type { AgentRunStore } from "@/agent-runs/agent-run-store";
export type {
  AgentRunChannel,
  AgentRunIndexRow,
  AgentRunSnapshot,
  AgentRunStatus,
  AgentRunValidationLinks,
} from "@/agent-runs/types";
