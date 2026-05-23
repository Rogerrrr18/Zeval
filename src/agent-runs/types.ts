/**
 * @fileoverview Contracts for persisted agent execution tracking records.
 */

/**
 * Delivery channel for one agent run record.
 */
export type AgentRunChannel = "prompt" | "issue" | "pr";

/**
 * Manual lifecycle state for one agent run.
 */
export type AgentRunStatus = "draft" | "queued" | "running" | "blocked" | "completed";

/**
 * Validation links attached to one tracked agent run.
 */
export type AgentRunValidationLinks = {
  replayValidationRunId: string | null;
  offlineValidationRunId: string | null;
};

/**
 * Validation context captured when the agent run was first created.
 */
export type AgentRunStartingValidationLinks = AgentRunValidationLinks;

/**
 * Full persisted agent run snapshot.
 */
export type AgentRunSnapshot = {
  schemaVersion: 1;
  agentRunId: string;
  packageId: string;
  channel: AgentRunChannel;
  status: AgentRunStatus;
  title: string;
  summary: string;
  content: string;
  notes: string;
  startingValidationLinks: AgentRunStartingValidationLinks;
  validationLinks: AgentRunValidationLinks;
  createdAt: string;
  updatedAt: string;
};

/**
 * Lightweight index row for agent run listing.
 */
export type AgentRunIndexRow = {
  agentRunId: string;
  packageId: string;
  channel: AgentRunChannel;
  status: AgentRunStatus;
  title: string;
  summary: string;
  startingValidationLinks: AgentRunStartingValidationLinks;
  validationLinks: AgentRunValidationLinks;
  createdAt: string;
  updatedAt: string;
};
