"""Crypto data vendor via CCXT.

Supports 100+ exchanges (Binance, Bybit, OKX, Coinbase, Kraken).
Each function matches the signature convention expected by
``VENDOR_METHODS`` in ``interface.py`` so ``route_to_vendor``
can dispatch here as if the provider were just another vendor.
"""

from __future__ import annotations

import functools
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import pandas as pd

from tradingagents.exceptions import RateLimitError

from .config import get_config

logger = logging.getLogger(__name__)


def _reraise_rate_limit(exc: Exception, vendor: str) -> None:
    """Re-raise CCXT rate-limit exceptions as :exc:`RateLimitError`.

    CCXT raises ``RateLimitExceeded`` (a subclass of ``DDoSProtection``)
    when an exchange returns HTTP 429 or a rate-limit header.  We convert
    those so the resilience wrapper in ``interface.py`` can retry with
    backoff, while other errors keep their existing fallback behaviour.
    """
    name = type(exc).__name__
    if name in ("RateLimitExceeded", "DDoSProtection"):
        raise RateLimitError(f"{vendor} rate limited: {exc}") from exc


# Canonical quote currency we normalise to when the user passes a bare
# pair like "BTC" or "BTC-USD".
_DEFAULT_QUOTE = "USDT"

# Mapping from common informal pair delimiters to the CCXT "/".
_DELIMITERS = {"-": "/", "_": "/", ":": "/"}


# ---------------------------------------------------------------------------
# Symbol normalisation
# ---------------------------------------------------------------------------


def _normalize_symbol(symbol: str, exchange) -> str:
    """Convert a user-supplied symbol to the format the exchange expects.

    Handles:
    - ``BTC/USDT`` → passed through (already canonical)
    - ``BTC-USD`` → ``BTC/USDT`` (dash, quote-currency mapping)
    - ``BTCUSDT``  → ``BTC/USDT`` (concatenated, split on known quotes)
    - ``BTC``      → ``BTC/USDT`` (single token, append default quote)
    """
    symbol = symbol.strip()

    # Already canonical (contains "/")
    if "/" in symbol:
        if symbol in exchange.markets:
            return symbol
        # Try case-insensitive
        for mkt in exchange.markets:
            if mkt.upper() == symbol.upper():
                return mkt
        raise ValueError(
            f"Symbol '{symbol}' not found on {exchange.id}. "
            f"Available pairs with this base: "
            f"{[m for m in exchange.markets if symbol.split('/')[0].upper() in m.upper()][:5]}"
        )

    # Concatenated form: "BTCUSDT" → try splitting on known quotes
    for quote in ["USDT", "USDC", "BUSD", "USD", "BTC", "ETH"]:
        if symbol.upper().endswith(quote) and len(symbol) > len(quote):
            base = symbol[: -len(quote)]
            candidate = f"{base.upper()}/{quote}"
            if candidate in exchange.markets:
                return candidate

    # Dash/underscore/colon-delimited form: "BTC-USD"
    for delim, replacement in _DELIMITERS.items():
        if delim in symbol:
            base, quote = symbol.split(delim, 1)
            # Map common quote aliases
            quote = _map_quote(quote)
            candidate = f"{base.upper()}/{quote}"
            if candidate in exchange.markets:
                return candidate
            # Also try the raw quote
            candidate_raw = f"{base.upper()}/{quote.upper()}"
            if candidate_raw in exchange.markets:
                return candidate_raw

    # Single token: "BTC" → "BTC/USDT"
    candidate = f"{symbol.upper()}/{_DEFAULT_QUOTE}"
    if candidate in exchange.markets:
        return candidate

    # Last resort: fuzzy search
    markets_upper = {m.upper(): m for m in exchange.markets}
    symbol_upper = symbol.upper()
    for mkt_upper, mkt in markets_upper.items():
        if mkt_upper.startswith(symbol_upper):
            return mkt

    raise ValueError(
        f"Could not find a pair matching '{symbol}' on {exchange.id}. "
        f"Try using the canonical format, e.g. 'BTC/USDT'."
    )


def _map_quote(quote: str) -> str:
    """Map common quote currency aliases to their canonical form."""
    alias_map = {
        "USD": "USDT",
        "USDC": "USDC",
        "BUSD": "BUSD",
        "BTC": "BTC",
        "ETH": "ETH",
    }
    return alias_map.get(quote.upper(), quote.upper())


