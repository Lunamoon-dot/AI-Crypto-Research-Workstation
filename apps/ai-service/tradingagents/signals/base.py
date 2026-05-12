"""Base types for the signal (quant) layer.

All signal generators produce ``SignalResult`` — a structured, deterministic
output the AI agents consume instead of raw indicator data.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


class SignalScore(str, Enum):
    """5-tier quantitative signal — same scale as AI rating for consistency."""

    STRONG_BUY = "Strong Buy"
    BUY = "Buy"
    NEUTRAL = "Neutral"
    SELL = "Sell"
    STRONG_SELL = "Strong Sell"


@dataclass
class FactorSignal:
    """Output from a single signal generator (funding, divergence, etc.)."""

    name: str  # e.g. "funding_oi", "rsi_divergence"
    score: SignalScore  # the computed signal
    confidence: float  # 0..1 — how strong the evidence is
    value: float  # raw factor value (e.g. funding rate %)
    threshold_breached: bool  # did it cross a defined threshold?
    data_quality: float = (
        0.5  # 0..1 — data sufficiency (sample size, history vs snapshot)
    )
    detail: str = ""  # human-readable breakdown
    metadata: dict = field(default_factory=dict)


@dataclass
class SignalResult:
    """Unified signal output consumed by AI agents.

    Replaces raw indicator dumps (RSI=45, MACD=cross, etc.) with a
    structured quantitative assessment the AI can reason about.
    """

    symbol: str
    timestamp: str
    score: SignalScore  # overall composite score
    confidence: float  # 0..1 — overall conviction
    factors: list[FactorSignal] = field(default_factory=list)

    # Key metrics extracted for AI context
    current_price: Optional[float] = None
    trend_direction: str = "neutral"  # bullish / bearish / sideways
    trend_strength: float = 0.0  # 0..1
    volatility_regime: str = "normal"  # low / normal / high / extreme
    market_regime: str = "unknown"  # trending / ranging / volatile

    # Summary that the AI prompt can inject directly
    summary: str = ""
    degradation_reasons: list[str] = field(default_factory=list)
    missing_core_data: list[str] = field(default_factory=list)
    missing_optional_data: list[str] = field(default_factory=list)

    def to_prompt_block(self) -> str:
        """Render as a prompt block for injection into AI agent context.

        This is what the analyst agents see instead of raw OHLCV/indicator dumps.
        """
        lines = [
            f"=== Quantitative Signal: {self.symbol} ===",
            f"Signal: {self.score.value} (confidence: {self.confidence:.0%})",
            f"Price: ${self.current_price:.2f}" if self.current_price else "",
            f"Trend: {self.trend_direction} (strength: {self.trend_strength:.0%})",
            f"Volatility: {self.volatility_regime}",
            f"Regime: {self.market_regime}",
            "",
            "Factor Breakdown:",
        ]
        lines = [line for line in lines if line]  # filter empty

        for f in self.factors:
            icon = {
                "Strong Buy": "🟢",
                "Buy": "🟢",
                "Neutral": "🟡",
                "Sell": "🔴",
                "Strong Sell": "🔴",
            }.get(f.score.value, "⚪")
            lines.append(
                f"  {icon} {f.name:25s} {f.score.value:12s} "
                f"(conf={f.confidence:.0%}, value={f.value:.4f})"
            )
            if f.detail:
                lines.append(f"     {f.detail}")

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

        return "\n".join(lines)

    def to_dict(self) -> dict:
        return {
            "symbol": self.symbol,
            "timestamp": self.timestamp,
            "score": self.score.value,
            "confidence": self.confidence,
            "current_price": self.current_price,
            "trend_direction": self.trend_direction,
            "trend_strength": self.trend_strength,
            "volatility_regime": self.volatility_regime,
            "market_regime": self.market_regime,
            "factors": [
                {
                    "name": f.name,
                    "score": f.score.value,
                    "confidence": f.confidence,
                    "data_quality": f.data_quality,
                    "value": f.value,
                    "threshold_breached": f.threshold_breached,
                    "detail": f.detail,
                }
                for f in self.factors
            ],
            "summary": self.summary,
            "degradation_reasons": list(self.degradation_reasons),
            "missing_core_data": list(self.missing_core_data),
            "missing_optional_data": list(self.missing_optional_data),
        }
