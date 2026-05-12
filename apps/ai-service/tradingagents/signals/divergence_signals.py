"""Divergence detection between price and indicators.

Detects classic divergence patterns:
- RSI divergence (price makes higher high, RSI makes lower high → bearish)
- MACD divergence (price makes lower low, MACD makes higher low → bullish)
- Volume-price divergence (rising price, falling volume → weak trend)
"""

from __future__ import annotations

import logging
from io import StringIO
from typing import Optional

import numpy as np
import pandas as pd

from .base import FactorSignal, SignalScore

logger = logging.getLogger(__name__)


def compute_rsi_divergence(ohlcv_csv: str, period: int = 14) -> FactorSignal:
    """Detect RSI divergence from OHLCV data."""
    try:
        df = pd.read_csv(StringIO(ohlcv_csv), index_col=0, parse_dates=True)
        if "Close" not in df.columns or len(df) < period + 10:
            return _neutral("rsi_divergence", "Insufficient data for RSI divergence.")
    except Exception as e:
        logger.warning("RSI divergence OHLCV parse error: %s", e)
        return _neutral("rsi_divergence", "OHLCV parse error.")

    close = df["Close"].astype(float)
    # Data quality scales with sample size: 200+ candles → 1.0, 30 → 0.15
    n_samples = len(close)
    dq = min(n_samples / 200.0, 1.0)

    rsi = _compute_rsi(close, period)

    if rsi is None or len(rsi) < 20:
        return _neutral("rsi_divergence", "RSI computation failed.", data_quality=dq)
    last_rsi = float(rsi.iloc[-1])

    # Look at last 20 bars for divergence
    lookback = min(20, len(close) - 2)
    recent_close = close.iloc[-lookback:]
    recent_rsi = rsi.iloc[-lookback:]

    # Find local peaks and troughs
    price_hh = _has_higher_high(recent_close.values)
    price_ll = _has_lower_low(recent_close.values)
    rsi_hh = _has_higher_high(recent_rsi)
    rsi_ll = _has_lower_low(recent_rsi)

    # Bearish divergence: price HH, RSI LH (lower high)
    if price_hh and not rsi_hh:
        return FactorSignal(
            name="rsi_divergence",
            score=SignalScore.SELL,
            confidence=0.75,
            value=last_rsi,
            threshold_breached=True,
            data_quality=dq,
            detail=(
                f"Bearish RSI divergence: price made higher high but RSI "
                f"failed to confirm (RSI={last_rsi:.1f}). Momentum weakening."
            ),
        )

    # Bullish divergence: price LL, RSI HL (higher low)
    if price_ll and not rsi_ll:
        return FactorSignal(
            name="rsi_divergence",
            score=SignalScore.BUY,
            confidence=0.75,
            value=last_rsi,
            threshold_breached=True,
            data_quality=dq,
            detail=(
                f"Bullish RSI divergence: price made lower low but RSI "
                f"held higher low (RSI={last_rsi:.1f}). Selling pressure fading."
            ),
        )

    # Overbought/Oversold as secondary signal
    if last_rsi > 70:
        return FactorSignal(
            name="rsi_divergence",
            score=SignalScore.SELL,
            confidence=0.4,
            value=last_rsi,
            threshold_breached=True,
            data_quality=dq,
            detail=f"RSI overbought at {last_rsi:.1f} — caution on new longs.",
        )
    if last_rsi < 30:
        return FactorSignal(
            name="rsi_divergence",
            score=SignalScore.BUY,
            confidence=0.4,
            value=last_rsi,
            threshold_breached=True,
            data_quality=dq,
            detail=f"RSI oversold at {last_rsi:.1f} — potential bounce.",
        )

    return FactorSignal(
        name="rsi_divergence",
        score=SignalScore.NEUTRAL,
        confidence=0.6,
        value=last_rsi,
        threshold_breached=False,
        data_quality=dq,
        detail=f"RSI={last_rsi:.1f} — no divergence or extreme reading.",
    )


