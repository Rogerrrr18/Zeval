/**
 * @fileoverview Tests for benchmark progress recovery and checkpoint resume.
 */

import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import { readBenchmarkRunStatus, shouldKeepRunStreamOpen, type BenchmarkRunStatus } from "./progress-recovery.ts";
import { readBenchmarkRunArtifact } from "./progress-artifacts.ts";

const RUNS_DIR = path.join(process.cwd(), ".zeval-db", "benchmark-runs");
const TEST_RUN_ID = "benchmark_generic_test_resume_001";

describe("benchmark progress recovery", () => {
  before(async () => {
    await mkdir(RUNS_DIR, { recursive: true });
    await writeFile(
      path.join(RUNS_DIR, `${TEST_RUN_ID}.json`),
      `${JSON.stringify({
        runId: TEST_RUN_ID,
        updatedAt: new Date(Date.now() - 300_000).toISOString(),
        snapshot: {
          runId: TEST_RUN_ID,
          phase: "evaluating",
          updatedAt: new Date(Date.now() - 300_000).toISOString(),
          totalSubmissions: 10,
          completedSubmissions: 4,
          failedSubmissions: 0,
          evaluatedMetrics: 8,
          totalMetrics: 30,
          matrixProgress: [],
          recentItems: [],
          events: [],
        },
        genericRun: {
          requirementText: "外贸客服",
          task: {
            benchmarkId: "bench",
            taskId: "task",
            title: "test",
            requirementText: "外贸客服",
            rubric: { rubricId: "r1", title: "r", description: "", modules: [] },
          },
          cases: [{ caseId: "case_1", taskId: "task", input: { sessionId: "s1" }, expected: {} }],
          submissions: [{ submissionId: "sub_1", runId: TEST_RUN_ID, status: "completed" }],
          metricResults: [{ submissionId: "sub_1", metricKey: "m1", runId: TEST_RUN_ID }],
        },
      }, null, 2)}\n`,
      "utf8",
    );
  });

  after(async () => {
    await rm(path.join(RUNS_DIR, `${TEST_RUN_ID}.json`), { force: true });
  });

  it("PR-01: returns genericRun checkpoint from artifact reader", async () => {
    const artifact = await readBenchmarkRunArtifact(TEST_RUN_ID);
    assert.ok(artifact?.genericRun);
    assert.equal(artifact.genericRun.submissions.length, 1);
    assert.equal(artifact.genericRun.metricResults.length, 1);
  });

  it("PR-02: stale non-terminal runs surface as interrupted + resumable", async () => {
    const status = await readBenchmarkRunStatus(TEST_RUN_ID);
    assert.equal(status.source, "artifact");
    assert.equal(status.stale, true);
    assert.equal(status.resumable, true);
    assert.equal(status.snapshot?.phase, "interrupted");
    assert.match(status.snapshot?.error ?? "", /继续评测/);
  });
});

describe("shouldKeepRunStreamOpen", () => {
  it("RS-01: keeps stream open for resumable interrupted checkpoints", () => {
    const status: BenchmarkRunStatus = {
      source: "artifact",
      stale: true,
      resumable: true,
      snapshot: {
        runId: "benchmark_generic_test",
        phase: "interrupted",
        totalSubmissions: 50,
        completedSubmissions: 50,
        failedSubmissions: 0,
        evaluatedMetrics: 8,
        totalMetrics: 350,
        matrixProgress: [],
        recentItems: [],
        events: [],
      },
    };
    assert.equal(shouldKeepRunStreamOpen(status), true);
  });

  it("RS-02: closes stream for completed runs", () => {
    const status: BenchmarkRunStatus = {
      source: "artifact",
      stale: false,
      resumable: false,
      snapshot: {
        runId: "benchmark_generic_test",
        phase: "completed",
        totalSubmissions: 50,
        completedSubmissions: 50,
        failedSubmissions: 0,
        evaluatedMetrics: 350,
        totalMetrics: 350,
        matrixProgress: [],
        recentItems: [],
        events: [],
      },
    };
    assert.equal(shouldKeepRunStreamOpen(status), false);
  });
});
