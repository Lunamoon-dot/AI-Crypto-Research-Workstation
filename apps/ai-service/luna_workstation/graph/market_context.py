"""Market context precomputation helpers."""

from __future__ import annotations

import logging

from luna_workstation.dataflows.ccxt_provider import _get_exchange
from luna_workstation.dataflows.market_context_provider import build_market_context

logger = logging.getLogger(__name__)


def precompute_market_context(config: dict, symbol: str, trade_date: str):
    """Return ``(prompt_block, market_context_or_none)`` for a research run."""
    policy = dict(config.get("market_context", {}))
    if policy.get("enabled") is False:
        return "", None

    primary_venue = str(
        policy.get("primary_venue") or config.get("crypto_exchange") or "binance"
    )
    validation_venues = [
        str(venue).strip()
        for venue in policy.get("validation_venues", ["okx", "bybit", "bitget"])
        if str(venue).strip() and str(venue).strip() != primary_venue
    ]
    threshold = float(policy.get("divergence_threshold_bps", 25.0))
    market_type = str(config.get("market_type", "spot"))

    try:
        result = build_market_context(
            symbol=symbol,
            market_type=market_type,
            primary_venue=primary_venue,
            validation_venues=validation_venues,
            exchange_loader=_get_exchange,
            divergence_threshold_bps=threshold,
        )
    except Exception as exc:
        logger.warning("Market context unavailable for %s on %s: %s", symbol, trade_date, exc)
        return (
            "===== PRE-COMPUTED MARKET CONTEXT =====\n"
            f"Instrument: {symbol}\n"
            f"Market type: {market_type}\n"
            "Quality: degraded\n"
            "Missing/degraded data:\n"
            f"- market_context_unavailable: {str(exc)[:200]}\n"
            "===== END MARKET CONTEXT =====",
            None,
        )

    return result.to_prompt_block(), result