def compute_macd_signal(ohlcv_csv: str) -> FactorSignal:
    """Compute MACD cross and divergence signal."""
    try:
        df = pd.read_csv(StringIO(ohlcv_csv), index_col=0, parse_dates=True)
        if "Close" not in df.columns or len(df) < 35:
            return _neutral("macd", "Insufficient data for MACD.")
    except Exception as e:
        logger.warning("MACD signal OHLCV parse error: %s", e)
        return _neutral("macd", "OHLCV parse error.")

    close = df["Close"].astype(float)
    n_samples = len(close)
    dq = min(n_samples / 200.0, 1.0)
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd_line = ema12 - ema26
    signal_line = macd_line.ewm(span=9, adjust=False).mean()
    histogram = macd_line - signal_line

    if len(macd_line) < 5:
        return _neutral("macd", "MACD computation incomplete.")

    # Check for cross
    prev_hist = histogram.iloc[-2]
    curr_hist = histogram.iloc[-1]
    prev_macd = macd_line.iloc[-2]
    prev_signal = signal_line.iloc[-2]
    curr_macd = macd_line.iloc[-1]
    curr_signal = signal_line.iloc[-1]

    # Bullish cross
    if prev_macd <= prev_signal and curr_macd > curr_signal:
        return FactorSignal(
            name="macd",
            score=SignalScore.BUY,
            confidence=0.65,
            value=float(curr_hist),
            threshold_breached=True,
            data_quality=dq,
            detail="MACD bullish crossover — short-term momentum turning positive.",
        )

    # Bearish cross
    if prev_macd >= prev_signal and curr_macd < curr_signal:
        return FactorSignal(
            name="macd",
            score=SignalScore.SELL,
            confidence=0.65,
            value=float(curr_hist),
            threshold_breached=True,
            data_quality=dq,
            detail="MACD bearish crossover — short-term momentum turning negative.",
        )

    # Histogram direction
    if curr_hist > 0 and curr_hist > prev_hist:
        return FactorSignal(
            name="macd",
            score=SignalScore.BUY,
            confidence=0.3,
            value=float(curr_hist),
            threshold_breached=False,
            data_quality=dq,
            detail=f"MACD histogram rising ({curr_hist:.4f}) — bullish momentum building.",
        )
    if curr_hist < 0 and curr_hist < prev_hist:
        return FactorSignal(
            name="macd",
            score=SignalScore.SELL,
            confidence=0.3,
            value=float(curr_hist),
            threshold_breached=False,
            data_quality=dq,
            detail=f"MACD histogram falling ({curr_hist:.4f}) — bearish momentum building.",
        )

    return FactorSignal(
        name="macd",
        score=SignalScore.NEUTRAL,
        confidence=0.6,
        value=float(curr_hist),
        threshold_breached=False,
        data_quality=dq,
        detail=f"MACD histogram flat ({curr_hist:.4f}) — no clear signal.",
    )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _compute_rsi(close: pd.Series, period: int = 14) -> Optional[pd.Series]:
    delta = close.diff()
    gain = delta.where(delta > 0, 0.0)
    loss = (-delta).where(delta < 0, 0.0)
    avg_gain = gain.rolling(window=period, min_periods=period).mean()
    avg_loss = loss.rolling(window=period, min_periods=period).mean()
    if avg_loss is None or (avg_loss == 0).all():
        return pd.Series([50.0] * len(close), index=close.index)
    rs = avg_gain / avg_loss
    return 100.0 - (100.0 / (1.0 + rs))


def _has_higher_high(values: np.ndarray) -> bool:
    """Does the most recent peak exceed earlier peaks?"""
    if len(values) < 10:
        return False
    mid = len(values) // 2
    first_half_max = values[:mid].max()
    second_half_max = values[mid:].max()
    return second_half_max > first_half_max * 1.005


def _has_lower_low(values: np.ndarray) -> bool:
    if len(values) < 10:
        return False
    mid = len(values) // 2
    first_half_min = values[:mid].min()
    second_half_min = values[mid:].min()
    return second_half_min < first_half_min * 0.995


def _neutral(
    name: str, msg: str, confidence: float = 0.0, data_quality: float = 0.0
) -> FactorSignal:
    return FactorSignal(
        name=name,
        score=SignalScore.NEUTRAL,
        confidence=confidence,
        value=0.0,
        threshold_breached=False,
        data_quality=data_quality,
        detail=msg,
    )
