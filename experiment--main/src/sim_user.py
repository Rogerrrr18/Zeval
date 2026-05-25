"""
动态 SimUser — 方法二核心模块
按意图序列与 Agent 交互，根据 Agent 回复动态决定：
- 达成 → 前进到下一意图
- 未达成 → 换方式追问（最多 N 次）
- 偏离 → 标记错误
"""

import random
import os
from dataclasses import dataclass, field
from src.intent_extractor import Intent, IntentSequence


@dataclass
class SimUserTurn:
    """SimUser 生成的单轮 query"""
    text: str
    intent_id: str
    attempt: int           # 当前意图的第几次尝试
    mode: str              # "initial" | "reask" | "clarify"


QUERY_TEMPLATES = {
    "initial": [
        "关于{intent_description}，我想问一下",
        "我想了解一下{intent_description}",
        "请问{intent_description}",
    ],
    "reask": [
        "我换个方式问：{intent_description}",
        "可能我没说清楚，我想知道的是：{intent_description}",
        "再问一下，关于{intent_description}，你能帮我看看吗？",
    ],
    "clarify": [
        "你的回答我没有完全理解，能不能具体说一下{intent_description}？",
        "不好意思，我需要更清楚的答案：{intent_description}",
    ],
}


class SimUser:
    """动态模拟用户"""

    def __init__(
        self,
        intent_sequence: IntentSequence,
        mode: str = "template",       # "template" | "llm"
        max_reasks: int = 3,
        temperature: float = 0.3,
    ):
        self.intent_sequence = intent_sequence
        self.mode = mode
        self.max_reasks = max_reasks
        self.temperature = temperature

        # 运行时状态
        self.current_intent_idx = 0
        self.reask_count = 0
        self.total_turns = 0
        self._rng = random.Random(42)

    @property
    def current_intent(self) -> Intent | None:
        if self.current_intent_idx < len(self.intent_sequence.intents):
            return self.intent_sequence.intents[self.current_intent_idx]
        return None

    @property
    def is_done(self) -> bool:
        return self.current_intent_idx >= len(self.intent_sequence.intents)

    def generate_query(self) -> SimUserTurn | None:
        """生成下一轮 query。返回 None 表示所有意图已处理完。"""
        if self.is_done:
            return None

        intent = self.current_intent
        description = intent.description

        if self.reask_count == 0:
            # 首次提出意图
            template = self._rng.choice(QUERY_TEMPLATES["initial"])
            mode = "initial"
        elif self.reask_count < self.max_reasks:
            # 追问
            template = self._rng.choice(QUERY_TEMPLATES["reask"])
            mode = "reask"
        else:
            # 澄清
            template = self._rng.choice(QUERY_TEMPLATES["clarify"])
            mode = "clarify"

        text = template.replace("{intent_description}", description)
        self.total_turns += 1

        return SimUserTurn(
            text=text,
            intent_id=intent.id,
            attempt=self.reask_count,
            mode=mode,
        )

    def on_agent_reply(self, judgement: str):
        """
        根据裁判结果更新 SimUser 状态。
        judgement: "covered" | "partial" | "not_covered" | "deviated"
        """
        if judgement == "covered":
            # 达成，前进到下一意图
            self.current_intent_idx += 1
            self.reask_count = 0
        elif judgement == "partial":
            # 部分覆盖，追问
            self.reask_count += 1
            if self.reask_count > self.max_reasks:
                # 超过最大追问数，标记未达成并前进
                self.current_intent_idx += 1
                self.reask_count = 0
        elif judgement in ("not_covered", "deviated"):
            # 未覆盖或偏离，追问
            self.reask_count += 1
            if self.reask_count > self.max_reasks:
                self.current_intent_idx += 1
                self.reask_count = 0

    def reset(self):
        """重置状态"""
        self.current_intent_idx = 0
        self.reask_count = 0
        self.total_turns = 0


def create_simuser_for_session(
    session_data: dict,
    extractor,
    max_reasks: int = 3,
) -> SimUser:
    """从 session 数据创建 SimUser 的便捷函数"""
    conversation = _format_conversation(session_data)
    intent_seq = extractor.extract(conversation, session_id=session_data.get("id", "unknown"))
    return SimUser(intent_sequence=intent_seq, max_reasks=max_reasks)


def _format_conversation(session_data: dict) -> str:
    """将 session 数据格式化为对话文本"""
    turns = session_data.get("turns", [])
    lines = []
    for t in turns:
        role = t.get("role", "user")
        text = t.get("text", "")
        lines.append(f"{role.upper()}: {text}")
    return "\n".join(lines)
