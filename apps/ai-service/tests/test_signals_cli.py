from datetime import datetime, timezone
import json

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


def _legacy_signal_payload(
    *,
    signal_id: str,
    symbol: str,
    signal_type: str,
    direction: str,
    score: str,
    detail: str,
) -> dict:
    return {
        "id": signal_id,
        "symbol": symbol,
        "signal_type": signal_type,
        "direction": direction,
        "strength": 0.61,
        "confidence": 0.61,
        "observed_at": "2026-05-12T18:43:28Z",
        "expires_at": None,
        "provenance": {
            "source": "signal_engine" if signal_type == "composite_quant" else signal_type,
            "source_timestamp": "2026-05-12T18:43:28Z",
            "observed_at": "2026-05-12T18:43:28Z",
            "freshness": "fresh",
            "freshness_seconds": 0,
            "confidence": 0.61,
            "metadata": {
                "score": score,
                "data_quality": 0.8,
                "threshold_breached": signal_type == "funding_oi",
                "raw_metadata": {
                    "funding_percentile": 0.93,
                    "oi_delta_5d": 0.07,
                    "price_delta_5d": -0.01,
                },
            },
        },
        "evidence": {
            "score": score,
            "value": 0.08,
            "detail": detail,
            "data_quality": 0.8,
            "threshold_breached": signal_type == "funding_oi",
        },
        "summary": detail,
        "supporting": True,
    }


def _save_legacy_signal_run(tmp_path, monkeypatch, symbol: str = "ETH/USDT"):
    config = _config(tmp_path)
    monkeypatch.setattr(signals_cmd, "DEFAULT_CONFIG", config)
    service = JournalService(config)
    run = service.start_research_run(ResearchRun(symbol=symbol))
    signal_ids = [
        "sig_legacy_quant",
        "sig_legacy_regime",
        "sig_legacy_macd",
        "sig_legacy_funding",
        "sig_legacy_onchain",
    ]
    legacy_signals = [
        _legacy_signal_payload(
            signal_id=signal_ids[0],
            symbol=symbol,
            signal_type="composite_quant",
            direction="neutral",
            score="Neutral",
            detail="Legacy composite quant signal.",
        ),
        _legacy_signal_payload(
            signal_id=signal_ids[1],
            symbol=symbol,
            signal_type="regime",
            direction="neutral",
            score="Neutral",
            detail="Legacy regime signal.",
        ),
        _legacy_signal_payload(
            signal_id=signal_ids[2],
            symbol=symbol,
            signal_type="macd",
            direction="bearish",
            score="Sell",
            detail="Legacy MACD signal.",
        ),
        _legacy_signal_payload(
            signal_id=signal_ids[3],
            symbol=symbol,
            signal_type="funding_oi",
            direction="neutral",
            score="Neutral",
            detail="Legacy funding signal.",
        ),
        _legacy_signal_payload(
            signal_id=signal_ids[4],
            symbol=symbol,
            signal_type="onchain",
            direction="bullish",
            score="Buy",
            detail="Legacy onchain signal.",
        ),
    ]
    for payload in legacy_signals:
        service.store.execute(
            """
            INSERT INTO signals (
                id, workspace_id, symbol, signal_type, direction, confidence,
                observed_at, source, source_timestamp, payload_json
            )
            VALUES (?, 'local', ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                payload["id"],
                payload["symbol"],
                payload["signal_type"],
                payload["direction"],
                payload["confidence"],
                payload["observed_at"],
                payload["provenance"]["source"],
                payload["provenance"]["source_timestamp"],
                json.dumps(payload),
            ),
        )
    snapshot_payload = {
        "id": "signal_snapshot_legacy",
        "research_run_id": run.id,
        "symbol": symbol,
        "captured_at": "2026-05-12T18:43:28Z",
        "signal_ids": signal_ids,
        "composite_signal_id": signal_ids[0],
        "bullish_count": 1,
        "bearish_count": 1,
        "neutral_count": 3,
        "stale_count": 0,
        "unknown_freshness_count": 0,
        "payload": {
            "signal_types": [
                "composite_quant",
                "regime",
                "macd",
                "funding_oi",
                "onchain",
            ]
        },
    }
    service.store.execute(
        """
        INSERT INTO signal_snapshots (
            id, research_run_id, symbol, captured_at, composite_signal_id,
            signal_count, bullish_count, bearish_count, neutral_count,
            stale_count, unknown_freshness_count, payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            snapshot_payload["id"],
            run.id,
            symbol,
            snapshot_payload["captured_at"],
            signal_ids[0],
            len(signal_ids),
            1,
            1,
            3,
            0,
            0,
            json.dumps(snapshot_payload),
        ),
    )
    run.signal_ids = signal_ids
    run.signal_snapshot_id = snapshot_payload["id"]
    service.update_research_run(run)
    return run, signal_ids, snapshot_payload["id"]


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


def test_signals_latest_normalizes_legacy_signal_payloads(tmp_path, monkeypatch):
    run, signal_ids, snapshot_id = _save_legacy_signal_run(tmp_path, monkeypatch)
    runner = CliRunner()

    result = runner.invoke(
        signals_cmd.signals_app,
        ["latest", "ETH/USDT", "--plain"],
    )

    assert result.exit_code == 0
    assert run.id in result.output
    assert snapshot_id in result.output
    assert "quant_bias:" in result.output
    assert "composite_quant" not in result.output
    assert "spot:" in result.output
    assert "perp:" in result.output
    assert "unknown:" not in result.output
    assert "sig_legacy_funding\tfunding_oi\tfunding_oi" in result.output
    assert "sig_legacy_macd\tmacd\tprice" in result.output
    assert "Buy" not in result.output
    assert "Sell" not in result.output

    snapshot_result = runner.invoke(
        signals_cmd.signals_app,
        ["snapshot", run.id, "--json"],
    )
    assert snapshot_result.exit_code == 0
    snapshot_payload = json.loads(snapshot_result.output)
    signal_snapshot = snapshot_payload["signal_snapshot"]
    assert signal_snapshot["quant_bias_signal_id"] == signal_ids[0]
    assert signal_snapshot["payload"]["signal_types"][0] == "quant_bias"
    assert signal_snapshot["payload"]["spot_signal_ids"] == [
        "sig_legacy_regime",
        "sig_legacy_macd",
        "sig_legacy_onchain",
    ]
    assert signal_snapshot["payload"]["perp_signal_ids"] == ["sig_legacy_funding"]

    explain_result = runner.invoke(
        signals_cmd.signals_app,
        ["explain", "sig_legacy_funding"],
    )
    assert explain_result.exit_code == 0
    assert "Lane: perp" in explain_result.output
    assert "Category: funding_oi" in explain_result.output
    assert "funding percentile rises above 90%" in explain_result.output
