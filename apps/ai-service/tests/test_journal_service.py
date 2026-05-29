import pytest

from luna_workstation.domain import (
    AgentOpinion,
    AgentStance,
    ConflictLevel,
    OutcomeResult,
    OutcomeReview,
    ResearchDebate,
    ResearchRun,
    ResearchRunStatus,
    Scenario,
    ScenarioProbabilityBand,
    Signal,
    SignalDirection,
    SignalProvenance,
    MarketBrief,
    MarketSnapshot,
    SignalSnapshot,
    ThesisDirection,
    TradeThesis,
    UserDecision,
    UserDecisionAction,
    Watchlist,
)
from luna_workstation.services import JournalService


def _config(tmp_path):
    return {
        "data_cache_dir": str(tmp_path),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }


def test_journal_service_persists_research_run_and_thesis(tmp_path):
    service = JournalService(_config(tmp_path))

    run = service.start_research_run(
        ResearchRun(
            symbol="BTC/USDT",
            deep_think_model="deepseek-v4-pro",
            quick_think_model="deepseek-v4-flash",
            llm_provider="deepseek",
            config_hash="abc123def4567890",
        )
    )
    thesis = service.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.WATCH,
            thesis_text="Wait for confirmation.",
        )
    )
    run.thesis_id = thesis.id
    service.complete_research_run(run)

    loaded_run = service.get_research_run(run.id)
    loaded_thesis = service.get_thesis(thesis.id)

    assert loaded_run is not None
    assert loaded_run.thesis_id == thesis.id
    assert loaded_run.deep_think_model == "deepseek-v4-pro"
    assert loaded_run.quick_think_model == "deepseek-v4-flash"
    assert loaded_run.llm_provider == "deepseek"
    assert loaded_run.config_hash == "abc123def4567890"
    assert loaded_thesis is not None
    assert loaded_thesis.symbol == "BTC/USDT"

    loaded_run.quick_think_model = "deepseek-v4-flash-updated"
    loaded_run.config_hash = "fedcba9876543210"
    service.update_research_run(loaded_run)
    updated_run = service.get_research_run(run.id)
    assert updated_run.quick_think_model == "deepseek-v4-flash-updated"
    assert updated_run.config_hash == "fedcba9876543210"


def test_journal_service_scopes_workspace_lists_and_duplicate_watchlist_names(tmp_path):
    db_path = tmp_path / "journal.sqlite"
    config_a = _config(tmp_path)
    config_a["journal"]["db_path"] = str(db_path)
    config_a["_engine"] = {"workspace_id": "workspace_a"}
    config_b = _config(tmp_path)
    config_b["journal"]["db_path"] = str(db_path)
    config_b["_engine"] = {"workspace_id": "workspace_b"}
    service_a = JournalService(config_a)
    service_b = JournalService(config_b)

    run_a = service_a.start_research_run(ResearchRun(symbol="BTC/USDT"))
    run_b = service_b.start_research_run(ResearchRun(symbol="ETH/USDT"))
    thesis_a = service_a.save_thesis(TradeThesis(symbol="BTC/USDT", thesis_text="A"))
    thesis_b = service_b.save_thesis(TradeThesis(symbol="ETH/USDT", thesis_text="B"))
    signal_a = service_a.save_signal(
        Signal(
            symbol="BTC/USDT",
            signal_type="regime",
            direction=SignalDirection.BULLISH,
            provenance=SignalProvenance(source="test"),
        )
    )
    signal_b = service_b.save_signal(
        Signal(
            symbol="ETH/USDT",
            signal_type="regime",
            direction=SignalDirection.BEARISH,
            provenance=SignalProvenance(source="test"),
        )
    )
    watch_a = service_a.repo.save_watchlist(
        Watchlist(name="default", workspace_id="workspace_a")
    )
    watch_b = service_b.repo.save_watchlist(
        Watchlist(name="default", workspace_id="workspace_b")
    )
    service_a.repo.save_market_brief(MarketBrief(title="A", workspace_id="workspace_a"))
    service_b.repo.save_market_brief(MarketBrief(title="B", workspace_id="workspace_b"))
    service_a.add_run_event(run_a.id, "run.note", "A")
    service_b.add_run_event(run_b.id, "run.note", "B")

    assert [run.symbol for run in service_a.list_research_runs()] == ["BTC/USDT"]
    assert [run.symbol for run in service_b.list_research_runs()] == ["ETH/USDT"]
    assert [thesis.id for thesis in service_a.list_theses()] == [thesis_a.id]
    assert [thesis.id for thesis in service_b.list_theses()] == [thesis_b.id]
    assert [signal.id for signal in service_a.list_signals()] == [signal_a.id]
    assert [signal.id for signal in service_b.list_signals()] == [signal_b.id]
    assert (
        service_a.repo.list_watchlists(workspace_id="workspace_a")[0].id == watch_a.id
    )
    assert (
        service_b.repo.list_watchlists(workspace_id="workspace_b")[0].id == watch_b.id
    )
    assert service_a.repo.list_market_briefs(workspace_id="workspace_a")[0].title == "A"
    assert service_b.repo.list_market_briefs(workspace_id="workspace_b")[0].title == "B"
    assert service_a.list_timeline_events(workspace_id="workspace_a")[0].message == "A"
    assert service_b.list_timeline_events(workspace_id="workspace_b")[0].message == "B"


