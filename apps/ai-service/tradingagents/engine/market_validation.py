"""Market-data validation helpers for the worker boundary."""

from __future__ import annotations

import csv
import io
import os
from datetime import date, timedelta
from typing import Any

from tradingagents.config.loader import ConfigLoader
from tradingagents.dataflows.config import config_context
from tradingagents.dataflows.ccxt_provider import (
    _get_configured_exchange,
    _normalize_symbol,
)
from tradingagents.dataflows.interface import route_to_vendor
from tradingagents.engine.schemas import normalize_crypto_symbol
from tradingagents.exceptions import ErrorCategory, classify_error


def validate_market_data(
    *,
    symbol: str,
    analysis_date: str,
    asset_class: str = "crypto",
    market_type: str = "spot",
    exchange: str | None = None,
    profile: str | None = None,
) -> dict[str, Any]:
    """Check that market data exists before a research job is queued."""
    normalized_asset = str(asset_class or "crypto").strip().lower()
    if normalized_asset != "crypto":
        return {
            "available": True,
            "symbol": symbol,
            "asset_class": normalized_asset,
            "message": "Non-crypto market validation is not required.",
        }

    canonical_symbol = normalize_crypto_symbol(symbol)
    target_date = _parse_date(analysis_date)
    start_date = target_date - timedelta(days=90)
    config = _load_validation_config(
        asset_class=normalized_asset,
        market_type=market_type,
        exchange=exchange,
        profile=profile,
    )

    try:
        with config_context(config):
            exchange_client = _get_configured_exchange()
            canonical_symbol = _normalize_symbol(canonical_symbol, exchange_client)
            _assert_market_active(exchange_client, canonical_symbol)

            if _require_ohlcv_validation():
                ohlcv_csv = route_to_vendor(
                    "get_crypto_ohlcv",
                    canonical_symbol,
                    start_date.isoformat(),
                    target_date.isoformat(),
                )
                candle_count = _count_candles(ohlcv_csv)
                if candle_count <= 0:
                    return _unavailable(
                        canonical_symbol,
                        config,
                        start_date,
                        target_date,
                        "No OHLCV candles were returned for this symbol/date range.",
                        retryable=False,
                        error_type="EmptyMarketData",
                    )
                return {
                    "available": True,
                    "symbol": canonical_symbol,
                    "asset_class": normalized_asset,
                    "market_type": market_type,
                    "exchange": config.get("crypto_exchange"),
                    "window_start": start_date.isoformat(),
                    "window_end": target_date.isoformat(),
                    "candle_count": candle_count,
                    "validation_method": "market_catalog+ohlcv",
                    "message": (
                        f"Market data is available for {canonical_symbol} "
                        f"({candle_count} daily candles)."
                    ),
                }
        return {
            "available": True,
            "symbol": canonical_symbol,
            "asset_class": normalized_asset,
            "market_type": market_type,
            "exchange": config.get("crypto_exchange"),
            "validation_method": "market_catalog",
            "message": (
                f"{canonical_symbol} is listed on {config.get('crypto_exchange')}."
            ),
        }
    except Exception as exc:
        classification = classify_error(exc)
        return _unavailable(
            canonical_symbol,
            config,
            start_date,
            target_date,
            str(exc),
            retryable=_is_retryable_validation_error(exc, classification.category),
            error_type=classification.error_type,
        )


def _load_validation_config(
    *,
    asset_class: str,
    market_type: str,
    exchange: str | None,
    profile: str | None,
) -> dict[str, Any]:
    overrides: dict[str, Any] = {
        "asset_class": asset_class,
        "market_type": market_type,
        "config_validation": {"validate_llm_keys": False},
        "provider_runtime": {
            "enabled": True,
            "timeout_sec": _float_env("MARKET_DATA_GUARD_PROVIDER_TIMEOUT_SEC", 20.0),
            "retries": _int_env("MARKET_DATA_GUARD_PROVIDER_RETRIES", 0),
        },
    }
    if exchange:
        overrides["crypto_exchange"] = exchange
    selected_profile = (profile or "").strip()
    if selected_profile.lower() == "default":
        selected_profile = ""
    return ConfigLoader().load(
        profile=selected_profile or None,
        cli_overrides=overrides,
        fail_fast=False,
    )


def _parse_date(value: str) -> date:
    try:
        return date.fromisoformat(str(value).strip())
    except ValueError as exc:
        raise ValueError(f"analysis_date must use YYYY-MM-DD: {value!r}") from exc


def _count_candles(ohlcv_csv: str) -> int:
    reader = csv.DictReader(io.StringIO(ohlcv_csv or ""))
    return sum(1 for row in reader if row)


def _assert_market_active(exchange, symbol: str) -> None:
    market = exchange.markets.get(symbol)
    if not market:
        raise ValueError(f"Symbol '{symbol}' not found on {exchange.id}.")
    if market.get("active") is False:
        raise ValueError(f"Symbol '{symbol}' is not active on {exchange.id}.")


def _require_ohlcv_validation() -> bool:
    return str(os.getenv("MARKET_DATA_GUARD_REQUIRE_OHLCV", "")).strip().lower() in {
        "1",
        "true",
        "yes",
    }


def _is_retryable_validation_error(
    exc: Exception,
    category: ErrorCategory,
) -> bool:
    if category is ErrorCategory.TRANSIENT_PROVIDER:
        return True
    message = str(exc).lower()
    return "timed out" in message or "rate limit" in message


def _unavailable(
    symbol: str,
    config: dict[str, Any],
    start_date: date,
    target_date: date,
    reason: str,
    *,
    retryable: bool,
    error_type: str,
) -> dict[str, Any]:
    exchange = config.get("crypto_exchange")
    return {
        "available": False,
        "symbol": symbol,
        "exchange": exchange,
        "window_start": start_date.isoformat(),
        "window_end": target_date.isoformat(),
        "retryable": retryable,
        "error_type": error_type,
        "reason": reason,
        "message": (
            f"Market data unavailable for {symbol} on {exchange}: {reason}. "
            "Research was not queued."
        ),
    }


def _float_env(name: str, default: float) -> float:
    try:
        value = float(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value > 0 else default


def _int_env(name: str, default: int) -> int:
    try:
        value = int(os.getenv(name, ""))
    except ValueError:
        return default
    return value if value >= 0 else default
