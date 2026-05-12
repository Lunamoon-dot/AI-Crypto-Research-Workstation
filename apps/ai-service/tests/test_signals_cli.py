from datetime import datetime, timezone

from typer.testing import CliRunner

from cli import signals_cmd
from tradingagents.domain import ResearchRun
from tradingagents.services import JournalService
from tradingagents.signals.base import FactorSignal, SignalResult, SignalScore
from tradingagents.signals.provenance import signal_result_to_domain_signals
from tradingagents.signals.snapshots import build_market_snapshot, build_signal_snapshot


def _config(tmp_path):
    return {
        "data_cache_dir": str(tmp_path),
        "journal": {
            "enabled": True,
            "db_path": str(tmp_path / "journal.sqlite"),
        },
    }


def _result(symbol: str = "ETH/USDT") -> SignalResult:
    return SignalResult(
        symbol=symbol,
        timestamp="2026-05-08T10:00:00Z",
        score=SignalScore.BUY,
        confidence=0.72,
        current_price=3200.0,
        trend_direction="bullish",
        trend_strength=0.67,
        volatility_regime="normal",
        market_regime="trending",
        summary="Quant bias is bullish.",
        factors=[
            FactorSignal(
                name="regime",
                score=SignalScore.BUY,
                confidence=0.7,
                value=1.0,
                threshold_breached=False,
                data_quality=0.9,
                detail="Trend intact.",
            ),
            FactorSignal(
                name="funding_oi",
                score=SignalScore.SELL,
                confidence=0.61,
                value=0.08,
                threshold_breached=True,
                data_quality=0.8,
                detail="Funding elevated.",
            ),
        ],
    )


def _save_signal_run(tmp_path, monkeypatch, symbol: str = "ETH/USDT"):
    config = _config(tmp_path)
    monkeypatch.setattr(signals_cmd, "DEFAULT_CONFIG", config)
    service = JournalService(config)
    run = service.start_research_run(ResearchRun(symbol=symbol))
    result = _result(symbol)
    signals = signal_result_to_domain_signals(
        result,
        now=datetime(2026, 5, 8, 12, 0, tzinfo=timezone.utc),
    )
    market_snapshot = build_market_snapshot(result, research_run_id=run.id)
    signal_snapshot = build_signal_snapshot(
        research_run_id=run.id,
        symbol=symbol,
        signals=signals,
    )
    run, saved_signals, _market, snapshot = service.save_quant_signal_bundle(
        run,
        signals,
        market_snapshot,
        signal_snapshot,
    )
    return run, saved_signals, snapshot


def test_signals_cli_import_smoke():
    assert signals_cmd.signals_app is not None


def test_signals_latest_plain_groups_lanes_without_execution_words(
    tmp_path, monkeypatch
):
    run, _signals, snapshot = _save_signal_run(tmp_path, monkeypatch)
    runner = CliRunner()

    result = runner.invoke(
        signals_cmd.signals_app,
        ["latest", "ETH/USDT", "--plain"],
    )

    assert result.exit_code == 0
    assert run.id in result.output
    assert snapshot.id in result.output
    assert "quant_bias:" in result.output
    assert "spot:" in result.output
    assert "perp:" in result.output
    assert "bullish" in result.output
    assert "bearish" in result.output
    assert "Buy" not in result.output
    assert "Sell" not in result.output


def test_signals_snapshot_is_scoped_to_one_run(tmp_path, monkeypatch):
    run_a, signals_a, _snapshot_a = _save_signal_run(tmp_path, monkeypatch)
    run_b, signals_b, _snapshot_b = _save_signal_run(tmp_path, monkeypatch)
    runner = CliRunner()

    result = runner.invoke(
        signals_cmd.signals_app,
        ["snapshot", run_a.id, "--json"],
    )

    assert result.exit_code == 0
    assert run_a.id in result.output
    assert run_b.id not in result.output
    assert "quant_bias_signal_id" in result.output
    assert "composite_signal_id" not in result.output
    assert signals_a[0].id in result.output
    assert signals_b[0].id not in result.output


def test_signals_explain_surfaces_watch_conditions(tmp_path, monkeypatch):
    _run, signals, snapshot = _save_signal_run(tmp_path, monkeypatch)
    funding_signal = next(signal for signal in signals if signal.signal_type == "funding_oi")
    runner = CliRunner()

    result = runner.invoke(
        signals_cmd.signals_app,
        ["explain", funding_signal.id],
    )

    assert result.exit_code == 0
    assert snapshot.id in result.output
    assert "Watch Conditions" in result.output
    assert "Review trigger" in result.output
    assert "perp" in result.output
    assert "funding_oi" in result.output
    assert "Buy" not in result.output
    assert "Sell" not in result.output
