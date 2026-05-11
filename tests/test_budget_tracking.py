"""Tests for token/latency budget tracking."""

import time


from tradingagents.observability.budget import (
    BudgetTracker,
    StageBudget,
    merge_budget_config,
    _DEFAULT_BUDGETS,
)


class TestStageBudget:
    """Per-stage budget tracking."""

    def test_initial_state(self):
        budget = StageBudget("analyst", max_tokens=10000, max_latency_sec=30)
        assert budget.tokens == 0
        assert budget.latency_sec == 0.0
        assert budget.stage == "analyst"

    def test_add_tokens(self):
        budget = StageBudget("analyst", max_tokens=10000, max_latency_sec=30)
        budget.add_tokens(500)
        budget.add_tokens(300)
        assert budget.tokens == 800

    def test_latency_tracking(self):
        budget = StageBudget("analyst", max_tokens=10000, max_latency_sec=30)
        budget.start()
        time.sleep(0.01)
        budget.stop()
        assert budget.latency_sec > 0

    def test_within_budget_no_warnings(self):
        budget = StageBudget("analyst", max_tokens=10000, max_latency_sec=30)
        budget.start()
        budget.add_tokens(1000)
        budget.stop()
        assert budget.check_budgets() == []

    def test_token_budget_exceeded(self):
        budget = StageBudget("analyst", max_tokens=100, max_latency_sec=300)
        budget.start()
        budget.add_tokens(200)
        budget.stop()
        exceeded = budget.check_budgets()
        assert len(exceeded) == 1
        assert "Token budget exceeded" in exceeded[0]
        assert "200 > 100" in exceeded[0]

    def test_latency_budget_exceeded(self):
        budget = StageBudget("analyst", max_tokens=10000, max_latency_sec=0.001)
        budget.start()
        time.sleep(0.01)
        budget.stop()
        exceeded = budget.check_budgets()
        assert len(exceeded) == 1
        assert "Latency budget exceeded" in exceeded[0]

    def test_both_budgets_exceeded(self):
        budget = StageBudget("analyst", max_tokens=100, max_latency_sec=0.001)
        budget.start()
        budget.add_tokens(200)
        time.sleep(0.01)
        budget.stop()
        exceeded = budget.check_budgets()
        assert len(exceeded) == 2

    def test_summary_dict(self):
        budget = StageBudget("debate", max_tokens=5000, max_latency_sec=10)
        budget.start()
        budget.add_tokens(1000)
        budget.stop()
        s = budget.summary()
        assert s["stage"] == "debate"
        assert s["tokens"] == 1000
        assert s["max_tokens"] == 5000
        assert s["max_latency_sec"] == 10
        assert s["latency_sec"] >= 0

    def test_budget_remaining(self):
        budget = StageBudget("trader", max_tokens=1000, max_latency_sec=30)
        budget.add_tokens(400)
        assert budget.token_budget_remaining == 600


class TestBudgetTracker:
    """Multi-stage budget tracker."""

    def test_tracks_tokens_in_nested_stage(self):
        tracker = BudgetTracker()
        with tracker.stage("analyst", analyst_name="market"):
            tracker.add_tokens(500, 200)
        summary = {s["stage"]: s for s in tracker.summary()}
        assert summary["analyst"]["tokens"] == 700

    def test_tracks_tokens_across_total(self):
        tracker = BudgetTracker()
        with tracker.stage("analyst"):
            tracker.add_tokens(100, 50)
        with tracker.stage("trader"):
            tracker.add_tokens(200, 100)
        summary = {s["stage"]: s for s in tracker.summary()}
        assert summary["total"]["tokens"] == 450

    def test_latency_measured(self):
        tracker = BudgetTracker()
        with tracker.stage("analyst"):
            time.sleep(0.01)
        summary = {s["stage"]: s for s in tracker.summary()}
        assert summary["analyst"]["latency_sec"] > 0

    def test_unknown_stage_uses_permissive_budget(self):
        tracker = BudgetTracker()
        with tracker.stage("custom_stage"):
            tracker.add_tokens(100_000, 100_000)
        # Should not raise
        summary = {s["stage"]: s for s in tracker.summary()}
        assert "custom_stage" not in summary  # Not in default budgets

    def test_total_budget_check(self):
        tracker = BudgetTracker(
            {"budgets": {"total": {"max_tokens": 500, "max_latency_sec": 600}}}
        )
        tracker.add_tokens(300, 300)
        exceeded = tracker.check_total_budget()
        assert len(exceeded) == 1
        assert "600 > 500" in exceeded[0]

    def test_summary_returns_all_stages(self):
        tracker = BudgetTracker()
        summary = tracker.summary()
        stages = {s["stage"] for s in summary}
        expected = set(_DEFAULT_BUDGETS.keys())
        assert stages == expected

    def test_token_accumulation_across_multiple_starts(self):
        """Tokens accumulate within same stage across multiple context blocks."""
        tracker = BudgetTracker()
        with tracker.stage("analyst"):
            tracker.add_tokens(100, 50)
        with tracker.stage("analyst"):
            tracker.add_tokens(200, 100)
        summary = {s["stage"]: s for s in tracker.summary()}
        assert summary["analyst"]["tokens"] == 450


class TestMergeBudgetConfig:
    """Config merging utility."""

    def test_empty_config_returns_defaults(self):
        merged = merge_budget_config({})
        assert "analyst" in merged
        assert merged["analyst"]["max_tokens"] == _DEFAULT_BUDGETS["analyst"]["max_tokens"]

    def test_partial_override(self):
        config = {
            "budgets": {
                "analyst": {"max_tokens": 9999},
            }
        }
        merged = merge_budget_config(config)
        assert merged["analyst"]["max_tokens"] == 9999
        # latency_sec should still be the default
        assert merged["analyst"]["max_latency_sec"] == _DEFAULT_BUDGETS["analyst"]["max_latency_sec"]

    def test_full_override(self):
        config = {
            "budgets": {
                "total": {"max_tokens": 500000, "max_latency_sec": 900},
            }
        }
        merged = merge_budget_config(config)
        assert merged["total"]["max_tokens"] == 500000
        assert merged["total"]["max_latency_sec"] == 900


class TestDefaultBudgets:
    """Verify default budgets are reasonable."""

    def test_total_exceeds_sum_of_stages(self):
        """Total budget should be large enough to accommodate all stages combined
        (analysts run in parallel, rest sequentially)."""
        # Excluding total itself and analysts_total
        stage_sum = sum(
            _DEFAULT_BUDGETS[s]["max_tokens"]
            for s in _DEFAULT_BUDGETS
            if s not in ("total", "analysts_total")
        )
        stage_sum += _DEFAULT_BUDGETS["analysts_total"]["max_tokens"]
        assert _DEFAULT_BUDGETS["total"]["max_tokens"] >= stage_sum

    def test_all_required_stages_present(self):
        required = {
            "analyst",
            "analysts_total",
            "debate",
            "research_manager",
            "trader",
            "risk_debate",
            "portfolio_manager",
            "scenario_planner",
            "total",
        }
        assert set(_DEFAULT_BUDGETS.keys()) == required

    def test_budgets_are_positive(self):
        for stage, budgets in _DEFAULT_BUDGETS.items():
            assert budgets["max_tokens"] > 0, f"{stage} max_tokens must be positive"
            assert budgets["max_latency_sec"] > 0, f"{stage} max_latency_sec must be positive"
