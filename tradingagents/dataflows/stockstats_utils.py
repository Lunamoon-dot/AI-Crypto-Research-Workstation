import logging

import pandas as pd
from stockstats import wrap
from typing import Annotated
import os
from .config import get_config

logger = logging.getLogger(__name__)


def _clean_dataframe(data: pd.DataFrame) -> pd.DataFrame:
    """Normalize a DataFrame for stockstats: parse dates, drop invalid rows, fill price gaps."""
    data["Date"] = pd.to_datetime(data["Date"], errors="coerce")
    data = data.dropna(subset=["Date"])

    price_cols = [c for c in ["Open", "High", "Low", "Close", "Volume"] if c in data.columns]
    data[price_cols] = data[price_cols].apply(pd.to_numeric, errors="coerce")
    data = data.dropna(subset=["Close"])
    data[price_cols] = data[price_cols].ffill().bfill()

    return data


def _load_ohlcv_crypto(symbol: str, curr_date: str, config: dict) -> pd.DataFrame:
    """Fetch crypto OHLCV data via CCXT with caching.

    Returns a DataFrame with columns ``Date, Open, High, Low, Close, Volume``
    matching the yfinance convention so that ``stockstats.wrap()`` works
    unchanged.
    """
    from io import StringIO
    from .ccxt_provider import get_crypto_ohlcv

    safe_symbol = symbol.replace("/", "_")

    curr_date_dt = pd.to_datetime(curr_date)
    today_date = pd.Timestamp.today()
    start_date = today_date - pd.DateOffset(years=5)

    os.makedirs(config["data_cache_dir"], exist_ok=True)
    data_file = os.path.join(
        config["data_cache_dir"],
        f"{safe_symbol}-CCXT-data-{start_date.strftime('%Y-%m-%d')}-{today_date.strftime('%Y-%m-%d')}.csv",
    )

    if os.path.exists(data_file):
        data = pd.read_csv(data_file, on_bad_lines="skip", encoding="utf-8")
    else:
        csv_str = get_crypto_ohlcv(
            symbol,
            start_date.strftime("%Y-%m-%d"),
            today_date.strftime("%Y-%m-%d"),
        )
        data = pd.read_csv(StringIO(csv_str))
        # Rename the index column (timestamp) to Date for stockstats compat
        data.rename(columns={"timestamp": "Date"}, inplace=True)
        data.to_csv(data_file, index=False, encoding="utf-8")

    data = _clean_dataframe(data)

    # Strip timezone so comparisons with tz-naive curr_date_dt work
    if data["Date"].dt.tz is not None:
        data["Date"] = data["Date"].dt.tz_localize(None)

    data = data[data["Date"] <= curr_date_dt]

    return data


def load_ohlcv(symbol: str, curr_date: str) -> pd.DataFrame:
    """Fetch crypto OHLCV data via CCXT with caching, filtered to prevent look-ahead bias.

    Rows after *curr_date* are filtered out so backtests never see future prices.
    """
    config = get_config()
    return _load_ohlcv_crypto(symbol, curr_date, config)


# Map common LLM-generated abbreviations to stockstats-compatible names.
INDICATOR_ALIASES = {
    "bb": "boll",
    "bbands": "boll",
    "bollinger": "boll",
    "bollinger_bands": "boll",
    "sma": "close_20_sma",
    "ema": "close_20_ema",
    "vwap": "vwma",
    "rsi": "rsi_14",
    "macd": "macd",
    "atr": "atr_14",
    "mfi": "mfi_14",
    "cci": "cci_14",
    "stoch": "kdjk",
    "stochastic": "kdjk",
    "adx": "adx",
    "dmi": "adx",
}


class StockstatsUtils:
    @staticmethod
    def get_stock_stats(
        symbol: Annotated[str, "trading pair (e.g. BTC/USDT)"],
        indicator: Annotated[
            str, "stockstats indicator name (e.g. rsi_14, macd, boll)"
        ],
        curr_date: Annotated[
            str, "current date for retrieving price data, YYYY-mm-dd"
        ],
    ):
        data = load_ohlcv(symbol, curr_date)
        df = wrap(data)
        df["Date"] = df["Date"].dt.strftime("%Y-%m-%d")
        curr_date_str = pd.to_datetime(curr_date).strftime("%Y-%m-%d")

        # Resolve common LLM abbreviations before hitting stockstats
        resolved = INDICATOR_ALIASES.get(indicator.lower(), indicator)
        try:
            df[resolved]  # trigger stockstats to calculate the indicator
        except Exception as e:
            known = sorted(set(INDICATOR_ALIASES.values()))
            raise RuntimeError(
                f"Indicator '{indicator}' unavailable: {e}. "
                f"Supported stockstats names include: {', '.join(known[:12])}"
            ) from None
        matching_rows = df[df["Date"].str.startswith(curr_date_str)]

        if not matching_rows.empty:
            indicator_value = matching_rows[resolved].values[0]
            return indicator_value
        else:
            return "N/A: Not a trading day (weekend or holiday)"
