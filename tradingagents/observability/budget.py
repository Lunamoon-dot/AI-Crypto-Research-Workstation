"""Token and latency budget tracking per graph stage.

Budgets are soft observability limits. They emit structured events when
exceeded, but they do not stop a research run.
"""

from __future__ import annotations

import contextvars
import logging
import threading
import time
from contextlib import contextmanager
from typing import Any

from langchain_core.callbacks import BaseCallbackHandler
from langchain_core.messages import AIMessage
from langchain_core.outputs import LLMResult

from tradingagents.observability import log_event

logger = logging.getLogger(__name__)


_DEFAULT_BUDGETS: dict[str, dict[str, float]] = {
    "analyst": {
        "max_tokens": 20_000,
        "max_latency_sec": 60.0,
    },
    "analysts_total": {
        "max_tokens": 80_000,
        "max_latency_sec": 240.0,
    },
    "debate": {
        "max_tokens": 40_000,
        "max_latency_sec": 120.0,
    },
    "research_manager": {
        "max_tokens": 15_000,
        "max_latency_sec": 45.0,
    },
    "trader": {
        "max_tokens": 10_000,
        "max_latency_sec": 30.0,
    },
    "risk_debate": {
        "max_tokens": 50_000,
        "max_latency_sec": 150.0,
    },
    "portfolio_manager": {
        "max_tokens": 15_000,
        "max_latency_sec": 45.0,
    },
    "scenario_planner": {
        "max_tokens": 10_000,
        "max_latency_sec": 30.0,
    },
    "total": {
        "max_tokens": 250_000,
        "max_latency_sec": 600.0,
    },
}


class StageBudget:
    """Per-stage token and latency tracking with budget checks."""

    def __init__(self, stage: str, max_tokens: float, max_latency_sec: float):
        self.stage = stage
        self.max_tokens = max_tokens
        self.max_latency_sec = max_latency_sec
        self.tokens: int = 0
        self._started: float | None = None
        self._latency_sec: float = 0.0

    def start(self) -> None:
        self._started = time.perf_counter()

    def add_tokens(self, count: int) -> None:
        self.tokens += count

    def add_latency(self, latency_sec: float) -> None:
        self._latency_sec += latency_sec

    def stop(self) -> float:
        """Stop timing and return cumulative latency in seconds."""
        if self._started is not None:
            self.add_latency(time.perf_counter() - self._started)
            self._started = None
        return self._latency_sec

    @property
    def latency_sec(self) -> float:
        return self._latency_sec

    @property
    def token_budget_remaining(self) -> float:
        return self.max_tokens - self.tokens

    @property
    def latency_budget_remaining(self) -> float:
        return self.max_latency_sec - self._latency_sec

    def check_budgets(self) -> list[str]:
        """Return exceeded-budget messages, or an empty list."""
        exceeded: list[str] = []
        if self.tokens > self.max_tokens:
            exceeded.append(
                f"Token budget exceeded for [{self.stage}]: "
                f"{self.tokens} > {self.max_tokens} tokens"
            )
        if self._latency_sec > self.max_latency_sec:
            exceeded.append(
                f"Latency budget exceeded for [{self.stage}]: "
                f"{self._latency_sec:.1f}s > {self.max_latency_sec}s"
            )
        return exceeded

    def summary(self) -> dict[str, Any]:
        return {
            "stage": self.stage,
            "tokens": self.tokens,
            "max_tokens": self.max_tokens,
            "latency_sec": round(self._latency_sec, 2),
            "max_latency_sec": self.max_latency_sec,
        }


