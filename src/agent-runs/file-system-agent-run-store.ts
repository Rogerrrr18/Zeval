/**
 * @fileoverview Filesystem-backed agent run store.
 */

import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentRunStore } from "@/agent-runs/agent-run-store";
import type { AgentRunIndexRow, AgentRunSnapshot, AgentRunStatus } from "@/agent-runs/types";

const AGENT_RUN_ROOT = path.join("artifacts", "agent-runs");

/**
 * Filesystem implementation for agent runs.
 */
export class FileSystemAgentRunStore implements AgentRunStore {
  /**
   * @inheritdoc
   */
  async save(snapshot: AgentRunSnapshot): Promise<void> {
    const runDirectory = path.join(AGENT_RUN_ROOT, sanitizeAgentRunId(snapshot.agentRunId));
    await mkdir(runDirectory, { recursive: true });
    await writeFile(path.join(runDirectory, "manifest.json"), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  }

  /**
   * @inheritdoc
   */
  async list(packageId?: string): Promise<AgentRunIndexRow[]> {
    let names: string[] = [];
    try {
      names = await readdir(AGENT_RUN_ROOT);
    } catch {
      return [];
    }

    const rows: Array<AgentRunIndexRow & { mtimeMs: number }> = [];
    for (const name of names) {
      const manifestPath = path.join(AGENT_RUN_ROOT, name, "manifest.json");
      try {
        const [raw, fileStat] = await Promise.all([readFile(manifestPath, "utf8"), stat(manifestPath)]);
        const parsed = normalizeAgentRunSnapshot(JSON.parse(raw) as AgentRunSnapshot);
        if (packageId && parsed.packageId !== packageId) {
          continue;
        }
        rows.push({
          agentRunId: parsed.agentRunId,
          packageId: parsed.packageId,
          channel: parsed.channel,
          status: parsed.status,
          title: parsed.title,
          summary: parsed.summary,
          startingValidationLinks: parsed.startingValidationLinks,
          validationLinks: parsed.validationLinks,
          createdAt: parsed.createdAt,
          updatedAt: parsed.updatedAt,
          mtimeMs: fileStat.mtimeMs,
        });
      } catch {
        continue;
      }
    }

    rows.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return rows.map((row) => ({
      agentRunId: row.agentRunId,
      packageId: row.packageId,
      channel: row.channel,
      status: row.status,
      title: row.title,
      summary: row.summary,
      startingValidationLinks: row.startingValidationLinks,
      validationLinks: row.validationLinks,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * @inheritdoc
   */
  async read(agentRunId: string): Promise<AgentRunSnapshot | null> {
    const manifestPath = path.join(AGENT_RUN_ROOT, sanitizeAgentRunId(agentRunId), "manifest.json");
    try {
      const raw = await readFile(manifestPath, "utf8");
      return normalizeAgentRunSnapshot(JSON.parse(raw) as AgentRunSnapshot);
    } catch {
      return null;
    }
  }

  /**
   * @inheritdoc
   */
  async update(
    agentRunId: string,
    patch: {
      status?: AgentRunStatus;
      notes?: string;
      replayValidationRunId?: string | null;
      offlineValidationRunId?: string | null;
    },
  ): Promise<AgentRunSnapshot | null> {
    const current = await this.read(agentRunId);
    if (!current) {
      return null;
    }

    const nextSnapshot: AgentRunSnapshot = {
      ...current,
      status: patch.status ?? current.status,
      notes: patch.notes ?? current.notes,
      validationLinks: {
        replayValidationRunId:
          patch.replayValidationRunId !== undefined
            ? patch.replayValidationRunId
            : current.validationLinks.replayValidationRunId,
        offlineValidationRunId:
          patch.offlineValidationRunId !== undefined
            ? patch.offlineValidationRunId
            : current.validationLinks.offlineValidationRunId,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.save(nextSnapshot);
    return nextSnapshot;
  }
}

/**
 * Sanitize agent run ids before they are used as directory names.
 *
 * @param agentRunId Raw agent run identifier.
 * @returns Safe directory name.
 */
export function sanitizeAgentRunId(agentRunId: string): string {
  return agentRunId.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "agent-run";
}

/**
 * Normalize one parsed agent run snapshot for backward compatibility.
 *
 * @param snapshot Parsed manifest payload.
 * @returns Snapshot with defaulted validation links.
 */
function normalizeAgentRunSnapshot(snapshot: AgentRunSnapshot): AgentRunSnapshot {
  return {
    ...snapshot,
    validationLinks: {
      replayValidationRunId: snapshot.validationLinks?.replayValidationRunId ?? null,
      offlineValidationRunId: snapshot.validationLinks?.offlineValidationRunId ?? null,
    },
    startingValidationLinks: {
      replayValidationRunId:
        snapshot.startingValidationLinks?.replayValidationRunId ??
        snapshot.validationLinks?.replayValidationRunId ??
        null,
      offlineValidationRunId:
        snapshot.startingValidationLinks?.offlineValidationRunId ??
        snapshot.validationLinks?.offlineValidationRunId ??
        null,
    },
  };
}
