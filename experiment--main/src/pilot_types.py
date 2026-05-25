from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Any


@dataclass
class HistoricalSpan:
    start_turn_index: int
    end_turn_index: int


@dataclass
class IntentItem:
    intent_index: int
    intent_text: str
    turn_span_user_turns: int
    example_user_queries: list[str] = field(default_factory=list)
    success_criteria: str = ""
    depends_on: list[int] = field(default_factory=list)
    historical_span: HistoricalSpan | None = None
    n_i_conflict: bool = False
    n_i_heuristic: bool = False


@dataclass
class RefillableItem:
    refill_index: int
    trigger_condition: str
    refill_reference: str
    key: str = ""
    source_turn_index: int | None = None
    confidence: str = "medium"
    injection_text: str = ""
    bind_intent_index: int | None = None


@dataclass
class LockedSessionAsset:
    schema_version: str
    schema_lock_revision: int
    prompt_version: str
    session_id: str
    intent_sequence: list[IntentItem] = field(default_factory=list)
    refillables: list[RefillableItem] = field(default_factory=list)
    source_file: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class JudgeDecision:
    label: str  # SATISFIED | NOT_SATISFIED | DEVIATION
    rationale: str
    evidence_quote: str
    fail_category: str = ""
    directly_answered: bool = False
    delivered_result: bool = False
    asked_followup: bool = False
    leaked_prompt: bool = False
    parroted_user: bool = False
    turn_score: float = 0.0
    source: str = "heuristic"  # heuristic | llm
    judge_model: str = ""
    prompt_text: str = ""
    raw_response: str = ""


@dataclass
class EvalTurn:
    eval_mode: str
    session_id: str
    intent_index: int
    intent_text: str
    success_criteria: str
    cycle_index: int
    budget: int
    budget_used: int
    user_text: str
    system_prefix: str
    assistant_text: str
    sim_strategy: str
    sim_note: str
    judge_label: str
    rationale: str
    evidence_quote: str
    fail_category: str
    directly_answered: bool
    delivered_result: bool
    asked_followup: bool
    leaked_prompt: bool
    parroted_user: bool
    turn_score: float
    judge_source: str
    judge_model: str
    judge_prompt: str
    judge_raw_response: str
    event: str


@dataclass
class SessionMetrics:
    session_id: str
    total_intents: int
    satisfied_intents: int
    failed_intents: int
    total_turns: int
    deviation_turns: int
    followup_turns: int
    intent_completion_rate: float
    followup_per_intent: float
    deviation_rate: float
    turn_efficiency: float
    direct_answer_rate: float
    result_delivery_rate: float
    prompt_leak_rate: float
    parrot_rate: float
    avg_turn_score: float
    composite_score: float

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
