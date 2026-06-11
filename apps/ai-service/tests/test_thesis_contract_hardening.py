import json
from types import SimpleNamespace

from luna_workstation.domain import (
    ResearchRun,
    ResearchRunStatus,
    ThesisArtifactStatus,
    ThesisTextSource,
)
from luna_workstation.agents.utils.agent_states import AgentState
from luna_workstation.graph.research_agents_graph import ResearchAgentsGraph
from luna_workstation.graph.thesis_validation import ThesisValidator


def _candidate(**overrides):
    payload = {
        "schema_version": "thesis_candidate.v1",
        "rating": "Overweight",
        "direction": "long",
        "confidence": 0.62,
        "market_type": "spot",
        "action_summary": "Favor BTC while reclaim holds",
        "investment_thesis": "Spot bid and trend structure support a conditional long thesis.",
        "confirmation_condition": "Daily close above 108000 with expanding spot volume",
        "invalidation": "Daily close below 101500",
        "entry_zone": "103000-105000 pullback",
        "target_zones": ["112000", "118000"],
        "key_reasons": [
            {
                "text": "Spot demand improved after reclaiming the prior range.",
                "supporting_evidence": [
                    {
                        "text": "Observed spot volume expanded on the reclaim.",
                        "evidence_kind": "observed",
                        "source_artifact": "signal_snapshot",
                        "source_field": "volume",
                        "strength": "high",
                    }
                ],
            }
        ],
        "risks": [
            {
                "text": "Failed acceptance above resistance would weaken the setup.",
                "supporting_evidence": [],
            }
        ],
        "monitor_next": [
            {
                "text": "Watch the daily close and spot volume confirmation.",
                "supporting_evidence": [],
            }
        ],
        "supporting_evidence": [
            {
                "text": "Observed spot volume expanded on the reclaim.",
                "evidence_kind": "observed",
                "source_artifact": "signal_snapshot",
                "source_field": "volume",
                "strength": "high",
            }
        ],
        "missing_data": [],
    }
    payload.update(overrides)
    return payload


def _graph(run=None):
    graph = object.__new__(ResearchAgentsGraph)
    graph.ticker = "BTC/USDT"
    graph.signal_processor = SimpleNamespace(process_signal=lambda _text: "Hold")
    graph.quant_signal_result = SimpleNamespace(
        confidence=0.64,
        score=SimpleNamespace(value="bullish"),
    )
    graph.current_debate = None
    graph.current_agent_opinions = []
    graph.current_research_run = run or ResearchRun(id="run_thesis_contract", symbol="BTC/USDT")
    graph.current_signals = []
    return graph


def _build_thesis(candidate, *, source="portfolio_decision_structured", run=None):
    return ResearchAgentsGraph._build_trade_thesis(
        _graph(run),
        {
            "final_trade_decision": "**Rating**: Overweight\n\nStructured candidate supplied.",
            "final_trade_summary_json": json.dumps(candidate),
            "final_trade_candidate_source": source,
            "final_trade_candidate_schema_version": candidate.get("schema_version"),
        },
    )


def test_validator_accepts_complete_structured_candidate():
    result = ThesisValidator().validate(
        candidate=_candidate(),
        source_contract="portfolio_decision_structured",
        data_quality_label="clean",
    )

    assert result.status == ThesisArtifactStatus.VALID
    assert result.blocked_reasons == []


def test_validator_accepts_validated_portfolio_json_block_candidate():
    result = ThesisValidator().validate(
        candidate=_candidate(),
        source_contract="portfolio_decision_json_block",
        data_quality_label="clean",
    )

    assert result.status == ThesisArtifactStatus.VALID
    assert result.blocked_reasons == []


def test_agent_state_preserves_portfolio_manager_candidate_metadata():
    annotations = AgentState.__annotations__

    assert "final_trade_candidate_source" in annotations
    assert "final_trade_candidate_schema_version" in annotations


def test_validator_degrades_optional_missing_targets():
    result = ThesisValidator().validate(
        candidate=_candidate(target_zones=[]),
        source_contract="portfolio_decision_structured",
        data_quality_label="clean",
    )

    assert result.status == ThesisArtifactStatus.DEGRADED
    assert "target_zones_missing" in result.degradation_reasons


def test_structured_candidate_success_persists_valid_status():
    thesis = _build_thesis(_candidate())

    assert thesis.artifact_status == ThesisArtifactStatus.VALID
    assert thesis.candidate_schema_version == "thesis_candidate.v1"
    assert thesis.source_contract == "portfolio_decision_structured"
    assert thesis.validation_issues == []
    assert thesis.blocked_reasons == []


