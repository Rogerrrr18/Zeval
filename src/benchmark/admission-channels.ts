/**
 * @fileoverview Canonical admission channel taxonomy shared by the review UI,
 * the admit-cases API, and the static admission-policy learner.
 *
 * A "channel" is the case-type bucket a human reviewer assigns to a labeled
 * session. The admission-policy learner groups labels by channel and fits
 * accept/reject/uncertainty rules from the per-channel secondary-metric
 * (二级指标) feature distribution.
 */

/** One selectable admission channel. */
export type AdmissionChannelDef = {
  /** Stable channel id persisted on labels and policies. */
  id: string;
  /** Short Chinese label rendered in the review UI. */
  label: string;
  /** Reviewer-facing hint describing which cases belong to this channel. */
  description: string;
};

/**
 * Fixed five-channel taxonomy from `docs/admission-pool-strategy.html`.
 * Order is the display order in the review workbench.
 */
export const ADMISSION_CHANNELS: readonly AdmissionChannelDef[] = [
  {
    id: "ch_task_completion",
    label: "任务完成",
    description: "围绕任务是否达成的案例（任务完成度类二级指标）。",
  },
  {
    id: "ch_format_compliance",
    label: "格式合规",
    description: "输出结构 / 格式 / schema 合规相关案例。",
  },
  {
    id: "ch_decision_accuracy",
    label: "筛选决策",
    description: "筛选 / 判断 / 决策准确性相关案例（需金标更有意义）。",
  },
  {
    id: "ch_uncertainty",
    label: "低置信/存疑",
    description: "评测置信度低或多指标分歧、需要人工持续关注的案例。",
  },
  {
    id: "ch_human_gold",
    label: "人工金标",
    description: "人工确认的高质量金标案例。",
  },
] as const;

/** All valid channel ids. */
export const ADMISSION_CHANNEL_IDS: readonly string[] = ADMISSION_CHANNELS.map(
  (channel) => channel.id,
);

/**
 * Minimum number of human-labeled sessions required before an admission policy
 * can be generated or refreshed. Lowered from the original 100 to 20 so the
 * automated admission-pool loop can start much earlier.
 */
export const ADMISSION_POLICY_MIN_LABELS = 20;

/**
 * Whether a channel id belongs to the canonical taxonomy.
 *
 * @param channel Candidate channel id.
 * @returns True when the id is a known admission channel.
 */
export function isAdmissionChannel(channel: string | undefined | null): channel is string {
  return typeof channel === "string" && ADMISSION_CHANNEL_IDS.includes(channel);
}

/**
 * Resolve the display label for a channel id.
 *
 * @param channel Channel id.
 * @returns Localized label, or the raw id when unknown.
 */
export function admissionChannelLabel(channel: string | undefined | null): string {
  if (!channel) return "未选择";
  return ADMISSION_CHANNELS.find((item) => item.id === channel)?.label ?? channel;
}
