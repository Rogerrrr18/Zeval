/**
 * @fileoverview SSE stream for Rubric Review Copilot.
 *
 * Frontend opens an EventSource to this endpoint to receive
 * real-time review suggestions and walkthrough messages.
 */

import { NextResponse } from "next/server";
import { reviewRubricSuggestFirst, reviewRubricWalkthrough } from "@/benchmark/rubric-review";
import type { BenchmarkRubricSet } from "@/benchmark/types";

export const dynamic = "force-dynamic";

type RubricReviewRequest = {
  rubric: BenchmarkRubricSet;
  requirementText: string;
  reviewMode?: "suggest_first" | "walkthrough";
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as RubricReviewRequest;
    if (!body.rubric || !body.requirementText) {
      return NextResponse.json(
        { error: "请提供 rubric 和 requirementText。" },
        { status: 400 },
      );
    }

    const reviewMode = body.reviewMode ?? "suggest_first";
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue(encoder.encode(`:heartbeat\n\n`));

        try {
          const generator =
            reviewMode === "suggest_first"
              ? reviewRubricSuggestFirst({
                  rubric: body.rubric,
                  requirementText: body.requirementText,
                  reviewMode,
                })
              : reviewRubricWalkthrough({
                  rubric: body.rubric,
                  requirementText: body.requirementText,
                  reviewMode,
                });

          for await (const event of generator) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
          }

          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "done" })}\n\n`));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({ type: "error", message })}\n\n`,
            ),
          );
        } finally {
          setTimeout(() => {
            try {
              controller.close();
            } catch {
              // ignore
            }
          }, 1000);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Rubric review 未知错误";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
