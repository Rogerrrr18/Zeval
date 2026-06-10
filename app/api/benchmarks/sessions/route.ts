/**
 * @fileoverview Benchmark workspace session history API.
 */

import { NextResponse } from "next/server";
import {
  readBenchmarkWorkspaceSessions,
  writeBenchmarkWorkspaceSessions,
  type BenchmarkWorkspaceSession,
} from "@/benchmark/session-store";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId") ?? "default";
  const index = await readBenchmarkWorkspaceSessions(projectId);
  return NextResponse.json(index);
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as {
      projectId?: string;
      activeSessionId?: string | null;
      sessions?: BenchmarkWorkspaceSession[];
    };
    const projectId = body.projectId ?? "default";

    await writeBenchmarkWorkspaceSessions({
      projectId,
      activeSessionId: body.activeSessionId ?? null,
      sessions: Array.isArray(body.sessions) ? body.sessions : [],
      updatedAt: new Date().toISOString(),
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `保存评测任务失败: ${message}` }, { status: 500 });
  }
}