def test_journal_service_marks_missing_core_data_as_failed(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.LONG,
        thesis_text="Bullish continuation if reclaim holds.",
    )

    saved_run, saved_thesis, _scenarios = service.complete_research_run_bundle(
        run,
        thesis,
        [],
    )

    loaded = service.get_research_run(saved_run.id)
    events = service.list_timeline_events(research_run_id=saved_run.id)
    assert saved_thesis is not None
    assert loaded.status == ResearchRunStatus.FAILED
    assert "market_snapshot_unavailable" in loaded.missing_core_data
    assert "market_snapshot_unavailable" in loaded.degradation_reasons
    assert any(event.event_type == "run.failed" for event in events)


def test_journal_service_marks_optional_data_as_completed_degraded(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(
        ResearchRun(
            symbol="BTC/USDT",
            missing_optional_data=["missing_funding_rate"],
        )
    )
    market_snapshot = service.save_market_snapshot(
        MarketSnapshot(
            research_run_id=run.id,
            symbol="BTC/USDT",
            current_price=100000.0,
        )
    )
    run.market_snapshot_id = market_snapshot.id
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.WATCH,
        thesis_text="Watch for confirmation.",
    )

    saved_run, _thesis, _scenarios = service.complete_research_run_bundle(
        run,
        thesis,
        [],
    )

    loaded = service.get_research_run(saved_run.id)
    assert loaded.status == ResearchRunStatus.COMPLETED_DEGRADED
    assert loaded.missing_core_data == []
    assert "missing_funding_rate" in loaded.missing_optional_data
    assert "missing_funding_rate" in loaded.degradation_reasons


def test_journal_service_does_not_mark_nonempty_reasons_completed(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(
        ResearchRun(
            symbol="BTC/USDT",
            degradation_reasons=["missing_news"],
        )
    )
    market_snapshot = service.save_market_snapshot(
        MarketSnapshot(
            research_run_id=run.id,
            symbol="BTC/USDT",
            current_price=100000.0,
        )
    )
    run.market_snapshot_id = market_snapshot.id
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.WATCH,
        thesis_text="Watch for confirmation.",
    )

    saved_run, _thesis, _scenarios = service.complete_research_run_bundle(
        run,
        thesis,
        [],
    )

    loaded = service.get_research_run(saved_run.id)
    assert loaded.status == ResearchRunStatus.COMPLETED_DEGRADED
    assert loaded.status != ResearchRunStatus.COMPLETED
    assert loaded.degradation_reasons == ["missing_news_feed"]


