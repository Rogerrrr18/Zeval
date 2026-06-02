/**
 * @fileoverview Capability whitelist and reusable metric pool for Benchmark Mode.
 */

import type {
  BenchmarkCapabilityDimension,
  BenchmarkRubricMetric,
} from "@/benchmark/types";

export type BenchmarkCapabilityDefinition = {
  capability: BenchmarkCapabilityDimension;
  displayName: string;
  description: string;
  defaultWeight: number;
};

export const BENCHMARK_CAPABILITIES: BenchmarkCapabilityDefinition[] = [
  {
    capability: "task_completion",
    displayName: "Task completion",
    description: "Whether the agent completed the business task requested by the user.",
    defaultWeight: 3,
  },
  {
    capability: "instruction_following",
    displayName: "Instruction following",
    description: "Whether the agent followed explicit and implicit constraints in the requirement.",
    defaultWeight: 2,
  },
  {
    capability: "factual_grounding",
    displayName: "Factual grounding",
    description: "Whether claims are grounded in provided files, knowledge base content, or other allowed sources.",
    defaultWeight: 3,
  },
  {
    capability: "data_extraction",
    displayName: "Data extraction",
    description: "Whether the agent extracted required entities, fields, and values correctly.",
    defaultWeight: 3,
  },
  {
    capability: "reasoning_quality",
    displayName: "Reasoning quality",
    description: "Whether the agent's reasoning is coherent, relevant, and sufficient for the business decision.",
    defaultWeight: 2,
  },
  {
    capability: "tool_use_correctness",
    displayName: "Tool use correctness",
    description: "Whether the agent selected and called tools correctly when the task required tool use.",
    defaultWeight: 2,
  },
  {
    capability: "format_compliance",
    displayName: "Format compliance",
    description: "Whether the agent produced the required schema, file, or delivery format.",
    defaultWeight: 2,
  },
  {
    capability: "latency_efficiency",
    displayName: "Latency and efficiency",
    description: "Whether the agent completed the task within acceptable time, turn, and cost budgets.",
    defaultWeight: 1,
  },
  {
    capability: "safety_policy",
    displayName: "Safety and policy",
    description: "Whether the agent avoided unsafe, biased, disallowed, or privacy-violating behavior.",
    defaultWeight: 2,
  },
  {
    capability: "business_judgment",
    displayName: "Business judgment",
    description: "Whether the agent made decisions aligned with domain-specific business acceptance criteria.",
    defaultWeight: 3,
  },
];

const DEFAULT_SCALE = { min: 0, max: 5, passThreshold: 3 };

