from tradingagents.graph import quant_signals
from tradingagents.signals import engine as engine_module
from tradingagents.signals.base import FactorSignal, SignalResult, SignalScore
from tradingagents.signals.engine import SignalEngine
from tradingagents.signals.provenance import signal_result_to_domain_signals


_OHLCV_CSV = """Date,Open,High,Low,Close,Volume
2026-05-10,100,110,95,105,1000
2026-05-11,105,112,101,108,1200
2026-05-12,108,116,104,114,1300
"""


def _factor(name: str, score: SignalScore = SignalScore.BUY) -> FactorSignal:
    return FactorSignal(
        name=name,
        score=score,
        confidence=0.75,
        value=1.0,
        threshold_breached=True,
        data_quality=1.0,
        detail=f"{name} detail",
    )


def test_signal_engine_records_failed_factor_as_degradation(monkeypatch):
    monkeypatch.setattr(
        engine_module,
        "detect_regime",
        lambda _csv: {
            "signal": _factor("regime"),
            "trend_direction": "up",
            "trend_strength": 0.7,
            "volatility_regime": "normal",
            "market_regime": "trending",
        },
    )
    monkeypatch.setattr(
        engine_module,
        "compute_rsi_divergence",
        lambda _csv: _factor("rsi_divergence"),
    )
    monkeypatch.setattr(
        engine_module,
        "compute_volume_signal",
        lambda _csv: _factor("volume_profile"),
    )

    def fail_macd(_csv):
        raise RuntimeError("macd source malformed")

    monkeypatch.setattr(engine_module, "compute_macd_signal", fail_macd)

    result = SignalEngine().generate("BTC/USDT", _OHLCV_CSV)

    assert "signal_factor_macd_failed" in result.missing_optional_data
    assert "signal_factor_macd_failed" in result.degradation_reasons
    assert result.factor_failures == [
        {
            "factor": "macd",
            "reason": "signal_factor_macd_failed",
            "error_type": "RuntimeError",
            "message": "macd source malformed",
        }
    ]
    assert "Signal factors unavailable" in result.to_prompt_block()

    composite = signal_result_to_domain_signals(result)[0]
    assert "signal_factor_macd_failed" in composite.provenance.metadata[
        "missing_optional_data"
    ]
    assert composite.provenance.metadata["factor_failures"][0]["factor"] == "macd"
    assert composite.evidence["factor_failures"][0]["reason"] == (
        "signal_factor_macd_failed"
    )


def test_precompute_quant_signal_preserves_engine_degradation(monkeypatch):
    factor_failure = {
        "factor": "macd",
        "reason": "signal_factor_macd_failed",
        "error_type": "RuntimeError",
        "message": "macd source malformed",
    }

    class FakeEngine:
        def generate(self, **_kwargs):
            return SignalResult(
                symbol="BTC/USDT",
                timestamp="2026-05-13T00:00:00Z",
                score=SignalScore.NEUTRAL,
                confidence=0.0,
                missing_optional_data=["signal_factor_macd_failed"],
                degradation_reasons=["signal_factor_macd_failed"],
                factor_failures=[factor_failure],
            )

    def fake_route(method, *_args, **_kwargs):
        if method == "get_crypto_ohlcv":
            return _OHLCV_CSV
        raise RuntimeError("optional provider unavailable")

    monkeypatch.setattr(quant_signals, "_get_signal_engine", lambda config: FakeEngine())
    monkeypatch.setattr(quant_signals, "route_to_vendor", fake_route)

    _prompt, result = quant_signals.precompute_quant_signal({}, "BTC/USDT", "2026-05-13")

    assert "signal_factor_macd_failed" in result.missing_optional_data
    assert "missing_funding_rate" in result.missing_optional_data
    assert "signal_factor_macd_failed" in result.degradation_reasons
    assert result.factor_failures == [factor_failure]
