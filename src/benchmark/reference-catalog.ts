/**
 * @fileoverview Shared reference catalog for benchmark rubric metrics.
 */

import type {
  BenchmarkCapabilityDimension,
  BenchmarkMetricReference,
} from "@/benchmark/types";

export const BENCHMARK_REFERENCE_CATALOG = {
  helm: {
    referenceId: "HELM",
    title: "Holistic Evaluation of Language Models",
    sourceType: "paper",
    url: "https://arxiv.org/abs/2211.09110",
    authors: ["Liang et al."],
    publisher: "Stanford CRFM",
    year: 2022,
    benchmarkName: "HELM",
    relevance: "覆盖准确性、鲁棒性、公平性、效率等多维评测原则，可作为综合指标体系的结构依据。",
    confidence: 0.95,
  },
  bigBench: {
    referenceId: "BIG-bench",
    title: "Beyond the Imitation Game: Quantifying and extrapolating the capabilities of language models",
    sourceType: "public_benchmark",
    url: "https://arxiv.org/abs/2206.04615",
    authors: ["BIG-bench authors"],
    year: 2022,
    benchmarkName: "BIG-bench",
    relevance: "强调任务级能力覆盖、可复现实验和跨任务指标聚合，适合支撑任务完成与推理质量维度。",
    confidence: 0.95,
  },
  mtBench: {
    referenceId: "MT-Bench",
    title: "Judging LLM-as-a-Judge with MT-Bench and Chatbot Arena",
    sourceType: "paper",
    url: "https://arxiv.org/abs/2306.05685",
    authors: ["Zheng et al."],
    publisher: "LMSYS",
    year: 2023,
    benchmarkName: "MT-Bench",
    relevance: "提供 LLM-as-a-judge 的成对/打分式评审经验，可支撑主观评分准则和证据化理由要求。",
    confidence: 0.93,
  },
  ifEval: {
    referenceId: "IFEval",
    title: "IFEval: Instruction-Following Evaluation for Large Language Models",
    sourceType: "public_benchmark",
    url: "https://arxiv.org/abs/2311.07911",
    authors: ["Zhou et al."],
    year: 2023,
    benchmarkName: "IFEval",
    relevance: "将显式指令约束拆解成可验证条件，适合支撑指令遵循和格式合规指标。",
    confidence: 0.92,
  },
  ragas: {
    referenceId: "RAGAS",
    title: "RAGAS: Automated Evaluation of Retrieval Augmented Generation",
    sourceType: "paper",
    url: "https://arxiv.org/abs/2309.15217",
    authors: ["Es et al."],
    year: 2023,
    benchmarkName: "RAGAS",
    relevance: "定义 faithfulness、answer relevance、context precision/recall 等 RAG 质量指标，可支撑事实依据与引用准确性。",
    confidence: 0.93,
  },
  toolBench: {
    referenceId: "ToolBench",
    title: "ToolBench: Towards Evaluating Large Language Models for Tool Learning",
    sourceType: "public_benchmark",
    url: "https://arxiv.org/abs/2307.16789",
    authors: ["Qin et al."],
    year: 2023,
    benchmarkName: "ToolBench",
    relevance: "覆盖工具选择、参数填充、调用链成功率和任务完成，对工具使用指标有直接参考价值。",
    confidence: 0.92,
  },
  agentBench: {
    referenceId: "AgentBench",
    title: "AgentBench: Evaluating LLMs as Agents",
    sourceType: "public_benchmark",
    url: "https://arxiv.org/abs/2308.03688",
    authors: ["Liu et al."],
    year: 2023,
    benchmarkName: "AgentBench",
    relevance: "面向 Agent 的多环境任务评测，适合支撑工具使用、任务完成和交互式决策指标。",
    confidence: 0.92,
  },
  nistAiRmf: {
    referenceId: "NIST-AI-RMF",
    title: "Artificial Intelligence Risk Management Framework (AI RMF 1.0)",
    sourceType: "standard",
    url: "https://www.nist.gov/itl/ai-risk-management-framework",
    publisher: "NIST",
    year: 2023,
    relevance: "提供有效性、安全性、可靠性、公平性、隐私等风险管理维度，可支撑安全合规与人工复核要求。",
    confidence: 0.94,
  },
  sweBench: {
    referenceId: "SWE-bench",
    title: "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?",
    sourceType: "public_benchmark",
    url: "https://arxiv.org/abs/2310.06770",
    authors: ["Jimenez et al."],
    year: 2023,
    benchmarkName: "SWE-bench",
    relevance: "以真实软件问题和测试通过率评估代码修复能力，可支撑代码执行、单元测试和任务完成指标。",
    confidence: 0.92,
  },
} satisfies Record<string, BenchmarkMetricReference>;

const REFERENCES_BY_CAPABILITY: Record<BenchmarkCapabilityDimension, BenchmarkMetricReference[]> = {
  task_completion: [
    BENCHMARK_REFERENCE_CATALOG.helm,
    BENCHMARK_REFERENCE_CATALOG.bigBench,
    BENCHMARK_REFERENCE_CATALOG.mtBench,
  ],
  instruction_following: [
    BENCHMARK_REFERENCE_CATALOG.ifEval,
    BENCHMARK_REFERENCE_CATALOG.helm,
  ],
  factual_grounding: [
    BENCHMARK_REFERENCE_CATALOG.ragas,
    BENCHMARK_REFERENCE_CATALOG.helm,
  ],
  data_extraction: [
    BENCHMARK_REFERENCE_CATALOG.helm,
    BENCHMARK_REFERENCE_CATALOG.bigBench,
  ],
  reasoning_quality: [
    BENCHMARK_REFERENCE_CATALOG.bigBench,
    BENCHMARK_REFERENCE_CATALOG.mtBench,
    BENCHMARK_REFERENCE_CATALOG.helm,
  ],
  tool_use_correctness: [
    BENCHMARK_REFERENCE_CATALOG.toolBench,
    BENCHMARK_REFERENCE_CATALOG.agentBench,
  ],
  format_compliance: [
    BENCHMARK_REFERENCE_CATALOG.ifEval,
    BENCHMARK_REFERENCE_CATALOG.helm,
  ],
  latency_efficiency: [
    BENCHMARK_REFERENCE_CATALOG.helm,
    BENCHMARK_REFERENCE_CATALOG.agentBench,
  ],
  safety_policy: [
    BENCHMARK_REFERENCE_CATALOG.nistAiRmf,
    BENCHMARK_REFERENCE_CATALOG.helm,
  ],
  business_judgment: [
    BENCHMARK_REFERENCE_CATALOG.mtBench,
    BENCHMARK_REFERENCE_CATALOG.helm,
    BENCHMARK_REFERENCE_CATALOG.bigBench,
  ],
};

/**
 * Return cloned references for one benchmark capability.
 */
export function benchmarkReferencesForCapability(
  capability: BenchmarkCapabilityDimension,
): BenchmarkMetricReference[] {
  return cloneMetricReferences(REFERENCES_BY_CAPABILITY[capability] ?? [
    BENCHMARK_REFERENCE_CATALOG.helm,
  ]);
}

/**
 * Deep clone reference metadata to avoid accidental shared mutation.
 */
export function cloneMetricReferences(
  references: BenchmarkMetricReference[] | undefined,
): BenchmarkMetricReference[] {
  return (references ?? []).map((reference) => ({
    ...reference,
    authors: reference.authors ? [...reference.authors] : undefined,
  }));
}
