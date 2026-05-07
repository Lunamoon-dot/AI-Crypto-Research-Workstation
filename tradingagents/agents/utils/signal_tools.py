"""SignalEngine utility — pre-computes quantitative signals.

The engine now runs as a pre-processing step BEFORE the LangGraph graph,
so AI agents receive the signal as structured context rather than having
to call a tool.  Kept as a plain function for direct use by the graph
runner and backtesting.
"""

from __future__ import annotations

from tradingagents.dataflows.interface import route_to_vendor
from tradingagents.dataflows.config import get_config
from tradingagents.signals.engine import SignalEngine


def _get_signal_engine() -> SignalEngine:
    """Create SignalEngine with config-driven weights/thresholds."""
    config = get_config()
    weights = config.get("signal_weights")
    thresholds = config.get("signal_thresholds", {})
    return SignalEngine(
        weights=weights,
        strong_buy_threshold=thresholds.get("strong_buy", 0.60),
        buy_threshold=thresholds.get("buy", 0.25),
        sell_threshold=thresholds.get("sell", -0.25),
        strong_sell_threshold=thresholds.get("strong_sell", -0.60),
    )


_engine = None


def get_quant_signal(
    symbol: str,
    start_date: str,
    end_date: str,
) -> str:
    """Generate a quantitative trading signal for a symbol.

    Runs deterministic signal detectors (RSI divergence, MACD, volume profile,
    regime detection, and for crypto: funding rate + OI + liquidations) and
    returns a structured signal the AI should use as its primary quantitative
    input.  The AI's job is to add narrative context, macro overlay, and
    sentiment filtering — NOT to re-derive signals from raw data.

    Returns a formatted block ready to inject into the analyst's reasoning.
    """
    # Fetch OHLCV
    try:
        ohlcv_csv = route_to_vendor("get_crypto_ohlcv", symbol, start_date, end_date)
    except Exception as e:
        return (
            f"Quant Signal: could not fetch OHLCV data for {symbol}: {e}. "
            "The symbol may not exist on the configured exchange. "
            "Check the ticker and exchange selection, or try a different pair."
        )

    # Fetch crypto-specific data
    # Prefer history (structured CSV) for richer signal computation.
    # Fall back gracefully to snapshot text when the exchange does not
    # expose historical endpoints.
    funding_csv = None
    oi_csv = None
    liq_csv = None
    long_short_csv = None
    nvt_csv = None
    exchange_metrics_csv = None

    try:
        funding_csv = route_to_vendor("get_crypto_funding_rate_history", symbol, 60)
    except Exception:
        try:
            funding_csv = route_to_vendor("get_crypto_funding_rate", symbol)
        except Exception:
            pass
    try:
        oi_csv = route_to_vendor("get_crypto_open_interest_history", symbol, 60)
    except Exception:
        try:
            oi_csv = route_to_vendor("get_crypto_open_interest", symbol)
        except Exception:
            pass
    try:
        liq_csv = route_to_vendor("get_crypto_liquidations", symbol)
    except Exception:
        pass

    # On-chain data — non-critical, best-effort
    try:
        long_short_csv = route_to_vendor("get_crypto_long_short_ratio", symbol)
    except Exception:
        pass
    try:
        nvt_csv = route_to_vendor("get_crypto_nvt", symbol)
    except Exception:
        pass
    try:
        exchange_metrics_csv = route_to_vendor("get_crypto_exchange_metrics", symbol)
    except Exception:
        pass

    # Lazy-init engine so it picks up the current config at call time
    global _engine
    if _engine is None:
        _engine = _get_signal_engine()

    result = _engine.generate(
        symbol=symbol,
        ohlcv_csv=ohlcv_csv,
        funding_csv=funding_csv,
        oi_csv=oi_csv,
        liq_csv=liq_csv,
        long_short_ratio_csv=long_short_csv,
        nvt_csv=nvt_csv,
        exchange_metrics_csv=exchange_metrics_csv,
    )

    return result.to_prompt_block()
