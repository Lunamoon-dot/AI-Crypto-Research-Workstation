"""On-chain signal — long/short ratio, NVT, and exchange reserve data.

Parses formatted text output from CCXT (long/short ratio) and CoinGecko
(NVT, exchange reserves) to produce a structured trading signal.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

from .base import FactorSignal, SignalScore

logger = logging.getLogger(__name__)

# Long/short ratio thresholds
LS_EXTREME_LONG = 2.5  # > 2.5 = extremely crowded long
LS_MAJORITY_LONG = 1.5  # > 1.5 = majority long
LS_MAJORITY_SHORT = 0.67  # < 0.67 = majority short
LS_EXTREME_SHORT = 0.4  # < 0.4 = extreme short (squeeze risk)

# NVT thresholds
NVT_OVERHEATED = 150  # > 150 = overvalued relative to usage
NVT_UNDERVALUED = 50  # < 50 = potentially undervalued

# Turnover thresholds use decimal ratios, not percentages.
TURNOVER_SPECULATIVE = 0.10  # > 10% of market cap in 24h


def compute_onchain_signal(
    symbol: str,
    long_short_ratio_text: Optional[str] = None,
    nvt_text: Optional[str] = None,
    exchange_metrics_text: Optional[str] = None,
) -> FactorSignal:
    """Compute a composite on-chain signal from available data sources.

    Each input is optional — the function uses whatever data is provided
    and adjusts confidence accordingly.
    """
    detail: list[str] = []
    bull_score = 0.0
    bear_score = 0.0
    total_weight = 0.0
    data_sources_used = 0

    # ---- 1. Long/Short ratio (weight: 0.50) --------------------------------
    ls_ratio = None
    if long_short_ratio_text:
        ls_ratio = _parse_long_short_ratio(long_short_ratio_text)
        if ls_ratio is not None:
            w = 0.50
            total_weight += w
            data_sources_used += 1
            detail.append(f"Long/Short ratio: {ls_ratio:.2f}")

            if ls_ratio > LS_EXTREME_LONG:
                detail.append("Extreme long positioning — crowded trade, reversal risk")
                bear_score += w * 0.85
            elif ls_ratio > LS_MAJORITY_LONG:
                detail.append("Majority long — bullish but watch for unwinding")
                bull_score += w * 0.25
            elif ls_ratio < LS_EXTREME_SHORT:
                detail.append("Extreme short positioning — short squeeze risk")
                bull_score += w * 0.85
            elif ls_ratio < LS_MAJORITY_SHORT:
                detail.append("Majority short — bearish but could reverse sharply")
                bear_score += w * 0.25
            else:
                detail.append("Balanced positioning")
        else:
            detail.append("Long/Short ratio: parse failed")

    # ---- 2. NVT Ratio (weight: 0.30) --------------------------------------
    nvt_value = None
    if nvt_text:
        nvt_value = _parse_nvt(nvt_text)
        if nvt_value is not None:
            w = 0.30
            total_weight += w
            data_sources_used += 1
            detail.append(f"NVT Ratio: {nvt_value:.0f}")

            if nvt_value > NVT_OVERHEATED:
                detail.append("High NVT — network overvalued relative to usage")
                bear_score += w * 0.70
            elif nvt_value < NVT_UNDERVALUED:
                detail.append("Low NVT — potentially undervalued")
                bull_score += w * 0.55
            else:
                detail.append("NVT in neutral range")
        else:
            detail.append("NVT: parse failed")

    # ---- 3. Exchange reserves / turnover (weight: 0.20) --------------------
    if exchange_metrics_text:
        reserves_delta, turnover = _parse_exchange_metrics(exchange_metrics_text)
        w = 0.20
        total_weight += w
        data_sources_used += 1

        if reserves_delta is not None:
            detail.append(f"Exchange reserves delta: {reserves_delta:+.1%}")
            # Reserves dropping → coins leaving exchanges → bullish (accumulation)
            if reserves_delta < -0.03:
                detail.append("Reserves declining — accumulation signal")
                bull_score += w * 0.65
            elif reserves_delta > 0.03:
                detail.append("Reserves rising — potential selling pressure")
                bear_score += w * 0.55

        if turnover is not None:
            detail.append(f"Turnover ratio: {turnover:.1%}")
            if turnover > TURNOVER_SPECULATIVE:
                detail.append("Extreme turnover — speculative froth")
                bear_score += w * 0.35

    # ---- Compose final score ------------------------------------------------

    if total_weight == 0.0:
        return FactorSignal(
            name="onchain",
            score=SignalScore.NEUTRAL,
            confidence=0.0,
            value=0.0,
            threshold_breached=False,
            data_quality=0.0,
            detail="No on-chain data available.",
            metadata={"symbol": symbol},
        )

    bull_norm = bull_score / total_weight
    bear_norm = bear_score / total_weight
    net = bull_norm - bear_norm

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
    confidence = min(abs(net) * 1.2, 0.85)  # cap at 0.85 — on-chain is supplementary

    # Data quality: 3 sources → 0.9, 2 → 0.7, 1 → 0.5
    dq = {3: 0.9, 2: 0.7, 1: 0.5}.get(data_sources_used, 0.3)

    return FactorSignal(
        name="onchain",
        score=score,
        confidence=round(confidence, 2),
        value=ls_ratio
        if ls_ratio is not None
        else (nvt_value if nvt_value is not None else 0.0),
        threshold_breached=threshold_breached,
        data_quality=round(dq, 2),
        detail=" | ".join(detail),
        metadata={
            "symbol": symbol,
            "long_short_ratio": ls_ratio,
            "nvt": nvt_value,
            "data_sources": data_sources_used,
        },
    )


# ---------------------------------------------------------------------------
# Parsers — extract numeric values from formatted tool output text
# ---------------------------------------------------------------------------


def _parse_long_short_ratio(text: str) -> Optional[float]:
    """Extract the numeric long/short ratio from CCXT formatted output.

    Looks for patterns like:
        Ratio:  1.85 (Long/Short)
        Ratio: 1.23
    """
    if not text:
        return None
    # Pattern: "Ratio:  N.NN (Long/Short)" or just "Ratio: N.NN"
    m = re.search(r"Ratio:\s*([\d.]+)", text)
    if m:
        return float(m.group(1))
    # Fallback: look for a decimal near "Long/Short"
    m = re.search(r"([\d.]+)\s*\(?Long/Short\)?", text)
    if m:
        return float(m.group(1))
    return None


def _parse_nvt(text: str) -> Optional[float]:
    """Extract NVT ratio value from CoinGecko formatted output.

    Looks for patterns like:
        NVT Ratio: 85.3
        Approx NVT: 120
    """
    if not text:
        return None
    m = re.search(r"(?:NVT|NVT Ratio|Approx NVT)[:\s]*([\d.]+)", text, re.IGNORECASE)
    if m:
        return float(m.group(1))
    return None


def _parse_exchange_metrics(text: str) -> tuple[Optional[float], Optional[float]]:
    """Parse exchange reserves delta and turnover ratio.

    Returns (reserves_delta, turnover) — each can be None if unparseable.
    """
    if not text:
        return None, None

    reserves_delta = None
    turnover = None

    # Reserves change: "Reserves: -2.3%" or "reserves delta: +1.5%"
    m = re.search(r"(?:[Rr]eserves?|reserves?\s*delta)[:\s]*([+\-]?[\d.]+)\s*%", text)
    if m:
        pct = float(m.group(1))
        reserves_delta = pct / 100.0

    # Turnover: "Turnover: 85.2%" or "turnover ratio: 0.45"
    m = re.search(
        r"(?:turnover\s*ratio|turnover)[:\s]*([+\-]?[\d.]+)\s*(%)?",
        text,
        re.IGNORECASE,
    )
    if m:
        val = float(m.group(1))
        turnover = val / 100.0 if m.group(2) else val

    return reserves_delta, turnover
