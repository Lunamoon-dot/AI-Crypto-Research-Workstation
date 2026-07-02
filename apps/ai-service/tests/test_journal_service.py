from datetime import datetime, timedelta, timezone

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
    MarketSnapshot,
    SignalSnapshot,
    ThesisDirection,
    TradeThesis,
    UserDecision,
    UserDecisionAction,
)
from luna_workstation.services import JournalService
from luna_workstation.signals.evaluation.models import (
    SignalCalibratorVersion,
    SignalModelAlert,
    SignalModelMonitoringSnapshot,
    SignalModelPromotion,
    SignalModelRollback,
    SignalObservation,
    SignalOutcomeLabel,
    SignalWeightVersion,
)


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


def test_journal_service_scopes_workspace_lists(tmp_path):
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
    service_a.add_run_event(run_a.id, "run.note", "A")
    service_b.add_run_event(run_b.id, "run.note", "B")

    assert [run.symbol for run in service_a.list_research_runs()] == ["BTC/USDT"]
    assert [run.symbol for run in service_b.list_research_runs()] == ["ETH/USDT"]
    assert [thesis.id for thesis in service_a.list_theses()] == [thesis_a.id]
    assert [thesis.id for thesis in service_b.list_theses()] == [thesis_b.id]
    assert [signal.id for signal in service_a.list_signals()] == [signal_a.id]
    assert [signal.id for signal in service_b.list_signals()] == [signal_b.id]
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
    assert "missing_funding_rate" not in loaded.degradation_reasons


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


def test_journal_service_filters_noisy_optional_missing_text_from_debate(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="ETH/USDT", market_type="spot"))
    market_snapshot = service.save_market_snapshot(
        MarketSnapshot(
            research_run_id=run.id,
            symbol="ETH/USDT",
            current_price=2000.0,
        )
    )
    run.market_snapshot_id = market_snapshot.id
    opinion = AgentOpinion(
        research_run_id=run.id,
        agent_name="Sentiment Analyst",
        role="sentiment_analyst",
        stance=AgentStance.NEUTRAL,
        missing_data=[
            "**Missing Data**:",
            "No data",
            "Unavailable",
            "`missing_news_feed` - delegated to News Analyst",
            "project-specific news missing primary feed",
            "No strong high-confidence directional signal can be derived from the "
            "sentiment/social data alone due to missing news feed and low headline count",
            "missing_liquidations",
        ],
        reason_codes=["missing_news_feed"],
        source_report_type="sentiment",
    )
    debate = ResearchDebate(
        research_run_id=run.id,
        symbol="ETH/USDT",
        consensus_stance=AgentStance.NEUTRAL,
        conflict_level=ConflictLevel.LOW,
        missing_data=opinion.missing_data,
    )
    run, _opinions, debate = service.save_agent_research_bundle(
        run,
        [opinion],
        debate,
    )
    thesis = TradeThesis(
        symbol="ETH/USDT",
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
    assert loaded.missing_optional_data == [
        "missing_social_feed",
        "missing_liquidations",
    ]
    assert loaded.degradation_reasons == []


def test_journal_service_sanitizes_legacy_run_quality_on_read(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(
        ResearchRun(
            symbol="ETH/USDT",
            market_type="spot",
            degradation_reasons=[
                "missing_liquidations",
                "missing_data",
                "missing_project_specific_news_missing_primary_feed",
            ],
            missing_optional_data=[
                "No data",
                "Unavailable",
                "missing_liquidations",
                "missing_news_derived_sentiment_appears_bearish_but_with_"
                "insufficient_sample_size_to_be_reliable",
            ],
        )
    )

    loaded = service.get_research_run(run.id)
    listed = service.list_research_runs(limit=1)

    assert loaded.degradation_reasons == []
    assert loaded.missing_optional_data == [
        "missing_liquidations",
        "missing_social_feed",
    ]
    assert listed[0].degradation_reasons == []


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


def test_quant_signal_bundle_persists_signal_observations(tmp_path):
    service = JournalService(_config(tmp_path))
    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))
    signals = [
        Signal(
            symbol="BTC/USDT",
            signal_type="quant_bias",
            direction=SignalDirection.BULLISH,
            confidence=0.7,
            provenance=SignalProvenance(source="signal_engine"),
            evidence={"availability": "valid", "market_regime": "trending"},
        ),
        Signal(
            symbol="BTC/USDT",
            signal_type="regime",
            direction=SignalDirection.NEUTRAL,
            confidence=0.0,
            provenance=SignalProvenance(source="signal_engine"),
            evidence={"availability": "valid", "data_quality": 1.0},
        ),
    ]
    market_snapshot = MarketSnapshot(
        research_run_id=run.id,
        symbol="BTC/USDT",
        current_price=100000.0,
    )
    signal_snapshot = SignalSnapshot(
        research_run_id=run.id,
        symbol="BTC/USDT",
        signal_ids=[],
        bullish_count=1,
        neutral_count=1,
    )

    saved_run, _signals, _market, saved_snapshot = service.save_quant_signal_bundle(
        run,
        signals,
        market_snapshot,
        signal_snapshot,
    )

    observations = service.list_signal_observations(
        signal_snapshot_id=saved_snapshot.id,
    )

    assert saved_run.signal_snapshot_id == saved_snapshot.id
    assert len(observations) == 2
    assert {observation.observation_kind for observation in observations} == {
        "factor",
        "composite",
    }
    regime = next(observation for observation in observations if observation.factor_name == "regime")
    assert regime.directional_edge == 0.0


