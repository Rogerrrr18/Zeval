/**
 * @fileoverview React context for the active project.
 *
 * Wraps the localStorage project store so every component can read/switch the
 * active project without prop drilling.  Also syncs the cookie on mount so the
 * Next.js edge proxy always has the latest project ID.
 */

"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_PROJECT,
  createProject as storeCreate,
  deleteProject as storeDelete,
  getActiveProjectId,
  listProjects,
  setActiveProjectId,
  updateProject as storeUpdate,
  type Project,
} from "@/lib/projectStore";

// ─── Context type ────────────────────────────────────────────────────────────

type ProjectContextValue = {
  projects: Project[];
  activeProjectId: string;
  activeProject: Project;
  switchProject: (id: string) => void;
  createProject: (name: string, description?: string) => Project;
  updateProject: (id: string, updates: Partial<Pick<Project, "name" | "description">>) => void;
  deleteProject: (id: string) => void;
};

const ProjectContext = createContext<ProjectContextValue>({
  projects: [DEFAULT_PROJECT],
  activeProjectId: DEFAULT_PROJECT.id,
  activeProject: DEFAULT_PROJECT,
  switchProject: () => {},
  createProject: () => DEFAULT_PROJECT,
  updateProject: () => {},
  deleteProject: () => {},
});

// ─── Provider ────────────────────────────────────────────────────────────────

export function ProjectProvider({ children }: { children: ReactNode }) {
  // Start with server-safe defaults so SSR and the initial client render agree,
  // then hydrate from localStorage in a post-mount effect to avoid the
  // SSR/CSR mismatch that triggers React hydration errors.
  const [projects, setProjects] = useState<Project[]>([DEFAULT_PROJECT]);
  const [activeProjectId, setActiveProjectIdState] = useState<string>(DEFAULT_PROJECT.id);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      const storedProjects = listProjects();
      const storedId = getActiveProjectId();
      setProjects(storedProjects);
      setActiveProjectIdState(storedId);
      // Sync cookie so the Next.js edge proxy always has the latest project ID.
      setActiveProjectId(storedId);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0] ?? DEFAULT_PROJECT;

  const switchProject = useCallback((id: string) => {
    setActiveProjectId(id);
    setActiveProjectIdState(id);
  }, []);

  const createProject = useCallback((name: string, description?: string): Project => {
    const project = storeCreate(name, description);
    setProjects(listProjects());
    return project;
  }, []);

  const updateProject = useCallback(
    (id: string, updates: Partial<Pick<Project, "name" | "description">>) => {
      storeUpdate(id, updates);
      setProjects(listProjects());
    },
    [],
  );

  const deleteProject = useCallback(
    (id: string) => {
      storeDelete(id);
      const remaining = listProjects();
      setProjects(remaining);
      if (activeProjectId === id) {
        const newId = remaining[0]?.id ?? DEFAULT_PROJECT.id;
        setActiveProjectId(newId);
        setActiveProjectIdState(newId);
      }
    },
    [activeProjectId],
  );

  return (
    <ProjectContext.Provider
      value={{
        projects,
        activeProjectId,
        activeProject,
        switchProject,
        createProject,
        updateProject,
        deleteProject,
      }}
    >
      {children}
    </ProjectContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useProject() {
  return useContext(ProjectContext);
}
