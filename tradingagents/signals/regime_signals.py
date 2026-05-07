"""Market regime detection — trending, ranging, or volatile.

Classifies the current market state from OHLCV data so the AI agents
know *what kind of market* they're trading in, not just *what price is*.
"""

from __future__ import annotations

import logging
from io import StringIO

import numpy as np
import pandas as pd

from .base import FactorSignal, SignalScore

logger = logging.getLogger(__name__)


def detect_regime(ohlcv_csv: str) -> dict:
    """Classify market regime from OHLCV data.

    Returns dict with:
    - trend_direction: bullish / bearish / sideways
    - trend_strength: 0..1
    - volatility_regime: low / normal / high / extreme
    - market_regime: trending / ranging / volatile
    - adx_value: Average Directional Index (14)
    - atr_pct: ATR as % of price
    - signal: FactorSignal
    """
    result = {
        "trend_direction": "neutral",
        "trend_strength": 0.0,
        "volatility_regime": "normal",
        "market_regime": "unknown",
        "adx_value": 0.0,
        "atr_pct": 0.0,
        "signal": None,
    }

    try:
        df = pd.read_csv(StringIO(ohlcv_csv), index_col=0, parse_dates=True)
        required = {"Close", "High", "Low"}
        if not required.issubset(df.columns) or len(df) < 30:
            result["signal"] = _neutral("regime", "Insufficient data for regime detection.")
            return result
    except Exception:
        result["signal"] = _neutral("regime", "OHLCV parse error.")
        return result

    close = df["Close"].astype(float)
    high = df["High"].astype(float)
    low = df["Low"].astype(float)
    current_price = close.iloc[-1]
    n_samples = len(close)
    dq = min(n_samples / 200.0, 1.0)  # 200+ candles → full quality

    # -- ATR (volatility) --------------------------------------------------
    atr = _compute_atr(high, low, close, period=14)
    if atr is not None and current_price > 0:
        atr_pct = atr / current_price
    else:
        atr_pct = 0.02  # default 2%
    result["atr_pct"] = round(atr_pct, 4)

    # Volatility regime
    if atr_pct > 0.05:
        result["volatility_regime"] = "extreme"
    elif atr_pct > 0.03:
        result["volatility_regime"] = "high"
    elif atr_pct < 0.01:
        result["volatility_regime"] = "low"
    else:
        result["volatility_regime"] = "normal"

    # -- ADX (trend strength) ----------------------------------------------
    adx = _compute_adx(high, low, close, period=14)
    if adx is not None:
        result["adx_value"] = round(adx, 1)
        if adx > 40:
            result["trend_strength"] = 0.9  # very strong trend
        elif adx > 25:
            result["trend_strength"] = 0.6  # trending
        elif adx > 20:
            result["trend_strength"] = 0.3  # weak trend
        else:
            result["trend_strength"] = 0.1  # ranging

    # -- Trend direction (SMA alignment) -----------------------------------
    sma20 = close.rolling(20).mean().iloc[-1]
    sma50 = close.rolling(50).mean().iloc[-1] if len(close) >= 50 else sma20
    sma200 = close.rolling(200).mean().iloc[-1] if len(close) >= 200 else sma20

    if current_price > sma20 > sma50:
        result["trend_direction"] = "bullish"
    elif current_price < sma20 < sma50:
        result["trend_direction"] = "bearish"
    else:
        result["trend_direction"] = "sideways"

    # -- Market regime classification --------------------------------------
    if adx is None:
        result["market_regime"] = "unknown"
    elif adx < 20:
        result["market_regime"] = "ranging"
    elif result["volatility_regime"] in ("high", "extreme"):
        result["market_regime"] = "volatile"
    else:
        result["market_regime"] = "trending"

    # -- Generate signal ---------------------------------------------------
    signal = _regime_to_signal(result, dq)
    result["signal"] = signal

    return result


def _regime_to_signal(r: dict, dq: float = 0.5) -> FactorSignal:
    """Translate regime detection into a trading signal."""

    # Trending bullish + normal vol = strongest buy signal
    if r["market_regime"] == "trending" and r["trend_direction"] == "bullish":
        conf = r["trend_strength"]
        return FactorSignal(
            name="regime",
            score=SignalScore.BUY if conf > 0.5 else SignalScore.NEUTRAL,
            confidence=conf,
            value=r["adx_value"],
            threshold_breached=conf > 0.5,
            data_quality=dq,
            detail=(
                f"Trending bullish (ADX={r['adx_value']:.0f}, "
                f"ATR={r['atr_pct']:.1%}). Favorable for long entries."
            ),
        )

    # Trending bearish + normal vol
    if r["market_regime"] == "trending" and r["trend_direction"] == "bearish":
        conf = r["trend_strength"]
        return FactorSignal(
            name="regime",
            score=SignalScore.SELL if conf > 0.5 else SignalScore.NEUTRAL,
            confidence=conf,
            value=r["adx_value"],
            threshold_breached=conf > 0.5,
            data_quality=dq,
            detail=(
                f"Trending bearish (ADX={r['adx_value']:.0f}, "
                f"ATR={r['atr_pct']:.1%}). Favorable for short entries."
            ),
        )

    # Ranging — no directional edge
    if r["market_regime"] == "ranging":
        return FactorSignal(
            name="regime",
            score=SignalScore.NEUTRAL,
            confidence=0.5,
            value=r["adx_value"],
            threshold_breached=False,
            data_quality=dq,
            detail=(
                f"Ranging market (ADX={r['adx_value']:.0f}). "
                f"Wait for breakout or use mean-reversion."
            ),
        )

    # High volatility — caution
    if r["market_regime"] == "volatile":
        conf = 0.6
        return FactorSignal(
            name="regime",
            score=SignalScore.NEUTRAL,
            confidence=conf,
            value=r["atr_pct"],
            threshold_breached=True,
            data_quality=dq,
            detail=(
                f"High volatility regime (ATR={r['atr_pct']:.1%}). "
                f"Reduce position size, widen stops."
            ),
        )

    return _neutral("regime", "No clear regime signal.", data_quality=dq)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _compute_atr(
    high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14
) -> float | None:
    if len(close) < period + 1:
        return None
    prev_close = close.shift(1)
    tr = pd.concat([
        (high - low),
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    return float(tr.rolling(period).mean().iloc[-1])


def _compute_adx(
    high: pd.Series, low: pd.Series, close: pd.Series, period: int = 14
) -> float | None:
    if len(close) < period * 2:
        return None

    prev_close = close.shift(1)
    up_move = high - high.shift(1)
    down_move = low.shift(1) - low

    plus_dm = pd.Series(0.0, index=high.index)
    minus_dm = pd.Series(0.0, index=high.index)

    plus_dm[(up_move > down_move) & (up_move > 0)] = up_move
    minus_dm[(down_move > up_move) & (down_move > 0)] = down_move

    tr = pd.concat([
        (high - low),
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)

    atr = tr.rolling(period).mean()
    plus_di = 100.0 * (plus_dm.rolling(period).mean() / atr)
    minus_di = 100.0 * (minus_dm.rolling(period).mean() / atr)

    dx = 100.0 * (abs(plus_di - minus_di) / (plus_di + minus_di + 1e-10))
    adx = dx.rolling(period).mean()

    if len(adx) == 0:
        return None
    return float(adx.iloc[-1])


def _neutral(name: str, msg: str, confidence: float = 0.0, data_quality: float = 0.0) -> FactorSignal:
    return FactorSignal(
        name=name, score=SignalScore.NEUTRAL, confidence=confidence,
        value=0.0, threshold_breached=False, data_quality=data_quality, detail=msg,
    )
