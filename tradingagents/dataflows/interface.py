import logging
from time import perf_counter
from typing import Annotated

# Import from vendor-specific modules
from .ccxt_provider import (
    get_crypto_ohlcv as get_ccxt_crypto_ohlcv,
    get_crypto_ticker as get_ccxt_crypto_ticker,
    get_crypto_funding_rate as get_ccxt_crypto_funding_rate,
    get_crypto_open_interest as get_ccxt_crypto_open_interest,
    get_crypto_funding_rate_history as get_ccxt_crypto_funding_rate_history,
    get_crypto_open_interest_history as get_ccxt_crypto_open_interest_history,
)
from .onchain_provider import (
    fetch_liquidations as get_ccxt_liquidations,
    fetch_long_short_ratio as get_ccxt_long_short_ratio,
    fetch_nvt_approximation as get_coingecko_nvt,
    fetch_token_supply_metrics as get_coingecko_supply,
    fetch_exchange_reserves as get_coingecko_reserves,
)
from .stockstats_utils import StockstatsUtils

# Configuration and routing logic
from .config import get_config
from tradingagents.observability import log_event


logger = logging.getLogger(__name__)


# -- thin wrappers that keep the VENDOR_METHODS pattern working ----------

def _get_indicators_ccxt(
    symbol: str, indicator: str, curr_date: str, look_back_days: int = 30,
) -> str:
    """Compute a technical indicator from CCXT-sourced OHLCV data."""
    return str(StockstatsUtils.get_stock_stats(
        symbol, indicator, curr_date,
    ))


def _get_news_crypto(
    ticker: str, start_date: str = "", end_date: str = "",
) -> str:
    """Placeholder crypto news — returns a note that crypto news is pending.

    TODO: integrate Cryptopanic API or similar crypto-native news source.
    """
    return (
        f"Crypto News for {ticker} ({start_date} → {end_date})\n"
        f"{'=' * 50}\n\n"
        f"Crypto-specific news source is not yet configured. The AI analyst "
        f"should rely on sentiment data (Fear & Greed Index, social sentiment, "
        f"news sentiment aggregation) and on-chain metrics for context.\n\n"
        f"To enable news: configure a Cryptopanic API key or add a "
        f"CryptoPanic provider in tradingagents/dataflows/.\n"
    )


def _get_global_news_crypto(
    curr_date: str, look_back_days: int = 7, limit: int = 5,
) -> str:
    """Placeholder global crypto news."""
    return (
        f"Global Crypto News (last {look_back_days} days)\n"
        f"{'=' * 50}\n\n"
        f"Global crypto news source is not yet configured. Use sentiment "
        f"indicators (Fear & Greed, social sentiment) for macro mood.\n"
    )


# ---------------------------------------------------------------------------
# Tool categories
# ---------------------------------------------------------------------------

TOOLS_CATEGORIES = {
    "technical_indicators": {
        "description": "Technical analysis indicators",
        "tools": ["get_indicators"],
    },
    "news_data": {
        "description": "News and macro data",
        "tools": [
            "get_news",
            "get_global_news",
        ],
    },
    "crypto_ohlcv": {
        "description": "Crypto OHLCV price data",
        "tools": ["get_crypto_ohlcv"],
    },
    "crypto_onchain": {
        "description": "Crypto market data (funding rate, OI, ticker, liquidations, L/S ratio)",
        "tools": [
            "get_crypto_ticker",
            "get_crypto_funding_rate",
            "get_crypto_open_interest",
            "get_crypto_funding_rate_history",
            "get_crypto_open_interest_history",
            "get_crypto_liquidations",
            "get_crypto_long_short_ratio",
            "get_crypto_nvt",
            "get_crypto_supply",
            "get_crypto_exchange_metrics",
        ],
    },
}

VENDOR_LIST = [
    "ccxt",
    "coingecko",
]

