import { readFile } from "node:fs/promises";
import path from "node:path";
import * as csvParser from "../../src/parsers/csvParser.ts";
import * as goldSetFileStore from "../../src/calibration/goldSetFileStore.ts";
import * as goldSetScaffold from "../../src/calibration/goldSetScaffold.ts";
import type {
  GoldSetAnnotationTaskRecord,
  GoldSetCaseRecord,
  GoldSetLabelDraftRecord,
} from "../../src/calibration/types.ts";
import type { RawChatlogRow } from "../../src/types/pipeline.ts";

const csvParserApi = resolveInteropModule(csvParser);
const goldSetFileStoreApi = resolveInteropModule(goldSetFileStore);
const goldSetScaffoldApi = resolveInteropModule(goldSetScaffold);

const DEFAULT_FIXTURES = [
  "mock-chatlog/raw-data/ecommerce-angry-escalation.csv",
  "mock-chatlog/raw-data/long-dialog-emotional-rp.csv",
  "mock-chatlog/raw-data/support-refund-short.csv",
  "mock-chatlog/raw-data/tech-onboarding-faq.csv",
];

void main().catch((error) => {
  console.error("[gold:expand:fixtures] failed", error);
  process.exitCode = 1;
});

/**
 * Expand one gold set from local fixture chatlogs using deterministic session
 * windows. This is a bootstrap tool, not a substitute for human labels.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const version = getFlagValue(args, "--version") ?? "v2";
  const targetCount = Number(getFlagValue(args, "--target-count") ?? "12");
  const assignee = getFlagValue(args, "--assignee");
  const reviewer = getFlagValue(args, "--reviewer") ?? "reviewer";
  const fixtures = getFlagValue(args, "--fixtures")?.split(",").map((item) => item.trim()).filter(Boolean) ?? DEFAULT_FIXTURES;
  const currentCases = await goldSetFileStoreApi.readGoldSetCases(version);
  const needed = Math.max(0, targetCount - currentCases.length);
  if (needed === 0) {
    console.info(`[gold:expand:fixtures] version=${version} already has ${currentCases.length} cases`);
    return;
  }

  const candidates: Array<{
    caseRecord: GoldSetCaseRecord;
    task: GoldSetAnnotationTaskRecord;
    draft: GoldSetLabelDraftRecord;
  }> = [];
  for (const fixture of fixtures) {
    const rows = csvParserApi.parseCsvRows(await readFile(fixture, "utf8"));
    candidates.push(...buildFixtureCandidates(rows, fixture, version, assignee, reviewer));
  }

  let saved = 0;
  for (const candidate of candidates) {
    if (saved >= needed) {
      break;
    }
    const result = await goldSetFileStoreApi.appendGoldSetCandidate(version, candidate);
    if (!result.alreadyExists) {
      saved += 1;
    }
  }

  const nextCases = await goldSetFileStoreApi.readGoldSetCases(version);
  console.info(`[gold:expand:fixtures] version=${version} saved=${saved} total=${nextCases.length}`);
}

/**
 * Build fixture-window candidate records.
 *
 * @param rows Parsed raw rows.
 * @param fixturePath Source fixture path.
 * @param version Gold-set version.
 * @param assignee Optional assignee.
 * @param reviewer Reviewer.
 * @returns Candidate records.
 */
function buildFixtureCandidates(
  rows: RawChatlogRow[],
  fixturePath: string,
  version: string,
  assignee: string | undefined,
  reviewer: string,
): Array<{
  caseRecord: GoldSetCaseRecord;
  task: GoldSetAnnotationTaskRecord;
  draft: GoldSetLabelDraftRecord;
}> {
  const bySession = new Map<string, RawChatlogRow[]>();
  rows.forEach((row) => {
    const current = bySession.get(row.sessionId) ?? [];
    current.push(row);
    bySession.set(row.sessionId, current);
  });

  const fileBase = path.basename(fixturePath, path.extname(fixturePath)).replace(/[^a-z0-9_-]+/gi, "_");
  const candidates: Array<{
    caseRecord: GoldSetCaseRecord;
    task: GoldSetAnnotationTaskRecord;
    draft: GoldSetLabelDraftRecord;
  }> = [];

  for (const [sessionId, sessionRows] of bySession.entries()) {
    buildWindows(sessionRows).forEach((windowRows, index) => {
      const caseRecord: GoldSetCaseRecord = {
        caseId: `fixture_${fileBase}_${sessionId}_w${String(index + 1).padStart(2, "0")}`,
        sceneId: inferSceneId(fileBase),
        sessionId,
        tags: ["source:fixture", `fixture:${fileBase}`, `window:${index + 1}`],
        rawRows: windowRows,
        notes: `Generated from fixture ${fixturePath}, session ${sessionId}, window ${index + 1}. Needs human review.`,
      };
      const [task] = goldSetScaffoldApi.buildGoldSetAnnotationTasks([caseRecord], {
        goldSetVersion: version,
        sourceCasesPath: fixturePath,
        createdAt: new Date().toISOString(),
        assignees: assignee ? [assignee] : undefined,
        reviewers: [reviewer],
        defaultPriority: "P1",
      });
      candidates.push({
        caseRecord,
        task: task!,
        draft: goldSetScaffoldApi.buildGoldSetLabelDraftTemplate(task!),
      });
    });
  }

  return candidates;
}

/**
 * Build short windows from a session.
 *
 * @param rows Session rows.
 * @returns Candidate windows.
 */
function buildWindows(rows: RawChatlogRow[]): RawChatlogRow[][] {
  if (rows.length <= 8) {
    return [rows];
  }
  const windows: RawChatlogRow[][] = [];
  for (let start = 0; start < rows.length && windows.length < 4; start += 4) {
    const windowRows = rows.slice(start, Math.min(start + 8, rows.length));
    if (windowRows.length >= 4) {
      windows.push(windowRows);
    }
  }
  return windows;
}

/**
 * Infer a coarse scene id from a fixture file name.
 *
 * @param fileBase Fixture base name.
 * @returns Scene id.
 */
function inferSceneId(fileBase: string): string {
  if (fileBase.includes("tech")) {
    return "enterprise-it";
  }
  if (fileBase.includes("ecommerce")) {
    return "ecommerce-support";
  }
  if (fileBase.includes("support")) {
    return "customer-support";
  }
  return "emotional-support";
}

function getFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index < 0) {
    return undefined;
  }
  return args[index + 1];
}

function resolveInteropModule<T>(module: T): T {
  return ((module as T & { default?: T }).default ?? module) as T;
}
