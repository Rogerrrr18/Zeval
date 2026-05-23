/**
 * @fileoverview Zod schemas for scenario templates and KPI mappings.
 */

import { z } from "zod";

/**
 * One metric reference inside a KPI definition.
 */
export const scenarioMetricReferenceSchema = z.object({
  source: z.enum(["objective", "subjective", "signal"]),
  metricId: z.string().min(1),
  weight: z.number().min(-1).max(1).refine((value) => value !== 0, {
    message: "weight 不能为 0。",
  }),
});

/**
 * One business KPI definition.
 */
export const scenarioBusinessKpiSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  description: z.string().min(1),
  direction: z.enum(["higher-is-better", "lower-is-better"]),
  mappedTo: z.object({
    primary: z.array(scenarioMetricReferenceSchema).min(1),
    secondary: z.array(scenarioMetricReferenceSchema).default([]),
  }),
  successThreshold: z.number().min(0).max(1),
  degradedThreshold: z.number().min(0).max(1),
});

/**
 * One onboarding question in a scenario template.
 */
export const scenarioOnboardingQuestionSchema = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
});

/**
 * Full scenario template schema.
 */
export const scenarioTemplateSchema = z.object({
  scenarioId: z.string().min(1),
  displayName: z.string().min(1),
  businessKpis: z.array(scenarioBusinessKpiSchema).min(1),
  onboardingQuestions: z.array(scenarioOnboardingQuestionSchema).default([]),
});
