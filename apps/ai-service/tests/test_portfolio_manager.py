from types import SimpleNamespace

from luna_workstation.agents.managers.portfolio_manager import (
    create_portfolio_manager,
    _render_latest_continuity_context,
)
from luna_workstation.domain.thesis import ResearchEvidenceItem


class CapturingLLM:
    def __init__(self):
        self.prompt = None

    def with_structured_output(self, *_args, **_kwargs):
        raise NotImplementedError("force freetext fallback")

    def invoke(self, prompt):
        self.prompt = prompt
        return SimpleNamespace(
            content="Hold. Prior thesis remains valid but needs confirmation."
        )


def test_portfolio_manager_injects_guarded_scenario_feedback_playbook():
    llm = CapturingLLM()
    node = create_portfolio_manager(llm, config={"market_type": "spot"})
    state = {
        "company_of_interest": "BTC/USDT",
        "risk_debate_state": {
            "history": "Risk debate says confirmation is required.",
            "aggressive_history": "",
            "conservative_history": "",
            "neutral_history": "",
            "current_aggressive_response": "",
            "current_conservative_response": "",
            "current_neutral_response": "",
            "count": 1,
        },
        "investment_plan": "Research manager plan.",
        "trader_investment_plan": "Setup planner proposal.",
        "market_type": "spot",
        "past_context": "",
        "latest_continuity_context": {
            "schema_version": "latest_continuity_context.v1",
            "raw_notes": "raw continuity paragraph should not be copied",
            "scenario_feedback_playbook": {
                "version": "scenario_feedback_playbook.v1",
                "lessons": [
                    {
                        "statement": "Wait for close confirmation before entry.",
                        "confidence": "medium",
                    }
                ],
                "gates": [],
                "exclusions": [],
            },
        },
    }

    result = node(state)

    assert result["final_trade_decision"] == (
        "Hold. Prior thesis remains valid but needs confirmation."
    )
    assert result["scenario_continuity_handoff"] is None
    assert llm.prompt is not None
    assert "Latest compact scenario feedback" in llm.prompt
    assert "Wait for close confirmation before entry." in llm.prompt
    assert "raw continuity paragraph should not be copied" not in llm.prompt
    assert (
        "Treat this only as evaluated prior feedback, not current evidence."
        in llm.prompt
    )
    assert (
        "Analyst reports and the risk debate remain the current evidence layer."
        in llm.prompt
    )
    assert (
        'source_artifact": "market_snapshot | signal_snapshot | trade_thesis | agent_opinion | research_debate | research_run | research_continuity | external_report | unknown"'
        in llm.prompt
    )


def test_portfolio_manager_renders_compact_scenario_feedback_playbook_only():
    rendered = _render_latest_continuity_context(
        {
            "schema_version": "latest_continuity_context.v1",
            "raw_notes": "raw continuity paragraph should not be copied",
            "scenario_feedback_playbook": {
                "version": "scenario_feedback_playbook.v1",
                "lessons": [
                    {
                        "id": "lesson_1",
                        "scope": "scenario",
                        "horizon": "short_term",
                        "market_type": "spot",
                        "statement": "Wait for close confirmation before entry.",
                        "confidence": "medium",
                        "evidence_count": 3,
                    }
                ],
                "gates": [],
                "exclusions": [],
            },
        }
    )

    assert "Wait for close confirmation before entry." in rendered
    assert "raw continuity paragraph should not be copied" not in rendered


def test_research_evidence_item_accepts_research_continuity_source_artifact():
    evidence = ResearchEvidenceItem(
        text="Prior continuity thesis was still active.",
        source_artifact="research_continuity",
    )

    assert evidence.source_artifact == "research_continuity"