class BudgetTracker:
    """Tracks token and latency budgets across graph pipeline stages."""

    def __init__(self, config: dict[str, Any] | None = None):
        config = config or {}
        budgets_cfg = config.get("budgets", {})
        self._budgets: dict[str, StageBudget] = {}
        self._stage_stack: contextvars.ContextVar[tuple[str, ...]] = (
            contextvars.ContextVar("tradingagents_budget_stage_stack", default=())
        )
        self._lock = threading.Lock()

        for stage_name, defaults in _DEFAULT_BUDGETS.items():
            stage_cfg = budgets_cfg.get(stage_name, {})
            self._budgets[stage_name] = StageBudget(
                stage=stage_name,
                max_tokens=float(stage_cfg.get("max_tokens", defaults["max_tokens"])),
                max_latency_sec=float(
                    stage_cfg.get("max_latency_sec", defaults["max_latency_sec"])
                ),
            )

    @contextmanager
    def stage(self, stage: str, **ctx_fields):
        """Context manager for a pipeline stage."""
        budget = self._budgets.get(stage)
        if budget is None:
            budget = StageBudget(stage, max_tokens=1_000_000, max_latency_sec=3600)

        started_at = time.perf_counter()
        stack = self._stage_stack.get()
        token = self._stage_stack.set((*stack, stage))
        try:
            yield budget
        finally:
            latency_sec = time.perf_counter() - started_at
            self._stage_stack.reset(token)
            with self._lock:
                budget.add_latency(latency_sec)
                exceeded = budget.check_budgets()
            if exceeded:
                for msg in exceeded:
                    logger.warning(msg)
                log_event(
                    logger,
                    "budget_exceeded",
                    stage=stage,
                    tokens=budget.tokens,
                    max_tokens=budget.max_tokens,
                    latency_sec=round(budget.latency_sec, 2),
                    max_latency_sec=budget.max_latency_sec,
                    exceeded=exceeded,
                    **ctx_fields,
                )

    def add_tokens(self, input_tokens: int, output_tokens: int) -> None:
        """Add token counts to the current stage and total run budget."""
        total = input_tokens + output_tokens
        stack = self._stage_stack.get()
        with self._lock:
            if stack:
                stage = stack[-1]
                budget = self._budgets.get(stage)
                if budget:
                    budget.add_tokens(total)
                if stage == "analyst":
                    analysts_total = self._budgets.get("analysts_total")
                    if analysts_total:
                        analysts_total.add_tokens(total)
            else:
                stage = None

            total_budget = self._budgets.get("total")
            if total_budget and stage != "total":
                total_budget.add_tokens(total)

    def current_stage(self) -> str | None:
        stack = self._stage_stack.get()
        return stack[-1] if stack else None

    def summary(self) -> list[dict[str, Any]]:
        """Return a summary of all configured stage budgets."""
        return [b.summary() for b in self._budgets.values()]

    def log_summary(self, **fields: Any) -> None:
        """Emit one structured event with the final budget summary."""
        log_event(logger, "budget_summary", summary=self.summary(), **fields)

    def check_total_budget(self) -> list[str]:
        """Check the total run budget and return exceeded messages."""
        total = self._budgets.get("total")
        if total:
            return total.check_budgets()
        return []


class BudgetCallbackHandler(BaseCallbackHandler):
    """LangChain callback that forwards LLM token usage to a tracker."""

    def __init__(self, tracker: BudgetTracker) -> None:
        super().__init__()
        self.tracker = tracker

    def on_llm_end(self, response: LLMResult, **kwargs: Any) -> None:
        usage = _extract_llm_usage(response)
        if usage["input_tokens"] or usage["output_tokens"]:
            self.tracker.add_tokens(
                usage["input_tokens"],
                usage["output_tokens"],
            )


def _extract_llm_usage(response: LLMResult) -> dict[str, int]:
    """Extract token usage from common LangChain response shapes."""
    usage_metadata = None
    try:
        generation = response.generations[0][0]
    except (IndexError, TypeError):
        generation = None

    if generation is not None and hasattr(generation, "message"):
        message = generation.message
        if isinstance(message, AIMessage):
            usage_metadata = getattr(message, "usage_metadata", None)

    if usage_metadata:
        return {
            "input_tokens": int(usage_metadata.get("input_tokens", 0) or 0),
            "output_tokens": int(usage_metadata.get("output_tokens", 0) or 0),
        }

    llm_output = getattr(response, "llm_output", None) or {}
    token_usage = llm_output.get("token_usage") or llm_output.get("usage") or {}
    return {
        "input_tokens": int(
            token_usage.get("input_tokens") or token_usage.get("prompt_tokens") or 0
        ),
        "output_tokens": int(
            token_usage.get("output_tokens")
            or token_usage.get("completion_tokens")
            or 0
        ),
    }


def merge_budget_config(config: dict[str, Any]) -> dict[str, dict[str, float]]:
    """Merge user budget config with defaults."""
    merged: dict[str, dict[str, float]] = {}
    for stage_name, defaults in _DEFAULT_BUDGETS.items():
        user = config.get("budgets", {}).get(stage_name, {})
        merged[stage_name] = {
            "max_tokens": float(user.get("max_tokens", defaults["max_tokens"])),
            "max_latency_sec": float(
                user.get("max_latency_sec", defaults["max_latency_sec"])
            ),
        }
    return merged