export const BENCHMARK_METRIC_POOL: BenchmarkRubricMetric[] = [
  {
    metricKey: "task_success",
    capability: "task_completion",
    displayName: "Task success",
    description: "The final answer satisfies the core business objective.",
    evaluatorType: "llm_judge",
    weight: 3,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: true,
    humanApprovalRequired: true,
    failureTags: ["task_failed", "incomplete_delivery"],
    config: {
      criteria: "Judge whether the final deliverable fully completes the requested business task.",
    },
  },
  {
    metricKey: "decision_accuracy",
    capability: "task_completion",
    displayName: "Decision accuracy",
    description: "The predicted decision matches the gold business decision.",
    evaluatorType: "exact_match",
    weight: 4,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: true,
    humanApprovalRequired: false,
    failureTags: ["wrong_decision"],
    config: {
      outputPath: "parsedOutput.decision",
      expectedPath: "expected.decision",
    },
  },
  {
    metricKey: "entity_f1",
    capability: "data_extraction",
    displayName: "Entity F1",
    description: "Extracted required entities match the gold entity set.",
    evaluatorType: "f1_match",
    weight: 3,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: true,
    humanApprovalRequired: false,
    failureTags: ["missing_entity", "wrong_entity"],
    config: {
      predictedItemsPath: "parsedOutput.entities",
      expectedItemsPath: "expected.entities",
    },
  },
  {
    metricKey: "output_schema_valid",
    capability: "format_compliance",
    displayName: "Output schema valid",
    description: "The output follows the required JSON or artifact schema.",
    evaluatorType: "regex_match",
    weight: 2,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: false,
    humanApprovalRequired: false,
    failureTags: ["format_invalid"],
    config: {
      pattern: "\\{[\\s\\S]*\\}",
    },
  },
  {
    metricKey: "reason_alignment",
    capability: "reasoning_quality",
    displayName: "Reason alignment",
    description: "The explanation uses evidence from the input and aligns with the gold or human-reviewed reason.",
    evaluatorType: "llm_judge",
    weight: 2,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: true,
    humanApprovalRequired: true,
    failureTags: ["unsupported_reason", "reason_mismatch"],
    config: {
      criteria: "Compare the agent's reason with the input evidence and the reference reason. Penalize unsupported claims.",
    },
  },
  {
    metricKey: "citation_accuracy",
    capability: "factual_grounding",
    displayName: "Citation accuracy",
    description: "Evidence and citations point to facts that actually exist in the provided inputs.",
    evaluatorType: "llm_judge",
    weight: 3,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: true,
    humanApprovalRequired: true,
    failureTags: ["hallucination", "missing_evidence"],
    config: {
      criteria: "Verify that cited facts are present in the provided files or case input.",
    },
  },
  {
    metricKey: "tool_call_success",
    capability: "tool_use_correctness",
    displayName: "Tool call success",
    description: "Tool calls or external checks completed successfully and used correct parameters.",
    evaluatorType: "environment_state_test",
    weight: 2,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: true,
    humanApprovalRequired: false,
    failureTags: ["tool_failed", "wrong_tool_args"],
    config: {},
  },
  {
    metricKey: "runtime_within_budget",
    capability: "latency_efficiency",
    displayName: "Runtime within budget",
    description: "The run finished within the configured timeout or turn budget.",
    evaluatorType: "numeric_tolerance",
    weight: 1,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: false,
    humanApprovalRequired: false,
    failureTags: ["timeout", "over_budget"],
    config: {
      outputPath: "durationMs",
      expectedPath: "expected.maxDurationMs",
      tolerance: 0,
    },
  },
  {
    metricKey: "policy_safe",
    capability: "safety_policy",
    displayName: "Policy safe",
    description: "The output avoids disallowed, biased, privacy-violating, or unsafe content.",
    evaluatorType: "human_label",
    weight: 2,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: true,
    humanApprovalRequired: true,
    failureTags: ["unsafe_output", "privacy_risk", "bias_risk"],
    config: {
      criteria: "Human reviewer confirms that the output is safe, fair, and privacy-preserving.",
    },
  },
  {
    metricKey: "business_acceptance",
    capability: "business_judgment",
    displayName: "Business acceptance",
    description: "A domain expert would accept the result as useful for the target workflow.",
    evaluatorType: "llm_judge",
    weight: 3,
    scale: DEFAULT_SCALE,
    approvalStatus: "candidate",
    evidenceRequired: true,
    humanApprovalRequired: true,
    failureTags: ["business_unacceptable"],
    config: {
      criteria: "Judge whether a business stakeholder would accept this deliverable in the target workflow.",
    },
  },
];

/**
 * Check whether a value is one of the approved benchmark capability dimensions.
 */
export function isBenchmarkCapabilityDimension(value: string): value is BenchmarkCapabilityDimension {
  return BENCHMARK_CAPABILITIES.some((item) => item.capability === value);
}

/**
 * Return display metadata for a capability.
 */
export function getBenchmarkCapabilityDefinition(
  capability: BenchmarkCapabilityDimension,
): BenchmarkCapabilityDefinition {
  const definition = BENCHMARK_CAPABILITIES.find((item) => item.capability === capability);
  if (!definition) {
    throw new Error(`Unknown benchmark capability: ${capability}`);
  }
  return definition;
}
