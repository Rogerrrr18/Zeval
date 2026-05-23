/**
 * @fileoverview Optional LLM review for upload-time data mapping plans.
 */

import { parseJsonObjectFromLlmOutput, requestSiliconFlowChatCompletion } from "@/lib/siliconflow";
import type { DataMappingPlan } from "@/types/data-onboarding";

type LlmMappingReviewPayload = {
  summary?: string;
  confidence?: number;
  warnings?: string[];
  questionsForUser?: string[];
};

/**
 * Ask the Data Onboarding Agent to review a deterministic mapping plan.
 * The returned review augments the plan; deterministic code still performs conversion.
 *
 * @param plan Rule-generated mapping plan.
 * @param sampleText Source sample text.
 * @returns LLM review fields.
 */
export async function reviewDataMappingPlanWithLlm(
  plan: DataMappingPlan,
  sampleText: string,
): Promise<LlmMappingReviewPayload> {
  const raw = await requestSiliconFlowChatCompletion(
    [
      {
        role: "system",
        content: [
          "你是 Zeval 的 Data Onboarding Agent。",
          "任务：复核上传数据的字段映射计划，判断它是否能对齐到内部评估结构。",
          "不要转换完整数据，只输出 JSON。",
          "如果字段缺失，要指出会导致哪些评估能力降级。",
          "confidence 必须是 0 到 1 的小数。",
          '输出格式：{"summary":"...","confidence":0.82,"warnings":["..."],"questionsForUser":["..."]}',
        ].join("\n"),
      },
      {
        role: "user",
        content: [
          "当前规则映射计划：",
          JSON.stringify(
            {
              sourceFormat: plan.sourceFormat,
              confidence: plan.confidence,
              detectedStructure: plan.detectedStructure,
              fieldMappings: plan.fieldMappings,
              capabilityReport: plan.capabilityReport,
              warnings: plan.warnings,
            },
            null,
            2,
          ),
          "上传数据样本：",
          sampleText.slice(0, 6000),
          "请复核映射是否合理，并指出缺失字段与需要用户确认的问题。",
        ].join("\n\n"),
      },
    ],
    { stage: "data_onboarding_mapping_review" },
  );
  return parseJsonObjectFromLlmOutput(raw) as LlmMappingReviewPayload;
}
