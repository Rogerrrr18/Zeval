/**
 * @fileoverview CLI workspace context — provides ZeroreRequestContext for headless operation.
 *
 * Reads from environment variables or falls back to sensible dev defaults so the
 * CLI works out-of-the-box without any additional configuration.
 *
 * Override with:
 *   ZEVAL_USER_ID, ZEVAL_ORG_ID, ZEVAL_PROJECT_ID
 */

import type { ZeroreRequestContext } from "@/auth/context";

/**
 * Build a ZeroreRequestContext suitable for CLI / headless operation.
 *
 * @param opts Optional overrides (e.g. --project-id flag value).
 * @returns Populated request context.
 */
export function buildCliContext(opts?: { projectId?: string }): ZeroreRequestContext {
  const projectId = opts?.projectId ?? process.env.ZEVAL_PROJECT_ID ?? "default";
  return {
    userId: process.env.ZEVAL_USER_ID ?? "cli-user",
    organizationId: process.env.ZEVAL_ORG_ID ?? "default-org",
    projectId,
    workspaceId: projectId,
    role: "owner",
  };
}
