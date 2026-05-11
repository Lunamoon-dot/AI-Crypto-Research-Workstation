"""Quant signal precomputation helpers."""

from __future__ import annotations

import logging
from datetime import datetime as dt, timedelta

from tradingagents.agents.utils.signal_tools import _get_signal_engine
from tradingagents.dataflows.interface import route_to_vendor

logger = logging.getLogger(__name__)


def precompute_quant_signal(config: dict, symbol: str, trade_date: str):
    """Return ``(prompt_block, signal_result_or_none)`` for a run."""
    td = dt.strptime(trade_date, "%Y-%m-%d")
    start = (td - timedelta(days=90)).strftime("%Y-%m-%d")

    try:
        ohlcv_csv = route_to_vendor("get_crypto_ohlcv", symbol, start, trade_date)
    except Exception as exc:
        logger.warning("Cannot fetch OHLCV for quant signal: %s", exc)
        return "", None

    funding_csv = None
    oi_csv = None
    liq_csv = None
    long_short_csv = None
    nvt_csv = None
    exchange_metrics_csv = None

    def _fetch_or_none(method: str, *args):
        try:
            return route_to_vendor(method, *args)
        except Exception as exc:
            logger.debug("Quant signal optional data '%s' unavailable: %s", method, exc)
            return None

    funding_csv = _fetch_or_none("get_crypto_funding_rate_history", symbol, 60)
    if funding_csv is None:
        funding_csv = _fetch_or_none("get_crypto_funding_rate", symbol)
    oi_csv = _fetch_or_none("get_crypto_open_interest_history", symbol, 60)
    if oi_csv is None:
        oi_csv = _fetch_or_none("get_crypto_open_interest", symbol)
    liq_csv = _fetch_or_none("get_crypto_liquidations", symbol)
    long_short_csv = _fetch_or_none("get_crypto_long_short_ratio", symbol)
    nvt_csv = _fetch_or_none("get_crypto_nvt", symbol)
    exchange_metrics_csv = _fetch_or_none("get_crypto_exchange_metrics", symbol)

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
    return result.to_prompt_block(), result
