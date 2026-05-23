/**
 * @fileoverview Built-in scenario template registry.
 */

import { TOB_CUSTOMER_SUPPORT_SCENARIO } from "@/scenarios/toB-customer-support";
import type { ScenarioTemplate } from "@/types/scenario";

/**
 * Built-in scenario templates available in the current MVP.
 */
export const BUILTIN_SCENARIO_TEMPLATES: ScenarioTemplate[] = [TOB_CUSTOMER_SUPPORT_SCENARIO];

/**
 * Lightweight UI options for workbench selection.
 */
export const SCENARIO_OPTIONS = BUILTIN_SCENARIO_TEMPLATES.map((item) => ({
  scenarioId: item.scenarioId,
  displayName: item.displayName,
  onboardingQuestions: item.onboardingQuestions,
  evaluationMetrics: item.evaluationMetrics ?? [],
  syntheticCaseSeeds: item.syntheticCaseSeeds ?? [],
}));

/**
 * Resolve one built-in scenario template by id.
 *
 * @param scenarioId Scenario identifier.
 * @returns Matched template or `null`.
 */
export function getScenarioTemplateById(scenarioId: string): ScenarioTemplate | null {
  return BUILTIN_SCENARIO_TEMPLATES.find((item) => item.scenarioId === scenarioId) ?? null;
}
