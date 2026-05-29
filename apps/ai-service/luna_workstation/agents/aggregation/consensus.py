"""Consensus aggregation for structured agent opinions."""

from __future__ import annotations

from collections import Counter

from luna_workstation.domain import AgentOpinion, AgentStance, ConflictLevel


def consensus_from_opinions(
    opinions: list[AgentOpinion],
) -> tuple[AgentStance, dict[str, int], ConflictLevel]:
    """Compute stance distribution and conflict level from typed opinions."""

    counts = Counter(opinion.stance.value for opinion in opinions)
    stance_counts = {
        stance.value: counts.get(stance.value, 0) for stance in AgentStance
    }
    directional = {
        AgentStance.BULLISH.value: stance_counts[AgentStance.BULLISH.value],
        AgentStance.BEARISH.value: stance_counts[AgentStance.BEARISH.value],
    }
    uncertain_or_missing = stance_counts[AgentStance.UNCERTAIN.value] + sum(
        1 for opinion in opinions if opinion.missing_data
    )

    if not opinions:
        return AgentStance.UNCERTAIN, stance_counts, ConflictLevel.LOW

    if directional[AgentStance.BULLISH.value] == directional[AgentStance.BEARISH.value]:
        consensus = AgentStance.NEUTRAL
    elif (
        directional[AgentStance.BULLISH.value] > directional[AgentStance.BEARISH.value]
    ):
        consensus = AgentStance.BULLISH
    else:
        consensus = AgentStance.BEARISH

    minority = min(directional.values())
    majority = max(directional.values())
    if minority == 0 and uncertain_or_missing <= 1:
        conflict = ConflictLevel.LOW
    elif majority - minority <= 1 or uncertain_or_missing >= max(2, len(opinions) // 3):
        conflict = ConflictLevel.HIGH
    else:
        conflict = ConflictLevel.MEDIUM

    return consensus, stance_counts, conflict
