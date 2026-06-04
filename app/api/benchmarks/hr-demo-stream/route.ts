/**
 * @fileoverview SSE stream for real-time benchmark progress.
 *
 * Frontend opens an EventSource to this endpoint with ?runId=xxx
 * to receive live progress updates while the benchmark is running.
 */

import { benchmarkProgress } from "@/benchmark/progress";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const runId = url.searchParams.get("runId");

  if (!runId) {
    return new Response(JSON.stringify({ error: "Missing runId query param" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      // Send initial heartbeat
      controller.enqueue(encoder.encode(`:heartbeat\n\n`));

      const unsubscribe = benchmarkProgress.subscribe(runId, (snapshot) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));

          if (snapshot.phase === "completed" || snapshot.phase === "failed") {
            // Give client a moment to receive final event before closing
            setTimeout(() => {
              try {
                controller.close();
              } catch {
                // already closed
              }
            }, 3000);
            unsubscribe();
          }
        } catch {
          // Stream already closed
          unsubscribe();
        }
      });

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`:heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

      // Cleanup on client disconnect
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ignore
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