def test_journal_service_normalizes_missing_data_reason_codes(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(
        ResearchRun(
            symbol="BTC/USDT",
            missing_optional_data=["liquidation heatmap", "onchain secondary"],
        )
    )
    market_snapshot = service.save_market_snapshot(
        MarketSnapshot(
            research_run_id=run.id,
            symbol="BTC/USDT",
            current_price=100000.0,
        )
    )
    run.market_snapshot_id = market_snapshot.id
    thesis = TradeThesis(
        symbol="BTC/USDT",
        direction=ThesisDirection.WATCH,
        thesis_text="Watch for confirmation.",
    )

    saved_run, _thesis, _scenarios = service.complete_research_run_bundle(
        run,
        thesis,
        [],
    )

    loaded = service.get_research_run(saved_run.id)
    assert "missing_liquidations" in loaded.missing_optional_data
    assert "missing_onchain_flows" in loaded.missing_optional_data


def test_journal_service_records_decision_and_outcome(tmp_path):
    service = JournalService(_config(tmp_path))
    thesis = service.save_thesis(
        TradeThesis(
            symbol="ETH/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Bullish continuation if reclaim holds.",
        )
    )

    decision = service.record_user_decision(
        UserDecision(
            thesis_id=thesis.id,
            action=UserDecisionAction.WATCHED,
            user_notes="Waiting for volume confirmation.",
        )
    )
    review = service.record_outcome_review(
        OutcomeReview(
            thesis_id=thesis.id,
            result=OutcomeResult.MIXED,
            lessons="Funding overheated before confirmation.",
        )
    )

    assert decision.id.startswith("decision_")
    assert review.id.startswith("outcome_")


def test_journal_service_builds_outcome_analytics_and_insights(tmp_path):
    service = JournalService(_config(tmp_path))
    btc_thesis = service.save_thesis(
        TradeThesis(
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            confidence=0.8,
            thesis_text="Bullish continuation.",
        )
    )
    eth_thesis = service.save_thesis(
        TradeThesis(
            symbol="ETH/USDT",
            direction=ThesisDirection.SHORT,
            confidence=0.5,
            thesis_text="Bearish breakdown.",
        )
    )

    service.record_outcome_review(
        OutcomeReview(
            thesis_id=btc_thesis.id,
            result=OutcomeResult.HIT_TARGET,
            max_favorable_excursion=0.12,
            max_adverse_excursion=-0.03,
            lessons="Volume confirmation worked.",
        )
    )
    service.record_outcome_review(
        OutcomeReview(
            thesis_id=btc_thesis.id,
            result=OutcomeResult.INVALIDATED,
            max_favorable_excursion=0.02,
            max_adverse_excursion=-0.08,
            invalidated=True,
            lessons="Invalidation needed tighter monitoring.",
        )
    )
    service.record_outcome_review(
        OutcomeReview(
            thesis_id=eth_thesis.id,
            result=OutcomeResult.MIXED,
            lessons="Wait for cleaner confirmation.",
        )
    )

    btc_reviews = service.list_outcome_reviews(symbol="BTC/USDT")
    analytics = service.build_outcome_analytics(symbol="BTC/USDT")
    empty = service.build_outcome_analytics(symbol="SOL/USDT")

    assert len(btc_reviews) == 2
    assert analytics.sample_size == 2
    assert analytics.hit_rate == 0.5
    assert analytics.invalidation_rate == 0.5
    assert round(analytics.average_mfe, 4) == 0.07
    assert any(
        insight.insight_type == "high_invalidation_rate"
        for insight in analytics.insights
    )
    assert empty.sample_size == 0
    assert empty.insights[0].insight_type == "insufficient_data"


def test_journal_service_persists_thesis_timeline(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="SOL/USDT"))
    thesis = service.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="SOL/USDT",
            direction=ThesisDirection.WATCH,
            thesis_text="Watch for reclaim confirmation.",
        )
    )
    run.thesis_id = thesis.id
    service.update_research_run(run)

    decision = service.record_user_decision(
        UserDecision(
            thesis_id=thesis.id,
            action=UserDecisionAction.WATCHED,
            user_notes="Waiting for clean breakout.",
        )
    )
    review = service.record_outcome_review(
        OutcomeReview(
            thesis_id=thesis.id,
            result=OutcomeResult.MIXED,
            lessons="Breakout failed after initial follow-through.",
        )
    )

    thesis_events = service.list_timeline_events(thesis_id=thesis.id)
    loaded_run = service.get_research_run(run.id)

    assert [event.event_type for event in thesis_events] == [
        "trade_thesis_saved",
        "user_decision_recorded",
        "outcome_review_recorded",
    ]
    assert loaded_run.user_decision_id == decision.id
    assert loaded_run.outcome_review_id == review.id


