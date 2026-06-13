/**
 * @fileoverview Tests for submission progress counter normalization.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeSubmissionProgressCounts } from "./progress-sync.ts";

describe("computeSubmissionProgressCounts", () => {
  it("PS-01: derives matrix totals from submissions without double counting", () => {
    const matrix = [{ agentFramework: "zeval", model: "m1", enabled: true, timeoutMs: 1000, maxTurns: 1, concurrency: 1 }];
    const cases = [{ caseId: "c1", taskId: "t", input: {}, expected: {} }, { caseId: "c2", taskId: "t", input: {}, expected: {} }];
    const submissions = [
      { submissionId: "s1", runId: "r", benchmarkId: "b", taskId: "t", caseId: "c1", agentFramework: "zeval", model: "m1", status: "completed" as const, rawOutput: "" },
      { submissionId: "s2", runId: "r", benchmarkId: "b", taskId: "t", caseId: "c2", agentFramework: "zeval", model: "m1", status: "completed" as const, rawOutput: "" },
    ];
    const counts = computeSubmissionProgressCounts(matrix, cases, submissions);
    assert.equal(counts.completedSubmissions, 2);
    assert.equal(counts.matrixProgress[0]?.completed, 2);
    assert.equal(counts.matrixProgress[0]?.total, 2);
  });
});
