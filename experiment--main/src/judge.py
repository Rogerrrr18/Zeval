"""
Rubric 裁判 — 方法二核心模块
判断 Agent 回复是否覆盖了当前意图。
使用结构化 rubric：covered / partial / not_covered / deviated
"""

import os
import json
from dataclasses import dataclass


@dataclass
class Judgement:
    """裁判结果"""
    verdict: str          # "covered" | "partial" | "not_covered" | "deviated"
    confidence: float     # 0-1
    reasoning: str        # 判断理由


RUBRIC_PROMPT = """你是一个对话评测专家。请判断 Agent 的回复是否覆盖了用户的当前意图。

评分准则（四档）：
- **covered**：Agent 的回复完全、正面地回应了用户意图，提供了有效信息或完成了请求的操作。
- **partial**：Agent 回应了部分意图，但遗漏了重要信息，或回答得不够充分。
- **not_covered**：Agent 没有正面回应用户意图（如：表示无法处理、要求更多信息、给出无关回复）。
- **deviated**：Agent 的回复与用户意图完全无关，甚至误解了意图。

用户意图：{intent_description}
用户 query：{user_query}
Agent 回复：{agent_reply}
意图达成条件：{achieve_condition}

请只输出 JSON：
{{
  "verdict": "covered|partial|not_covered|deviated",
  "confidence": 0.0-1.0,
  "reasoning": "简短判断理由"
}}"""


class RubricJudge:
    """Rubric 驱动的 LLM 裁判"""

    def __init__(self, model: str = "gpt-4", temperature: float = 0.3, num_samples: int = 3):
        """
        Args:
            model: LLM 模型
            temperature: 固定 0.3 保证可复现
            num_samples: 采样次数（多数投票，降低方差）
        """
        self.model = model
        self.temperature = temperature
        self.num_samples = num_samples
        self._client = None
        self._embedder = None

    def _get_client(self):
        if self._client is None and os.environ.get("OPENAI_API_KEY"):
            from openai import OpenAI
            self._client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        return self._client

    def judge(
        self,
        intent_description: str,
        user_query: str,
        agent_reply: str,
        achieve_condition: str = "",
    ) -> Judgement:
        """单次裁判（不采样）"""
        client = self._get_client()
        if client is None:
            return self._rule_judge(intent_description, user_query, agent_reply, achieve_condition)

        prompt = RUBRIC_PROMPT.format(
            intent_description=intent_description,
            user_query=user_query,
            agent_reply=agent_reply,
            achieve_condition=achieve_condition or "Agent 正面回应了用户意图",
        )

        response = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=self.temperature,
            seed=42,
        )
        raw = response.choices[0].message.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)

        return Judgement(
            verdict=data["verdict"],
            confidence=data.get("confidence", 0.5),
            reasoning=data.get("reasoning", ""),
        )

    def judge_with_voting(
        self,
        intent_description: str,
        user_query: str,
        agent_reply: str,
        achieve_condition: str = "",
    ) -> Judgement:
        """多次采样 + 多数投票（降低裁判方差）"""
        if self.num_samples <= 1:
            return self.judge(intent_description, user_query, agent_reply, achieve_condition)

        votes = []
        for _ in range(self.num_samples):
            j = self.judge(intent_description, user_query, agent_reply, achieve_condition)
            votes.append(j)

        # 多数投票
        from collections import Counter
        verdict_counts = Counter(v.verdict for v in votes)
        winning_verdict = verdict_counts.most_common(1)[0][0]
        avg_confidence = sum(v.confidence for v in votes) / len(votes)

        return Judgement(
            verdict=winning_verdict,
            confidence=avg_confidence,
            reasoning=f"Majority vote: {dict(verdict_counts)}",
        )

    def _rule_judge(
        self,
        intent_description: str,
        user_query: str,
        agent_reply: str,
        achieve_condition: str,
    ) -> Judgement:
        """确定性规则裁判（不依赖 LLM）"""
        similarity = self._semantic_similarity(intent_description, agent_reply)

        # 关键词匹配
        intent_keywords = set(intent_description.lower().split())
        reply_keywords = set(agent_reply.lower().split())
        keyword_overlap = len(intent_keywords & reply_keywords) / max(len(intent_keywords), 1)

        # 综合判断
        if similarity > 0.6 and keyword_overlap > 0.3:
            verdict = "covered"
            confidence = min(0.95, similarity)
        elif similarity > 0.4:
            verdict = "partial"
            confidence = similarity
        elif similarity > 0.2:
            verdict = "not_covered"
            confidence = max(0.1, similarity)
        else:
            verdict = "deviated"
            confidence = 0.1

        return Judgement(
            verdict=verdict,
            confidence=confidence,
            reasoning=f"Similarity={similarity:.3f}, KeywordOverlap={keyword_overlap:.3f}",
        )

    def _semantic_similarity(self, text_a: str, text_b: str) -> float:
        """优先用 sentence-transformers；不可用时退化为纯本地词集相似度。"""
        try:
            import numpy as np
            if self._embedder is None:
                from sentence_transformers import SentenceTransformer
                self._embedder = SentenceTransformer("all-MiniLM-L6-v2")
            a_emb = self._embedder.encode(text_a)
            b_emb = self._embedder.encode(text_b)
            denom = (np.linalg.norm(a_emb) * np.linalg.norm(b_emb)) or 1.0
            return float(np.dot(a_emb, b_emb) / denom)
        except Exception:
            a = {w for w in text_a.lower().split() if w}
            b = {w for w in text_b.lower().split() if w}
            if not a or not b:
                return 0.0
            return len(a & b) / max(len(a | b), 1)
