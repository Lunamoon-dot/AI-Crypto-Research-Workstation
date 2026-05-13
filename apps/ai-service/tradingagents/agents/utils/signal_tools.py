"""SignalEngine utility — pre-computes quantitative signals.

The engine now runs as a pre-processing step BEFORE the LangGraph graph,
so AI agents receive the signal as structured context rather than having
to call a tool.  Kept as a plain function for direct use by the graph
runner and backtesting.

Config is now passed explicitly — the old module-level singleton cache
has been removed so each graph instance gets its own engine.
"""

from __future__ import annotations

import logging

from tradingagents.dataflows.interface import route_to_vendor
from tradingagents.signals.engine import SignalEngine

logger = logging.getLogger(__name__)


def _get_signal_engine(config=None) -> SignalEngine:
    """Create SignalEngine with config-driven weights/thresholds."""
    if config is None:
        raise RuntimeError(
            "No config context bound. Wrap the call in config_context() or pass config explicitly."
        )
    raw_weights = config.get("signal_weights") or {}
    weight_version = str(raw_weights.get("version", "signal_weights:v1:2026-05-13"))
    weights = {
        key: float(value)
        for key, value in raw_weights.items()
        if key != "version" and isinstance(value, (int, float))
    }
    thresholds = config.get("signal_thresholds", {})
    return SignalEngine(
        weights=weights or None,
        weight_version=weight_version,
        strong_buy_threshold=thresholds.get("strong_buy", 0.60),
        buy_threshold=thresholds.get("buy", 0.25),
        sell_threshold=thresholds.get("sell", -0.25),
        strong_sell_threshold=thresholds.get("strong_sell", -0.60),
    )


def get_quant_signal(
    symbol: str,
    start_date: str,
    end_date: str,
    config=None,
) -> str:
    """Generate a quantitative market-bias block for a symbol.

    Runs deterministic signal detectors (RSI divergence, MACD, volume profile,
    regime detection, and for crypto: funding rate + OI + liquidations) and
    returns structured evidence the AI should use as its primary quantitative
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
        funding_csv = route_to_vendor(
            "get_crypto_funding_rate_history", symbol, 60, _quiet=True
        )
    except Exception:
        try:
            funding_csv = route_to_vendor("get_crypto_funding_rate", symbol)
        except Exception as e:
            logger.debug("Funding rate snapshot fallback failed for %s: %s", symbol, e)
    try:
        oi_csv = route_to_vendor(
            "get_crypto_open_interest_history", symbol, 60, _quiet=True
        )
    except Exception:
        try:
            oi_csv = route_to_vendor("get_crypto_open_interest", symbol)
        except Exception as e:
            logger.debug("Open interest snapshot fallback failed for %s: %s", symbol, e)
    try:
        liq_csv = route_to_vendor("get_crypto_liquidations", symbol)
    except Exception as e:
        logger.debug("Liquidation data fetch failed for %s: %s", symbol, e)

    # On-chain data — non-critical, best-effort
    try:
        long_short_csv = route_to_vendor("get_crypto_long_short_ratio", symbol)
    except Exception as e:
        logger.debug("Long/short ratio fetch failed for %s: %s", symbol, e)
    try:
        nvt_csv = route_to_vendor("get_crypto_nvt", symbol)
    except Exception as e:
        logger.debug("NVT data fetch failed for %s: %s", symbol, e)
    try:
        exchange_metrics_csv = route_to_vendor("get_crypto_exchange_metrics", symbol)
    except Exception as e:
        logger.debug("Exchange metrics fetch failed for %s: %s", symbol, e)

    engine = _get_signal_engine(config=config)

    result = engine.generate(
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
