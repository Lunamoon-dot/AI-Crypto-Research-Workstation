"""Symbol normalization helpers."""

from __future__ import annotations


def normalize_ticker_symbol(ticker: str) -> str:
    """Normalize ticker input while preserving exchange suffixes."""
    return ticker.strip().upper()


__all__ = ["normalize_ticker_symbol"]