# Mapping of methods to their vendor-specific implementations
VENDOR_METHODS = {
    # technical_indicators
    "get_indicators": {
        "ccxt": _get_indicators_ccxt,
    },
    # news_data
    "get_news": {
        "ccxt": _get_news_crypto,
    },
    "get_global_news": {
        "ccxt": _get_global_news_crypto,
    },
    # crypto_ohlcv
    "get_crypto_ohlcv": {
        "ccxt": get_ccxt_crypto_ohlcv,
    },
    # crypto_onchain
    "get_crypto_ticker": {
        "ccxt": get_ccxt_crypto_ticker,
    },
    "get_crypto_funding_rate": {
        "ccxt": get_ccxt_crypto_funding_rate,
    },
    "get_crypto_funding_rate_history": {
        "ccxt": get_ccxt_crypto_funding_rate_history,
    },
    "get_crypto_open_interest": {
        "ccxt": get_ccxt_crypto_open_interest,
    },
    "get_crypto_open_interest_history": {
        "ccxt": get_ccxt_crypto_open_interest_history,
    },
    "get_crypto_liquidations": {
        "ccxt": get_ccxt_liquidations,
    },
    "get_crypto_long_short_ratio": {
        "ccxt": get_ccxt_long_short_ratio,
    },
    "get_crypto_nvt": {
        "coingecko": get_coingecko_nvt,
    },
    "get_crypto_supply": {
        "coingecko": get_coingecko_supply,
    },
    "get_crypto_exchange_metrics": {
        "coingecko": get_coingecko_reserves,
    },
}


def get_category_for_method(method: str) -> str:
    """Get the category that contains the specified method."""
    for category, info in TOOLS_CATEGORIES.items():
        if method in info["tools"]:
            return category
    raise ValueError(f"Method '{method}' not found in any category")


def get_vendor(category: str, method: str = None) -> str:
    """Get the configured vendor for a data category or specific tool method.
    Tool-level configuration takes precedence over category-level.
    """
    config = get_config()

    # Check tool-level configuration first (if method provided)
    if method:
        tool_vendors = config.get("tool_vendors", {})
        if method in tool_vendors:
            return tool_vendors[method]

    # Fall back to category-level configuration
    return config.get("data_vendors", {}).get(category, "default")


def route_to_vendor(method: str, *args, **kwargs):
    """Route method calls to appropriate vendor implementation with fallback support."""
    category = get_category_for_method(method)
    vendor_config = get_vendor(category, method)
    primary_vendors = [v.strip() for v in vendor_config.split(',')]

    if method not in VENDOR_METHODS:
        raise ValueError(f"Method '{method}' not supported")

    # Build fallback chain: primary vendors first, then remaining available vendors
    all_available_vendors = list(VENDOR_METHODS[method].keys())
    fallback_vendors = primary_vendors.copy()
    for vendor in all_available_vendors:
        if vendor not in fallback_vendors:
            fallback_vendors.append(vendor)

    last_error = None
    for vendor in fallback_vendors:
        if vendor not in VENDOR_METHODS[method]:
            continue

        impl_func = VENDOR_METHODS[method][vendor]
        started = perf_counter()

        try:
            result = impl_func(*args, **kwargs)
            log_event(
                logger,
                "data_provider_call",
                method=method,
                category=category,
                vendor=vendor,
                status="success",
                duration_ms=round((perf_counter() - started) * 1000, 2),
            )
            return result
        except Exception as exc:
            last_error = exc
            logger.warning(
                "Vendor '%s' failed for method '%s': %s",
                vendor, method, exc,
            )
            log_event(
                logger,
                "data_provider_call",
                level=logging.WARNING,
                method=method,
                category=category,
                vendor=vendor,
                status="failed",
                duration_ms=round((perf_counter() - started) * 1000, 2),
                error_type=type(exc).__name__,
                error=str(exc),
            )
            continue  # try next vendor on any error

    detail = f"{last_error}" if last_error else "no vendor configured"
    raise RuntimeError(f"No available vendor for '{method}': {detail}")
