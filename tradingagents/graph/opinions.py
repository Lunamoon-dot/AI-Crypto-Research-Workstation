"""Adapters from graph state to structured agent opinions."""

from __future__ import annotations

import re

from tradingagents.agents.aggregation import (
    aggregate_confidence,
    consensus_from_opinions,
    detect_contradictions,
)
from tradingagents.domain import AgentOpinion, AgentStance, ResearchDebate
from tradingagents.signals.base import SignalResult, SignalScore


BULLISH_TERMS = (
    "bullish",
    "buy",
    "overweight",
    "upside",
    "breakout",
    "accumulation",
    "support",
    "positive",
    "growth",
)
BEARISH_TERMS = (
    "bearish",
    "sell",
    "underweight",
    "downside",
    "breakdown",
    "overheated",
    "resistance",
    "negative",
    "risk",
)
MISSING_DATA_TERMS = ("missing", "unavailable", "not available", "insufficient", "no data")
RISK_TERMS = ("risk", "downside", "overheated", "weak", "volatile", "liquidation", "drawdown")
INVALIDATION_TERMS = ("invalidate", "invalidation", "stop", "break below", "break above", "lose")


def build_agent_opinions(
    final_state: dict,
    *,
    research_run_id: str | None,
    quant_signal_result: SignalResult | None,
) -> list[AgentOpinion]:
    """Build typed opinions from the current graph's reports and debates."""

    opinions: list[AgentOpinion] = []
    if quant_signal_result is not None:
        opinions.append(_quant_opinion(quant_signal_result, research_run_id))

    report_sources = [
        ("Market Analyst", "market", final_state.get("market_report", "")),
        ("Sentiment Analyst", "sentiment", final_state.get("sentiment_report", "")),
        ("News Analyst", "news", final_state.get("news_report", "")),
        ("Onchain Analyst", "onchain", final_state.get("fundamentals_report", "")),
    ]
    for agent_name, report_type, text in report_sources:
        opinion = _text_opinion(
            agent_name,
            text,
            research_run_id=research_run_id,
            role="analyst",
            source_report_type=report_type,
        )
        if opinion:
            opinions.append(opinion)

    debate = final_state.get("investment_debate_state") or {}
    for agent_name, text, stance in [
        ("Bull Researcher", debate.get("bull_history", ""), AgentStance.BULLISH),
        ("Contrarian Analyst", debate.get("bear_history", ""), AgentStance.BEARISH),
        ("Research Manager", debate.get("judge_decision", ""), None),
    ]:
        opinion = _text_opinion(
            agent_name,
            text,
            research_run_id=research_run_id,
            role="research",
            source_report_type="investment_debate",
            stance_override=stance,
        )
        if opinion:
            opinions.append(opinion)

    if final_state.get("trader_investment_plan"):
        opinions.append(
            _text_opinion(
                "Trader",
                final_state["trader_investment_plan"],
                research_run_id=research_run_id,
                role="planning",
                source_report_type="trader_plan",
            )
        )

    risk = final_state.get("risk_debate_state") or {}
    for agent_name, text, stance in [
        ("Aggressive Risk Analyst", risk.get("aggressive_history", ""), AgentStance.BULLISH),
        ("Conservative Risk Analyst", risk.get("conservative_history", ""), AgentStance.BEARISH),
        ("Neutral Risk Analyst", risk.get("neutral_history", ""), AgentStance.NEUTRAL),
        ("Portfolio Manager", risk.get("judge_decision", "") or final_state.get("final_trade_decision", ""), None),
    ]:
        opinion = _text_opinion(
            agent_name,
            text,
            research_run_id=research_run_id,
            role="risk",
            source_report_type="risk_debate",
            stance_override=stance,
        )
        if opinion:
            opinions.append(opinion)

    return [opinion for opinion in opinions if opinion is not None]


def build_research_debate(
    *,
    symbol: str,
    research_run_id: str | None,
    opinions: list[AgentOpinion],
) -> ResearchDebate:
    """Aggregate saved opinions into a persisted debate summary."""

    consensus, stance_counts, conflict = consensus_from_opinions(opinions)
    missing_data = []
    for opinion in opinions:
        missing_data.extend(opinion.missing_data)

    return ResearchDebate(
        research_run_id=research_run_id,
        symbol=symbol,
        consensus_stance=consensus,
        consensus_confidence=aggregate_confidence(opinions),
        conflict_level=conflict,
        stance_counts=stance_counts,
        opinion_ids=[opinion.id for opinion in opinions if opinion.id],
        contradictions=detect_contradictions(opinions),
        missing_data=_dedupe(missing_data)[:10],
    )


