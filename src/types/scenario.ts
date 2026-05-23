/**
 * @fileoverview Scenario-template and business-KPI evaluation contracts.
 */

import type { EvalMetricKind, EvalMetricScope, EvalRequiredField } from "@/types/eval-metric";

/**
 * One metric reference inside a business KPI mapping.
 */
export type ScenarioMetricReference = {
  source: "objective" | "subjective" | "signal";
  metricId: string;
  weight: number;
};

/**
 * One business KPI definition inside a scenario template.
 */
export type ScenarioBusinessKpi = {
  id: string;
  displayName: string;
  description: string;
  direction: "higher-is-better" | "lower-is-better";
  mappedTo: {
    primary: ScenarioMetricReference[];
    secondary: ScenarioMetricReference[];
  };
  successThreshold: number;
  degradedThreshold: number;
};

/**
 * One onboarding prompt collected before locking a customer instance.
 */
export type ScenarioOnboardingQuestion = {
  id: string;
  question: string;
};

/**
 * Scenario-level metric template inspired by G-Eval and DAG metric builders.
 */
export type ScenarioEvaluationMetric = {
  id: string;
  displayName: string;
  description: string;
  kind: Extract<EvalMetricKind, "rule" | "llm_geval" | "llm_dag" | "structured" | "trace" | "synthetic">;
  scope: EvalMetricScope;
  threshold: number;
  direction: "higher-is-better" | "lower-is-better";
  requiredFields: EvalRequiredField[];
  criteria?: string;
  evaluationSteps: string[];
  fallback: "skip" | "degrade" | "rule_proxy";
  mapsToMetricId?: string;
};

/**
 * Synthetic case seed used to generate or manually draft edge-case eval data.
 */
export type ScenarioSyntheticCaseSeed = {
  id: string;
  userPersona: string;
  situation: string;
  expectedFailureMode: string;
  targetMetrics: string[];
};

/**
 * Human-authored scenario template for one business workflow.
 */
export type ScenarioTemplate = {
  scenarioId: string;
  displayName: string;
  businessKpis: ScenarioBusinessKpi[];
  evaluationMetrics?: ScenarioEvaluationMetric[];
  syntheticCaseSeeds?: ScenarioSyntheticCaseSeed[];
  onboardingQuestions: ScenarioOnboardingQuestion[];
};

/**
 * One scored metric contribution inside a KPI result.
 */
export type ScenarioMetricContribution = {
  source: ScenarioMetricReference["source"];
  metricId: string;
  weight: number;
  rawValue: number;
  alignedScore: number;
  evidence: string;
};

/**
 * One scored KPI result emitted by the scenario evaluator.
 */
export type ScenarioKpiResult = {
  id: string;
  displayName: string;
  description: string;
  score: number;
  status: "healthy" | "degraded" | "at_risk";
  successThreshold: number;
  degradedThreshold: number;
  topEvidence: string[];
  contributions: ScenarioMetricContribution[];
};

/**
 * Full business-KPI evaluation attached to one pipeline run.
 */
export type ScenarioEvaluation = {
  scenarioId: string;
  displayName: string;
  averageScore: number;
  generatedAt: string;
  kpis: ScenarioKpiResult[];
};
