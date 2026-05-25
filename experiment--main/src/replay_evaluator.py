"""
回放评测编排器 — 方法二完整流程
协调 SimUser、Agent、裁判三方的交互循环
"""

import time
from dataclasses import dataclass, field
from typing import Callable

from src.intent_extractor import IntentExtractor, IntentSequence
from src.sim_user import SimUser
from src.judge import RubricJudge, Judgement


@dataclass
class TurnRecord:
    """单轮评测记录"""
    turn: int
    intent_id: str
    intent_description: str
    user_query: str
    agent_reply: str
    verdict: str           # covered / partial / not_covered / deviated
    confidence: float
    reask_attempt: int


@dataclass
class EvalResult:
    """一次完整评测的结果"""
    session_id: str
    total_intents: int
    achieved_intents: int
    partially_achieved: int
    total_asks: int          # 总追问次数
    deviated_turns: int
    total_turns: int
    original_turns: int      # 原始 session 轮次
    turns: list[TurnRecord] = field(default_factory=list)

    # 四项评分
    intent_achievement_rate: float = 0.0
    reask_efficiency: float = 0.0
    deviation_rate: float = 0.0
    turn_efficiency: float = 0.0
    total_score: float = 0.0


@dataclass
class EvalConfig:
    """评测配置"""
    max_reasks: int = 3
    weights: dict = field(default_factory=lambda: {
        "intent_achievement": 0.5,
        "reask_efficiency": 0.2,
        "deviation": 0.2,
        "turn_efficiency": 0.1,
    })


class ReplayEvaluator:
    """动态意图驱动回放评测器"""

    def __init__(
        self,
        agent_fn: Callable[[str, str], str],  # (user_query, context) -> agent_reply
        extractor: IntentExtractor,
        judge: RubricJudge,
        config: EvalConfig = None,
    ):
        self.agent_fn = agent_fn
        self.extractor = extractor
        self.judge = judge
        self.config = config or EvalConfig()

    def evaluate(self, session_data: dict) -> EvalResult:
        """对单个 session 执行完整回放评测"""
        session_id = session_data.get("id", "unknown")
        conversation = self._format_conversation(session_data)
        original_turns = len(session_data.get("turns", []))

        # Step 1: 意图提取
        intent_seq = self.extractor.extract(conversation, session_id)

        # Step 2: 初始化 SimUser
        sim_user = SimUser(
            intent_sequence=intent_seq,
            max_reasks=self.config.max_reasks,
        )

        # Step 3: 动态回放循环
        turns = []
        context = ""  # 对话上下文
        achieved_intents = 0
        partially_achieved = 0
        total_asks = 0
        deviated_turns = 0
        turn_count = 0

        while not sim_user.is_done and turn_count < 50:  # 最大 50 轮保护
            turn_count += 1

            # a) SimUser 生成 query
            turn = sim_user.generate_query()
            if turn is None:
                break

            # b) Agent 回复
            agent_reply = self.agent_fn(turn.text, context)
            context += f"\nUSER: {turn.text}\nAGENT: {agent_reply}"

            # c) 裁判检查
            intent = sim_user.current_intent
            if intent is None:
                break

            judgement = self.judge.judge_with_voting(
                intent_description=intent.description,
                user_query=turn.text,
                agent_reply=agent_reply,
                achieve_condition=intent.achieve_condition,
            )

            # d) 偏离检测（确定性判断）
            if judgement.verdict == "deviated":
                deviated_turns += 1

            # e) 记录
            turns.append(TurnRecord(
                turn=turn_count,
                intent_id=intent.id,
                intent_description=intent.description,
                user_query=turn.text,
                agent_reply=agent_reply,
                verdict=judgement.verdict,
                confidence=judgement.confidence,
                reask_attempt=turn.attempt,
            ))

            # f) 更新 SimUser 状态
            previous_intent_idx = sim_user.current_intent_idx
            sim_user.on_agent_reply(judgement.verdict)

            # 统计达成
            if sim_user.current_intent_idx > previous_intent_idx:
                if judgement.verdict == "covered":
                    achieved_intents += 1
                elif judgement.verdict == "partial":
                    partially_achieved += 1

            if turn.attempt > 0:
                total_asks += 1

        # Step 4: 评分计算
        total_intents = len(intent_seq.intents)
        w = self.config.weights

        intent_achievement_rate = achieved_intents / max(total_intents, 1)
        reask_efficiency = 1.0 - (total_asks / max(total_intents + total_asks, 1))
        deviation_rate = deviated_turns / max(turn_count, 1)
        turn_efficiency_score = 1.0 - (turn_count / max(original_turns, 1))
        turn_efficiency_score = max(0.0, min(1.0, turn_efficiency_score))  # clamp [0,1]

        total_score = (
            intent_achievement_rate * w["intent_achievement"]
            + reask_efficiency * w["reask_efficiency"]
            + (1.0 - deviation_rate) * w["deviation"]
            + turn_efficiency_score * w["turn_efficiency"]
        )

        return EvalResult(
            session_id=session_id,
            total_intents=total_intents,
            achieved_intents=achieved_intents,
            partially_achieved=partially_achieved,
            total_asks=total_asks,
            deviated_turns=deviated_turns,
            total_turns=turn_count,
            original_turns=original_turns,
            turns=turns,
            intent_achievement_rate=intent_achievement_rate,
            reask_efficiency=reask_efficiency,
            deviation_rate=deviation_rate,
            turn_efficiency=turn_efficiency_score,
            total_score=total_score,
        )

    def _format_conversation(self, session_data: dict) -> str:
        turns = session_data.get("turns", [])
        lines = []
        for t in turns:
            role = t.get("role", "user")
            text = t.get("text", "")
            lines.append(f"{role.upper()}: {text}")
        return "\n".join(lines)


# ── 模拟 Agent（用于实验） ──────────────────────────────────

class MockAgent:
    """模拟 Agent — 可配置回复行为用于实验"""

    def __init__(self, mode: str = "helpful", delay: float = 0.0):
        """
        mode:
          - "helpful": 总是正面回应
          - "partial": 部分回应（30% 覆盖，40% 部分，30% 未覆盖）
          - "evasive": 回避型（经常 not_covered / deviated）
          - "random": 随机行为
        """
        self.mode = mode
        self.delay = delay

    def reply(self, user_query: str, context: str = "") -> str:
        if self.delay > 0:
            time.sleep(self.delay)

        if self.mode == "helpful":
            return f"好的，关于「{user_query[:50]}...」我帮您查到了相关信息。"
        elif self.mode == "random":
            import random
            modes = ["helpful", "partial", "evasive"]
            self.mode = random.choice(modes)
            return self.reply(user_query, context)
        elif self.mode == "partial":
            return f"关于这个问题，我查到了一部分信息，但还需要确认一下。"
        else:
            return "抱歉，我没有理解您的问题，能再说一遍吗？"
