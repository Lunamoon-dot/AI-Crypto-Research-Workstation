"""Volume profile and liquidation imbalance signals.

Detects:
- Volume climax (potential reversal)
- Up/Down volume ratio
- Liquidation imbalance (long vs short liq skew)
- Volume-price confirmation/divergence
"""

from __future__ import annotations

import logging
from io import StringIO
from typing import Optional

import pandas as pd

from .base import FactorSignal, SignalScore

logger = logging.getLogger(__name__)


def compute_volume_signal(ohlcv_csv: str) -> FactorSignal:
    """Analyze volume profile for accumulation/distribution signals."""
    try:
        df = pd.read_csv(StringIO(ohlcv_csv), index_col=0, parse_dates=True)
        required = {"Close", "Volume"}
        if not required.issubset(df.columns) or len(df) < 20:
            return _neutral("volume_profile", "Insufficient data for volume analysis.")
    except Exception as e:
        logger.warning("Volume signal OHLCV parse error: %s", e)
        return _neutral("volume_profile", "OHLCV parse error.")

    close = df["Close"].astype(float)
    volume = df["Volume"].astype(float)
    n_samples = len(close)
    dq = min(n_samples / 200.0, 1.0)

    # Volume moving averages
    vol_sma_20 = volume.rolling(20).mean()
    vol_sma_5 = volume.rolling(5).mean()
    if len(vol_sma_20) < 20 or len(vol_sma_5) < 5:
        return _neutral(
            "volume_profile", "Volume MA computation incomplete.", data_quality=dq
        )

    current_vol = volume.iloc[-1]
    avg_vol_20 = vol_sma_20.iloc[-1]
    avg_vol_5 = vol_sma_5.iloc[-1]
    vol_ratio = current_vol / avg_vol_20 if avg_vol_20 > 0 else 1.0

    # Price change over last 5 bars
    price_change_5 = (
        (close.iloc[-1] - close.iloc[-6]) / close.iloc[-6] if len(close) >= 6 else 0.0
    )

    # Volume climax detection (> 2.5x average)
    if vol_ratio > 2.5:
        if price_change_5 > 0.03:
            return FactorSignal(
                name="volume_profile",
                score=SignalScore.SELL,
                confidence=0.55,
                value=vol_ratio,
                threshold_breached=True,
                data_quality=dq,
                detail=(
                    f"Volume climax ({vol_ratio:.1f}x avg) on up day — "
                    f"potential exhaustion. Selling into strength."
                ),
            )
        if price_change_5 < -0.03:
            return FactorSignal(
                name="volume_profile",
                score=SignalScore.BUY,
                confidence=0.55,
                value=vol_ratio,
                threshold_breached=True,
                data_quality=dq,
                detail=(
                    f"Volume climax ({vol_ratio:.1f}x avg) on down day — "
                    f"potential capitulation. Accumulation opportunity."
                ),
            )

    # Rising volume + rising price = confirmation (bullish)
    if avg_vol_5 > avg_vol_20 * 1.2 and price_change_5 > 0.01:
        return FactorSignal(
            name="volume_profile",
            score=SignalScore.BUY,
            confidence=0.5,
            value=vol_ratio,
            threshold_breached=False,
            data_quality=dq,
            detail=(
                f"Volume expanding (+{vol_ratio:.1f}x) with rising price "
                f"({price_change_5:+.2%}) — trend confirmation."
            ),
        )

    # Rising volume + falling price = distribution (bearish)
    if avg_vol_5 > avg_vol_20 * 1.2 and price_change_5 < -0.01:
        return FactorSignal(
            name="volume_profile",
            score=SignalScore.SELL,
            confidence=0.5,
            value=vol_ratio,
            threshold_breached=False,
            data_quality=dq,
            detail=(
                f"Volume expanding (+{vol_ratio:.1f}x) with falling price "
                f"({price_change_5:+.2%}) — distribution."
            ),
        )

    # Declining volume + rising price = weak trend
    if avg_vol_5 < avg_vol_20 * 0.7 and price_change_5 > 0.01:
        return FactorSignal(
            name="volume_profile",
            score=SignalScore.NEUTRAL,
            confidence=0.35,
            value=vol_ratio,
            threshold_breached=False,
            data_quality=dq,
            detail=(
                f"Declining volume ({vol_ratio:.1f}x) on uptrend — "
                f"weak conviction. Trend may stall."
            ),
        )

    return FactorSignal(
        name="volume_profile",
        score=SignalScore.NEUTRAL,
        confidence=0.6,
        value=vol_ratio,
        threshold_breached=False,
        data_quality=dq,
        detail=f"Volume normal ({vol_ratio:.1f}x avg) — no signal.",
    )