def _quant_opinion(
    result: SignalResult,
    research_run_id: str | None,
) -> AgentOpinion:
    stance = {
        SignalScore.STRONG_BUY: AgentStance.BULLISH,
        SignalScore.BUY: AgentStance.BULLISH,
        SignalScore.NEUTRAL: AgentStance.NEUTRAL,
        SignalScore.SELL: AgentStance.BEARISH,
        SignalScore.STRONG_SELL: AgentStance.BEARISH,
    }.get(result.score, AgentStance.UNCERTAIN)
    evidence = [
        factor.detail or f"{factor.name}: {factor.score.value}"
        for factor in result.factors[:5]
    ]
    risks = [
        factor.detail
        for factor in result.factors
        if factor.detail and factor.score in (SignalScore.SELL, SignalScore.STRONG_SELL)
    ][:5]
    return AgentOpinion(
        research_run_id=research_run_id,
        agent_name="Quant Analyst",
        role="quant",
        stance=stance,
        confidence=result.confidence,
        key_evidence=evidence or ([result.summary] if result.summary else []),
        risks=risks,
        raw_text=result.to_prompt_block(),
        source_report_type="quant_signal",
    )


def _text_opinion(
    agent_name: str,
    text: str,
    *,
    research_run_id: str | None,
    role: str,
    source_report_type: str,
    stance_override: AgentStance | None = None,
) -> AgentOpinion | None:
    text = (text or "").strip()
    if not text:
        return None
    stance = stance_override or _infer_stance(text)
    return AgentOpinion(
        research_run_id=research_run_id,
        agent_name=agent_name,
        role=role,
        stance=stance,
        confidence=_infer_confidence(text, stance),
        key_evidence=_extract_sentences(text, terms=(), limit=4),
        risks=_extract_sentences(text, terms=RISK_TERMS, limit=4),
        invalidation_conditions=_extract_sentences(text, terms=INVALIDATION_TERMS, limit=3),
        missing_data=_extract_sentences(text, terms=MISSING_DATA_TERMS, limit=3),
        raw_text=text,
        source_report_type=source_report_type,
    )


def _infer_stance(text: str) -> AgentStance:
    lowered = text.lower()
    bullish = sum(lowered.count(term) for term in BULLISH_TERMS)
    bearish = sum(lowered.count(term) for term in BEARISH_TERMS)
    if bullish == bearish == 0:
        return AgentStance.UNCERTAIN
    if abs(bullish - bearish) <= 1:
        return AgentStance.NEUTRAL
    return AgentStance.BULLISH if bullish > bearish else AgentStance.BEARISH


def _infer_confidence(text: str, stance: AgentStance) -> float:
    base = 0.4 if stance == AgentStance.UNCERTAIN else 0.55
    length_bonus = min(len(text) / 5000, 0.2)
    evidence_bonus = min(len(_extract_sentences(text, terms=(), limit=6)) * 0.03, 0.18)
    return min(base + length_bonus + evidence_bonus, 0.85)


def _extract_sentences(text: str, *, terms: tuple[str, ...], limit: int) -> list[str]:
    cleaned = re.sub(r"\s+", " ", text.replace("|", " ")).strip()
    if not cleaned:
        return []
    pieces = re.split(r"(?<=[.!?])\s+|(?:\n|^)\s*[-*]\s+", cleaned)
    selected = []
    for piece in pieces:
        sentence = piece.strip(" -")
        if not sentence:
            continue
        if terms and not any(term in sentence.lower() for term in terms):
            continue
        selected.append(sentence[:240])
        if len(selected) >= limit:
            break
    return _dedupe(selected)


def _dedupe(values: list[str]) -> list[str]:
    seen = set()
    deduped = []
    for value in values:
        key = value.lower()
        if key in seen:
            continue
        seen.add(key)
        deduped.append(value)
    return deduped
