/**
 * @fileoverview Chinese negative feedback keywords for rule-only bad case harvesting.
 */

export type NegativeKeywordLevel = "strong" | "medium" | "weak";

export type NegativeKeywordEntry = {
  keyword: string;
  level: NegativeKeywordLevel;
  weight: number;
};

export const NEGATIVE_ZH_KEYWORDS: NegativeKeywordEntry[] = [
  { keyword: "错了", level: "strong", weight: 0.34 },
  { keyword: "不对", level: "strong", weight: 0.32 },
  { keyword: "不是", level: "medium", weight: 0.22 },
  { keyword: "不行", level: "strong", weight: 0.32 },
  { keyword: "重来", level: "strong", weight: 0.32 },
  { keyword: "换一个", level: "medium", weight: 0.24 },
  { keyword: "没用", level: "strong", weight: 0.32 },
  { keyword: "无效", level: "strong", weight: 0.32 },
  { keyword: "答非所问", level: "strong", weight: 0.36 },
  { keyword: "没回答", level: "strong", weight: 0.32 },
  { keyword: "没解决", level: "strong", weight: 0.34 },
  { keyword: "听不懂", level: "medium", weight: 0.24 },
  { keyword: "看不懂", level: "medium", weight: 0.22 },
  { keyword: "没明白", level: "medium", weight: 0.24 },
  { keyword: "什么意思", level: "medium", weight: 0.22 },
  { keyword: "太慢", level: "medium", weight: 0.24 },
  { keyword: "等太久", level: "medium", weight: 0.24 },
  { keyword: "反复", level: "medium", weight: 0.22 },
  { keyword: "重复", level: "medium", weight: 0.2 },
  { keyword: "麻烦", level: "weak", weight: 0.14 },
  { keyword: "烦", level: "weak", weight: 0.14 },
  { keyword: "崩溃", level: "strong", weight: 0.36 },
  { keyword: "生气", level: "medium", weight: 0.24 },
  { keyword: "投诉", level: "strong", weight: 0.38 },
  { keyword: "转人工", level: "strong", weight: 0.36 },
  { keyword: "找主管", level: "strong", weight: 0.34 },
  { keyword: "客服不行", level: "strong", weight: 0.34 },
  { keyword: "别敷衍", level: "medium", weight: 0.26 },
  { keyword: "别绕", level: "medium", weight: 0.22 },
  { keyword: "别废话", level: "medium", weight: 0.24 },
  { keyword: "没有帮助", level: "strong", weight: 0.32 },
  { keyword: "不满意", level: "strong", weight: 0.32 },
];

/**
 * Find the first configured negative keyword in one text.
 *
 * @param content Text to scan.
 * @returns Matched keyword entry or null.
 */
export function findNegativeKeyword(content: string): NegativeKeywordEntry | null {
  return NEGATIVE_ZH_KEYWORDS.find((entry) => content.includes(entry.keyword)) ?? null;
}

