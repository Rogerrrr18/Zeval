from __future__ import annotations

import json
import math
import os
import random
from pathlib import Path
from typing import Callable
from dataclasses import asdict

from src.pilot_types import EvalTurn, IntentItem, JudgeDecision, LockedSessionAsset, SessionMetrics


class PilotJudge:
    def __init__(self, model: str | None = None):
        self.model = model or os.environ.get("ZEVAL_JUDGE_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"
        self._client = None

    def _get_client(self):
        api_key = (
            os.environ.get("ZEVAL_INTENT_EXPERIMENT_API_KEY")
            or os.environ.get("ZEVAL_JUDGE_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
        )
        base_url = os.environ.get("ZEVAL_JUDGE_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
        if not api_key:
            return None
        if self._client is None:
            try:
                from openai import OpenAI
            except ModuleNotFoundError:
                return None
            kwargs = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            self._client = OpenAI(**kwargs)
        return self._client

    def decide(self, intent: IntentItem, user_text: str, assistant_text: str) -> JudgeDecision:
        client = self._get_client()
        if client is None:
            return self._heuristic_decide(intent, user_text, assistant_text)
        try:
            return self._llm_decide(intent, user_text, assistant_text, client)
        except Exception:
            return self._heuristic_decide(intent, user_text, assistant_text)

    def _llm_decide(self, intent: IntentItem, user_text: str, assistant_text: str, client) -> JudgeDecision:
        prompt = f"""你是一个严格的对话评审器。只输出 JSON。
标签只能是 SATISFIED / NOT_SATISFIED / DEVIATION。

当前意图：{intent.intent_text}
成功标准：{intent.success_criteria}
用户本轮：{user_text}
助手回复：{assistant_text}

规则：
- SATISFIED：已经正面完成或明确回答意图
- NOT_SATISFIED：相关但未完成/仍需追问
- DEVIATION：明显跑题或误解意图
- 如果只是复述用户、暴露系统注入、空话安抚、只提问不交付结果，默认不能判 SATISFIED
- 优先检查硬失败：提示词泄漏、答非所问、无结果、空回复

输出字段必须使用中文键名：
{{
  "标签":"SATISFIED/NOT_SATISFIED/DEVIATION",
  "理由":"一句话",
  "证据引用":"从助手回复复制的短句",
  "失败类型":"无/只追问未交付/提示词泄漏/复述用户/答非所问/信息不足未处理/空回复",
  "是否直接回答":true,
  "是否给出结果":true,
  "是否还在追问":false,
  "是否泄漏提示":false,
  "是否复述用户":false,
  "本轮得分":0到1之间小数
}}"""
        response = client.chat.completions.create(
            model=self.model,
            temperature=0,
            seed=42,
            messages=[{"role": "user", "content": prompt}],
            response_format={"type": "json_object"},
        )
        raw_content = (response.choices[0].message.content or "").strip()
        if not raw_content:
            return self._heuristic_result(
                intent,
                user_text,
                assistant_text,
                "NOT_SATISFIED",
                "评审模型返回空白 JSON，回退为严格未满足。",
                self._quote(assistant_text),
                fail_category="评审空白输出",
                directly_answered=False,
                delivered_result=False,
                asked_followup=False,
                leaked_prompt=False,
                parroted_user=False,
                turn_score=0.0,
                source="llm",
                judge_model=self.model,
                prompt_text=prompt,
                raw_response="<EMPTY>",
            )
        data = self._parse_json_object(raw_content)
        fail_category = data.get("失败类型") or data.get("fail_category") or ""
        directly_answered = bool(data.get("是否直接回答", data.get("directly_answered", False)))
        delivered_result = bool(data.get("是否给出结果", data.get("delivered_result", False)))
        asked_followup = bool(data.get("是否还在追问", data.get("asked_followup", False)))
        leaked_prompt = bool(data.get("是否泄漏提示", data.get("leaked_prompt", False)))
        parroted_user = bool(data.get("是否复述用户", data.get("parroted_user", False)))
        turn_score = self._safe_score(data.get("本轮得分", data.get("turn_score", 0.0)))
        return JudgeDecision(
            label=data.get("标签") or data.get("label", "NOT_SATISFIED"),
            rationale=data.get("理由") or data.get("rationale", ""),
            evidence_quote=data.get("证据引用") or data.get("evidence_quote", assistant_text[:80]),
            fail_category=fail_category,
            directly_answered=directly_answered,
            delivered_result=delivered_result,
            asked_followup=asked_followup,
            leaked_prompt=leaked_prompt,
            parroted_user=parroted_user,
            turn_score=turn_score,
            source="llm",
            judge_model=self.model,
            prompt_text=prompt,
            raw_response=raw_content,
        )

    def _parse_json_object(self, raw_content: str) -> dict:
        try:
            return json.loads(raw_content)
        except json.JSONDecodeError:
            start = raw_content.find("{")
            end = raw_content.rfind("}")
            if start >= 0 and end > start:
                return json.loads(raw_content[start:end + 1])
            raise

    def _safe_score(self, value) -> float:
        try:
            score = float(value)
        except Exception:
            return 0.0
        return max(0.0, min(1.0, score))

    def _heuristic_decide(self, intent: IntentItem, user_text: str, assistant_text: str) -> JudgeDecision:
        reply = (assistant_text or "").strip()
        if not reply:
            return self._heuristic_result(intent, user_text, assistant_text, "DEVIATION", "空回复，视为无效。", "", fail_category="空回复", turn_score=0.0)

        if self._is_goodbye(user_text) and self._is_polite_close(reply):
            return self._heuristic_result(intent, user_text, assistant_text, "SATISFIED", "用户在结束对话，助手进行了自然收尾。", self._quote(reply), fail_category="无", directly_answered=True, delivered_result=True, turn_score=0.95)

        bad_markers = ["不知道", "没理解", "再说一遍", "无法", "抱歉"]
        if any(x in reply for x in bad_markers):
            return self._heuristic_result(intent, user_text, assistant_text, "NOT_SATISFIED", "回复承认未理解或无法处理。", self._quote(reply), fail_category="信息不足未处理", asked_followup=True, turn_score=0.2)

        intent_tokens = _tokenize(intent.intent_text + " " + " ".join(intent.example_user_queries))
        criteria_tokens = _tokenize(intent.success_criteria)
        user_tokens = _tokenize(user_text)
        reply_tokens = _tokenize(reply)
        overlap = len(intent_tokens & reply_tokens) / max(len(intent_tokens), 1)
        user_overlap = len(user_tokens & reply_tokens) / max(len(user_tokens), 1)
        criteria_overlap = len(criteria_tokens & reply_tokens) / max(len(criteria_tokens), 1) if criteria_tokens else 0.0

        fact_like = any(ch.isdigit() for ch in reply) or any(x in reply for x in ["已", "可以", "成功", "状态", "地址", "电话", "时间", "reference"])
        contains_leak = "【会话已知事实】" in reply or "基于当前需求和已知事实" in reply
        echo_like = self._looks_like_parrot(user_text, reply)
        question_only = reply.endswith("?") or reply.endswith("？")
        direct_answered = not question_only
        delivered_result = fact_like and not contains_leak

        if contains_leak and ("历史对话已出现如下事实" in reply or reply.startswith("已收到。基于当前需求和已知事实")):
            return self._heuristic_result(intent, user_text, assistant_text, "NOT_SATISFIED", "回复把 system 注入内容直接泄漏出来了，更像提示词回显，不算真正完成任务。", self._quote(reply), fail_category="提示词泄漏", leaked_prompt=True, directly_answered=direct_answered, delivered_result=False, turn_score=0.1)
        if contains_leak and not fact_like:
            return self._heuristic_result(intent, user_text, assistant_text, "NOT_SATISFIED", "回复暴露了注入提示，但没有真正给出用户要的结果。", self._quote(reply), fail_category="提示词泄漏", leaked_prompt=True, directly_answered=direct_answered, delivered_result=False, turn_score=0.1)
        if echo_like and not fact_like:
            return self._heuristic_result(intent, user_text, assistant_text, "NOT_SATISFIED", f"回复主要在复述用户输入，user_overlap={user_overlap:.2f}。", self._quote(reply), fail_category="复述用户", parroted_user=True, directly_answered=False, delivered_result=False, turn_score=0.15)
        if question_only and not fact_like and criteria_overlap < 0.2:
            return self._heuristic_result(intent, user_text, assistant_text, "NOT_SATISFIED", "回复主要在反问/追问，没有完成当前意图。", self._quote(reply), fail_category="只追问未交付", directly_answered=False, delivered_result=False, asked_followup=True, turn_score=0.2)

        if (overlap >= 0.45 and (fact_like or criteria_overlap >= 0.2)) or (fact_like and overlap >= 0.2):
            score = min(1.0, 0.7 + min(criteria_overlap, 0.2) + (0.1 if fact_like else 0.0))
            return self._heuristic_result(intent, user_text, assistant_text, "SATISFIED", f"回复命中了意图并给出较具体结果，overlap={overlap:.2f}，criteria_overlap={criteria_overlap:.2f}。", self._quote(reply), fail_category="无", directly_answered=True, delivered_result=True, turn_score=score)
        if overlap >= 0.12:
            return self._heuristic_result(intent, user_text, assistant_text, "NOT_SATISFIED", f"回复部分相关，但未满足成功标准，overlap={overlap:.2f}，criteria_overlap={criteria_overlap:.2f}。", self._quote(reply), fail_category="信息不足未处理", directly_answered=direct_answered, delivered_result=delivered_result, turn_score=0.45)
        return self._heuristic_result(intent, user_text, assistant_text, "DEVIATION", f"回复与当前意图基本脱节，overlap={overlap:.2f}。", self._quote(reply), fail_category="答非所问", directly_answered=direct_answered, delivered_result=False, turn_score=0.05)

    def _heuristic_result(self, intent: IntentItem, user_text: str, assistant_text: str, label: str, rationale: str, evidence_quote: str, *, fail_category: str = "", directly_answered: bool = False, delivered_result: bool = False, asked_followup: bool = False, leaked_prompt: bool = False, parroted_user: bool = False, turn_score: float = 0.0, source: str = "heuristic", judge_model: str = "heuristic", prompt_text: str | None = None, raw_response: str | None = None) -> JudgeDecision:
        prompt = f"""[启发式评审说明]
当前意图：{intent.intent_text}
成功标准：{intent.success_criteria}
用户本轮：{user_text}
助手回复：{assistant_text}

启发式规则：
1. 收尾意图 + 礼貌结束 => 满足
2. 明显承认不会/没理解 => 未满足
3. 泄漏 system 注入 / 提示词回显 => 未满足
4. 主要复述用户原话 => 未满足
5. 只追问不交付结果 => 未满足
6. 命中意图且给出具体结果 => 满足
7. 基本脱节 => 偏航
"""
        raw = json.dumps({
            "标签": label,
            "理由": rationale,
            "证据引用": evidence_quote,
            "失败类型": fail_category or "无",
            "是否直接回答": directly_answered,
            "是否给出结果": delivered_result,
            "是否还在追问": asked_followup,
            "是否泄漏提示": leaked_prompt,
            "是否复述用户": parroted_user,
            "本轮得分": round(turn_score, 4),
            "判定方式": "启发式规则",
        }, ensure_ascii=False, indent=2)
        return JudgeDecision(label, rationale, evidence_quote, fail_category=fail_category or "无", directly_answered=directly_answered, delivered_result=delivered_result, asked_followup=asked_followup, leaked_prompt=leaked_prompt, parroted_user=parroted_user, turn_score=round(turn_score, 4), source=source, judge_model=judge_model, prompt_text=prompt_text or prompt, raw_response=raw_response or raw)

    def _looks_like_parrot(self, user_text: str, reply: str) -> bool:
        user_text = (user_text or "").strip()
        reply = (reply or "").strip()
        if not user_text or not reply:
            return False
        normalized_reply = reply.replace("已收到。", "").replace("我明白了。", "").replace("基于当前需求和已知事实，我的处理是：", "")
        overlap = len(_tokenize(user_text) & _tokenize(normalized_reply)) / max(len(_tokenize(user_text)), 1)
        return overlap >= 0.7 and len(normalized_reply) < len(user_text) * 1.8

    def _is_goodbye(self, text: str) -> bool:
        t = (text or "").lower()
        return any(x in t for x in ["thank you", "goodbye", "that will be all", "谢谢", "再见", "就这样", "不用了"])

    def _is_polite_close(self, text: str) -> bool:
        t = (text or "").lower()
        return any(x in t for x in ["great day", "goodbye", "welcome", "have a", "谢谢", "再见", "祝你", "很高兴"])

    def _quote(self, text: str, limit: int = 80) -> str:
        return text if len(text) <= limit else text[: limit - 1] + "…"


class DynamicSimUser:
    def __init__(self, asset: LockedSessionAsset, alpha: float = 2.0, b_min: int = 3, global_cap: int = 40, seed: int = 42, challenge_mode: str = "normal"):
        self.asset = asset
        self.alpha = alpha
        self.b_min = b_min
        self.global_cap = global_cap
        self.rng = random.Random(seed)
        self.challenge_mode = challenge_mode
        self.intent_pos = 0
        self.intent_cycles = 0
        self.global_cycles = 0
        self.last_label = ""
        self.last_rationale = ""

    @property
    def done(self) -> bool:
        return self.intent_pos >= len(self.asset.intent_sequence) or self.global_cycles >= self.global_cap

    @property
    def current_intent(self) -> IntentItem | None:
        if self.intent_pos >= len(self.asset.intent_sequence):
            return None
        return self.asset.intent_sequence[self.intent_pos]

    def current_budget(self) -> int:
        intent = self.current_intent
        if intent is None:
            return 0
        n_i = max(intent.turn_span_user_turns, 0)
        if n_i == 0:
            return self.b_min
        return min(self.global_cap, max(self.b_min, math.ceil(self.alpha * n_i)))

    def next_user_turn(self) -> dict | None:
        intent = self.current_intent
        if intent is None:
            return None
        templates_initial = [
            "我想处理一下：{text}",
            "请帮我看一下：{text}",
            "关于这个需求，想请你直接处理：{text}",
        ]
        templates_followup = [
            "你刚才没有解决我的重点，我真正想要的是：{text}",
            "换个说法，我关心的是：{text}",
            "还是没回答到位，请直接处理：{text}",
        ]
        text = intent.example_user_queries[0] if intent.example_user_queries else intent.intent_text

        if self.intent_cycles == 0:
            if self.challenge_mode == "missing_info":
                return {
                    "user_text": f"我先不把条件都说全，你先尽量处理：{text}",
                    "sim_strategy": "缺信息施压",
                    "sim_note": f"困难模式=missing_info：故意少给条件，观察 Agent 会不会先交付可交付部分，而不是机械复述。",
                }
            if self.challenge_mode == "constraint_conflict":
                return {
                    "user_text": f"帮我处理这个：{text}。但我还有个可能冲突的要求，别忽略约束。",
                    "sim_strategy": "冲突约束",
                    "sim_note": "困难模式=constraint_conflict：在首轮埋入潜在冲突，观察 Agent 是否识别约束而不是盲答。",
                }
            template = self.rng.choice(templates_initial)
            return {
                "user_text": template.format(text=text),
                "sim_strategy": "初次提出意图",
                "sim_note": f"首次进入 intent {intent.intent_index}，按历史用户表述发起请求。",
            }

        if self.challenge_mode == "intent_shift" and self.intent_cycles == 1:
            return {
                "user_text": f"我补充一下，我现在更关心另一个方向，但你先别忘了原需求：{text}",
                "sim_strategy": "中途意图漂移",
                "sim_note": "困难模式=intent_shift：用户中途改口，观察 Agent 能否稳住主意图并处理新信息。",
            }

        if self.last_label == "DEVIATION":
            return {
                "user_text": f"你刚才有点跑偏。不要解释流程，直接完成这件事：{text}",
                "sim_strategy": "偏航纠偏",
                "sim_note": f"上一轮 Judge 判为 DEVIATION，因此 SimUser 明确要求回到意图：{intent.intent_text}",
            }

        if self.last_label == "NOT_SATISFIED":
            criteria = intent.success_criteria or "请直接给结果，不要只复述。"
            if self.challenge_mode == "strict_recovery":
                criteria = f"{criteria}；如果缺信息，请明确告诉我缺什么、你已经能先做什么。"
            return {
                "user_text": f"上一轮还没完成。请按这个标准直接处理：{criteria}。我的需求还是：{text}",
                "sim_strategy": "按成功标准追问",
                "sim_note": f"上一轮 Judge 判为 NOT_SATISFIED，SimUser 把 success criteria 显式抬出来施压。",
            }

        template = self.rng.choice(templates_followup)
        return {
            "user_text": template.format(text=text),
            "sim_strategy": "普通追问",
            "sim_note": "进入同一意图的后续轮次，继续追问直到满足或耗尽预算。",
        }

    def consume(self, label: str, rationale: str = "") -> str:
        budget = self.current_budget()
        self.intent_cycles += 1
        self.global_cycles += 1
        self.last_label = label
        self.last_rationale = rationale
        if label == "SATISFIED":
            self.intent_pos += 1
            self.intent_cycles = 0
            self.last_label = ""
            self.last_rationale = ""
            return "intent_satisfied"
        if self.intent_cycles >= budget:
            self.intent_pos += 1
            self.intent_cycles = 0
            self.last_label = ""
            self.last_rationale = ""
            return "intent_failed_budget"
        return "continue"


class FrontierTestAgent:
    def __init__(self, model: str | None = None, strict: bool = False):
        self.model = model or os.environ.get("ZEVAL_TEST_AGENT_MODEL") or os.environ.get("ZEVAL_AGENT_MODEL")
        self.strict = strict
        self._client = None

    def _get_client(self):
        api_key = (
            os.environ.get("ZEVAL_INTENT_EXPERIMENT_API_KEY")
            or os.environ.get("ZEVAL_JUDGE_API_KEY")
            or os.environ.get("OPENAI_API_KEY")
        )
        base_url = os.environ.get("ZEVAL_JUDGE_BASE_URL") or os.environ.get("OPENAI_BASE_URL")
        if not api_key or not self.model:
            return None
        if self._client is None:
            try:
                from openai import OpenAI
            except ModuleNotFoundError:
                return None
            kwargs = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            self._client = OpenAI(**kwargs)
        return self._client

    def reply(self, user_text: str, system_prefix: str = "", context: str = "") -> str:
        client = self._get_client()
        if client is None:
            if self.strict:
                raise RuntimeError("真实模型未接通：缺少 API Key、Base URL 或模型名。")
            return default_agent(user_text, system_prefix, context)
        prompt = (
            "你是一个真实待测 Agent。请基于给定的 system 已知事实、已有上下文和当前用户请求，"
            "自然地继续对话。优先解决用户问题，不要解释评测机制。"
        )
        messages = [{"role": "system", "content": prompt}]
        if system_prefix.strip():
            messages.append({"role": "system", "content": system_prefix})
        if context.strip():
            messages.append({"role": "system", "content": f"已有对话上下文：\n{context.strip()}"})
        messages.append({"role": "user", "content": user_text})
        try:
            response = client.chat.completions.create(
                model=self.model,
                temperature=0.2,
                seed=42,
                messages=messages,
            )
            text = response.choices[0].message.content or ""
            return text.strip() or default_agent(user_text, system_prefix, context)
        except Exception as exc:
            if self.strict:
                raise RuntimeError(f"真实模型调用失败：{exc}") from exc
            return default_agent(user_text, system_prefix, context)


def default_agent(user_text: str, system_prefix: str = "", context: str = "") -> str:
    fact = ""
    if system_prefix:
        fact = system_prefix.splitlines()[0][:80]
    return f"已收到。基于当前需求和已知事实，我的处理是：{user_text[:60]}。{fact}"


class PilotExperimentRunner:
    def __init__(self, agent_fn: Callable[[str, str, str], str] | None = None, alpha: float = 2.0, b_min: int = 3, global_cap: int = 40, challenge_mode: str = "normal"):
        self.test_agent = FrontierTestAgent()
        self.agent_fn = agent_fn or self.test_agent.reply
        self.alpha = alpha
        self.b_min = b_min
        self.global_cap = global_cap
        self.challenge_mode = challenge_mode
        self.judge = PilotJudge()

    def run_dynamic(self, asset: LockedSessionAsset) -> tuple[SessionMetrics, list[EvalTurn]]:
        sim = DynamicSimUser(asset, alpha=self.alpha, b_min=self.b_min, global_cap=self.global_cap, challenge_mode=self.challenge_mode)
        turns: list[EvalTurn] = []
        satisfied = 0
        failed = 0
        deviations = 0
        followups = 0
        context = ""

        while not sim.done:
            intent = sim.current_intent
            if intent is None:
                break
            user_turn = sim.next_user_turn()
            if user_turn is None:
                break
            user_text = user_turn["user_text"]
            system_prefix = self._build_refill_prefix(asset, intent.intent_index)
            assistant_text = self.agent_fn(user_text, system_prefix, context)
            decision = self.judge.decide(intent, user_text, assistant_text)
            budget_before = sim.current_budget()
            budget_used = sim.intent_cycles + 1
            event = sim.consume(decision.label, decision.rationale)
            if decision.label == "DEVIATION":
                deviations += 1
            if sim.global_cycles > 1 and sim.intent_cycles > 0:
                followups += 1
            if event == "intent_satisfied":
                satisfied += 1
            elif event == "intent_failed_budget":
                failed += 1

            turns.append(
                EvalTurn(
                    eval_mode="dynamic",
                    session_id=asset.session_id,
                    intent_index=intent.intent_index,
                    intent_text=intent.intent_text,
                    success_criteria=intent.success_criteria,
                    cycle_index=sim.global_cycles,
                    budget=max(budget_before, self.b_min),
                    budget_used=budget_used,
                    user_text=user_text,
                    system_prefix=system_prefix,
                    assistant_text=assistant_text,
                    sim_strategy=user_turn.get("sim_strategy", ""),
                    sim_note=user_turn.get("sim_note", ""),
                    judge_label=decision.label,
                    rationale=decision.rationale,
                    evidence_quote=decision.evidence_quote,
                    fail_category=decision.fail_category,
                    directly_answered=decision.directly_answered,
                    delivered_result=decision.delivered_result,
                    asked_followup=decision.asked_followup,
                    leaked_prompt=decision.leaked_prompt,
                    parroted_user=decision.parroted_user,
                    turn_score=decision.turn_score,
                    judge_source=decision.source,
                    judge_model=decision.judge_model,
                    judge_prompt=decision.prompt_text,
                    judge_raw_response=decision.raw_response,
                    event=event,
                )
            )
            context += f"\nUSER: {user_text}\nASSISTANT: {assistant_text}"

        metrics = self._build_metrics(asset, satisfied, failed, deviations, followups, len(turns), turns)
        return metrics, turns

    def run_baseline(self, asset: LockedSessionAsset, session_data: dict) -> tuple[SessionMetrics, list[EvalTurn]]:
        turns = session_data.get("turns", [])
        satisfied = 0
        deviations = 0
        followups = 0
        total_turns = 0
        judge_rows: list[EvalTurn] = []
        for intent in asset.intent_sequence:
            assistant_bundle = self._assistant_text_in_span(turns, intent)
            user_bundle = (intent.example_user_queries[0] if intent.example_user_queries else intent.intent_text)
            decision = self.judge.decide(intent, user_bundle, assistant_bundle)
            total_turns += max(intent.turn_span_user_turns, 1)
            if decision.label == "SATISFIED":
                satisfied += 1
            elif decision.label == "DEVIATION":
                deviations += 1
            if max(intent.turn_span_user_turns, 1) > 1:
                followups += max(intent.turn_span_user_turns - 1, 0)
            judge_rows.append(
                EvalTurn(
                    eval_mode="baseline",
                    session_id=asset.session_id,
                    intent_index=intent.intent_index,
                    intent_text=intent.intent_text,
                    success_criteria=intent.success_criteria,
                    cycle_index=intent.intent_index,
                    budget=max(intent.turn_span_user_turns, 1),
                    budget_used=max(intent.turn_span_user_turns, 1),
                    user_text=user_bundle,
                    system_prefix="",
                    assistant_text=assistant_bundle,
                    sim_strategy="历史基线回看",
                    sim_note="这不是 SimUser 新生成的轮次，而是把历史 span 合并后交给 Judge 判断。",
                    judge_label=decision.label,
                    rationale=decision.rationale,
                    evidence_quote=decision.evidence_quote,
                    fail_category=decision.fail_category,
                    directly_answered=decision.directly_answered,
                    delivered_result=decision.delivered_result,
                    asked_followup=decision.asked_followup,
                    leaked_prompt=decision.leaked_prompt,
                    parroted_user=decision.parroted_user,
                    turn_score=decision.turn_score,
                    judge_source=decision.source,
                    judge_model=decision.judge_model,
                    judge_prompt=decision.prompt_text,
                    judge_raw_response=decision.raw_response,
                    event="baseline_intent_judged",
                )
            )
        failed = max(len(asset.intent_sequence) - satisfied, 0)
        return self._build_metrics(asset, satisfied, failed, deviations, followups, total_turns, judge_rows), judge_rows

    def _assistant_text_in_span(self, turns: list[dict], intent: IntentItem) -> str:
        if intent.historical_span is None:
            return ""
        chunks = []
        for t in turns:
            turn_num = int(t.get("turn_num", 0))
            if intent.historical_span.start_turn_index <= turn_num <= intent.historical_span.end_turn_index and t.get("role") == "agent":
                chunks.append(t.get("text", ""))
        return " ".join(chunks).strip()

    def _build_refill_prefix(self, asset: LockedSessionAsset, intent_index: int) -> str:
        selected = []
        for item in asset.refillables:
            if item.bind_intent_index is None or item.bind_intent_index == intent_index:
                selected.append(item.injection_text or f"【会话已知事实】{item.refill_reference}")
        return "\n".join(selected)

    def _build_metrics(self, asset: LockedSessionAsset, satisfied: int, failed: int, deviations: int, followups: int, total_turns: int, turns: list[EvalTurn]) -> SessionMetrics:
        total_intents = max(len(asset.intent_sequence), 1)
        hist_turns = sum(max(i.turn_span_user_turns, 1) for i in asset.intent_sequence)
        completion = satisfied / total_intents
        followup_per_intent = followups / total_intents
        deviation_rate = deviations / max(total_turns, 1)
        turn_efficiency = hist_turns / max(total_turns, 1)
        turn_efficiency = min(turn_efficiency, 1.5)
        direct_answer_rate = sum(1 for t in turns if t.directly_answered) / max(len(turns), 1)
        result_delivery_rate = sum(1 for t in turns if t.delivered_result) / max(len(turns), 1)
        prompt_leak_rate = sum(1 for t in turns if t.leaked_prompt) / max(len(turns), 1)
        parrot_rate = sum(1 for t in turns if t.parroted_user) / max(len(turns), 1)
        avg_turn_score = sum(t.turn_score for t in turns) / max(len(turns), 1)
        composite = (
            (completion * 0.35)
            + ((1 / (1 + followup_per_intent)) * 0.1)
            + ((1 - deviation_rate) * 0.15)
            + (min(turn_efficiency, 1.0) * 0.05)
            + (result_delivery_rate * 0.15)
            + (direct_answer_rate * 0.1)
            + ((1 - prompt_leak_rate) * 0.05)
            + ((1 - parrot_rate) * 0.05)
        )
        return SessionMetrics(
            session_id=asset.session_id,
            total_intents=total_intents,
            satisfied_intents=satisfied,
            failed_intents=failed,
            total_turns=total_turns,
            deviation_turns=deviations,
            followup_turns=followups,
            intent_completion_rate=round(completion, 4),
            followup_per_intent=round(followup_per_intent, 4),
            deviation_rate=round(deviation_rate, 4),
            turn_efficiency=round(turn_efficiency, 4),
            direct_answer_rate=round(direct_answer_rate, 4),
            result_delivery_rate=round(result_delivery_rate, 4),
            prompt_leak_rate=round(prompt_leak_rate, 4),
            parrot_rate=round(parrot_rate, 4),
            avg_turn_score=round(avg_turn_score, 4),
            composite_score=round(composite, 4),
        )


def summarize_results(baseline_metrics: list[SessionMetrics], dynamic_metrics: list[SessionMetrics]) -> dict:
    def avg(items: list[SessionMetrics], field: str) -> float:
        vals = [getattr(x, field) for x in items]
        return round(sum(vals) / max(len(vals), 1), 4)

    fields = ["intent_completion_rate", "followup_per_intent", "deviation_rate", "turn_efficiency", "direct_answer_rate", "result_delivery_rate", "prompt_leak_rate", "parrot_rate", "avg_turn_score", "composite_score"]
    baseline = {f: avg(baseline_metrics, f) for f in fields}
    dynamic = {f: avg(dynamic_metrics, f) for f in fields}
    delta = {f: round(dynamic[f] - baseline[f], 4) for f in fields}
    return {
        "baseline": baseline,
        "dynamic": dynamic,
        "delta": delta,
        "sessions": len(dynamic_metrics),
    }


def generate_radar_svg(summary: dict, out_path: Path):
    # normalize followup/deviation by converting lower-is-better to higher-is-better
    labels = [
        ("意图完成", "intent_completion_rate", False),
        ("少追问", "followup_per_intent", True),
        ("少偏航", "deviation_rate", True),
        ("轮次效率", "turn_efficiency", False),
        ("综合得分", "composite_score", False),
    ]

    def score(side: str, key: str, invert: bool):
        value = summary[side][key]
        if invert:
            return max(0.0, min(1.0, 1 / (1 + value)))
        return max(0.0, min(1.0, value))

    cx, cy, radius = 220, 220, 140
    circles = []
    for r in [0.25, 0.5, 0.75, 1.0]:
        circles.append(f'<circle cx="{cx}" cy="{cy}" r="{radius*r}" fill="none" stroke="#dbe3ee" stroke-dasharray="3 3"/>')

    axes = []
    baseline_points = []
    dynamic_points = []
    label_nodes = []
    for idx, (label, key, invert) in enumerate(labels):
        angle = -math.pi / 2 + idx * (2 * math.pi / len(labels))
        x = cx + radius * math.cos(angle)
        y = cy + radius * math.sin(angle)
        axes.append(f'<line x1="{cx}" y1="{cy}" x2="{x}" y2="{y}" stroke="#cbd5e1"/>')
        label_nodes.append(f'<text x="{cx + (radius+22)*math.cos(angle):.1f}" y="{cy + (radius+22)*math.sin(angle):.1f}" font-size="12" text-anchor="middle" fill="#334155">{label}</text>')
        for side, collector in [("baseline", baseline_points), ("dynamic", dynamic_points)]:
            s = score(side, key, invert)
            px = cx + radius * s * math.cos(angle)
            py = cy + radius * s * math.sin(angle)
            collector.append(f"{px:.1f},{py:.1f}")

    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="520" height="520" viewBox="0 0 520 520">
  <rect width="520" height="520" fill="#ffffff" rx="18"/>
  {''.join(circles)}
  {''.join(axes)}
  <polygon points="{' '.join(baseline_points)}" fill="rgba(59,130,246,0.18)" stroke="#2563eb" stroke-width="2"/>
  <polygon points="{' '.join(dynamic_points)}" fill="rgba(239,68,68,0.18)" stroke="#ef4444" stroke-width="2"/>
  {''.join(label_nodes)}
  <text x="28" y="28" font-size="18" fill="#111827">基线 B vs 动态 D 雷达图</text>
  <rect x="28" y="42" width="12" height="12" fill="rgba(59,130,246,0.18)" stroke="#2563eb"/>
  <text x="48" y="52" font-size="12" fill="#334155">B = 原始会话基线</text>
  <rect x="28" y="62" width="12" height="12" fill="rgba(239,68,68,0.18)" stroke="#ef4444"/>
  <text x="48" y="72" font-size="12" fill="#334155">D = 动态回放</text>
</svg>'''
    out_path.write_text(svg, encoding="utf-8")


def write_json(path: Path, data: dict):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def write_jsonl(path: Path, rows: list[dict]):
    with path.open("w", encoding="utf-8") as f:
        for row in rows:
            f.write(json.dumps(row, ensure_ascii=False) + "\n")


def eval_turn_to_dict(turn: EvalTurn) -> dict:
    return asdict(turn)


def _tokenize(text: str) -> set[str]:
    text = (text or "").lower()
    tokens = []
    current = []
    for ch in text:
        if ch.isalnum() or '\u4e00' <= ch <= '\u9fff':
            current.append(ch)
        else:
            if current:
                tokens.append(''.join(current))
                current = []
    if current:
        tokens.append(''.join(current))
    return {t for t in tokens if len(t) > 1}
