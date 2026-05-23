/**
 * GET  /api/eval-datasets/admission-rules
 *   Returns the full default admission rule catalogue grouped by channel.
 *
 * POST /api/eval-datasets/admission-rules
 *   Placeholder for future per-project rule overrides (Supabase-backed, P3+).
 *   Currently returns 501.
 *
 * The catalogue is the canonical PRD §13.3 rule set.  Future work will
 * store overrides in `dataset_admission_rules` and merge them here.
 */

import { NextResponse } from "next/server";
import { DEFAULT_ADMISSION_RULES } from "@/eval-datasets/admission/rules";

const CHANNEL_LABELS: Record<string, string> = {
  auto_tp:          "TP — 系统判定坏案例",
  auto_fn:          "FN — 漏报坏案例（行为代理信号）",
  auto_tn:          "TN — 金标正例抽样",
  auto_uncertainty: "边界案例（置信度低）",
};

const RULE_CHANNEL_MAP: Record<string, string> = {
  goal_failed:           "auto_tp",
  low_empathy:           "auto_tp",
  off_topic_high:        "auto_tp",
  preachy_high:          "auto_tp",
  interest_decline:      "auto_tp",
  understanding_barrier: "auto_tp",
  recovery_failure:      "auto_tp",
  high_dropoff:          "auto_tp",
  fn_dropoff_negative_tail: "auto_fn",
  fn_repeated_question:     "auto_fn",
  fn_length_collapse:       "auto_fn",
  fn_consecutive_short:     "auto_fn",
  goal_achieved_high_score: "auto_tn",
  clean_session_sampled:    "auto_tn",
  judge_uncertainty:        "auto_uncertainty",
};

const RULE_DESCRIPTIONS: Record<string, string> = {
  goal_failed:              "goalCompletion.status in (failed, partial)",
  low_empathy:              "subjective 共情程度 score ≤ 2",
  off_topic_high:           "subjective 答非所问/无视风险 score ≤ 2",
  preachy_high:             "subjective 说教感/压迫感 score ≤ 2",
  interest_decline:         "riskTags.interestDeclineRisk.severity in (medium, high)",
  understanding_barrier:    "asset tag understanding_barrier 或 understandingBarrierRisk signal",
  recovery_failure:         "recoveryTrace.status == failed",
  high_dropoff:             "escalation_keyword 或 question_repeat tag 命中",
  fn_dropoff_negative_tail: "末尾3条用户消息中 ≥2 条含负向词，且最后一条为 user",
  fn_repeated_question:     "同 session 同一归一化问题出现 ≥2 次",
  fn_length_collapse:       "用户后半段平均消息长度 < 前半段 × 0.6，轮次 ≥6",
  fn_consecutive_short:     "连续3条以上用户消息 ≤5 字符且末条为 user",
  goal_achieved_high_score: "goalCompletion == achieved + confidence > 0.6 + 共情程度 ≥ 4",
  clean_session_sampled:    "无任何 TP/FN 规则命中，5% 随机抽样",
  judge_uncertainty:        "任意主观维度 confidence ∈ [0.4, 0.6]",
};

export async function GET() {
  const grouped: Record<string, unknown[]> = {};

  for (const [key, config] of Object.entries(DEFAULT_ADMISSION_RULES)) {
    const channel = RULE_CHANNEL_MAP[key] ?? "other";
    if (!grouped[channel]) grouped[channel] = [];
    grouped[channel].push({
      key,
      channel,
      channelLabel: CHANNEL_LABELS[channel] ?? channel,
      severity: config.severity,
      enabled: config.enabled,
      description: RULE_DESCRIPTIONS[key] ?? "",
    });
  }

  return NextResponse.json({
    rules: Object.values(grouped).flat(),
    groupedByChannel: grouped,
    channelLabels: CHANNEL_LABELS,
    note: "MVP 阶段规则为内置默认值。未来将支持通过 dataset_admission_rules 表按项目覆盖。",
  });
}

export async function POST() {
  return NextResponse.json(
    { error: "per-project 规则覆盖尚未实现（P3+ 功能，待 Supabase 迁移后上线）。" },
    { status: 501 },
  );
}
