"""Build market and signal snapshots from saved signal-engine output."""

from __future__ import annotations

from tradingagents.domain import (
    DataFreshness,
    MarketSnapshot,
    Signal,
    SignalDirection,
    SignalSnapshot,
)
from tradingagents.signals.base import SignalResult
from tradingagents.signals.provenance import parse_signal_timestamp, signal_score_to_direction


def build_market_snapshot(
    result: SignalResult,
    *,
    research_run_id: str | None = None,
) -> MarketSnapshot:
    """Create point-in-time market context from the composite signal result."""
    return MarketSnapshot(
        research_run_id=research_run_id,
        symbol=result.symbol,
        current_price=result.current_price,
        trend_direction=result.trend_direction,
        trend_strength=result.trend_strength,
        volatility_regime=result.volatility_regime,
        market_regime=result.market_regime,
        source="signal_engine",
        source_timestamp=parse_signal_timestamp(result.timestamp),
        summary=result.summary,
        payload={
            "quant_bias": signal_score_to_direction(result.score).value,
            "confidence": result.confidence,
            "factor_count": len(result.factors),
        },
    )


def build_signal_snapshot(
    *,
    research_run_id: str,
    symbol: str,
    signals: list[Signal],
) -> SignalSnapshot:
    """Create an immutable signal-id snapshot for a research run."""
    composite_signal_id = next(
        (
            signal.id
            for signal in signals
            if signal.signal_type in ("quant_bias", "composite_quant")
        ),
        None,
    )
    bullish = sum(
        1 for signal in signals if signal.direction == SignalDirection.BULLISH
    )
    bearish = sum(
        1 for signal in signals if signal.direction == SignalDirection.BEARISH
    )
    neutral = sum(
        1 for signal in signals if signal.direction == SignalDirection.NEUTRAL
    )
    stale = sum(
        1 for signal in signals if signal.provenance.freshness == DataFreshness.STALE
    )
    unknown = sum(
        1 for signal in signals if signal.provenance.freshness == DataFreshness.UNKNOWN
    )
    return SignalSnapshot(
        research_run_id=research_run_id,
        symbol=symbol,
        signal_ids=[signal.id for signal in signals if signal.id],
        composite_signal_id=composite_signal_id,
        bullish_count=bullish,
        bearish_count=bearish,
        neutral_count=neutral,
        stale_count=stale,
        unknown_freshness_count=unknown,
        payload={
            "signal_types": [signal.signal_type for signal in signals],
            "spot_signal_ids": [
                signal.id
                for signal in signals
                if signal.id and getattr(signal.evidence_lane, "value", "") == "spot"
            ],
            "perp_signal_ids": [
                signal.id
                for signal in signals
                if signal.id and getattr(signal.evidence_lane, "value", "") == "perp"
            ],
        },
    )
