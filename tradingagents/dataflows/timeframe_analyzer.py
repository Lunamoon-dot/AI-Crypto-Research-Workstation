"""Multi-timeframe analysis for detecting trend alignment and divergence.

Provides resampling, relative-strength comparison, and alignment scoring
across daily, weekly, and monthly timeframes.
"""

from __future__ import annotations

from io import StringIO
from typing import Optional

import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Resampling helpers
# ---------------------------------------------------------------------------

VALID_TIMEFRAMES = {"daily", "weekly", "monthly"}


def resample_ohlcv(df: pd.DataFrame, target: str) -> Optional[pd.DataFrame]:
    """Resample daily OHLCV to weekly or monthly bars.

    Parameters
    ----------
    df : DataFrame with columns Open, High, Low, Close, Volume
    target : one of ``"weekly"`` or ``"monthly"``

    Returns
    -------
    DataFrame or None when insufficient rows
    """
    if df.empty or len(df) < 2:
        return None

    rules = {"weekly": "W", "monthly": "ME"}
    rule = rules.get(target)
    if rule is None:
        return df  # daily

    resampled = df.resample(rule).agg({
        "Open": "first",
        "High": "max",
        "Low": "min",
        "Close": "last",
        "Volume": "sum",
    }).dropna()

    if resampled.empty:
        return None
    return resampled


# ---------------------------------------------------------------------------
# Trend detection
# ---------------------------------------------------------------------------


def _sma(series: pd.Series, window: int) -> pd.Series:
    return series.rolling(window=window, min_periods=1).mean()


def detect_trend(df: pd.DataFrame, column: str = "Close") -> dict:
    """Detect trend direction and strength for a single timeframe.

    Returns a dict with keys: direction, strength, slope_pct, above_sma_20, above_sma_50
    """
    if df is None or df.empty or len(df) < 5:
        return {"direction": "neutral", "strength": 0.0, "slope_pct": 0.0,
                "above_sma_20": False, "above_sma_50": False}

    close = df[column].astype(float)
    sma20 = _sma(close, min(20, len(close)))
    sma50 = _sma(close, min(50, len(close)))

    # Linear slope of last N bars
    n = min(20, len(close))
    recent = close.iloc[-n:]
    x = np.arange(len(recent))
    slope, _ = np.polyfit(x, recent.values, 1)
    avg_price = recent.mean()
    slope_pct = float((slope / avg_price) * 100 * n) if avg_price > 0 else 0.0

    if slope_pct > 1.0:
        direction = "bullish"
        strength = min(abs(slope_pct) / 5.0, 1.0)
    elif slope_pct < -1.0:
        direction = "bearish"
        strength = min(abs(slope_pct) / 5.0, 1.0)
    else:
        direction = "sideways"
        strength = max(0.0, 1.0 - abs(slope_pct))

    return {
        "direction": direction,
        "strength": round(strength, 2),
        "slope_pct": round(slope_pct, 2),
        "above_sma_20": bool(close.iloc[-1] > sma20.iloc[-1]),
        "above_sma_50": bool(close.iloc[-1] > sma50.iloc[-1]),
    }


