import { NextResponse } from "next/server";
import { benchmarkProgress } from "@/benchmark/progress";
import { readBenchmarkRunArtifact } from "@/benchmark/progress-artifacts";
import { runGenericBenchmarkStreaming } from "@/benchmark/generic-run";
import { interruptBenchmarkRun } from "@/benchmark/run-cancellation";
import type { BenchmarkRubricSet } from "@/benchmark/types";
import type { BenchmarkDatasetSnapshot } from "@/benchmark/session-store";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      requirementText?: string;
      rubric?: BenchmarkRubricSet;
      dataset?: BenchmarkDatasetSnapshot;
      resumeRunId?: string;
    };

    if (!body.requirementText?.trim() || !body.rubric) {
      return NextResponse.json(
        { error: "请先提供评测需求和评分标准。" },
        { status: 400 },
      );
    }
    if (!body.dataset?.rawRows?.length) {
      return NextResponse.json(
        { error: "请先上传评测数据，并完成字段对齐和清洗。" },
        { status: 400 },
      );
    }

    const runId = body.resumeRunId?.startsWith("benchmark_generic_")
      ? body.resumeRunId
      : `benchmark_generic_${Date.now()}`;

    void runGenericBenchmarkStreaming({
      runId,
      requirementText: body.requirementText,
      rubric: body.rubric,
      dataset: body.dataset,
      resumeRunId: body.resumeRunId,
    }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const artifact = await readBenchmarkRunArtifact(runId);
      const hasCheckpoint = Boolean(
        artifact?.genericRun &&
        (artifact.genericRun.submissions.length > 0 || artifact.genericRun.metricResults.length > 0),
      );
      if (hasCheckpoint && /EPERM|checkpoint|operation not permitted/i.test(message)) {
        interruptBenchmarkRun(runId, "checkpoint 写入失败，可点击「继续评测」从断点恢复。");
        return;
      }
      benchmarkProgress.setPhase(runId, "failed", message);
    });

    return NextResponse.json({ runId });
  } catch (error) {
    const message = error instanceof Error ? error.message : "启动评测失败";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