def test_journal_service_persists_scenarios_and_timeline(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = service.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Bullish continuation if reclaim holds.",
        )
    )

    saved = service.save_scenarios(
        [
            Scenario(
                thesis_id=thesis.id,
                condition="If BTC reclaims resistance with volume.",
                expected_market_behavior="Continuation becomes more likely.",
                probability_band=ScenarioProbabilityBand.MEDIUM,
                invalidation="Invalid if reclaim fails.",
                risk_map=["Funding can overheat."],
                suggested_user_action="review long thesis",
            )
        ]
    )

    loaded = service.get_scenario(saved[0].id)
    scenarios = service.list_scenarios(thesis_id=thesis.id)
    timeline = service.list_timeline_events(thesis_id=thesis.id)

    assert loaded.condition.startswith("If BTC reclaims")
    assert scenarios[0].probability_band == ScenarioProbabilityBand.MEDIUM
    assert any(event.event_type == "scenarios_saved" for event in timeline)


def test_journal_service_persists_stage_timeline_events(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))
    opinions = [
        AgentOpinion(
            research_run_id=run.id,
            agent_name="Market Analyst",
            stance=AgentStance.BULLISH,
        )
    ]
    debate = ResearchDebate(
        research_run_id=run.id,
        symbol="BTC/USDT",
        consensus_stance=AgentStance.BULLISH,
        conflict_level=ConflictLevel.LOW,
    )

    run, _opinions, _debate = service.save_agent_research_bundle(
        run,
        opinions,
        debate,
    )
    thesis = TradeThesis(
        research_run_id=run.id,
        symbol="BTC/USDT",
        thesis_text="Watch reclaim.",
    )
    scenario = Scenario(
        condition="Reclaim resistance.",
        expected_market_behavior="Continuation improves.",
        probability_band=ScenarioProbabilityBand.MEDIUM,
        suggested_user_action="review thesis",
    )
    service.complete_research_run_bundle(run, thesis, [scenario])

    event_types = [
        event.event_type
        for event in service.list_timeline_events(research_run_id=run.id)
    ]

    assert "analyst.opinions.recorded" in event_types
    assert "debate.recorded" in event_types
    assert "scenario.plan.recorded" in event_types


def test_journal_service_saves_and_reads_signals(tmp_path):
    service = JournalService(_config(tmp_path))
    saved = service.save_signals(
        [
            Signal(
                symbol="BTC/USDT",
                signal_type="regime",
                direction=SignalDirection.BULLISH,
                confidence=0.7,
                provenance=SignalProvenance(source="signal_engine"),
            ),
            Signal(
                symbol="ETH/USDT",
                signal_type="funding_oi",
                direction=SignalDirection.BEARISH,
                confidence=0.6,
                provenance=SignalProvenance(source="funding_oi"),
            ),
        ]
    )

    btc_signals = service.list_signals(symbol="BTC/USDT")
    loaded = service.get_signal(saved[0].id)

    assert len(saved) == 2
    assert len(btc_signals) == 1
    assert btc_signals[0].symbol == "BTC/USDT"
    assert loaded is not None
    assert loaded.signal_type == "regime"


def test_journal_service_persists_market_and_signal_snapshots(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))

    market_snapshot = service.save_market_snapshot(
        MarketSnapshot(
            research_run_id=run.id,
            symbol="BTC/USDT",
            current_price=100000.0,
            trend_direction="bullish",
        )
    )
    signal_snapshot = service.save_signal_snapshot(
        SignalSnapshot(
            research_run_id=run.id,
            symbol="BTC/USDT",
            signal_ids=["sig_1", "sig_2"],
            bullish_count=1,
            bearish_count=1,
        )
    )
    run.market_snapshot_id = market_snapshot.id
    run.signal_snapshot_id = signal_snapshot.id
    service.update_research_run(run)

    loaded_run = service.get_research_run(run.id)
    loaded_market = service.get_market_snapshot(market_snapshot.id)
    loaded_signals = service.get_signal_snapshot(signal_snapshot.id)

    assert loaded_run.market_snapshot_id == market_snapshot.id
    assert loaded_run.signal_snapshot_id == signal_snapshot.id
    assert loaded_market.current_price == 100000.0
    assert loaded_signals.signal_ids == ["sig_1", "sig_2"]


