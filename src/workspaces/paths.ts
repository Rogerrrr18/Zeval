/**
 * @fileoverview Workspace-aware local path helpers.
 */

import path from "node:path";
import { sanitizeContextId } from "@/auth/context";

/**
 * Resolve a local path inside a workspace root.
 *
 * @param workspaceId Workspace identifier.
 * @param segments Path segments under the workspace root.
 * @returns Local path.
 */
export function resolveWorkspacePath(workspaceId: string, ...segments: string[]): string {
  return path.join("workspaces", sanitizeContextId(workspaceId), ...segments);
}

/**
 * Resolve an artifact path for global demo data or workspace-specific data.
 *
 * @param workspaceId Workspace identifier.
 * @param legacyPath Existing root-level path.
 * @returns Workspace path when enabled, otherwise legacy path.
 */
export function maybeWorkspacePath(workspaceId: string | undefined, legacyPath: string): string {
  const workspaceStorage = process.env.ZEVAL_WORKSPACE_STORAGE ?? process.env.ZERORE_WORKSPACE_STORAGE;
  if (workspaceStorage !== "enabled" || !workspaceId) {
    return legacyPath;
  }
  return resolveWorkspacePath(workspaceId, legacyPath);
}
