"""Confidence aggregation for structured agent opinions."""

from __future__ import annotations

from tradingagents.domain import AgentOpinion


def aggregate_confidence(opinions: list[AgentOpinion]) -> float | None:
    """Return the average non-null opinion confidence."""

    confidences = [
        opinion.confidence
        for opinion in opinions
        if opinion.confidence is not None
    ]
    if not confidences:
        return None
    return sum(confidences) / len(confidences)