# ---------------------------------------------------------------------------
# Lazy exchange loader
# ---------------------------------------------------------------------------


@functools.lru_cache(maxsize=4)
def _get_exchange(exchange_id: str):
    """Return a configured CCXT exchange instance (cached per exchange id)."""
    import ccxt

    exchange_class = getattr(ccxt, exchange_id)
    exchange = exchange_class({"enableRateLimit": True})
    exchange.load_markets()
    logger.info("CCXT %s loaded — %d markets", exchange_id, len(exchange.markets))
    return exchange


def _get_configured_exchange():
    """Get the exchange from config."""
    config = get_config()
    exchange_id = config.get("crypto_exchange", "binance")
    return _get_exchange(exchange_id)


# ---------------------------------------------------------------------------
# OHLCV data
# ---------------------------------------------------------------------------


def _get_crypto_ohlcv_df(
    symbol: str,
    start_date: str,
    end_date: str,
) -> "pd.DataFrame":
    """Fetch OHLCV price data for a crypto pair, returning a DataFrame.

    Internal helper — callers that need structured data should use this
    instead of the CSV-returning ``get_crypto_ohlcv``.
    """
    exchange = _get_configured_exchange()
    symbol = _normalize_symbol(symbol, exchange)

    since = exchange.parse8601(start_date + "T00:00:00Z")
    raw = exchange.fetch_ohlcv(symbol, timeframe="1d", since=since, limit=365 * 2)

    df = pd.DataFrame(
        raw, columns=["timestamp", "open", "high", "low", "close", "volume"]
    )
    if not df.empty:
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
        df.columns = ["Date", "Open", "High", "Low", "Close", "Volume"]
    return df


def get_crypto_ohlcv(
    symbol: str,
    start_date: str,
    end_date: str,
) -> str:
    """Fetch daily OHLCV candles for a crypto pair.

    Returns a CSV string matching the format produced by
    ``get_YFin_data_online`` so downstream consumers (particularly
    ``stockstats``) can read the result unchanged.
    Prefer ``_get_crypto_ohlcv_df`` when you need a DataFrame directly.
    """
    df = _get_crypto_ohlcv_df(symbol, start_date, end_date)
    return df.to_csv(index=False)
    """

    # Fetch candles — CCXT returns list of [ts, open, high, low, close, volume]
    all_candles: list = []
    fetch_since = since
    limit = 1000
    while True:
        candles = exchange.fetch_ohlcv(
            symbol, timeframe="1d", since=fetch_since, limit=limit
        )
        if not candles or len(candles) == 0:
            break
        all_candles.extend(candles)
        last_ts = candles[-1][0]
        if last_ts >= end_ms or len(candles) < limit:
            break
        fetch_since = last_ts + 1  # advance past last candle

    if not all_candles:
        raise ValueError(
            f"No OHLCV data returned for {symbol} from {start_date} to {end_date}. "
            "The pair may not exist on this exchange or the date range may be too old."
        )

    # Build DataFrame
    df = pd.DataFrame(
        all_candles,
        columns=["timestamp", "Open", "High", "Low", "Close", "Volume"],
    )
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df.set_index("timestamp", inplace=True)

    # Filter to requested date range
    df = df[
        (df.index >= pd.Timestamp(start_dt, tz=timezone.utc))
        & (df.index <= pd.Timestamp(end_dt, tz=timezone.utc))
    ]

    if df.empty:
        raise ValueError(
            f"No OHLCV data in range {start_date} → {end_date} for {symbol}"
        )

    return df.to_csv()
    """


# ---------------------------------------------------------------------------
# Ticker snapshot
# ---------------------------------------------------------------------------