LONG_LIQ_THRESHOLD = 200_000  # $200k long liquidations
SHORT_LIQ_THRESHOLD = 200_000


def compute_liquidation_signal(liq_text: str | None = None) -> FactorSignal:
    """Detect liquidation imbalance from CCXT liquidation data."""
    if liq_text is None:
        return _neutral("liquidations", "No liquidation data provided.")

    long_liq = _extract_value(liq_text, "Long liquidations")
    short_liq = _extract_value(liq_text, "Short liquidations")

    if long_liq is None and short_liq is None:
        return _neutral("liquidations", "Could not parse liquidation data.")

    long_liq = long_liq or 0.0
    short_liq = short_liq or 0.0
    total = long_liq + short_liq

    # Data quality: both sides parsed → 0.8, one side → 0.5, no data → 0.0
    has_both = long_liq > 0 and short_liq > 0
    dq = 0.8 if has_both else (0.5 if total > 0 else 0.0)

    if total == 0:
        return _neutral(
            "liquidations",
            "No recent liquidation events.",
            confidence=0.3,
            data_quality=dq,
        )

    # Imbalance: long_liq / short_liq
    if short_liq > 0:
        ratio = long_liq / short_liq
    else:
        ratio = float("inf") if long_liq > 0 else 1.0

    if ratio > 3.0 and long_liq > LONG_LIQ_THRESHOLD:
        return FactorSignal(
            name="liquidations",
            score=SignalScore.SELL,
            confidence=min(ratio / 5.0, 0.9),
            value=ratio,
            threshold_breached=True,
            data_quality=dq,
            detail=(
                f"Heavy long liquidations (${long_liq:,.0f}) vs shorts "
                f"(${short_liq:,.0f}) — ratio {ratio:.1f}x. "
                f"Cascading downside risk."
            ),
        )

    if ratio < 0.33 and short_liq > SHORT_LIQ_THRESHOLD:
        return FactorSignal(
            name="liquidations",
            score=SignalScore.BUY,
            confidence=min((1.0 / max(ratio, 0.01)) / 5.0, 0.9),
            value=ratio,
            threshold_breached=True,
            data_quality=dq,
            detail=(
                f"Heavy short liquidations (${short_liq:,.0f}) vs longs "
                f"(${long_liq:,.0f}) — ratio {1.0 / ratio:.1f}x. "
                f"Short squeeze in progress."
            ),
        )

    return FactorSignal(
        name="liquidations",
        score=SignalScore.NEUTRAL,
        confidence=0.5,
        value=ratio,
        threshold_breached=False,
        data_quality=dq,
        detail=f"Liquidations balanced (L:${long_liq:,.0f} / S:${short_liq:,.0f}).",
    )


def _extract_value(text: str, label: str) -> Optional[float]:
    """Extract dollar value after a label like 'Long liquidations: $123,456'."""
    import re

    pattern = rf"{label}:\s*\$?([\d,]+(?:\.\d{{2}})?)"
    m = re.search(pattern, text, re.IGNORECASE)
    if m:
        return float(m.group(1).replace(",", ""))
    return None


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
