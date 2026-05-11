"""Token and latency budget tracking per graph stage.

Tracks cumulative token consumption and wall-clock latency across
pipeline stages (analysts, debate, risk, portfolio) and compares
against configurable budgets.  Exceeded budgets emit warnings via
structured logging but do NOT abort the run — budgets are soft limits
for observability, not hard enforcement.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from typing import Any

from tradingagents.observability import log_event

logger = logging.getLogger(__name__)


# Default budgets — overridden by config
_DEFAULT_BUDGETS: dict[str, dict[str, float]] = {
    # Per-analyst budgets (applied to each of market, social, news, onchain)
    "analyst": {
        "max_tokens": 20_000,  # combined input+output tokens
        "max_latency_sec": 60.0,  # wall-clock seconds
    },
    # Total analyst phase budget (sum of all analysts)
    "analysts_total": {
        "max_tokens": 80_000,
        "max_latency_sec": 240.0,
    },
    # Research debate phase (all rounds)
    "debate": {
        "max_tokens": 40_000,
        "max_latency_sec": 120.0,
    },
    # Research manager
    "research_manager": {
        "max_tokens": 15_000,
        "max_latency_sec": 45.0,
    },
    # Trader
    "trader": {
        "max_tokens": 10_000,
        "max_latency_sec": 30.0,
    },
    # Risk debate phase (all rounds)
    "risk_debate": {
        "max_tokens": 50_000,
        "max_latency_sec": 150.0,
    },
    # Portfolio manager
    "portfolio_manager": {
        "max_tokens": 15_000,
        "max_latency_sec": 45.0,
    },
    # Scenario planner
    "scenario_planner": {
        "max_tokens": 10_000,
        "max_latency_sec": 30.0,
    },
    # Whole run
    "total": {
        "max_tokens": 250_000,
        "max_latency_sec": 600.0,
    },
}


class StageBudget:
    """Per-stage token and latency tracking with budget enforcement."""

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

    def stop(self) -> float:
        """Stop timing and return latency in seconds."""
        if self._started is not None:
            self._latency_sec = time.perf_counter() - self._started
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
        """Return list of exceeded budget messages (empty if within budget)."""
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
    """Tracks token/latency budgets across all pipeline stages.

    Usage::

        tracker = BudgetTracker(config)
        with tracker.stage("analyst", analyst_name="market"):
            # ... analyst work ...
            tracker.add_tokens(500, 200)  # input, output
    """

    def __init__(self, config: dict[str, Any] | None = None):
        config = config or {}
        budgets_cfg = config.get("budgets", {})
        self._budgets: dict[str, StageBudget] = {}
        self._stage_stack: list[str] = []

        # Build per-stage budgets from config (falling back to defaults)
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
        """Context manager for a pipeline stage. Starts/stops the budget clock."""
        budget = self._budgets.get(stage)
        if budget is None:
            # Unknown stage — create a temporary one with permissive budgets
            budget = StageBudget(stage, max_tokens=1_000_000, max_latency_sec=3600)

        budget.start()
        self._stage_stack.append(stage)
        try:
            yield budget
        finally:
            budget.stop()
            self._stage_stack.pop()
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
        """Add token counts to the current (innermost) stage budget."""
        total = input_tokens + output_tokens
        if self._stage_stack:
            stage = self._stage_stack[-1]
            budget = self._budgets.get(stage)
            if budget:
                budget.add_tokens(total)
        # Also add to total
        total_budget = self._budgets.get("total")
        if total_budget:
            total_budget.add_tokens(total)

    def summary(self) -> list[dict[str, Any]]:
        """Return a summary of all stage budgets."""
        return [b.summary() for b in self._budgets.values()]

    def check_total_budget(self) -> list[str]:
        """Check the total run budget and return exceeded messages."""
        total = self._budgets.get("total")
        if total:
            return total.check_budgets()
        return []


def merge_budget_config(config: dict[str, Any]) -> dict[str, dict[str, float]]:
    """Merge user budget config with defaults, returning complete budget dict.

    This is used by ``default_config.py`` to provide a complete set of
    budget defaults while allowing partial overrides.
    """
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
