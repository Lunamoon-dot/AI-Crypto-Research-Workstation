"""Contradiction detection for structured agent opinions."""

from __future__ import annotations

from tradingagents.domain import AgentOpinion, AgentStance


def detect_contradictions(opinions: list[AgentOpinion]) -> list[str]:
    """Expose disagreement between bullish and bearish opinions."""

    bullish = [
        opinion
        for opinion in opinions
        if opinion.stance == AgentStance.BULLISH and opinion.key_evidence
    ]
    bearish = [
        opinion
        for opinion in opinions
        if opinion.stance == AgentStance.BEARISH and opinion.key_evidence
    ]
    contradictions = []
    for bull in bullish[:3]:
        for bear in bearish[:3]:
            contradictions.append(
                f"{bull.agent_name} is bullish because {bull.key_evidence[0]}; "
                f"{bear.agent_name} is bearish because {bear.key_evidence[0]}."
            )
    return contradictions[:6]
