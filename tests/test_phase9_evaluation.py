from datetime import datetime, timezone

from typer.testing import CliRunner

from cli import backtest_cmd
from tradingagents.domain import (
    AgentOpinion,
    AgentStance,
    OutcomeResult,
    Signal,
    SignalDirection,
    SignalProvenance,
    ThesisDirection,
    TradeThesis,
)
from tradingagents.services import EvaluationService, JournalService


def _config(tmp_path):
    return {
        "data_cache_dir": str(tmp_path / "cache"),
        "journal": {"enabled": True, "db_path": str(tmp_path / "journal.sqlite")},
    }


def _ohlcv(*args):
    return "\n".join(
        [
            "timestamp,Open,High,Low,Close,Volume",
            "2026-05-08,100,105,99,104,10",
            "2026-05-09,104,111,103,110,12",
            "2026-05-10,110,112,107,108,9",
        ]
    )


def test_evaluate_saved_thesis_records_target_mfe_mae(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    thesis = journal.save_thesis(
        TradeThesis(
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Continuation if reclaim holds.",
            target_zones=["110"],
            invalidation_level="Lose 95",
            created_at=datetime(2026, 5, 8, tzinfo=timezone.utc),
        )
    )
    service = EvaluationService(config, price_loader=_ohlcv)

    evaluation = service.evaluate_thesis(thesis.id, window_days=3)
    loaded = service.list_evaluations(thesis_id=thesis.id)

    assert evaluation.result == OutcomeResult.HIT_TARGET
    assert evaluation.target_hit is True
    assert evaluation.invalidated is False
    assert evaluation.time_to_target_days == 1
    assert round(evaluation.max_favorable_excursion, 4) == 0.12
    assert round(evaluation.max_adverse_excursion, 4) == -0.01
    assert loaded[0].id == evaluation.id


def test_evaluate_saved_thesis_can_record_outcome_review(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    thesis = journal.save_thesis(
        TradeThesis(
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Continuation if reclaim holds.",
            target_zones=["110"],
            created_at=datetime(2026, 5, 8, tzinfo=timezone.utc),
        )
    )
    service = EvaluationService(config, price_loader=_ohlcv)

    evaluation = service.evaluate_thesis(thesis.id, window_days=3, record_review=True)
    reviews = journal.list_outcome_reviews(thesis_id=thesis.id)

    assert len(reviews) == 1
    assert reviews[0].result == evaluation.result
    assert reviews[0].max_favorable_excursion == evaluation.max_favorable_excursion


def test_evaluate_thesis_cli_renders_quality_metrics(tmp_path, monkeypatch):
    config = _config(tmp_path)
    journal = JournalService(config)
    thesis = journal.save_thesis(
        TradeThesis(
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            thesis_text="Continuation if reclaim holds.",
            target_zones=["110"],
            created_at=datetime(2026, 5, 8, tzinfo=timezone.utc),
        )
    )
    monkeypatch.setattr(
        backtest_cmd,
        "EvaluationService",
        lambda: EvaluationService(config, price_loader=_ohlcv),
    )
    runner = CliRunner()

    result = runner.invoke(backtest_cmd.backtest_app, ["thesis", thesis.id])

    assert result.exit_code == 0
    assert "Thesis Quality Evaluation" in result.output
    assert "hit_target" in result.output
    assert "MFE" in result.output


def test_evaluation_analytics_groups_by_setup_confidence_signal_and_agent(tmp_path):
    config = _config(tmp_path)
    journal = JournalService(config)
    signal = journal.save_signal(
        Signal(
            symbol="BTC/USDT",
            signal_type="funding_extreme",
            direction=SignalDirection.BEARISH,
            confidence=0.6,
            provenance=SignalProvenance(source="coinglass"),
        )
    )
    opinion = journal.save_agent_opinions(
        [
            AgentOpinion(
                agent_name="Market Analyst",
                stance=AgentStance.BULLISH,
                confidence=0.7,
            )
        ]
    )[0]
    thesis = journal.save_thesis(
        TradeThesis(
            symbol="BTC/USDT",
            direction=ThesisDirection.LONG,
            setup_type="breakout",
            confidence=0.74,
            thesis_text="Continuation if reclaim holds.",
            target_zones=["110"],
            supporting_signal_ids=[signal.id],
            agent_opinion_ids=[opinion.id],
            created_at=datetime(2026, 5, 8, tzinfo=timezone.utc),
        )
    )
    service = EvaluationService(config, price_loader=_ohlcv)
    service.evaluate_thesis(thesis.id, window_days=3)

    analytics = service.build_analytics(symbol="BTC/USDT")

    assert analytics.total_sample_size == 1
    assert analytics.by_setup[0].key == "breakout"
    assert analytics.by_confidence_bucket[0].key == "gte_0.70"
    assert analytics.by_signal[0].key.startswith("funding_extreme:bearish")
    assert analytics.by_agent[0].key == "Market Analyst"
