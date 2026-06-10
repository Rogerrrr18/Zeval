/**
 * @fileoverview Browser-side project registry backed by localStorage.
 *
 * Projects are lightweight metadata objects.  All backend data is already
 * namespaced by projectId (the DB layer partitions every record under
 * `.zeval-db/<projectId>/`).  Switching projects therefore instantly changes
 * which data the user sees without any server-side user accounts.
 */

export type Project = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
};

const PROJECTS_KEY = "zeval:projects";
const ACTIVE_KEY = "zeval:active-project-id";
const COOKIE_NAME = "zeval-project-id";

export const DEFAULT_PROJECT: Project = {
  id: "default",
  name: "默认项目",
  description: "系统默认项目",
  createdAt: "2024-01-01T00:00:00.000Z",
};

/** Read the full project list from localStorage. Always returns at least one entry. */
export function listProjects(): Project[] {
  if (typeof window === "undefined") return [DEFAULT_PROJECT];
  try {
    const raw = window.localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [DEFAULT_PROJECT];
    const parsed = JSON.parse(raw) as Project[];
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : [DEFAULT_PROJECT];
  } catch {
    return [DEFAULT_PROJECT];
  }
}

/** Get the currently active project ID. */
export function getActiveProjectId(): string {
  if (typeof window === "undefined") return DEFAULT_PROJECT.id;
  try {
    return window.localStorage.getItem(ACTIVE_KEY) ?? DEFAULT_PROJECT.id;
  } catch {
    return DEFAULT_PROJECT.id;
  }
}

/**
 * Persist the active project ID to both localStorage and a cookie.
 * The cookie is read by the Next.js edge proxy and forwarded as x-zeval-project-id.
 */
export function setActiveProjectId(id: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_KEY, id);
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(id)};path=/;max-age=31536000;samesite=lax`;
  } catch {
    // localStorage can be unavailable in restricted contexts.
  }
}

/** Persist the full project list. */
export function saveProjects(projects: Project[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(projects));
  } catch {}
}

/** Create a new project, persist it, and return the new record. */
export function createProject(name: string, description?: string): Project {
  const id = `proj-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const project: Project = {
    id,
    name: name.trim() || "未命名项目",
    description: description?.trim(),
    createdAt: new Date().toISOString(),
  };
  const projects = listProjects();
  saveProjects([...projects, project]);
  return project;
}

/** Update name/description for an existing project. */
export function updateProject(id: string, updates: Partial<Pick<Project, "name" | "description">>): void {
  const projects = listProjects().map((p) =>
    p.id === id ? { ...p, ...updates } : p,
  );
  saveProjects(projects);
}

/** Delete a project by ID.  The "default" project cannot be removed. */
export function deleteProject(id: string): void {
  if (id === DEFAULT_PROJECT.id) return;
  const remaining = listProjects().filter((p) => p.id !== id);
  saveProjects(remaining.length > 0 ? remaining : [DEFAULT_PROJECT]);
}
