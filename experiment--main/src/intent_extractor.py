"""
意图序列提取器 — 方法二核心模块
从历史 session 中提取意图序列：Intent = [intent₁, intent₂, ..., intentₖ]
每个 intent 包含：意图描述、原始 query 示例、达成条件、依赖关系
"""

import json
import os
from typing import Optional
from dataclasses import dataclass, field, asdict


@dataclass
class Intent:
    """单个意图"""
    id: str                          # intent ID
    description: str                 # 意图描述（自然语言）
    examples: list[str] = field(default_factory=list)  # 原始 query 示例 (1-3条)
    achieve_condition: str = ""      # 达成条件：Agent 回复满足什么条件算达成
    depends_on: list[str] = field(default_factory=list)  # 依赖的 intent ID 列表


@dataclass
class IntentSequence:
    """一个 session 的意图序列"""
    session_id: str
    intents: list[Intent]
    background: str = ""             # 对话背景（主题、用户身份等）


# ── 意图提取 Prompt 模板 ──────────────────────────────────────

EXTRACTION_PROMPT = """你是一个对话分析专家。给定一段多轮客服对话，请提取对话中用户的意图序列。

要求：
1. 识别用户在每个阶段的核心意图（不是逐句，而是按语义阶段聚类）
2. 每个意图只提取一次，不要重复
3. 意图粒度适中——不是每个句子一个意图，也不是整个对话一个意图
4. 标注意图之间的依赖关系（哪些意图必须在前面完成后才能提出）

输出 JSON 格式：
{
  "background": "对话背景（一句话）",
  "intents": [
    {
      "id": "intent_1",
      "description": "用户意图的自然语言描述",
      "examples": ["原始对话中体现该意图的1-3句用户原话"],
      "achieve_condition": "Agent 回复满足什么条件算该意图被满足",
      "depends_on": []
    },
    ...
  ]
}

对话内容：
{conversation}

请只输出 JSON，不要有其他内容。"""


class IntentExtractor:
    """意图提取器 — 支持 LLM 和模板两种模式"""

    def __init__(self, mode: str = "llm", model: str = "gpt-4", temperature: float = 0.3):
        """
        Args:
            mode: "llm" 使用 LLM 提取, "template" 使用规则模板
            model: LLM 模型名
            temperature: LLM temperature（固定 0.3 保证可复现）
        """
        self.mode = mode
        self.model = model
        self.temperature = temperature
        self._client = None

    def _get_client(self):
        if self._client is None and self.mode == "llm":
            from openai import OpenAI
            self._client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
        return self._client

    def extract(self, conversation: str, session_id: str = "unknown") -> IntentSequence:
        """从对话文本中提取意图序列"""
        if self.mode == "llm":
            return self._extract_llm(conversation, session_id)
        else:
            return self._extract_template(conversation, session_id)

    def _extract_llm(self, conversation: str, session_id: str) -> IntentSequence:
        """LLM 提取意图"""
        client = self._get_client()
        if client is None:
            raise RuntimeError("OpenAI client not available. Set OPENAI_API_KEY or use mode='template'")

        prompt = EXTRACTION_PROMPT.format(conversation=conversation)
        response = client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": prompt}],
            temperature=self.temperature,
            seed=42,
        )
        raw = response.choices[0].message.content.strip()

        # 解析 JSON（处理可能的 markdown 包裹）
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)

        intents = []
        for item in data.get("intents", []):
            intents.append(Intent(
                id=item["id"],
                description=item["description"],
                examples=item.get("examples", []),
                achieve_condition=item.get("achieve_condition", ""),
                depends_on=item.get("depends_on", []),
            ))

        return IntentSequence(
            session_id=session_id,
            intents=intents,
            background=data.get("background", ""),
        )

    def _extract_template(self, conversation: str, session_id: str) -> IntentSequence:
        """模板规则提取（确定性、可复现）"""
        # 简化版：按用户发言轮次提取
        lines = conversation.strip().split("\n")
        user_turns = []
        for line in lines:
            line = line.strip()
            if line.startswith("USER:") or line.startswith("用户：") or line.startswith("Customer:"):
                user_turns.append(line.split(":", 1)[1].strip() if ":" in line else line)

        intents = []
        for i, turn in enumerate(user_turns):
            intents.append(Intent(
                id=f"intent_{i+1}",
                description=turn[:100],
                examples=[turn],
                achieve_condition="Agent 正面回应了用户的请求",
                depends_on=[f"intent_{i}"] if i > 0 else [],
            ))

        return IntentSequence(
            session_id=session_id,
            intents=intents,
            background="客服对话",
        )
