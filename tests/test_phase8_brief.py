from datetime import date, datetime, timezone

from typer.testing import CliRunner

from cli import brief_cmd
from tradingagents.domain import (
    MarketSnapshot,
    ResearchRun,
    ThesisDirection,
    TradeThesis,
)
from tradingagents.services import BriefService, JournalService, WatchlistService


def _config(tmp_path):
    return {
        "data_cache_dir": str(tmp_path / "cache"),
        "journal": {"enabled": True, "db_path": str(tmp_path / "journal.sqlite")},
    }


def _seed_watchlist(config):
    journal = JournalService(config)
    watchlists = WatchlistService(config)
    run = journal.start_research_run(ResearchRun(symbol="BTC/USDT"))
    thesis = journal.save_thesis(
        TradeThesis(
            research_run_id=run.id,
            symbol="BTC/USDT",
            direction=ThesisDirection.WATCH,
            setup_type="breakout_confirmation",
            thesis_text="Watch for confirmation above resistance with volume expansion.",
            confidence=0.64,
            invalidation_level="Lose 103800",
            target_zones=["110000", "115000"],
        )
    )
    watchlists.add_thesis(thesis.id)
    return journal, thesis


def test_daily_market_brief_persists_and_remembers_previous_state(tmp_path):
    config = _config(tmp_path)
    journal, thesis = _seed_watchlist(config)
    service = BriefService(config)

    journal.save_market_snapshot(
        MarketSnapshot(
            symbol="BTC/USDT",
            captured_at=datetime(2026, 5, 7, tzinfo=timezone.utc),
            current_price=100000,
            trend_direction="up",
            volatility_regime="normal",
            market_regime="risk_on",
            source="test",
            source_timestamp=datetime(2026, 5, 7, tzinfo=timezone.utc),
            summary="BTC held the prior range.",
        )
    )
    previous = service.create_daily_brief(
        brief_date=date(2026, 5, 7),
        watchlist_name="default",
    )

    journal.save_market_snapshot(
        MarketSnapshot(
            symbol="BTC/USDT",
            captured_at=datetime(2026, 5, 8, tzinfo=timezone.utc),
            current_price=105000,
            trend_direction="up",
            volatility_regime="normal",
            market_regime="risk_on",
            source="test",
            source_timestamp=datetime(2026, 5, 8, tzinfo=timezone.utc),
            summary="BTC reclaimed the local range.",
        )
    )
    current = service.create_daily_brief(
        brief_date=date(2026, 5, 8),
        watchlist_name="default",
    )

    assert current.id
    assert current.previous_brief_id == previous.id
    assert current.thesis_updates[0].thesis_id == thesis.id
    assert any("price changed +5.00%" in note for note in current.memory_notes)
    payload = current.model_dump_json() if hasattr(current, "model_dump_json") else current.json()
    assert "buy now" not in payload.lower()


def test_brief_cli_daily_renders_without_live_fetch(tmp_path, monkeypatch):
    config = _config(tmp_path)
    journal, _ = _seed_watchlist(config)
    journal.save_market_snapshot(
        MarketSnapshot(
            symbol="BTC/USDT",
            current_price=105000,
            trend_direction="up",
            market_regime="risk_on",
            source="test",
            source_timestamp=datetime(2026, 5, 8, tzinfo=timezone.utc),
        )
    )
    monkeypatch.setattr(brief_cmd, "BriefService", lambda: BriefService(config))
    runner = CliRunner()

    result = runner.invoke(
        brief_cmd.app,
        ["daily", "--date", "2026-05-08", "--watchlist", "default"],
    )

    assert result.exit_code == 0
    assert "Market Brief - 2026-05-08" in result.output
    assert "BTC/USDT" in result.output
    assert "Active Thesis Updates" in result.output
