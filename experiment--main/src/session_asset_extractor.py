from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from src.pilot_types import HistoricalSpan, IntentItem, LockedSessionAsset, RefillableItem

SCHEMA_VERSION = "2026-02-intent-refill-v1"
PROMPT_VERSION = "pilot-v1"

EXTRACTION_PROMPT = """你是一个会话整理器。请把给定 transcript 整理为固定 JSON Schema，输出字段必须严格匹配：
- schema_version
- schema_lock_revision
- prompt_version
- session_id
- intent_sequence
- refillables

要求：
1. 只提取真实 transcript 中能支持的信息
2. intent_sequence 反映用户按阶段推进的核心意图
3. turn_span_user_turns 是该意图在历史中对应的用户发起轮数
4. refillables 只保留历史中已闭环、适合注入为已知事实的内容
5. 只输出 JSON
"""


class SessionAssetExtractor:
    def __init__(self, model: str | None = None, temperature: float = 0.1):
        self.model = model or os.environ.get("ZEVAL_JUDGE_MODEL") or os.environ.get("OPENAI_MODEL") or "gpt-4o-mini"
        self.temperature = temperature
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
            kwargs: dict[str, Any] = {"api_key": api_key}
            if base_url:
                kwargs["base_url"] = base_url
            self._client = OpenAI(**kwargs)
        return self._client

    def extract(self, session: dict) -> LockedSessionAsset:
        client = self._get_client()
        if client is None:
            return self._heuristic_extract(session)
        try:
            return self._llm_extract(session, client)
        except Exception:
            return self._heuristic_extract(session)

    def _llm_extract(self, session: dict, client) -> LockedSessionAsset:
        transcript = self._format_session(session)
        response = client.chat.completions.create(
            model=self.model,
            temperature=self.temperature,
            seed=42,
            messages=[
                {"role": "system", "content": EXTRACTION_PROMPT},
                {"role": "user", "content": transcript},
            ],
            response_format={"type": "json_object"},
        )
        raw = response.choices[0].message.content.strip()
        data = json.loads(raw)
        return self._from_dict(data, session)

    def _heuristic_extract(self, session: dict) -> LockedSessionAsset:
        turns = session.get("turns", [])
        user_turns = [t for t in turns if t.get("role") == "user"]
        intent_sequence: list[IntentItem] = []
        refillables: list[RefillableItem] = []

        for idx, turn in enumerate(user_turns, start=1):
            turn_num = int(turn.get("turn_num", idx))
            next_user_turn_num = self._next_user_turn_num(user_turns, idx)
            hist_end = next_user_turn_num - 1 if next_user_turn_num is not None else int(turns[-1].get("turn_num", turn_num))
            example = turn.get("text", "").strip()
            success = self._infer_success_criteria(turn)
            span_user_turns = self._count_user_turns_in_span(turns, turn_num, hist_end)
            intent_sequence.append(
                IntentItem(
                    intent_index=idx,
                    intent_text=self._summarize_text(example),
                    turn_span_user_turns=max(span_user_turns, 1),
                    example_user_queries=[example] if example else [],
                    success_criteria=success,
                    depends_on=[idx - 1] if idx > 1 else [],
                    historical_span=HistoricalSpan(start_turn_index=turn_num, end_turn_index=hist_end),
                )
            )
            assistant_reference = self._find_last_assistant_text(turns, turn_num, hist_end)
            if assistant_reference:
                refillables.append(
                    RefillableItem(
                        refill_index=len(refillables) + 1,
                        trigger_condition=f"进入意图 {idx}: {self._summarize_text(example, 24)}",
                        refill_reference=self._summarize_text(assistant_reference, 80),
                        key=f"intent_{idx}_known_fact",
                        source_turn_index=hist_end,
                        confidence="medium",
                        injection_text=(
                            f"【会话已知事实】关于意图 {idx}，历史对话已出现如下事实：{self._summarize_text(assistant_reference, 120)}。"
                            "请在不重复调用外部系统的前提下，优先基于该事实作答。"
                        ),
                        bind_intent_index=idx,
                    )
                )

        return LockedSessionAsset(
            schema_version=SCHEMA_VERSION,
            schema_lock_revision=1,
            prompt_version=PROMPT_VERSION,
            session_id=session.get("id", "unknown"),
            intent_sequence=intent_sequence,
            refillables=refillables,
            source_file=session.get("source_file", ""),
        )

    def _from_dict(self, data: dict, session: dict) -> LockedSessionAsset:
        intents = []
        for item in data.get("intent_sequence", []):
            span = item.get("historical_span") or {}
            intents.append(
                IntentItem(
                    intent_index=int(item.get("intent_index", len(intents) + 1)),
                    intent_text=item.get("intent_text") or item.get("description") or "",
                    turn_span_user_turns=int(item.get("turn_span_user_turns", 1) or 1),
                    example_user_queries=item.get("example_user_queries", []),
                    success_criteria=item.get("success_criteria", ""),
                    depends_on=[int(x) for x in item.get("depends_on", [])],
                    historical_span=HistoricalSpan(
                        start_turn_index=int(span.get("start_turn_index", 0)),
                        end_turn_index=int(span.get("end_turn_index", 0)),
                    ) if span else None,
                    n_i_conflict=bool(item.get("n_i_conflict", False)),
                    n_i_heuristic=bool(item.get("n_i_heuristic", False)),
                )
            )
        refillables = []
        for item in data.get("refillables", []):
            refillables.append(
                RefillableItem(
                    refill_index=int(item.get("refill_index", len(refillables) + 1)),
                    trigger_condition=item.get("trigger_condition", ""),
                    refill_reference=item.get("refill_reference", ""),
                    key=item.get("key", ""),
                    source_turn_index=item.get("source_turn_index"),
                    confidence=item.get("confidence", "medium"),
                    injection_text=item.get("injection_text", ""),
                    bind_intent_index=item.get("bind_intent_index"),
                )
            )
        return LockedSessionAsset(
            schema_version=data.get("schema_version", SCHEMA_VERSION),
            schema_lock_revision=int(data.get("schema_lock_revision", 1)),
            prompt_version=data.get("prompt_version", PROMPT_VERSION),
            session_id=data.get("session_id", session.get("id", "unknown")),
            intent_sequence=intents,
            refillables=refillables,
            source_file=session.get("source_file", ""),
        )

    @staticmethod
    def validate_asset(asset: LockedSessionAsset) -> list[str]:
        errors = []
        if not asset.intent_sequence:
            errors.append("intent_sequence is empty")
        seen = set()
        for item in asset.intent_sequence:
            if item.intent_index in seen:
                errors.append(f"duplicate intent_index: {item.intent_index}")
            seen.add(item.intent_index)
            if not item.intent_text.strip():
                errors.append(f"intent {item.intent_index} missing intent_text")
            if item.turn_span_user_turns < 1:
                errors.append(f"intent {item.intent_index} turn_span_user_turns < 1")
        return errors

    @staticmethod
    def dump_asset(asset: LockedSessionAsset, path: Path):
        path.write_text(json.dumps(asset.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def load_asset(path: Path) -> LockedSessionAsset:
        data = json.loads(path.read_text(encoding="utf-8"))
        extractor = SessionAssetExtractor()
        return extractor._from_dict(data, {"id": data.get("session_id", "unknown")})

    @staticmethod
    def ensure_locked_asset(asset: LockedSessionAsset, draft_path: Path, locked_path: Path):
        SessionAssetExtractor.dump_asset(asset, draft_path)
        if not locked_path.exists():
            SessionAssetExtractor.dump_asset(asset, locked_path)

    def _format_session(self, session: dict) -> str:
        parts = [f"session_id={session.get('id', 'unknown')}"]
        for turn in session.get("turns", []):
            parts.append(f"[{turn.get('turn_num', '')}] {turn.get('role', 'user').upper()}: {turn.get('text', '')}")
        return "\n".join(parts)

    def _next_user_turn_num(self, user_turns: list[dict], idx: int):
        if idx >= len(user_turns):
            return None
        return int(user_turns[idx].get("turn_num", idx + 1))

    def _count_user_turns_in_span(self, turns: list[dict], start: int, end: int) -> int:
        return sum(1 for t in turns if start <= int(t.get("turn_num", 0)) <= end and t.get("role") == "user")

    def _find_last_assistant_text(self, turns: list[dict], start: int, end: int) -> str:
        text = ""
        for t in turns:
            turn_num = int(t.get("turn_num", 0))
            if start <= turn_num <= end and t.get("role") == "agent":
                text = t.get("text", "")
        return text.strip()

    def _infer_success_criteria(self, turn: dict) -> str:
        utterance = turn.get("text", "").strip()
        if not utterance:
            return "助手正面回应并解决该意图。"
        if utterance.endswith("?") or utterance.endswith("？"):
            return "助手需要直接回答这个问题或给出明确下一步。"
        return "助手需要确认理解并给出有效结果或明确处理动作。"

    def _summarize_text(self, text: str, limit: int = 36) -> str:
        text = re.sub(r"\s+", " ", text or "").strip()
        return text if len(text) <= limit else text[: limit - 1] + "…"