def trend_alignment_score(trends: dict[str, dict]) -> dict:
    """Score how well trends align across timeframes (0-100).

    Parameters
    ----------
    trends : dict mapping timeframe name → detect_trend result

    Returns
    -------
    dict with ``score`` (0-100), ``verdict``, ``breakdown``
    """
    present = {k: v for k, v in trends.items() if v is not None}
    if len(present) < 2:
        return {"score": 50, "verdict": "insufficient_data",
                "breakdown": "Need at least 2 timeframes for alignment analysis."}

    directions = [v["direction"] for v in present.values()]
    strengths = [v["strength"] for v in present.values()]

    # Alignment bonus: all same direction
    unique_dirs = set(directions)
    if len(unique_dirs) == 1 and "neutral" not in unique_dirs:
        dir_score = 100
        verdict = "strongly_aligned"
    elif len(unique_dirs) == 1 and "neutral" in unique_dirs:
        dir_score = 40
        verdict = "neutral_across_board"
    elif "bullish" in unique_dirs and "bearish" in unique_dirs:
        dir_score = 10
        verdict = "divergent"
    elif "neutral" in unique_dirs:
        dir_score = 50
        verdict = "mixed"
    else:
        dir_score = 70
        verdict = "moderately_aligned"

    # Strength-weighted score
    avg_strength = sum(strengths) / max(len(strengths), 1)
    combined = round(dir_score * 0.6 + avg_strength * 40, 1)

    breakdown_lines = []
    for tf, t in present.items():
        breakdown_lines.append(
            f"  {tf}: {t['direction']} (strength={t['strength']}, slope={t['slope_pct']:.1f}%)"
        )

    return {
        "score": combined,
        "verdict": verdict,
        "breakdown": "\n".join(breakdown_lines),
        "direction_consensus": max(set(directions), key=directions.count) if directions else "neutral",
    }


# ---------------------------------------------------------------------------
# Multi-timeframe report generator
# ---------------------------------------------------------------------------


def generate_mtf_report(
    daily_csv: str,
    start_date: str,
    end_date: str,
    symbol: str = "",
) -> str:
    """Produce a human-readable multi-timeframe analysis report.

    Parameters
    ----------
    daily_csv : CSV string from get_crypto_ohlcv
    start_date, end_date : date range (for context only)
    symbol : optional ticker for the report header

    Returns
    -------
    Multi-timeframe report as a formatted string
    """
    try:
        df = pd.read_csv(StringIO(daily_csv), index_col=0, parse_dates=True)
    except Exception:
        return "Error: Could not parse OHLCV data for multi-timeframe analysis."

    if df.empty or "Close" not in df.columns:
        return "Error: OHLCV data missing Close column."

    # Build timeframes
    frames = {"daily": df}
    weekly = resample_ohlcv(df, "weekly")
    monthly = resample_ohlcv(df, "monthly")
    if weekly is not None:
        frames["weekly"] = weekly
    if monthly is not None:
        frames["monthly"] = monthly

    # Detect trends
    trends = {}
    for tf_name, tf_df in frames.items():
        trends[tf_name] = detect_trend(tf_df)

    # Alignment
    alignment = trend_alignment_score(trends)

    header = f"Multi-Timeframe Analysis"
    if symbol:
        header += f" for {symbol}"
    header += f"\n{'=' * 50}"

    lines = [header, ""]
    lines.append(f"Period: {start_date} → {end_date}")
    lines.append(f"Timeframes available: {', '.join(frames.keys())}")
    lines.append("")

    lines.append("Trend Summary:")
    for tf_name, t in trends.items():
        dir_icon = {"bullish": "▲", "bearish": "▼", "sideways": "─"}
        icon = dir_icon.get(t["direction"], "?")
        lines.append(
            f"  {icon} {tf_name.upper():8s} {t['direction']:10s} "
            f"(strength: {t['strength']:.0%}, slope: {t['slope_pct']:+.1f}%)"
        )
    lines.append("")

    lines.append(f"Alignment Score: {alignment['score']:.0f}/100")
    lines.append(f"Verdict: {alignment['verdict'].replace('_', ' ').title()}")
    lines.append(f"Consensus Direction: {alignment['direction_consensus'].title()}")
    lines.append("")
    lines.append("Breakdown:")
    lines.append(alignment["breakdown"])
    lines.append("")

    # Trading implications
    if alignment["score"] >= 80:
        lines.append("⚡ Strong multi-timeframe alignment — higher conviction trades.")
    elif alignment["score"] >= 60:
        lines.append("📊 Moderate alignment — trade with standard risk parameters.")
    elif alignment["score"] >= 40:
        lines.append("⚠️  Mixed signals across timeframes — reduce position size.")
    else:
        lines.append("🚫 Timeframe divergence — avoid new positions, tighten stops.")

    return "\n".join(lines)
