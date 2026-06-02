/**
 * @fileoverview Copilot-assisted rubric drafting for Benchmark Mode.
 */

import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import {
  buildRubricDraftFromRequirement,
  renderRubricReviewMarkdown,
} from "@/benchmark/rubric";
import type {
  BenchmarkCapabilityDimension,
  BenchmarkDomain,
  BenchmarkRubricSet,
} from "@/benchmark/types";

type DraftBenchmarkRubricInput = {
  title: string;
  description: string;
  domain: BenchmarkDomain;
  requirementText: string;
  preferredCapabilities?: BenchmarkCapabilityDimension[];
  useLlm?: boolean;
};

type DraftBenchmarkRubricResult = {
  rubric: BenchmarkRubricSet;
  reviewMarkdown: string;
  source: "llm" | "template";
  warnings: string[];
};

type LlmRubricPayload = {
  preferredCapabilities?: string[];
  title?: string;
  description?: string;
};

/**
 * Draft a rubric using LLM-assisted capability selection when available, with a
 * deterministic template fallback. Returned metrics are still candidates until
 * the user approves them.
 */
export async function draftBenchmarkRubric(
  input: DraftBenchmarkRubricInput,
): Promise<DraftBenchmarkRubricResult> {
  const warnings: string[] = [];
  let preferredCapabilities = input.preferredCapabilities;
  let source: "llm" | "template" = "template";
  let title = input.title;
  let description = input.description;

  if (input.useLlm) {
    try {
      const llm = await requestSiliconFlowChatCompletion(
        [
          {
            role: "system",
            content: [
              "You are Zeval Benchmark Copilot.",
              "Extract the best benchmark capability dimensions for the user's real business task.",
              "Return JSON only.",
              "Allowed capabilities: task_completion, instruction_following, factual_grounding, data_extraction, reasoning_quality, tool_use_correctness, format_compliance, latency_efficiency, safety_policy, business_judgment.",
              'Output schema: {"preferredCapabilities":["task_completion"],"title":"...","description":"..."}',
            ].join("\n"),
          },
          {
            role: "user",
            content: [
              `Title: ${input.title}`,
              `Domain: ${input.domain}`,
              `Description: ${input.description}`,
              "Requirement:",
              input.requirementText,
            ].join("\n\n"),
          },
        ],
        { stage: "benchmark_rubric_draft", temperature: 0.2, seed: 42 },
      );
      const parsed = parseJsonObjectFromLlmOutput(llm) as LlmRubricPayload;
      const capabilities = (parsed.preferredCapabilities ?? [])
        .filter(isBenchmarkCapabilityDimension);
      if (capabilities.length > 0) {
        preferredCapabilities = capabilities;
        source = "llm";
      }
      if (typeof parsed.title === "string" && parsed.title.trim()) {
        title = parsed.title.trim();
      }
      if (typeof parsed.description === "string" && parsed.description.trim()) {
        description = parsed.description.trim();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      warnings.push(`LLM rubric draft failed, used template fallback: ${message}`);
    }
  }

  const rubric = buildRubricDraftFromRequirement({
    title,
    description,
    domain: input.domain,
    requirementText: input.requirementText,
    preferredCapabilities,
  });

  return {
    rubric: {
      ...rubric,
      generatedBy: source === "llm" ? "copilot" : rubric.generatedBy,
    },
    reviewMarkdown: renderRubricReviewMarkdown(rubric),
    source,
    warnings,
  };
}

function isBenchmarkCapabilityDimension(value: string): value is BenchmarkCapabilityDimension {
  return (
    value === "task_completion" ||
    value === "instruction_following" ||
    value === "factual_grounding" ||
    value === "data_extraction" ||
    value === "reasoning_quality" ||
    value === "tool_use_correctness" ||
    value === "format_compliance" ||
    value === "latency_efficiency" ||
    value === "safety_policy" ||
    value === "business_judgment"
  );
}