def test_journal_service_persists_signal_model_artifacts_and_monitoring(tmp_path):
    service = JournalService(_config(tmp_path))
    now = datetime(2026, 6, 1, 12, tzinfo=timezone.utc)
    weight = SignalWeightVersion(
        id="weight_1",
        workspace_id=service.workspace_id,
        version="signal_weights:v1:test",
        status="candidate",
        horizon_minutes=1440,
    )
    calibrator = SignalCalibratorVersion(
        id="calibrator_1",
        workspace_id=service.workspace_id,
        version="signal_calibrator:v1:test",
        weight_version=weight.version,
        status="candidate",
        horizon_minutes=1440,
        publishable=False,
    )
    promotion = SignalModelPromotion(
        id="promotion_1",
        workspace_id=service.workspace_id,
        to_weight_version=weight.version,
        to_calibrator_version=calibrator.version,
        promoted_by="user_1",
        evidence_report_id="report_1",
    )
    snapshot = SignalModelMonitoringSnapshot(
        id="monitor_1",
        workspace_id=service.workspace_id,
        window_start=now,
        window_end=now,
        active_weight_version=weight.version,
        active_calibrator_version=calibrator.version,
        status="insufficient_data",
    )
    alert = SignalModelAlert(
        id="alert_1",
        workspace_id=service.workspace_id,
        alert_type="model_version_missing",
        severity="info",
        message="missing model",
    )
    rollback = SignalModelRollback(
        id="rollback_1",
        workspace_id=service.workspace_id,
        from_weight_version="w2",
        to_weight_version=weight.version,
        from_calibrator_version="c2",
        to_calibrator_version=calibrator.version,
        reason="test",
        evidence_snapshot_id=snapshot.id,
        requested_by="user_1",
    )

    service.save_signal_weight_version(weight)
    service.save_signal_calibrator_version(calibrator)
    service.save_signal_model_promotion(promotion)
    service.save_signal_monitoring_snapshot(snapshot)
    service.save_signal_model_alert(alert)
    service.save_signal_model_rollback(rollback)

    assert service.list_signal_weight_versions()[0].version == weight.version
    assert service.list_signal_calibrator_versions()[0].version == calibrator.version
    assert service.list_signal_model_promotions()[0].to_weight_version == weight.version
    assert service.list_signal_monitoring_snapshots()[0].id == snapshot.id
    assert service.list_signal_model_alerts()[0].alert_type == alert.alert_type
    assert service.list_signal_model_rollbacks()[0].to_weight_version == weight.version


def test_journal_service_labels_matured_signal_outcomes_idempotently(tmp_path):
    service = JournalService(_config(tmp_path))
    observed_at = datetime(2026, 6, 1, 12, tzinfo=timezone.utc)
    observation = SignalObservation(
        id="obs_label_1",
        workspace_id=service.workspace_id,
        symbol="BTC/USDT",
        timeframe="1h",
        observed_at=observed_at,
        observation_kind="factor",
        factor_name="regime",
        factor_family="price_structure",
        direction="bullish",
        directional_edge=0.8,
        heuristic_strength=0.8,
        detector_confidence=0.8,
        data_quality=1.0,
        availability="valid",
    )
    service.repo.save_signal_observations([observation])

    def candle_loader(_observation, _horizon_minutes):
        return [
            {
                "timestamp": (observed_at + timedelta(hours=1)).isoformat(),
                "open": 100.0,
                "high": 103.0,
                "low": 99.0,
                "close": 102.0,
            }
        ]

    first = service.label_signal_outcomes(
        horizon_minutes=1440,
        candle_loader=candle_loader,
        now=observed_at + timedelta(days=2),
    )
    second = service.label_signal_outcomes(
        horizon_minutes=1440,
        candle_loader=candle_loader,
        now=observed_at + timedelta(days=2),
        dry_run=True,
    )

    labels = service.list_signal_outcome_labels(horizon_minutes=1440)
    assert first["labeled"] == 1
    assert labels[0].label_status == "complete"
    assert second["requested"] == 0


def test_journal_service_trains_candidate_and_persists_monitoring_snapshot(tmp_path):
    service = JournalService(_config(tmp_path))
    now = datetime(2026, 6, 1, 12, tzinfo=timezone.utc)
    observation = SignalObservation(
        id="obs_train_1",
        workspace_id=service.workspace_id,
        symbol="BTC/USDT",
        timeframe="1h",
        observed_at=now,
        observation_kind="factor",
        factor_name="regime",
        factor_family="price_structure",
        direction="bullish",
        directional_edge=0.8,
        heuristic_strength=0.8,
        detector_confidence=0.8,
        data_quality=1.0,
        availability="valid",
        market_regime="trending",
        volatility_regime="normal",
    )
    label = SignalOutcomeLabel(
        id="label_train_1",
        workspace_id=service.workspace_id,
        observation_id=observation.id,
        symbol=observation.symbol,
        horizon_minutes=1440,
        label_status="complete",
        entry_price=100.0,
        exit_price=103.0,
        forward_return=0.03,
        direction_label="up",
        signal_direction="bullish",
        signed_return=0.03,
        direction_correct=True,
        data_quality="complete",
    )
    service.repo.save_signal_observations([observation])
    service.save_signal_outcome_labels([label])

    candidate = service.train_signal_model_candidate(
        horizon_minutes=1440,
        min_train_samples=1,
        min_calibration_samples=0,
        min_oos_samples=0,
        min_folds=0,
    )
    snapshot = service.build_signal_model_monitoring_snapshot(horizon_minutes=1440)

    assert service.list_signal_weight_versions()[0].version == candidate.weight_version.version
    assert service.list_signal_calibrator_versions()[0].version == candidate.calibrator_version.version
    assert service.list_signal_monitoring_snapshots()[0].id == snapshot.id
    assert "model_version_missing" in {
        alert.alert_type for alert in service.list_signal_model_alerts()
    }


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
