"""Funding rate + Open Interest signals with timeseries-aware analysis.

When history CSV is available (preferred), computes:
- Funding rate trend (7-day slope)
- Funding rate percentile (vs 60-day range)
- OI delta (24h, 5d, 7d) and OI/price divergence

When only snapshot text is available (backward compat), falls back to
single-point threshold checks against the same extreme boundaries.
"""

from __future__ import annotations

import logging
from io import StringIO
from typing import Optional

import numpy as np
import pandas as pd

from .base import FactorSignal, SignalScore

logger = logging.getLogger(__name__)

# Thresholds
EXTREME_NEG = -0.005   # -0.5% — extreme negative (shorts paying)
EXTREME_POS = +0.005   # +0.5% — extreme positive (longs paying)
WARN_NEG = -0.001      # -0.1% — caution negative
WARN_POS = +0.001      # +0.1% — caution positive


def compute_funding_oi_signal(
    symbol: str,
    funding_csv: str | None = None,
    oi_csv: str | None = None,
    ohlcv_csv: str | None = None,
) -> FactorSignal:
    """Compute a composite funding + OI signal.

    Detects whether *funding_csv* / *oi_csv* contain CSV timeseries
    (preferred — rich analysis) or formatted snapshot text (fallback —
    single-point thresholds), then produces a weighted composite signal.

    When OHLCV history is provided alongside OI history, OI/price
    divergence detection is enabled.
    """
    # ------------------------------------------------------------------
    # Stage 1 — parse inputs (detect format automatically)
    # ------------------------------------------------------------------

    fund = _parse_funding_input(funding_csv)    # {rate, slope, pct, has_history}
    oi = _parse_oi_input(oi_csv)                # {current_oi, delta_1d, delta_5d, delta_7d, has_history}
    price = _parse_price_input(ohlcv_csv)       # {current_price, delta_5d, has_data}

    # ------------------------------------------------------------------
    # Stage 2 — accumulate weighted assessments
    # ------------------------------------------------------------------

    detail: list[str] = []
    bull_score = 0.0
    bear_score = 0.0
    total_weight = 0.0

    # --- 2a. Funding absolute level (weight: 0.40) ---------------------
    if fund.get("has_data"):
        rate = fund["rate"]
        w = 0.40
        total_weight += w
        detail.append(f"Funding rate: {rate:+.4%}")

        if rate <= EXTREME_NEG:
            detail.append(
                f"Extreme negative — shorts pay {abs(rate):.2%}, squeeze risk elevated"
            )
            bull_score += w * 0.85
        elif rate <= WARN_NEG:
            detail.append("Moderately negative — leans bullish")
            bull_score += w * 0.35
        elif rate >= EXTREME_POS:
            detail.append(
                f"Extreme positive — longs pay {rate:.2%}, correction risk elevated"
            )
            bear_score += w * 0.85
        elif rate >= WARN_POS:
            detail.append("Moderately positive — leans bearish")
            bear_score += w * 0.35
        else:
            detail.append("Funding rate in neutral range")

    # --- 2b. Funding trend (weight: 0.25, history only) ----------------
    if fund.get("has_history"):
        slope = fund["slope"]
        pct_rank = fund["percentile"]
        w = 0.25
        total_weight += w

        if slope > 1e-6:
            detail.append(
                f"Rate rising ({slope:+.2e}/day) — positioning tilting long"
            )
            bear_score += w * min(0.5, 0.5 * (slope / 1e-5))
        elif slope < -1e-6:
            detail.append(
                f"Rate falling ({slope:+.2e}/day) — shorts unwinding"
            )
            bull_score += w * min(0.5, 0.5 * (abs(slope) / 1e-5))

        if pct_rank > 0.90:
            detail.append(f"Funding at {pct_rank:.0%}ile — near top of 60d range")
            bear_score += w * 0.35
        elif pct_rank < 0.10:
            detail.append(f"Funding at {pct_rank:.0%}ile — near bottom of 60d range")
            bull_score += w * 0.35

    # --- 2c. OI / price divergence (weight: 0.35, needs OI + OHLCV) ---
    if oi.get("has_history") and price.get("has_data"):
        oi_d5 = oi["delta_5d"]
        px_d5 = price["delta_5d"]
        w = 0.35
        total_weight += w
        detail.append(
            f"OI 5d: {oi_d5:+.1%} | Price 5d: {px_d5:+.1%}"
        )

        # --- Divergence / confirmation (mutually exclusive) ---
        if px_d5 > 0.01 and oi_d5 < -0.03:
            # Price up, OI down -> weak trend, possible reversal
            detail.append("OI falling while price rising — trend weakening")
            bear_score += w * 0.65
        elif px_d5 < -0.01 and oi_d5 > 0.03:
            # Price down, OI up -> accumulation, possible bounce
            detail.append("OI rising while price falling — accumulation signal")
            bull_score += w * 0.70
        elif px_d5 > 0.01 and oi_d5 > 0.03:
            # Price up, OI up -> confirmed uptrend
            detail.append("Price + OI both rising — trend confirmation")
            bull_score += w * 0.65
        elif px_d5 < -0.01 and oi_d5 < -0.03:
            # Price down, OI down -> confirmed downtrend
            detail.append("Price + OI both falling — trend confirmation")
            bear_score += w * 0.65
        else:
            detail.append("OI/price in neutral alignment — no divergence")

        # --- OI trend (independent of price, always assessed) ---
        if abs(oi_d5) > 0.05:
            if oi_d5 > 0:
                bull_score += w * 0.15
            else:
                bear_score += w * 0.15
    elif oi.get("has_data") and oi.get("delta_1d") is not None:
        # At least report OI delta even without OHLCV
        detail.append(f"OI current: {oi['current_oi']:,.0f} (1d: {oi['delta_1d']:+.1%})")

    # ------------------------------------------------------------------
    # Stage 3 — compose final score
    # ------------------------------------------------------------------

    if total_weight == 0.0:
        return FactorSignal(
            name="funding_oi",
            score=SignalScore.NEUTRAL,
            confidence=0.0,
            value=0.0,
            threshold_breached=False,
            data_quality=0.0,
            detail="Funding rate data unavailable on this exchange.",
            metadata={"symbol": symbol},
        )

    # Normalise to [0, 1] range
    bull_norm = bull_score / total_weight
    bear_norm = bear_score / total_weight
    net = bull_norm - bear_norm

    # Map to 5-tier SignalScore
    if net >= 0.60:
        score = SignalScore.STRONG_BUY
    elif net >= 0.25:
        score = SignalScore.BUY
    elif net <= -0.60:
        score = SignalScore.STRONG_SELL
    elif net <= -0.25:
        score = SignalScore.SELL
    else:
        score = SignalScore.NEUTRAL

    threshold_breached = abs(net) >= 0.25
    confidence = min(abs(net) * 1.2, 1.0)  # scale for intuitive 0-1 range

    # Data quality: full history → 0.9, snapshot only → 0.4
    dq = 0.9 if fund.get("has_history") else (0.4 if fund.get("has_data") else 0.0)

    return FactorSignal(
        name="funding_oi",
        score=score,
        confidence=round(confidence, 2),
        value=fund.get("rate", 0.0),
        threshold_breached=threshold_breached,
        data_quality=round(dq, 2),
        detail=" | ".join(detail),
        metadata={
            "symbol": symbol,
            "funding_rate": fund.get("rate"),
            "funding_slope": fund.get("slope"),
            "funding_percentile": fund.get("percentile"),
            "oi_current": oi.get("current_oi"),
            "oi_delta_5d": oi.get("delta_5d"),
            "price_delta_5d": price.get("delta_5d"),
            "has_history": fund.get("has_history", False),
        },
    )


