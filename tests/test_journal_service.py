from tradingagents.domain import (
    OutcomeResult,
    OutcomeReview,
    ResearchRun,
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
from tradingagents.services import JournalService


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

    run = service.start_research_run(ResearchRun(symbol="BTC/USDT"))
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
    assert loaded_thesis is not None
    assert loaded_thesis.symbol == "BTC/USDT"


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


def test_journal_service_saves_and_reads_signals(tmp_path):
    service = JournalService(_config(tmp_path))
    saved = service.save_signals([
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
    ])

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
