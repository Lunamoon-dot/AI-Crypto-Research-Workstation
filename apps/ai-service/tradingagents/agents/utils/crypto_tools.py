"""LangChain tool wrappers for crypto data sources.

Each tool is a ``@tool``-decorated function that delegates to
``route_to_vendor`` for CCXT and CoinGecko providers.
"""

from __future__ import annotations

from typing import Annotated

from langchain_core.tools import tool

from tradingagents.dataflows.interface import route_to_vendor


@tool
def get_crypto_ohlcv(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
    start_date: Annotated[str, "Start date in yyyy-mm-dd format"],
    end_date: Annotated[str, "End date in yyyy-mm-dd format"],
) -> str:
    """Retrieve daily OHLCV price data for a crypto pair from the configured exchange.

    Returns a CSV string with columns: timestamp, Open, High, Low, Close, Volume.
    """
    return route_to_vendor("get_crypto_ohlcv", symbol, start_date, end_date)


@tool
def get_crypto_ticker(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
) -> str:
    """Get a 24-hour ticker snapshot: last price, bid/ask, high/low, volume, % change."""
    return route_to_vendor("get_crypto_ticker", symbol)


@tool
def get_crypto_funding_rate(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
) -> str:
    """Get the current perpetual futures funding rate and next funding timestamp.

    A positive funding rate means longs pay shorts; negative means shorts pay longs.
    Extreme funding rates can signal overcrowded positioning.
    """
    return route_to_vendor("get_crypto_funding_rate", symbol)


@tool
def get_crypto_open_interest(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
) -> str:
    """Get the current open interest in the pair's futures market.

    Rising open interest alongside rising price confirms trend strength.
    Divergences between price and open interest can signal trend exhaustion.
    """
    return route_to_vendor("get_crypto_open_interest", symbol)


@tool
def get_crypto_liquidations(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
) -> str:
    """Get recent liquidation orders for a crypto futures pair.

    High liquidation volumes indicate forced position closures — long
    liquidations can signal cascading downside; short liquidations can
    signal a short squeeze.
    """
    return route_to_vendor("get_crypto_liquidations", symbol)


@tool
def get_crypto_long_short_ratio(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
) -> str:
    """Get the current long/short position ratio for a futures pair.

    Ratio > 1 = majority long (bullish but possibly crowded).
    Ratio < 1 = majority short (bearish but possibly squeeze-prone).
    Extreme readings often precede reversals.
    """
    return route_to_vendor("get_crypto_long_short_ratio", symbol)


@tool
def get_crypto_nvt(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
) -> str:
    """Estimate a valuation/liquidity proxy for a crypto asset.

    Uses CoinGecko market cap divided by exchange-reported 24h volume. This is
    not true on-chain NVT because it does not use network transaction volume.
    """
    return route_to_vendor("get_crypto_nvt", symbol)


@tool
def get_crypto_supply(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
) -> str:
    """Fetch circulating supply, total supply, max supply, and FDV/MC ratio.

    High FDV/MC ratio (> 5x) signals significant future dilution from
    token unlocks. Low ratio means most supply is already circulating. Burns
    reduce supply; they do not mint new tokens.
    """
    return route_to_vendor("get_crypto_supply", symbol)


@tool
def get_crypto_exchange_metrics(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
) -> str:
    """Fetch exchange volume/liquidity proxy metrics.

    High turnover can indicate speculative trading. Low turnover can indicate
    weak participation or a quiet tape; it is not accumulation by itself.
    """
    return route_to_vendor("get_crypto_exchange_metrics", symbol)


@tool
def get_crypto_funding_rate_history(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
    days: Annotated[int, "Number of days of history (default 30, max 90)"] = 30,
) -> str:
    """Fetch historical funding rates for a crypto pair as a structured CSV timeseries.

    Returns CSV with columns ``timestamp, fundingRate``.  Used by the quantitative
    signal engine to compute funding rate trend, percentile ranking, and extreme
    duration — not for direct AI reading (use ``get_crypto_funding_rate`` for
    human-readable snapshots).
    """
    return route_to_vendor("get_crypto_funding_rate_history", symbol, min(days, 90))


@tool
def get_crypto_open_interest_history(
    symbol: Annotated[str, "Trading pair symbol, e.g. BTC/USDT, ETH/USDT"],
    days: Annotated[int, "Number of days of history (default 30, max 90)"] = 30,
) -> str:
    """Fetch historical open interest for a crypto pair as a structured CSV timeseries.

    Returns CSV with columns ``timestamp, openInterestAmount, openInterestValue``
    at daily resolution.  Used by the quantitative signal engine to compute OI
    delta and OI/price divergence — not for direct AI reading.
    """
    return route_to_vendor("get_crypto_open_interest_history", symbol, min(days, 90))