def test_valid_thesis_persists_compiled_text_not_raw_pm_prose():
    thesis = _build_thesis(_candidate())

    assert thesis.thesis_text_source == ThesisTextSource.COMPILED
    assert thesis.compiler_version
    assert thesis.raw_model_thesis_text == "**Rating**: Overweight\n\nStructured candidate supplied."
    assert thesis.thesis_text.startswith("Stance:")
    assert "Structured candidate supplied." not in thesis.thesis_text
    assert [section.key for section in thesis.compiled_sections] == [
        "stance",
        "thesis",
        "key_reasons",
        "risks",
        "confirmation",
        "invalidation",
        "monitor_next",
    ]


def test_degraded_thesis_persists_compiled_caveats():
    thesis = _build_thesis(_candidate(target_zones=[]))

    assert thesis.artifact_status == ThesisArtifactStatus.DEGRADED
    assert thesis.thesis_text_source == ThesisTextSource.COMPILED
    assert "Data caveats:" in thesis.thesis_text
    assert "target_zones_missing" in thesis.thesis_text


def test_summary_json_without_structured_source_is_blocked():
    thesis = ResearchAgentsGraph._build_trade_thesis(
        _graph(),
        {
            "final_trade_decision": "**Rating**: Overweight\n\nStructured-looking JSON supplied.",
            "final_trade_summary_json": json.dumps(_candidate()),
        },
    )

    assert thesis.artifact_status == ThesisArtifactStatus.BLOCKED
    assert "candidate_source_not_structured" in thesis.blocked_reasons


def test_blocked_thesis_persists_diagnostic_text_not_raw_pm_prose():
    thesis = ResearchAgentsGraph._build_trade_thesis(
        _graph(),
        {
            "final_trade_decision": (
                "**Rating**: Overweight\n\n"
                "**Confirmation**: Daily close above 108000.\n\n"
                "**Invalidation**: Daily close below 101500."
            ),
            "final_trade_candidate_source": "free_text_fallback",
        },
    )

    assert thesis.artifact_status == ThesisArtifactStatus.BLOCKED
    assert thesis.thesis_text_source == ThesisTextSource.DIAGNOSTIC
    assert thesis.thesis_text.startswith("Thesis blocked.")
    assert "Confirmation:" not in thesis.thesis_text
    assert thesis.raw_model_thesis_text.startswith("**Rating**: Overweight")


def test_candidate_missing_schema_version_blocks_thesis():
    candidate = _candidate()
    candidate.pop("schema_version")

    thesis = _build_thesis(candidate)

    assert thesis.artifact_status == ThesisArtifactStatus.BLOCKED
    assert "schema_version_missing" in thesis.blocked_reasons


def test_free_text_fallback_cannot_create_valid_thesis():
    thesis = ResearchAgentsGraph._build_trade_thesis(
        _graph(),
        {
            "final_trade_decision": (
                "**Rating**: Overweight\n\n"
                "**Confirmation**: Daily close above 108000.\n\n"
                "**Invalidation**: Daily close below 101500."
            ),
            "final_trade_candidate_source": "free_text_fallback",
        },
    )

    assert thesis.artifact_status == ThesisArtifactStatus.BLOCKED
    assert "structured_candidate_missing" in thesis.blocked_reasons
    assert thesis.evidence["source_contract"] == "free_text_fallback"


def test_missing_critical_candidate_fields_block_thesis():
    thesis = _build_thesis(
        _candidate(
            confirmation_condition="",
            invalidation="",
        )
    )

    assert thesis.artifact_status == ThesisArtifactStatus.BLOCKED
    assert "confirmation_condition_missing" in thesis.blocked_reasons
    assert "invalidation_missing" in thesis.blocked_reasons


def test_rating_direction_conflict_blocks_thesis():
    thesis = _build_thesis(_candidate(rating="Overweight", direction="short"))

    assert thesis.artifact_status == ThesisArtifactStatus.BLOCKED
    assert "rating_direction_conflict" in thesis.blocked_reasons


def test_stale_or_missing_data_degrades_thesis_without_blocking():
    run = ResearchRun(
        id="run_thesis_contract_degraded",
        symbol="BTC/USDT",
        status=ResearchRunStatus.COMPLETED_DEGRADED,
        missing_optional_data=["missing_news_feed"],
    )

    thesis = _build_thesis(
        _candidate(missing_data=["News feed unavailable during this run."]),
        run=run,
    )

    assert thesis.artifact_status == ThesisArtifactStatus.DEGRADED
    assert "data_quality_degraded" in thesis.degradation_reasons
    assert thesis.blocked_reasons == []
