/**
 * @fileoverview Default sizes for temporary evaluation sample batches (MVP).
 */

/** 临时评测集 goodcase 目标条数（与 badcase 合计约 {@link TEMP_EVAL_SAMPLE_TOTAL_TARGET}）。 */
export const TEMP_EVAL_SAMPLE_GOODCASE_TARGET = 10;

/** 临时评测集 badcase 目标条数。 */
export const TEMP_EVAL_SAMPLE_BADCASE_TARGET = 10;

/** 合计目标 case 数（分层后总数上限约 20；不足量时仍允许落盘，见 sample-batch 逻辑）。 */
export const TEMP_EVAL_SAMPLE_TOTAL_TARGET = TEMP_EVAL_SAMPLE_GOODCASE_TARGET + TEMP_EVAL_SAMPLE_BADCASE_TARGET;
