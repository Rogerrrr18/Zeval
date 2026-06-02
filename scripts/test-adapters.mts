/**
 * @fileoverview End-to-end test for all 4 agent adapters.
 *
 * Run: npx tsx scripts/test-adapters.mts
 */

import { getHrAdapter } from "../src/benchmark/adapters/index";
import type { BenchmarkCase } from "../src/benchmark/types";

const testCase: BenchmarkCase = {
  caseId: "hr_test_001",
  taskId: "hr_resume_screening_v1",
  input: {
    role: "ML Engineer",
    job_description: "We need a Machine Learning Engineer with Python, TensorFlow, and deep learning experience.",
    resume: "Candidate has 5 years of Python experience, built production NLP models with TensorFlow and PyTorch, published 2 papers on deep learning.",
  },
  expected: { decision: "select" },
  source: "fixture",
};

const config = {
  apiKey: "sk-DcsnRTU8nKykcKt10Vc5RdIaRRvWNNf0VE8q9xqcCFmPwRWJ",
  baseUrl: "http://www.opcrouter.online",
  timeoutMs: 60000,
  maxRetries: 2,
};

async function test() {
  const frameworks = [
    { id: "claude_code", model: "deepseek-v4-flash" },
    { id: "codex", model: "gpt-5.5" },
    { id: "hermes", model: "mimo-v2-flash" },
    { id: "openclaw", model: "gpt-5.5" },
  ];

  let passed = 0;
  let failed = 0;

  for (const fw of frameworks) {
    console.log(`\n=== Testing ${fw.id} (${fw.model}) ===`);
    try {
      const adapter = getHrAdapter(fw.id);
      const started = Date.now();
      const submission = await adapter.submit(testCase, {
        runId: `test_${Date.now()}`,
        benchmarkId: "test",
        taskId: "test",
        matrixCell: {
          agentFramework: fw.id as any,
          model: fw.model,
          enabled: true,
        },
      }, config);
      const elapsed = Date.now() - started;

      console.log("  Status:", submission.status);
      console.log("  Decision:", submission.parsedOutput?.decision ?? "(parse failed)");
      console.log("  Reason:", (submission.parsedOutput?.reason as string)?.slice(0, 80) ?? "(none)");
      console.log("  Duration:", submission.durationMs, "ms (wall:", elapsed, "ms)");

      if (submission.status === "completed" && submission.parsedOutput?.decision) {
        console.log("  ✓ PASS");
        passed++;
      } else {
        console.log("  ✗ FAIL - no valid decision");
        failed++;
      }
    } catch (e) {
      console.error("  ✗ FAIL:", e instanceof Error ? e.message : String(e));
      failed++;
    }
  }

  console.log(`\n=== Summary: ${passed}/${passed + failed} passed ===`);
  process.exit(failed > 0 ? 1 : 0);
}

test();