def test_journal_service_persists_observability_contract_records(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))

    provider = service.record_provider_health_from_payload(
        {
            "provider": "ccxt",
            "method": "get_crypto_ohlcv",
            "status": "success",
            "duration_ms": 12.5,
        }
    )
    llm = service.record_llm_call_from_payload(
        {
            "run_id": run.id,
            "provider": "deepseek",
            "model": "deepseek-v4-flash",
            "stage": "news",
            "agent": "news_analyst",
            "input_tokens": 100,
            "output_tokens": 25,
            "duration_ms": 250.0,
            "status": "success",
        }
    )
    freshness = service.record_data_freshness_from_payload(
        {
            "run_id": run.id,
            "symbol": "BTC/USDT",
            "source": "signal_engine",
            "source_timestamp": "2026-05-12T00:00:00+00:00",
            "observed_timestamp": "2026-05-12T00:10:00+00:00",
            "age_seconds": 600,
            "threshold_seconds": 86400,
            "freshness": "fresh",
        }
    )

    assert provider.id.startswith("provider_health_")
    assert llm.id.startswith("llm_call_")
    assert freshness.id.startswith("freshness_")
    assert service.list_provider_health(provider="ccxt")[0].component == (
        "get_crypto_ohlcv"
    )
    assert service.list_llm_calls(research_run_id=run.id)[0].input_tokens == 100
    assert service.list_data_freshness_checks(research_run_id=run.id)[0].status == (
        "fresh"
    )


def test_quant_signal_bundle_rolls_back_when_event_write_fails(tmp_path, monkeypatch):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))
    signal = Signal(
        symbol="BTC/USDT",
        signal_type="regime",
        direction=SignalDirection.BULLISH,
        confidence=0.7,
        provenance=SignalProvenance(source="signal_engine"),
    )
    market_snapshot = MarketSnapshot(
        research_run_id=run.id,
        symbol="BTC/USDT",
        current_price=100000.0,
    )
    signal_snapshot = SignalSnapshot(
        research_run_id=run.id,
        symbol="BTC/USDT",
    )

    def _fail_event(*args, **kwargs):
        raise RuntimeError("event write failed")

    monkeypatch.setattr(service.repo, "add_run_event", _fail_event)

    with pytest.raises(RuntimeError, match="event write failed"):
        service.save_quant_signal_bundle(
            run,
            [signal],
            market_snapshot,
            signal_snapshot,
        )

    loaded_run = service.get_research_run(run.id)
    assert service.list_signals(symbol="BTC/USDT") == []
    assert service.get_market_snapshot(market_snapshot.id) is None
    assert service.get_signal_snapshot(signal_snapshot.id) is None
    assert loaded_run.market_snapshot_id is None
    assert loaded_run.signal_snapshot_id is None
    assert loaded_run.signal_ids == []


def test_journal_service_persists_agent_opinions_and_debate(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))

    opinions = service.save_agent_opinions(
        [
            AgentOpinion(
                research_run_id=run.id,
                agent_name="News Analyst",
                stance=AgentStance.BULLISH,
                confidence=0.7,
                key_evidence=["ETF inflows improved."],
            ),
            AgentOpinion(
                research_run_id=run.id,
                agent_name="Contrarian Analyst",
                role="research",
                stance=AgentStance.BEARISH,
                confidence=0.6,
                key_evidence=["Funding is overheated."],
            ),
        ]
    )
    debate = service.save_debate(
        ResearchDebate(
            research_run_id=run.id,
            symbol="BTC/USDT",
            consensus_stance=AgentStance.NEUTRAL,
            consensus_confidence=0.65,
            conflict_level=ConflictLevel.HIGH,
            opinion_ids=[opinion.id for opinion in opinions],
            contradictions=["Bullish flow conflicts with overheated funding."],
        )
    )
    for opinion in opinions:
        opinion.debate_id = debate.id
    service.save_agent_opinions(opinions)
    run.debate_id = debate.id
    service.update_research_run(run)

    loaded_run = service.get_research_run(run.id)
    loaded_debate = service.get_debate(debate.id)
    loaded_opinions = service.list_agent_opinions(debate_id=debate.id)

    assert loaded_run.debate_id == debate.id
    assert loaded_debate.consensus_stance == AgentStance.NEUTRAL
    assert loaded_debate.conflict_level == ConflictLevel.HIGH
    assert len(loaded_opinions) == 2
    assert {opinion.agent_name for opinion in loaded_opinions} == {
        "News Analyst",
        "Contrarian Analyst",
    }