# ======================================================================
# Input parsers — detect CSV vs text format automatically
# ======================================================================


def _parse_funding_input(data: str | None) -> dict:
    """Parse funding data, auto-detecting CSV history vs snapshot text.

    Returns dict with keys: has_data, rate, has_history, slope, percentile.
    """
    if data is None:
        return {"has_data": False, "rate": None, "has_history": False}

    if _looks_like_csv(data):
        return _analyze_funding_history(data)
    return _analyze_funding_snapshot(data)


def _parse_oi_input(data: str | None) -> dict:
    """Parse open interest data, auto-detecting CSV history vs snapshot text.

    Returns dict with keys: has_data, current_oi, has_history, delta_1d, delta_5d, delta_7d.
    """
    if data is None:
        return {"has_data": False, "current_oi": None, "has_history": False}

    if _looks_like_csv(data):
        return _analyze_oi_history(data)
    return _analyze_oi_snapshot(data)


def _parse_price_input(data: str | None) -> dict:
    """Parse OHLCV CSV for current price and 5-day change."""
    if data is None:
        return {"has_data": False, "current_price": None, "delta_5d": 0.0}

    try:
        df = pd.read_csv(StringIO(data), index_col=0, parse_dates=True)
        if "Close" not in df.columns or len(df) < 2:
            return {"has_data": False, "current_price": None, "delta_5d": 0.0}

        close = df["Close"].astype(float)
        current = close.iloc[-1]
        # 5-bar change (could be 5 days or 5 candles depending on timeframe)
        if len(close) >= 6:
            delta_5d = (close.iloc[-1] - close.iloc[-6]) / close.iloc[-6]
        else:
            delta_5d = 0.0

        return {
            "has_data": True,
            "current_price": float(current),
            "delta_5d": float(delta_5d),
        }
    except Exception as e:
        logger.debug("OHLCV parse error in funding_oi: %s", e)
        return {"has_data": False, "current_price": None, "delta_5d": 0.0}


