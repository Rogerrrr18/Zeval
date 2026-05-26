/**
 * @fileoverview Sidebar project switcher.
 *
 * Renders the active project name with a dropdown that lets the user:
 *   – switch between existing projects
 *   – create a new project (inline form)
 *   – delete non-default projects
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DEFAULT_PROJECT, type Project } from "@/lib/projectStore";
import { useProject } from "./ProjectContext";
import styles from "./projectSwitcher.module.css";

// ─── Icons (inline SVG, no extra dep) ────────────────────────────────────────

function ChevronDown() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProjectSwitcher() {
  const { projects, activeProject, switchProject, createProject, deleteProject } = useProject();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
        setCreating(false);
        setConfirmDeleteId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Focus input when create form opens
  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const handleSwitch = useCallback(
    (project: Project) => {
      switchProject(project.id);
      setOpen(false);
      setCreating(false);
      setConfirmDeleteId(null);
    },
    [switchProject],
  );

  const handleCreate = useCallback(() => {
    const name = newName.trim();
    if (!name) return;
    const project = createProject(name, newDesc.trim() || undefined);
    switchProject(project.id);
    setNewName("");
    setNewDesc("");
    setCreating(false);
    setOpen(false);
  }, [newName, newDesc, createProject, switchProject]);

  const handleDelete = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (confirmDeleteId === id) {
        deleteProject(id);
        setConfirmDeleteId(null);
      } else {
        setConfirmDeleteId(id);
      }
    },
    [confirmDeleteId, deleteProject],
  );

  return (
    <div className={styles.root} ref={dropdownRef}>
      {/* Trigger */}
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        onClick={() => {
          setOpen((v) => !v);
          setCreating(false);
          setConfirmDeleteId(null);
        }}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={styles.triggerIcon}>
          <FolderIcon />
        </span>
        <span className={styles.triggerName}>{activeProject.name}</span>
        <span className={styles.triggerChevron}>
          <ChevronDown />
        </span>
      </button>

      {/* Dropdown */}
      {open && (
        <div className={styles.dropdown} role="listbox">
          {/* Project list */}
          <div className={styles.list}>
            {projects.map((project) => {
              const isActive = project.id === activeProject.id;
              const isConfirm = confirmDeleteId === project.id;
              return (
                <div
                  key={project.id}
                  className={`${styles.item} ${isActive ? styles.itemActive : ""}`}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => handleSwitch(project)}
                >
                  <span className={styles.itemCheck}>{isActive && <CheckIcon />}</span>
                  <span className={styles.itemName}>{project.name}</span>
                  {project.id !== DEFAULT_PROJECT.id && (
                    <button
                      type="button"
                      className={`${styles.deleteBtn} ${isConfirm ? styles.deleteBtnConfirm : ""}`}
                      onClick={(e) => handleDelete(project.id, e)}
                      title={isConfirm ? "再次点击确认删除" : "删除项目"}
                    >
                      {isConfirm ? "确认?" : <TrashIcon />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className={styles.divider} />

          {/* New project form / button */}
          {creating ? (
            <div className={styles.createForm}>
              <input
                ref={inputRef}
                type="text"
                className={styles.createInput}
                placeholder="项目名称"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                    setNewDesc("");
                  }
                }}
                maxLength={48}
              />
              <input
                type="text"
                className={styles.createInput}
                placeholder="描述（可选）"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") {
                    setCreating(false);
                    setNewName("");
                    setNewDesc("");
                  }
                }}
                maxLength={120}
              />
              <div className={styles.createActions}>
                <button
                  type="button"
                  className={styles.createConfirmBtn}
                  onClick={handleCreate}
                  disabled={!newName.trim()}
                >
                  创建
                </button>
                <button
                  type="button"
                  className={styles.createCancelBtn}
                  onClick={() => {
                    setCreating(false);
                    setNewName("");
                    setNewDesc("");
                  }}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={styles.newProjectBtn}
              onClick={() => setCreating(true)}
            >
              <PlusIcon />
              新建项目
            </button>
          )}
        </div>
      )}
    </div>
  );
}
