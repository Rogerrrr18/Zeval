/**
 * @fileoverview Persist static admission policies under `.zeval-db`.
 */

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AdmissionPolicy } from "./admission-policy-types.ts";

const POLICIES_DIR = path.join(process.cwd(), ".zeval-db", "admission-policies");

/**
 * Resolve the on-disk path for one project policy file.
 *
 * @param projectId Project identifier.
 * @returns Absolute JSON file path.
 */
export function admissionPolicyFilePath(projectId: string): string {
  return path.join(POLICIES_DIR, `${sanitizeProjectId(projectId)}.json`);
}

/**
 * Save an admission policy JSON file for a project.
 *
 * @param policy Policy document to persist.
 */
export async function saveAdmissionPolicy(policy: AdmissionPolicy): Promise<void> {
  await mkdir(POLICIES_DIR, { recursive: true });
  const filePath = admissionPolicyFilePath(policy.projectId);
  await writeFile(filePath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
}

/**
 * Read a persisted admission policy.
 *
 * @param projectId Project identifier.
 * @returns Policy when present; otherwise null.
 */
export async function readAdmissionPolicy(projectId: string): Promise<AdmissionPolicy | null> {
  try {
    const raw = await readFile(admissionPolicyFilePath(projectId), "utf8");
    return JSON.parse(raw) as AdmissionPolicy;
  } catch (error) {
    if (isNotFoundError(error)) return null;
    throw error;
  }
}

/**
 * List project ids that already have a persisted admission policy.
 *
 * @returns Sorted project id list.
 */
export async function listAdmissionPolicyProjectIds(): Promise<string[]> {
  try {
    const entries = await readdir(POLICIES_DIR);
    return entries
      .filter((name) => name.endsWith(".json"))
      .map((name) => name.replace(/\.json$/i, ""))
      .sort();
  } catch (error) {
    if (isNotFoundError(error)) return [];
    throw error;
  }
}

function sanitizeProjectId(projectId: string): string {
  return projectId.trim().replace(/[^a-zA-Z0-9._-]/g, "_") || "default";
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
