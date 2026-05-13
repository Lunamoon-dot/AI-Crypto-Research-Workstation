"""Quant signal precomputation helpers."""

from __future__ import annotations

import logging
from datetime import datetime as dt, timedelta

from tradingagents.agents.utils.signal_tools import _get_signal_engine
from tradingagents.dataflows.interface import route_to_vendor

logger = logging.getLogger(__name__)

_OPTIONAL_REASON_CODES = {
    "funding_rate_history": "missing_funding_rate",
    "funding_rate": "missing_funding_rate",
    "open_interest_history": "exchange_oi_unsupported",
    "open_interest": "exchange_oi_unsupported",
    "liquidations": "missing_liquidations",
    "long_short_ratio": "missing_long_short_ratio",
    "nvt": "missing_onchain_secondary",
    "exchange_metrics": "missing_exchange_metrics",
}


def precompute_quant_signal(config: dict, symbol: str, trade_date: str):
    """Return ``(prompt_block, signal_result_or_none)`` for a run."""
    td = dt.strptime(trade_date, "%Y-%m-%d")
    start = (td - timedelta(days=90)).strftime("%Y-%m-%d")

    try:
        ohlcv_csv = route_to_vendor("get_crypto_ohlcv", symbol, start, trade_date)
    except Exception as exc:
        message = (
            f"Core data unavailable for {symbol}: OHLCV/symbol validity failed "
            f"for {start} -> {trade_date}: {exc}"
        )
        logger.error(message)
        raise ValueError(message) from exc

    funding_csv = None
    oi_csv = None
    liq_csv = None
    long_short_csv = None
    nvt_csv = None
    exchange_metrics_csv = None
    missing_optional_data: list[str] = []

    def _fetch_or_none(method: str, label: str, *args):
        try:
            return route_to_vendor(method, *args, _quiet=True)
        except Exception as exc:
            logger.debug("Quant signal optional data '%s' unavailable: %s", method, exc)
            missing_optional_data.append(_OPTIONAL_REASON_CODES[label])
            return None

    funding_csv = _fetch_or_none(
        "get_crypto_funding_rate_history", "funding_rate_history", symbol, 60
    )
    if funding_csv is None:
        funding_csv = _fetch_or_none("get_crypto_funding_rate", "funding_rate", symbol)
        if funding_csv is not None:
            missing_optional_data = [
                item for item in missing_optional_data if item != "missing_funding_rate"
            ]
            if _looks_unavailable(funding_csv):
                missing_optional_data.append("missing_funding_rate")
                funding_csv = None
    oi_csv = _fetch_or_none(
        "get_crypto_open_interest_history", "open_interest_history", symbol, 60
    )
    if oi_csv is None:
        oi_csv = _fetch_or_none("get_crypto_open_interest", "open_interest", symbol)
        if oi_csv is not None:
            missing_optional_data = [
                item
                for item in missing_optional_data
                if item != "exchange_oi_unsupported"
            ]
            if _looks_unavailable(oi_csv):
                missing_optional_data.append("exchange_oi_unsupported")
                oi_csv = None
    liq_csv = _fetch_or_none("get_crypto_liquidations", "liquidations", symbol)
    long_short_csv = _fetch_or_none(
        "get_crypto_long_short_ratio", "long_short_ratio", symbol
    )
    nvt_csv = _fetch_or_none("get_crypto_nvt", "nvt", symbol)
    exchange_metrics_csv = _fetch_or_none(
        "get_crypto_exchange_metrics", "exchange_metrics", symbol
    )

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
    result.missing_optional_data = _dedupe(
        [*result.missing_optional_data, *missing_optional_data]
    )
    if result.missing_optional_data:
        result.degradation_reasons = _dedupe(
            [*result.degradation_reasons, *result.missing_optional_data]
        )
    return result.to_prompt_block(), result


def _looks_unavailable(text: str | None) -> bool:
    lowered = (text or "").lower()
    return "not available" in lowered or "does not support" in lowered


def _dedupe(items: list[str]) -> list[str]:
    return list(dict.fromkeys(item for item in items if item))
