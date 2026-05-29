"""Composite scoring — combines multiple FactorSignals into one SignalResult.

Weights each factor by its confidence and the factor's reliability (configurable).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional

from .base import FactorSignal, SignalResult, SignalScore, score_to_quant_bias

# Default factor weights (sum to 1.0).  Funding/regime get higher weight
# because they're more structural; RSI/MACD get lower because they're noisy.
SIGNAL_WEIGHT_VERSION = "signal_weights:v1:2026-05-13"
DEFAULT_WEIGHTS: dict[str, float] = {
    "funding_oi": 0.20,
    "rsi_divergence": 0.12,
    "macd": 0.08,
    "volume_profile": 0.12,
    "liquidations": 0.12,
    "regime": 0.16,
    "onchain": 0.20,
}


class CompositeScorer:
    """Weighted multi-factor scorer that produces the final SignalResult."""

    def __init__(
        self,
        weights: Optional[dict[str, float]] = None,
        weight_version: str = SIGNAL_WEIGHT_VERSION,
        strong_buy_threshold: float = 0.60,
        buy_threshold: float = 0.25,
        sell_threshold: float = -0.25,
        strong_sell_threshold: float = -0.60,
    ):
        self.weights = weights or DEFAULT_WEIGHTS
        self.weight_version = weight_version
        self.strong_buy_threshold = strong_buy_threshold
        self.buy_threshold = buy_threshold
        self.sell_threshold = sell_threshold
        self.strong_sell_threshold = strong_sell_threshold

    def score(
        self,
        factors: list[FactorSignal],
        *,
        trend_direction: str = "neutral",
        trend_strength: float = 0.0,
        volatility_regime: str = "normal",
        market_regime: str = "unknown",
        current_price: Optional[float] = None,
        symbol: str = "",
    ) -> SignalResult:
        """Compute a weighted composite score from factor signals.

        Each factor contributes:
        - ``+weight * effective_confidence`` for bullish signals
        - ``-weight * effective_confidence`` for bearish signals
        - ``0`` for neutral

        Effective confidence = confidence * data_quality, so a factor built
        from thin data (e.g. 30 candles vs 200) carries less weight in the
        composite.

        The final confidence also receives an agreement bonus when multiple
        independent factors point the same direction, and a volatility
        discount in high/extreme regimes.
        """
        composite = 0.0
        total_weight = 0.0

        for f in factors:
            w = self.weights.get(f.name, 0.10)
            total_weight += w

            # Blend data_quality into factor confidence so thin-data signals
            # pull the composite score less than well-sampled ones.
            eff_conf = f.confidence * f.data_quality if f.data_quality > 0 else 0.0

            if f.score in (SignalScore.STRONG_BUY, SignalScore.BUY):
                mult = 2.0 if f.score == SignalScore.STRONG_BUY else 1.0
                composite += w * eff_conf * mult
            elif f.score in (SignalScore.STRONG_SELL, SignalScore.SELL):
                mult = 2.0 if f.score == SignalScore.STRONG_SELL else 1.0
                composite -= w * eff_conf * mult
            # Neutral → no contribution

        # Normalize
        if total_weight > 0:
            composite /= total_weight

        # Determine final score
        if composite >= self.strong_buy_threshold:
            final_score = SignalScore.STRONG_BUY
        elif composite >= self.buy_threshold:
            final_score = SignalScore.BUY
        elif composite <= self.strong_sell_threshold:
            final_score = SignalScore.STRONG_SELL
        elif composite <= self.sell_threshold:
            final_score = SignalScore.SELL
        else:
            final_score = SignalScore.NEUTRAL

        # --- Confidence calculation (three components) ------------------------

        # 1. Directional strength — how far from zero the composite is.
        directional_conf = min(abs(composite), 1.0)

        # 2. Average effective factor confidence — reflects whether each
        #    factor had sufficient data AND signal strength in its domain.
        if factors:
            avg_eff_conf = sum(f.confidence * f.data_quality for f in factors) / len(
                factors
            )
        else:
            avg_eff_conf = 0.0

        confidence = directional_conf * 0.6 + avg_eff_conf * 0.4

        # 3. Factor agreement bonus — independent factors pointing the same
        #    direction raise confidence above the weighted average.
        n_bullish = sum(
            1 for f in factors if f.score in (SignalScore.BUY, SignalScore.STRONG_BUY)
        )
        n_bearish = sum(
            1 for f in factors if f.score in (SignalScore.SELL, SignalScore.STRONG_SELL)
        )
        n_directional = n_bullish + n_bearish
        n_total = len(factors)

        if n_directional >= 2 and n_total >= 3:
            majority = max(n_bullish, n_bearish)
            agreement_ratio = majority / n_directional
            # Bonus scales with agreement: 2/2 = +0.10, 3/4 = +0.05, 5/5 = +0.18
            agreement_bonus = (agreement_ratio - 0.5) * 0.20
            confidence += agreement_bonus

        # 4. Volatility discount — in high/extreme vol, ALL factors are
        #    less reliable regardless of what they report.
        vol_discount = {"low": 1.0, "normal": 1.0, "high": 0.75, "extreme": 0.50}
        confidence *= vol_discount.get(volatility_regime, 1.0)

        confidence = round(min(confidence, 1.0), 2)

        # Build summary
        n_neutral = n_total - n_bullish - n_bearish
        n_breached = sum(1 for f in factors if f.threshold_breached)

        summary_parts = [
            f"Quant bias: {score_to_quant_bias(final_score)} "
            f"(composite={composite:+.2f}, heuristic_confidence={confidence:.0%})",
            f"{n_bullish} bullish, {n_bearish} bearish, {n_neutral} neutral factors",
        ]
        if n_breached > 0:
            summary_parts.append(f"{n_breached} threshold(s) breached")
        if volatility_regime in ("high", "extreme"):
            summary_parts.append(
                f"⚠ {volatility_regime} volatility — confidence discounted"
            )
        if market_regime == "ranging":
            summary_parts.append("⚠ Ranging market — directional signals less reliable")

        return SignalResult(
            symbol=symbol,
            timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            score=final_score,
            confidence=round(confidence, 2),
            heuristic_confidence=round(confidence, 2),
            signal_weight_version=self.weight_version,
            factors=factors,
            current_price=current_price,
            trend_direction=trend_direction,
            trend_strength=trend_strength,
            volatility_regime=volatility_regime,
            market_regime=market_regime,
            summary="\n".join(summary_parts),
        )