def get_crypto_ticker(symbol: str) -> str:
    """Return a 24-hour ticker snapshot as a formatted string."""
    exchange = _get_configured_exchange()
    symbol = _normalize_symbol(symbol, exchange)

    ticker = exchange.fetch_ticker(symbol)

    lines = [
        f"=== {symbol} Ticker Snapshot ===",
        f"Last Price:     {ticker.get('last', 'N/A')}",
        f"Bid / Ask:      {ticker.get('bid', 'N/A')} / {ticker.get('ask', 'N/A')}",
        f"24h High / Low: {ticker.get('high', 'N/A')} / {ticker.get('low', 'N/A')}",
        f"24h Volume:     {ticker.get('baseVolume', ticker.get('quoteVolume', 'N/A'))}",
        f"24h Change:     {_pct(ticker.get('percentage', 0))}",
        f"Timestamp:      {ticker.get('datetime', 'N/A')}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Funding rate (perpetual futures)
# ---------------------------------------------------------------------------


def get_crypto_funding_rate(symbol: str) -> str:
    """Return the current perpetual funding rate for a pair."""
    exchange = _get_configured_exchange()
    symbol = _normalize_symbol(symbol, exchange)

    try:
        fr = exchange.fetch_funding_rate(symbol)
    except Exception as e:
        _reraise_rate_limit(e, exchange.id)
        # Try the linear perpetual form: "BTC/USDT:USDT"
        try:
            fr = exchange.fetch_funding_rate(f"{symbol}:{symbol.split('/')[1]}")
        except Exception as e2:
            _reraise_rate_limit(e2, exchange.id)
            return (
                f"Funding rate data is not available for {symbol} on {exchange.id}. "
                "This pair may not have a perpetual futures market."
            )

    lines = [
        f"=== {symbol} Funding Rate ===",
        f"Funding Rate:    {_pct(fr.get('fundingRate', 0))}",
        f"Next Funding:    {fr.get('nextFundingDatetime', fr.get('datetime', 'N/A'))}",
        f"Mark Price:      {fr.get('markPrice', 'N/A')}",
        f"Index Price:     {fr.get('indexPrice', 'N/A')}",
        f"Interest Rate:   {fr.get('interestRate', 'N/A')}",
    ]
    return "\n".join(lines)


def _pct(value: Optional[float]) -> str:
    """Format a decimal as a percentage string, robust to None."""
    if value is None:
        return "N/A"
    return f"{value:+.4%}"


# ---------------------------------------------------------------------------
# Open interest
# ---------------------------------------------------------------------------


def get_crypto_open_interest(symbol: str) -> str:
    """Return the current open interest for a pair's futures market."""
    exchange = _get_configured_exchange()
    symbol = _normalize_symbol(symbol, exchange)

    try:
        oi = exchange.fetch_open_interest(symbol)
    except Exception as e:
        _reraise_rate_limit(e, exchange.id)
        try:
            oi = exchange.fetch_open_interest(f"{symbol}:{symbol.split('/')[1]}")
        except Exception as e2:
            _reraise_rate_limit(e2, exchange.id)
            return (
                f"Open interest data is not available for {symbol} on {exchange.id}. "
                "This pair may not have a futures market with open interest reporting."
            )

    lines = [
        f"=== {symbol} Open Interest ===",
        f"Open Interest:   {oi.get('openInterestAmount', oi.get('openInterest', 'N/A'))}",
        f"Notional Value:  {oi.get('openInterestValue', 'N/A')}",
        f"Timestamp:       {oi.get('datetime', 'N/A')}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Funding rate *history* — timeseries for quant signal engine
# ---------------------------------------------------------------------------


def get_crypto_funding_rate_history(
    symbol: str,
    days: int = 30,
) -> str:
    """Fetch historical funding rates as a structured CSV timeseries.

    Returns a CSV with columns ``timestamp, fundingRate`` covering the
    last *days* calendar days.  Unlike ``get_crypto_funding_rate`` (which
    returns a formatted snapshot for AI reading), this is designed as
    input for the deterministic ``SignalEngine``.

    Uses CCXT ``fetch_funding_rate_history`` (Binance, Bybit, OKX, Bitget).
    Raises ``ValueError`` when the exchange does not support history.
    """
    exchange = _get_configured_exchange()
    symbol = _normalize_symbol(symbol, exchange)

    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    since_ms = exchange.parse8601(since_dt.strftime("%Y-%m-%dT%H:%M:%SZ"))
    limit = min(days * 3, 1000)  # funding settles every 8h → ~3 events/day

    raw = _fetch_funding_history_inner(exchange, symbol, since_ms, limit)

    if not raw:
        raise ValueError(
            f"No funding rate history returned for {symbol} on {exchange.id}. "
            f"Either the pair lacks a perpetual market or the exchange does not "
            f"expose historical funding data."
        )

    # Normalize to DataFrame
    df = _funding_history_to_df(raw)

    if df.empty:
        raise ValueError(
            f"Funding rate history empty after normalisation for {symbol}."
        )

    return df.to_csv(index=False)


def _fetch_funding_history_inner(
    exchange, symbol: str, since_ms: int, limit: int
) -> list | None:
    """Try to fetch funding rate history; fall back to linear perp format."""
    try:
        return exchange.fetch_funding_rate_history(
            symbol,
            since=since_ms,
            limit=limit,
        )
    except Exception as e:
        _reraise_rate_limit(e, exchange.id)

    # Retry with linear perpetual form: "BTC/USDT:USDT"
    try:
        quote = symbol.split("/")[1]
        linear = f"{symbol}:{quote}"
        return exchange.fetch_funding_rate_history(
            linear,
            since=since_ms,
            limit=limit,
        )
    except Exception as e2:
        _reraise_rate_limit(e2, exchange.id)

    return None


def _funding_history_to_df(raw: list) -> "pd.DataFrame":
    """Normalise the varied key names CCXT exchanges return into a standard DataFrame."""
    records = []
    for entry in raw:
        ts = entry.get("timestamp") or entry.get("fundingTimestamp") or 0
        rate = (
            entry.get("fundingRate") or entry.get("funding_rate") or entry.get("rate")
        )
        if ts and rate is not None:
            records.append({"timestamp": int(ts), "fundingRate": float(rate)})
    if not records:
        return pd.DataFrame()
    df = pd.DataFrame(records)
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df.sort_values("timestamp", inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df[["timestamp", "fundingRate"]]


# ---------------------------------------------------------------------------
# Open Interest *history* — timeseries for quant signal engine
# ---------------------------------------------------------------------------


def get_crypto_open_interest_history(
    symbol: str,
    days: int = 30,
) -> str:
    """Fetch historical open interest as a structured CSV timeseries.

    Returns a CSV with columns ``timestamp, openInterestAmount, openInterestValue``
    at daily resolution.  Designed for the deterministic ``SignalEngine`` to
    compute OI delta and OI/price divergence.

    Uses CCXT ``fetch_open_interest_history`` (Binance, Bybit, OKX).
    Raises ``ValueError`` when the exchange does not support OI history.
    """
    exchange = _get_configured_exchange()
    symbol = _normalize_symbol(symbol, exchange)

    since_dt = datetime.now(timezone.utc) - timedelta(days=days)
    since_ms = exchange.parse8601(since_dt.strftime("%Y-%m-%dT%H:%M:%SZ"))
    limit = min(days * 2, 1000)  # daily resolution → ~1-2 events/day

    raw = _fetch_oi_history_inner(exchange, symbol, since_ms, limit)

    if not raw:
        raise ValueError(
            f"No open interest history returned for {symbol} on {exchange.id}. "
            f"Either the pair lacks a futures market or the exchange does not "
            f"expose historical OI data."
        )

    df = _oi_history_to_df(raw)

    if df.empty:
        raise ValueError(
            f"Open interest history empty after normalisation for {symbol}."
        )

    return df.to_csv(index=False)


def _fetch_oi_history_inner(
    exchange, symbol: str, since_ms: int, limit: int
) -> list | None:
    """Try to fetch OI history; fall back to linear perp format."""
    try:
        return exchange.fetch_open_interest_history(
            symbol,
            timeframe="1d",
            since=since_ms,
            limit=limit,
        )
    except Exception as e:
        _reraise_rate_limit(e, exchange.id)

    try:
        quote = symbol.split("/")[1]
        linear = f"{symbol}:{quote}"
        return exchange.fetch_open_interest_history(
            linear,
            timeframe="1d",
            since=since_ms,
            limit=limit,
        )
    except Exception as e2:
        _reraise_rate_limit(e2, exchange.id)

    return None


def _oi_history_to_df(raw: list) -> "pd.DataFrame":
    """Normalise CCXT OI history entries into a standard DataFrame."""
    records = []
    for entry in raw:
        ts = entry.get("timestamp") or 0
        amt = entry.get("openInterestAmount") or entry.get("openInterest") or 0
        val = entry.get("openInterestValue") or 0
        if ts:
            records.append(
                {
                    "timestamp": int(ts),
                    "openInterestAmount": float(amt),
                    "openInterestValue": float(val) if val else float("nan"),
                }
            )
    if not records:
        return pd.DataFrame()
    df = pd.DataFrame(records)
    df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms", utc=True)
    df.sort_values("timestamp", inplace=True)
    df.reset_index(drop=True, inplace=True)
    return df[["timestamp", "openInterestAmount", "openInterestValue"]]
