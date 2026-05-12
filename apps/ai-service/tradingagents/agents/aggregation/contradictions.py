"""Contradiction detection for structured agent opinions."""

from __future__ import annotations

from tradingagents.domain import AgentOpinion, AgentStance


def detect_contradictions(opinions: list[AgentOpinion]) -> list[str]:
    """Expose typed disagreement between bullish and bearish opinions."""

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
    contradictions.extend(_missing_data_contradictions(opinions))
    for bull in bullish[:3]:
        for bear in bearish[:3]:
            contradiction_type = _classify_contradiction(bull, bear)
            contradictions.append(
                f"{contradiction_type}: {bull.agent_name} is bullish because {bull.key_evidence[0]}; "
                f"{bear.agent_name} is bearish because {bear.key_evidence[0]}."
            )
    return contradictions[:6]


def _classify_contradiction(bull: AgentOpinion, bear: AgentOpinion) -> str:
    combined = " ".join(
        bull.key_evidence[:2]
        + bear.key_evidence[:2]
        + [
            bull.agent_name,
            bear.agent_name,
            bull.source_report_type or "",
            bear.source_report_type or "",
        ]
    ).lower()
    if "sentiment" in combined and ("signal" in combined or "quant" in combined):
        return "signal_vs_sentiment"
    if "trend" in combined and "funding" in combined:
        return "trend_vs_funding"
    if "news" in combined and "volume" in combined:
        return "news_vs_volume"
    if "macro" in combined and (
        "crypto" in combined or "bitcoin" in combined or "btc" in combined
    ):
        return "macro_vs_crypto"
    if "risk" in combined or "portfolio" in combined:
        return "risk_vs_thesis"
    return "directional_disagreement"


def _missing_data_contradictions(opinions: list[AgentOpinion]) -> list[str]:
    messages = []
    for opinion in opinions:
        if opinion.missing_data:
            messages.append(
                f"missing_data: {opinion.agent_name} reported missing data: {opinion.missing_data[0]}"
            )
    return messages[:2]
