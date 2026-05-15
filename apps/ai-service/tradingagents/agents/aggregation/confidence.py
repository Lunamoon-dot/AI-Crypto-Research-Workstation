"""Confidence aggregation for structured agent opinions."""

from __future__ import annotations

from tradingagents.domain import AgentOpinion, ConflictLevel


def aggregate_confidence(
    opinions: list[AgentOpinion],
    *,
    conflict_level: ConflictLevel | None = None,
    missing_data_count: int = 0,
    stale_count: int = 0,
) -> float | None:
    """Return adjusted consensus confidence from opinion confidence values."""

    weighted_confidences = [
        (
            opinion.confidence,
            max(min(getattr(opinion, "data_quality", 1.0), 1.0), 0.0),
        )
        for opinion in opinions
        if opinion.confidence is not None
    ]
    if not weighted_confidences:
        return None
    total_weight = sum(weight for _, weight in weighted_confidences)
    if total_weight <= 0:
        return None
    base = sum(confidence * weight for confidence, weight in weighted_confidences)
    base /= total_weight
    penalty = 0.0
    if conflict_level == ConflictLevel.HIGH:
        penalty += 0.2
    elif conflict_level == ConflictLevel.MEDIUM:
        penalty += 0.1
    penalty += min(missing_data_count * 0.03, 0.18)
    penalty += min(stale_count * 0.05, 0.15)
    return max(base - penalty, 0.0)