def _looks_like_csv(data: str | None) -> bool:
    """Heuristic: CSV output starts with 'timestamp,'; snapshot text starts with '==='."""
    if data is None:
        return False
    stripped = data.lstrip()
    return stripped.startswith("timestamp,")


# ======================================================================
# History analysers (CSV timeseries → structured assessments)
# ======================================================================


def _analyze_funding_history(data: str) -> dict:
    """Parse funding rate history CSV → trend + percentile assessment."""
    try:
        df = pd.read_csv(StringIO(data), parse_dates=["timestamp"])
        if "fundingRate" not in df.columns or len(df) < 3:
            return _fallback_latest_rate(df)

        rates = df["fundingRate"].astype(float).dropna()
        if len(rates) < 3:
            return {
                "has_data": True,
                "rate": float(rates.iloc[-1]),
                "has_history": False,
            }

        current = float(rates.iloc[-1])

        # 7-day slope via linear regression
        lookback = min(21, len(rates))  # ~7d at 3x/day
        recent = rates.iloc[-lookback:]
        x = np.arange(len(recent))
        slope = float(np.polyfit(x, recent.values, 1)[0])

        # Percentile within full history
        pct_rank = float((rates < current).mean())

        return {
            "has_data": True,
            "rate": current,
            "has_history": True,
            "slope": slope,
            "percentile": pct_rank,
        }
    except Exception as e:
        logger.debug("Funding history parse error: %s", e)
        return {"has_data": False, "rate": None, "has_history": False}


def _analyze_oi_history(data: str) -> dict:
    """Parse OI history CSV → current OI + deltas."""
    try:
        df = pd.read_csv(StringIO(data), parse_dates=["timestamp"])
        col = (
            "openInterestAmount"
            if "openInterestAmount" in df.columns
            else "openInterestValue"
        )
        if col not in df.columns or len(df) < 2:
            return {"has_data": False, "current_oi": None, "has_history": False}

        oi = df[col].astype(float).dropna()
        if len(oi) < 2:
            return {"has_data": False, "current_oi": None, "has_history": False}

        current = float(oi.iloc[-1])

        def _delta(lag: int) -> float:
            if len(oi) > lag:
                prev = float(oi.iloc[-(lag + 1)])
                return (current - prev) / prev if prev > 0 else 0.0
            return 0.0

        return {
            "has_data": True,
            "current_oi": current,
            "has_history": len(oi) >= 5,
            "delta_1d": _delta(1),
            "delta_5d": _delta(5),
            "delta_7d": _delta(7),
        }
    except Exception as e:
        logger.debug("OI history parse error: %s", e)
        return {"has_data": False, "current_oi": None, "has_history": False}


def _fallback_latest_rate(df: pd.DataFrame) -> dict:
    """Extract the latest rate when there is too little history for trend analysis."""
    try:
        rates = df["fundingRate"].astype(float).dropna()
        if len(rates) > 0:
            return {"has_data": True, "rate": float(rates.iloc[-1]), "has_history": False}
    except Exception:
        pass
    return {"has_data": False, "rate": None, "has_history": False}


# ======================================================================
# Snapshot analysers (formatted text → basic threshold check)
# ======================================================================


def _analyze_funding_snapshot(data: str) -> dict:
    """Parse formatted funding rate text (backward compat path)."""
    rate = _parse_funding_rate(data)
    if rate is not None:
        return {"has_data": True, "rate": rate, "has_history": False}
    return {"has_data": False, "rate": None, "has_history": False}


def _analyze_oi_snapshot(data: str) -> dict:
    """Parse formatted OI text (backward compat path)."""
    oi_val = _parse_oi(data)
    if oi_val is not None:
        return {
            "has_data": True,
            "current_oi": oi_val,
            "has_history": False,
            "delta_1d": None,
            "delta_5d": None,
            "delta_7d": None,
        }
    return {"has_data": False, "current_oi": None, "has_history": False}


def _parse_funding_rate(text: str) -> Optional[float]:
    """Extract funding rate from formatted CCXT output."""
    import re
    m = re.search(r"Funding Rate:\s*([+\-]?[\d.]+)\s*%", text)
    if m:
        pct = float(m.group(1))
        return pct / 100.0
    m = re.search(r"fundingRate.*?([+\-]?[\d.]+)", text, re.IGNORECASE)
    if m:
        return float(m.group(1)) / 100.0
    return None


def _parse_oi(text: str) -> Optional[float]:
    """Extract open interest from formatted CCXT output."""
    import re
    m = re.search(r"Open Interest:\s*([\d,.]+)", text)
    if m:
        return float(m.group(1).replace(",", ""))
    return None
