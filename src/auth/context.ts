/**
 * @fileoverview Local auth and workspace context for API routes.
 */

export type ZeroreRole = "owner" | "admin" | "member" | "viewer";

export type ZeroreRequestContext = {
  userId: string;
  organizationId: string;
  projectId: string;
  /**
   * Deprecated compatibility alias. In the Zeval data model, workspaceId maps
   * to projectId so existing stores remain isolated without a broad rewrite.
   */
  workspaceId: string;
  role: ZeroreRole;
};

const DEFAULT_DEV_CONTEXT: ZeroreRequestContext = {
  userId: "dev-user",
  organizationId: "default-org",
  projectId: "default",
  workspaceId: "default",
  role: "owner",
};

const ROLE_ORDER: Record<ZeroreRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

/**
 * Resolve a request context from headers. The MVP uses a dev fallback so local
 * demos remain one-command runnable; production can replace this with SSO/JWT.
 *
 * @param request Incoming request.
 * @returns Request context.
 */
export function getZeroreRequestContext(request: Request): ZeroreRequestContext {
  const userId =
    request.headers.get("x-zeval-user-id")?.trim() ||
    request.headers.get("x-zerore-user-id")?.trim() ||
    DEFAULT_DEV_CONTEXT.userId;
  const organizationId = sanitizeContextId(
    request.headers.get("x-zeval-organization-id")?.trim() ||
      request.headers.get("x-zeval-org-id")?.trim() ||
      DEFAULT_DEV_CONTEXT.organizationId,
  );
  const projectId = sanitizeContextId(
    request.headers.get("x-zeval-project-id")?.trim() ||
      request.headers.get("x-zeval-workspace-id")?.trim() ||
      request.headers.get("x-zerore-workspace-id")?.trim() ||
      DEFAULT_DEV_CONTEXT.projectId,
  );
  const role =
    parseRole(request.headers.get("x-zeval-role")?.trim()) ??
    parseRole(request.headers.get("x-zerore-role")?.trim()) ??
    DEFAULT_DEV_CONTEXT.role;
  return {
    userId,
    organizationId,
    projectId,
    workspaceId: projectId,
    role,
  };
}

/**
 * Build a serializable data-scope payload for queues, records and audit logs.
 *
 * @param context Current request context.
 * @returns Organization/project scope with a workspace compatibility alias.
 */
export function getZevalDataScope(context: ZeroreRequestContext): {
  organizationId: string;
  projectId: string;
  workspaceId: string;
} {
  return {
    organizationId: context.organizationId,
    projectId: context.projectId,
    workspaceId: context.workspaceId,
  };
}

/**
 * Assert that a context has at least the required role.
 *
 * @param context Current request context.
 * @param minRole Minimum required role.
 */
export function assertWorkspaceRole(context: ZeroreRequestContext, minRole: ZeroreRole): void {
  if (ROLE_ORDER[context.role] < ROLE_ORDER[minRole]) {
    throw new Error(`权限不足：需要 ${minRole}，当前为 ${context.role}。`);
  }
}

/**
 * Sanitize workspace/user identifiers for local storage paths.
 *
 * @param value Raw identifier.
 * @returns Safe identifier.
 */
export function sanitizeContextId(value: string): string {
  return value.replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "default";
}

/**
 * Parse a role header.
 *
 * @param value Raw role.
 * @returns Role when valid.
 */
function parseRole(value: string | null | undefined): ZeroreRole | null {
  if (value === "owner" || value === "admin" || value === "member" || value === "viewer") {
    return value;
  }
  return null;
}
