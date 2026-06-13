import { benchmarkProgress } from "@/benchmark/progress";
import { readBenchmarkRunStatus, shouldKeepRunStreamOpen } from "@/benchmark/progress-recovery";
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
    async start(controller) {
      controller.enqueue(encoder.encode(":heartbeat\n\n"));

      const recovered = await readBenchmarkRunStatus(runId);
      if (recovered.snapshot) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(recovered.snapshot)}\n\n`));
      }

      if (!shouldKeepRunStreamOpen(recovered)) {
        controller.close();
        return;
      }

      const unsubscribe = benchmarkProgress.subscribe(runId, (snapshot) => {        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(snapshot)}\n\n`));

          if (snapshot.phase === "completed") {
            setTimeout(() => {
              try {
                controller.close();
              } catch {
                // already closed
              }
            }, 3000);
            unsubscribe();
          }        } catch {
          unsubscribe();
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(":heartbeat\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15000);

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
