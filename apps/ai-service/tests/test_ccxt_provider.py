from __future__ import annotations

from datetime import datetime, timezone
from io import StringIO

import pandas as pd

from luna_workstation.dataflows import ccxt_provider


def _ms(day: str) -> int:
    return int(
        datetime.fromisoformat(day).replace(tzinfo=timezone.utc).timestamp() * 1000
    )


class _FakeExchange:
    id = "fake"

    def __init__(self, candles, markets=None):
        self.candles = candles
        self.markets = markets or {"BTC/USDT": {}}
        self.calls = []

    def fetch_ohlcv(self, symbol, timeframe="1d", since=None, limit=None):
        self.calls.append(
            {
                "symbol": symbol,
                "timeframe": timeframe,
                "since": since,
                "limit": limit,
            }
        )
        eligible = [candle for candle in self.candles if candle[0] >= since]
        return eligible[:limit]


def test_ccxt_ohlcv_paginates_and_filters_after_end_date(monkeypatch):
    candles = [
        [_ms("2026-01-01"), 1, 2, 0.5, 1.5, 10],
        [_ms("2026-01-02"), 2, 3, 1.5, 2.5, 11],
        [_ms("2026-01-03"), 3, 4, 2.5, 3.5, 12],
        [_ms("2026-01-04"), 4, 5, 3.5, 4.5, 13],
        [_ms("2026-01-05"), 5, 6, 4.5, 5.5, 14],
        [_ms("2026-01-06"), 6, 7, 5.5, 6.5, 15],
    ]
    exchange = _FakeExchange(candles)
    monkeypatch.setattr(ccxt_provider, "_OHLCV_FETCH_LIMIT", 2)
    monkeypatch.setattr(ccxt_provider, "_get_configured_exchange", lambda: exchange)

    csv_data = ccxt_provider.get_crypto_ohlcv(
        "BTC/USDT",
        "2026-01-01",
        "2026-01-05",
    )

    df = pd.read_csv(StringIO(csv_data), parse_dates=["Date"])
    assert len(exchange.calls) >= 3
    assert df["Date"].dt.date.min().isoformat() == "2026-01-01"
    assert df["Date"].dt.date.max().isoformat() == "2026-01-05"
    assert "2026-01-06" not in {day.isoformat() for day in df["Date"].dt.date}


def test_ccxt_ohlcv_accepts_iso_timezone_dates(monkeypatch):
    candles = [
        [_ms("2026-01-01"), 1, 2, 0.5, 1.5, 10],
        [_ms("2026-01-02"), 2, 3, 1.5, 2.5, 11],
        [_ms("2026-01-03"), 3, 4, 2.5, 3.5, 12],
        [_ms("2026-01-04"), 4, 5, 3.5, 4.5, 13],
    ]
    exchange = _FakeExchange(candles)
    monkeypatch.setattr(ccxt_provider, "_get_configured_exchange", lambda: exchange)

    csv_data = ccxt_provider.get_crypto_ohlcv(
        "BTC/USDT",
        "2026-01-01T08:30:00+07:00",
        "2026-01-03T23:59:59+07:00",
    )

    df = pd.read_csv(StringIO(csv_data), parse_dates=["Date"])
    assert exchange.calls[0]["since"] == _ms("2026-01-01")
    assert [day.isoformat() for day in df["Date"].dt.date] == [
        "2026-01-01",
        "2026-01-02",
        "2026-01-03",
    ]


def test_ccxt_symbol_normalization_repairs_missing_usdt_prefix(monkeypatch):
    candles = [
        [_ms("2026-01-01"), 1, 2, 0.5, 1.5, 10],
        [_ms("2026-01-02"), 2, 3, 1.5, 2.5, 11],
    ]
    exchange = _FakeExchange(candles, markets={"ETH/USDT": {}})
    monkeypatch.setattr(ccxt_provider, "_get_configured_exchange", lambda: exchange)

    ccxt_provider.get_crypto_ohlcv("ETHDT", "2026-01-01", "2026-01-02")

    assert exchange.calls[0]["symbol"] == "ETH/USDT"
