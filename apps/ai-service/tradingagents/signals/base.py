"""Base types for the deterministic signal layer."""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


MIN_EMPIRICAL_CONFIDENCE_SAMPLE_SIZE = 30
MIN_EMPIRICAL_CONFIDENCE_OOS_SIZE = 10


class SignalScore(str, Enum):
    """Five-tier quantitative signal scale."""

    STRONG_BUY = "Strong Buy"
    BUY = "Buy"
    NEUTRAL = "Neutral"
    SELL = "Sell"
    STRONG_SELL = "Strong Sell"


def score_to_quant_bias(score: SignalScore) -> str:
    """Render an internal score as non-execution market-bias wording."""
    if score in (SignalScore.STRONG_BUY, SignalScore.BUY):
        return "bullish"
    if score in (SignalScore.STRONG_SELL, SignalScore.SELL):
        return "bearish"
    if score == SignalScore.NEUTRAL:
        return "neutral"
    return "unknown"


@dataclass
class FactorSignal:
    """Output from one signal generator."""

    name: str
    score: SignalScore
    confidence: float
    value: float
    threshold_breached: bool
    data_quality: float = 0.5
    detail: str = ""
    metadata: dict = field(default_factory=dict)


@dataclass
class SignalResult:
    """Unified signal output consumed by agents.

    ``confidence`` remains as a compatibility alias for heuristic confidence.
    Empirical confidence is only publishable when enough validated,
    out-of-sample evidence exists.
    """

    symbol: str
    timestamp: str
    score: SignalScore
    confidence: float
    factors: list[FactorSignal] = field(default_factory=list)
    heuristic_confidence: float | None = None
    empirical_confidence: float | None = None
    empirical_sample_size: int = 0
    empirical_oos_sample_size: int = 0
    signal_weight_version: str = ""

    current_price: Optional[float] = None
    trend_direction: str = "neutral"
    trend_strength: float = 0.0
    volatility_regime: str = "normal"
    market_regime: str = "unknown"

    summary: str = ""
    degradation_reasons: list[str] = field(default_factory=list)
    missing_core_data: list[str] = field(default_factory=list)
    missing_optional_data: list[str] = field(default_factory=list)
    factor_failures: list[dict[str, str]] = field(default_factory=list)

    def to_prompt_block(self) -> str:
        """Render the signal as prompt-safe research context."""
        heuristic = (
            self.heuristic_confidence
            if self.heuristic_confidence is not None
            else self.confidence
        )
        lines = [
            f"=== Quant Bias: {self.symbol} ===",
            f"Quant Bias: {score_to_quant_bias(self.score)}",
            f"Heuristic confidence: {heuristic:.0%}",
            f"Price: ${self.current_price:.2f}" if self.current_price else "",
            f"Trend: {self.trend_direction} (strength: {self.trend_strength:.0%})",
            f"Volatility: {self.volatility_regime}",
            f"Regime: {self.market_regime}",
            f"Signal weight version: {self.signal_weight_version}"
            if self.signal_weight_version
            else "",
            "",
            "Evidence Breakdown:",
        ]
        lines = [line for line in lines if line]

        if self.empirical_confidence_is_publishable():
            lines.append(
                "Empirical confidence: "
                f"{self.empirical_confidence:.0%} "
                f"(n={self.empirical_sample_size}, "
                f"oos={self.empirical_oos_sample_size})"
            )
        elif self.empirical_confidence is not None:
            lines.append(
                "Empirical confidence: insufficient validated sample "
                f"(n={self.empirical_sample_size}, "
                f"oos={self.empirical_oos_sample_size})"
            )

        for factor in self.factors:
            lines.append(
                f"  - {factor.name:25s} {score_to_quant_bias(factor.score):8s} "
                f"(conf={factor.confidence:.0%}, value={factor.value:.4f})"
            )
            if factor.detail:
                lines.append(f"     {factor.detail}")

        if self.summary:
            lines.extend(["", self.summary])
        if self.missing_optional_data:
            lines.extend(
                [
                    "",
                    "Optional data unavailable:",
                    *[f"  - {item}" for item in self.missing_optional_data],
                ]
            )
        if self.factor_failures:
            lines.extend(
                [
                    "",
                    "Signal factors unavailable:",
                    *[
                        "  - "
                        f"{item.get('factor', 'unknown')}: "
                        f"{item.get('reason', 'failed')}"
                        for item in self.factor_failures
                    ],
                ]
            )

        return "\n".join(lines)

    def to_dict(self) -> dict:
        heuristic = (
            self.heuristic_confidence
            if self.heuristic_confidence is not None
            else self.confidence
        )
        return {
            "symbol": self.symbol,
            "timestamp": self.timestamp,
            "quant_bias": score_to_quant_bias(self.score),
            "confidence": self.confidence,
            "heuristic_confidence": heuristic,
            "empirical_confidence": self.empirical_confidence,
            "empirical_sample_size": self.empirical_sample_size,
            "empirical_oos_sample_size": self.empirical_oos_sample_size,
            "empirical_confidence_publishable": self.empirical_confidence_is_publishable(),
            "signal_weight_version": self.signal_weight_version,
            "current_price": self.current_price,
            "trend_direction": self.trend_direction,
            "trend_strength": self.trend_strength,
            "volatility_regime": self.volatility_regime,
            "market_regime": self.market_regime,
            "factors": [
                {
                    "name": factor.name,
                    "quant_bias": score_to_quant_bias(factor.score),
                    "confidence": factor.confidence,
                    "data_quality": factor.data_quality,
                    "value": factor.value,
                    "threshold_breached": factor.threshold_breached,
                    "detail": factor.detail,
                }
                for factor in self.factors
            ],
            "summary": self.summary,
            "degradation_reasons": list(self.degradation_reasons),
            "missing_core_data": list(self.missing_core_data),
            "missing_optional_data": list(self.missing_optional_data),
            "factor_failures": [dict(item) for item in self.factor_failures],
        }

    def empirical_confidence_is_publishable(self) -> bool:
        return (
            self.empirical_confidence is not None
            and self.empirical_sample_size >= MIN_EMPIRICAL_CONFIDENCE_SAMPLE_SIZE
            and self.empirical_oos_sample_size >= MIN_EMPIRICAL_CONFIDENCE_OOS_SIZE
        )
