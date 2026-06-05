"""Tests for token/latency budget tracking."""

from types import SimpleNamespace
import time

from langchain_core.messages import AIMessage
from langchain_core.outputs import ChatGeneration, LLMResult


from luna_workstation.observability.budget import (
    BudgetCallbackHandler,
    BudgetTracker,
    StageBudget,
    merge_budget_config,
    _DEFAULT_BUDGETS,
)
import luna_workstation.graph.setup as graph_setup_module
from luna_workstation.graph.research_agents_graph import ResearchAgentsGraph
from luna_workstation.graph.setup import GraphSetup


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

    def test_total_stage_does_not_double_count_direct_tokens(self):
        tracker = BudgetTracker()
        with tracker.stage("total"):
            tracker.add_tokens(100, 50)
        summary = {s["stage"]: s for s in tracker.summary()}
        assert summary["total"]["tokens"] == 150

    def test_analyst_tokens_roll_up_to_analysts_total(self):
        tracker = BudgetTracker()
        with tracker.stage("analyst", analyst_name="market"):
            tracker.add_tokens(100, 50)
        summary = {s["stage"]: s for s in tracker.summary()}
        assert summary["analyst"]["tokens"] == 150
        assert summary["analysts_total"]["tokens"] == 150

    def test_budget_callback_handler_tracks_llm_usage_in_current_stage(self):
        tracker = BudgetTracker()
        handler = BudgetCallbackHandler(tracker)
        message = AIMessage(
            content="ok",
            usage_metadata={
                "input_tokens": 11,
                "output_tokens": 7,
                "total_tokens": 18,
            },
        )
        result = LLMResult(generations=[[ChatGeneration(message=message)]])

        with tracker.stage("portfolio_manager"):
            handler.on_llm_end(result)

        summary = {s["stage"]: s for s in tracker.summary()}
        assert summary["portfolio_manager"]["tokens"] == 18
        assert summary["total"]["tokens"] == 18

    def test_graph_setup_budgeted_node_sets_current_stage(self):
        tracker = BudgetTracker()
        setup = GraphSetup.__new__(GraphSetup)
        setup.budget_tracker = tracker
        seen_stages = []

        def node(state):
            seen_stages.append(tracker.current_stage())
            return state

        wrapped = setup._budgeted_node(node, "scenario_planner")

        assert wrapped({"ok": True}) == {"ok": True}
        assert seen_stages == ["scenario_planner"]

    def test_setup_planner_budgeted_node_emits_plan_recorded(self, monkeypatch):
        setup = GraphSetup.__new__(GraphSetup)
        setup.budget_tracker = None
        events = []

        def record_event(_logger, event, **fields):
            events.append((event, fields))

        monkeypatch.setattr(graph_setup_module, "log_event", record_event)

        def node(_state):
            return {
                "trader_investment_plan": "Review spot accumulation.",
                "market_type": "spot",
            }

        wrapped = setup._budgeted_node(
            node,
            "setup_planner",
            graph_node=str(graph_setup_module.PipelineNode.SETUP_PLANNER),
        )

        assert wrapped({})["market_type"] == "spot"
        plan_events = [fields for event, fields in events if event == "plan_recorded"]
        assert plan_events == [
            {
                "action": "setup_proposal",
                "market_type": "spot",
                "setup_plan_length": 25,
                "stage": "setup_planner",
                "graph_node": str(graph_setup_module.PipelineNode.SETUP_PLANNER),
            }
        ]

    def test_scenario_planner_budgeted_node_can_fail_open(self, monkeypatch):
        setup = GraphSetup.__new__(GraphSetup)
        setup.budget_tracker = None
        events = []

        def record_event(_logger, event, **fields):
            events.append((event, fields))

        monkeypatch.setattr(graph_setup_module, "log_event", record_event)

        def node(_state):
            raise RuntimeError("planner timed out")

        wrapped = setup._budgeted_node(
            node,
            "scenario_planner",
            fail_open=True,
            graph_node=str(graph_setup_module.PipelineNode.SCENARIO_PLANNER),
        )

        assert wrapped({"ok": True}) == {
            "scenario_plan": "",
            "scenario_plan_json": "",
        }
        assert [event for event, _fields in events] == [
            "agent_node_started",
            "agent_node_failed",
        ]
        failed = events[1][1]
        assert failed["stage"] == "scenario_planner"
        assert failed["status"] == "failed"
        assert failed["error_type"] == "RuntimeError"

    def test_real_graph_setup_wraps_all_pipeline_stages(self, monkeypatch):
        setup = GraphSetup.__new__(GraphSetup)
        setup.quick_thinking_llm = object()
        setup.deep_thinking_llm = object()
        setup.tool_nodes = {
            definition.tool_key: object()
            for definition in graph_setup_module.ANALYST_DEFINITIONS
        }
        setup.conditional_logic = SimpleNamespace(
            should_continue_debate=lambda _state: (
                graph_setup_module.DebateNode.RESEARCH_MANAGER
            ),
            should_continue_risk_analysis=lambda _state: (
                graph_setup_module.PipelineNode.PORTFOLIO_MANAGER
            ),
        )
        setup.config = {}
        setup.budget_tracker = BudgetTracker()
        wrapped_stages = []

        def node_factory(*_args, **_kwargs):
            return lambda state: state

        def analyst_runner(*_args, **_kwargs):
            return lambda state: state

        monkeypatch.setattr(graph_setup_module, "create_market_analyst", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_bull_researcher", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_bear_researcher", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_research_manager", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_setup_planner", node_factory)
        monkeypatch.setattr(
            graph_setup_module, "create_aggressive_debator", node_factory
        )
        monkeypatch.setattr(graph_setup_module, "create_neutral_debator", node_factory)
        monkeypatch.setattr(
            graph_setup_module, "create_conservative_debator", node_factory
        )
        monkeypatch.setattr(
            graph_setup_module, "create_portfolio_manager", node_factory
        )
        monkeypatch.setattr(graph_setup_module, "create_scenario_planner", node_factory)
        monkeypatch.setattr(graph_setup_module, "make_analyst_runner", analyst_runner)
        monkeypatch.setattr(
            graph_setup_module,
            "create_analyst_opinion_builder",
            lambda **_kwargs: lambda state: state,
        )

        def record_budgeted_node(node_fn, stage, **_ctx):
            wrapped_stages.append(stage)
            return node_fn

        setup._budgeted_node = record_budgeted_node

        setup.setup_graph(["market"])

        assert wrapped_stages == [
            "analyst",
            "debate",
            "debate",
            "research_manager",
            "setup_planner",
            "risk_debate",
            "risk_debate",
            "risk_debate",
            "portfolio_manager",
            "scenario_planner",
        ]

    def test_portfolio_manager_uses_quick_llm_for_final_synthesis(self, monkeypatch):
        quick_llm = object()
        deep_llm = object()
        setup = GraphSetup.__new__(GraphSetup)
        setup.quick_thinking_llm = quick_llm
        setup.deep_thinking_llm = deep_llm
        setup.tool_nodes = {
            definition.tool_key: object()
            for definition in graph_setup_module.ANALYST_DEFINITIONS
        }
        setup.conditional_logic = SimpleNamespace(
            should_continue_debate=lambda _state: (
                graph_setup_module.DebateNode.RESEARCH_MANAGER
            ),
            should_continue_risk_analysis=lambda _state: (
                graph_setup_module.PipelineNode.PORTFOLIO_MANAGER
            ),
        )
        setup.config = {}
        setup.budget_tracker = None
        setup.llm_orchestrator = None
        captured = {}

        def node_factory(*_args, **_kwargs):
            return lambda state: state

        monkeypatch.setattr(graph_setup_module, "create_market_analyst", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_bull_researcher", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_bear_researcher", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_research_manager", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_setup_planner", node_factory)
        monkeypatch.setattr(
            graph_setup_module, "create_aggressive_debator", node_factory
        )
        monkeypatch.setattr(graph_setup_module, "create_neutral_debator", node_factory)
        monkeypatch.setattr(
            graph_setup_module, "create_conservative_debator", node_factory
        )
        monkeypatch.setattr(graph_setup_module, "create_scenario_planner", node_factory)
        monkeypatch.setattr(
            graph_setup_module,
            "make_analyst_runner",
            lambda *_args, **_kwargs: lambda state: state,
        )
        monkeypatch.setattr(
            graph_setup_module,
            "create_analyst_opinion_builder",
            lambda **_kwargs: lambda state: state,
        )

        def portfolio_manager_factory(llm, **_kwargs):
            captured["portfolio_manager_llm"] = llm
            return lambda state: state

        monkeypatch.setattr(
            graph_setup_module,
            "create_portfolio_manager",
            portfolio_manager_factory,
        )

        setup._budgeted_node = lambda node_fn, _stage, **_ctx: node_fn
        setup.setup_graph(["market"])

        assert captured["portfolio_manager_llm"] is quick_llm

    def test_parallel_analysts_join_before_debate(self, monkeypatch):
        setup = GraphSetup.__new__(GraphSetup)
        setup.quick_thinking_llm = object()
        setup.deep_thinking_llm = object()
        setup.tool_nodes = {
            definition.tool_key: object()
            for definition in graph_setup_module.ANALYST_DEFINITIONS
        }
        setup.conditional_logic = SimpleNamespace(
            should_continue_debate=lambda _state: (
                graph_setup_module.DebateNode.RESEARCH_MANAGER
            ),
            should_continue_risk_analysis=lambda _state: (
                graph_setup_module.PipelineNode.PORTFOLIO_MANAGER
            ),
        )
        setup.config = {}
        setup.budget_tracker = None
        setup.llm_orchestrator = None

        def node_factory(*_args, **_kwargs):
            return lambda state: state

        def analyst_runner(*_args, **_kwargs):
            return lambda state: state

        monkeypatch.setattr(graph_setup_module, "create_market_analyst", node_factory)
        monkeypatch.setattr(
            graph_setup_module, "create_social_media_analyst", node_factory
        )
        monkeypatch.setattr(graph_setup_module, "create_news_analyst", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_onchain_analyst", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_bull_researcher", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_bear_researcher", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_research_manager", node_factory)
        monkeypatch.setattr(graph_setup_module, "create_setup_planner", node_factory)
        monkeypatch.setattr(
            graph_setup_module, "create_aggressive_debator", node_factory
        )
        monkeypatch.setattr(graph_setup_module, "create_neutral_debator", node_factory)
        monkeypatch.setattr(
            graph_setup_module, "create_conservative_debator", node_factory
        )
        monkeypatch.setattr(
            graph_setup_module, "create_portfolio_manager", node_factory
        )
        monkeypatch.setattr(graph_setup_module, "create_scenario_planner", node_factory)
        monkeypatch.setattr(graph_setup_module, "make_analyst_runner", analyst_runner)
        monkeypatch.setattr(
            graph_setup_module,
            "create_analyst_opinion_builder",
            lambda **_kwargs: lambda state, report: None,
        )

        workflow = setup.setup_graph(["market", "social", "news", "onchain"])

        analysts = (
            graph_setup_module.AnalystNode.MARKET,
            graph_setup_module.AnalystNode.SOCIAL,
            graph_setup_module.AnalystNode.NEWS,
            graph_setup_module.AnalystNode.ONCHAIN,
        )
        assert (analysts, graph_setup_module.DebateNode.BULL_RESEARCHER) in (
            workflow.waiting_edges
        )
        for analyst in analysts:
            assert (analyst, graph_setup_module.DebateNode.BULL_RESEARCHER) not in (
                workflow.edges
            )

    def test_research_graph_propagate_wraps_total_budget_stage(self):
        tracker = BudgetTracker()
        graph = ResearchAgentsGraph.__new__(ResearchAgentsGraph)
        graph.config = {
            "checkpoint_enabled": False,
            "observability": {"persist_run_events": False},
            "asset_class": "crypto",
        }
        graph.journal_bridge = SimpleNamespace(service=None)
        graph.budget_tracker = tracker
        graph._checkpointer_ctx = None
        graph.orchestrator = SimpleNamespace(execute_with_fallback=lambda fn: fn())
        seen_stages = []

        def run_graph(*_args, **_kwargs):
            seen_stages.append(tracker.current_stage())
            return {"ok": True}, "Hold"

        graph._run_graph = run_graph

        assert graph.propagate("BTC/USDT", "2026-05-12") == ({"ok": True}, "Hold")
        assert seen_stages == ["total"]


class TestMergeBudgetConfig:
    """Config merging utility."""

    def test_empty_config_returns_defaults(self):
        merged = merge_budget_config({})
        assert "analyst" in merged
        assert (
            merged["analyst"]["max_tokens"] == _DEFAULT_BUDGETS["analyst"]["max_tokens"]
        )

    def test_partial_override(self):
        config = {
            "budgets": {
                "analyst": {"max_tokens": 9999},
            }
        }
        merged = merge_budget_config(config)
        assert merged["analyst"]["max_tokens"] == 9999
        # latency_sec should still be the default
        assert (
            merged["analyst"]["max_latency_sec"]
            == _DEFAULT_BUDGETS["analyst"]["max_latency_sec"]
        )

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
            "setup_planner",
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
            assert budgets["max_latency_sec"] > 0, (
                f"{stage} max_latency_sec must be positive"
            )
