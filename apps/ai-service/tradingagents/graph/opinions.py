"""Adapters from graph state to structured agent opinions."""

from __future__ import annotations

import re

from tradingagents.agents.aggregation import (
    aggregate_confidence,
    consensus_from_opinions,
    detect_contradictions,
)
from tradingagents.domain import AgentOpinion, AgentStance, ResearchDebate
from tradingagents.graph.node_names import OpinionSource
from tradingagents.signals.base import SignalResult, SignalScore
from tradingagents.utils.collections import dedupe


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
MISSING_DATA_TERMS = (
    "missing",
    "unavailable",
    "not available",
    "insufficient",
    "no data",
)
RISK_TERMS = (
    "risk",
    "downside",
    "overheated",
    "weak",
    "volatile",
    "liquidation",
    "drawdown",
    "crowded",
    "euphoric",
)
INVALIDATION_TERMS = (
    "invalidate",
    "invalidation",
    "stop",
    "stop-loss",
    "break below",
    "break above",
    "lose",
    "fails",
)
EVIDENCE_TERMS = (
    "because",
    "signal",
    "trend",
    "funding",
    "volume",
    "sentiment",
    "news",
    "on-chain",
    "onchain",
    "evidence",
    "data",
)
_BULLET_BOUNDARY_RE = re.compile(r"(?:^|\n)\s*[-*]\s+")
_SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[.!?])\s+")
_INLINE_WHITESPACE_RE = re.compile(r"[ \t\r\f\v]+")
_DECLARED_CONFIDENCE_RE = re.compile(
    r"""
    (?:
        confidence\s+score|conviction\s+score|confidence|conviction
    )
    \s*(?:[:=]|\bis\b|\bat\b)?\s*
    (?P<value>\d+(?:\.\d+)?)
    \s*(?P<percent>%|percent|pct)?
    """,
    re.IGNORECASE | re.VERBOSE,
)


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
        (
            "Market Analyst",
            "market",
            "market_analyst",
            final_state.get("market_report", ""),
            final_state.get("market_opinion"),
        ),
        (
            "Sentiment Analyst",
            "sentiment",
            "sentiment_analyst",
            final_state.get("sentiment_report", ""),
            final_state.get("sentiment_opinion"),
        ),
        (
            "News Analyst",
            "news",
            "news_analyst",
            final_state.get("news_report", ""),
            final_state.get("news_opinion"),
        ),
        (
            "Onchain Analyst",
            "onchain",
            "onchain_analyst",
            final_state.get("fundamentals_report", ""),
            final_state.get("fundamentals_opinion"),
        ),
    ]
    for agent_name, report_type, role, text, structured in report_sources:
        opinion = _structured_state_opinion(
            structured,
            agent_name,
            research_run_id=research_run_id,
            role=role,
            source_report_type=report_type,
            raw_text=text,
        ) or opinion_from_text(
            agent_name,
            text,
            research_run_id=research_run_id,
            role=role,
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
            role="contrarian"
            if agent_name == OpinionSource.BEAR_RESEARCHER
            else "research",
            source_report_type="investment_debate",
            stance_override=stance,
        )
        if opinion:
            opinions.append(opinion)

    setup_plan = final_state.get("trader_investment_plan")
    if setup_plan:
        setup_opinion = _text_opinion(
            "Setup Planner",
            setup_plan,
            research_run_id=research_run_id,
            role="planning",
            source_report_type="setup_plan",
        )
        if setup_opinion:
            opinions.append(setup_opinion)

    risk = final_state.get("risk_debate_state") or {}
    for agent_name, text, stance in [
        (
            "Risk Analyst - Aggressive",
            risk.get("aggressive_history", ""),
            AgentStance.BULLISH,
        ),
        (
            "Risk Analyst - Conservative",
            risk.get("conservative_history", ""),
            AgentStance.BEARISH,
        ),
        (
            "Risk Analyst - Neutral",
            risk.get("neutral_history", ""),
            AgentStance.NEUTRAL,
        ),
        (
            "Portfolio Manager",
            risk.get("judge_decision", "")
            or final_state.get("final_trade_decision", ""),
            None,
        ),
    ]:
        opinion = _text_opinion(
            agent_name,
            text,
            research_run_id=research_run_id,
            role="risk_analyst"
            if agent_name.startswith("Risk Analyst")
            else "portfolio_manager",
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
    stale_count = _count_stale_mentions(opinions)

    return ResearchDebate(
        research_run_id=research_run_id,
        symbol=symbol,
        consensus_stance=consensus,
        consensus_confidence=aggregate_confidence(
            opinions,
            conflict_level=conflict,
            missing_data_count=len(missing_data),
            stale_count=stale_count,
        ),
        conflict_level=conflict,
        stance_counts=stance_counts,
        opinion_ids=[opinion.id for opinion in opinions if opinion.id],
        contradictions=detect_contradictions(opinions),
        missing_data=dedupe(missing_data)[:10],
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
        agent_name=OpinionSource.QUANT_ANALYST,
        role="quant",
        stance=stance,
        confidence=result.confidence,
        key_evidence=evidence or ([result.summary] if result.summary else []),
        risks=risks,
        missing_data=_quant_missing_data(result),
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
        confidence=_extract_declared_confidence(text),
        key_evidence=_extract_evidence(text, limit=4),
        risks=_extract_sentences(text, terms=RISK_TERMS, limit=4),
        invalidation_conditions=_extract_sentences(
            text, terms=INVALIDATION_TERMS, limit=3
        ),
        missing_data=_extract_sentences(text, terms=MISSING_DATA_TERMS, limit=3),
        raw_text=text,
        source_report_type=source_report_type,
    )


def opinion_from_text(
    agent_name: str,
    text: str,
    *,
    research_run_id: str | None,
    role: str,
    source_report_type: str,
    stance_override: AgentStance | None = None,
) -> AgentOpinion | None:
    """Build a best-effort AgentOpinion from legacy prose text."""
    return _text_opinion(
        agent_name,
        text,
        research_run_id=research_run_id,
        role=role,
        source_report_type=source_report_type,
        stance_override=stance_override,
    )


def _structured_state_opinion(
    value: object,
    agent_name: str,
    *,
    research_run_id: str | None,
    role: str,
    source_report_type: str,
    raw_text: str,
) -> AgentOpinion | None:
    if value is None:
        return None
    try:
        opinion = (
            value
            if isinstance(value, AgentOpinion)
            else AgentOpinion.model_validate(value)
        )
    except Exception:
        return None
    return opinion.model_copy(
        update={
            "research_run_id": research_run_id,
            "agent_name": agent_name,
            "role": role,
            "source_report_type": source_report_type,
            "raw_text": opinion.raw_text or raw_text,
        }
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


def _extract_declared_confidence(text: str) -> float | None:
    match = _DECLARED_CONFIDENCE_RE.search(text)
    if not match:
        return None
    value = float(match.group("value"))
    if match.group("percent") or value > 1:
        value /= 100
    return max(min(value, 1.0), 0.0)


def _extract_evidence(text: str, *, limit: int) -> list[str]:
    evidence = _extract_sentences(text, terms=EVIDENCE_TERMS, limit=limit)
    if len(evidence) >= limit:
        return evidence
    fallback = _extract_sentences(text, terms=(), limit=limit)
    return dedupe(evidence + fallback)[:limit]


def _extract_sentences(text: str, *, terms: tuple[str, ...], limit: int) -> list[str]:
    selected = []
    for sentence in _iter_sentence_candidates(text):
        if terms and not any(term in sentence.lower() for term in terms):
            continue
        selected.append(sentence[:240])
        if len(selected) >= limit:
            break
    return dedupe(selected)


def _iter_sentence_candidates(text: str):
    cleaned = text.strip()
    if not cleaned:
        return

    cleaned = _BULLET_BOUNDARY_RE.sub("\n", cleaned)
    for line in cleaned.splitlines():
        for candidate in _iter_line_candidates(line):
            candidate = _INLINE_WHITESPACE_RE.sub(" ", candidate).strip(" -")
            if not candidate:
                continue
            for sentence in _SENTENCE_BOUNDARY_RE.split(candidate):
                sentence = sentence.strip(" -")
                if sentence:
                    yield sentence


def _iter_line_candidates(line: str):
    stripped = line.strip()
    if not stripped or set(stripped) <= {"-", ":", "|", " "}:
        return

    if "|" in stripped:
        cells = [cell.strip() for cell in stripped.strip("|").split("|")]
        cells = [cell for cell in cells if cell]
        if len(cells) > 1 and len(cells) % 2 == 0:
            for index in range(0, len(cells), 2):
                yield f"{cells[index]}: {cells[index + 1]}"
            return
        if len(cells) > 1:
            for cell in cells:
                yield cell
            return

    yield stripped


def _quant_missing_data(result: SignalResult) -> list[str]:
    missing = []
    for factor in result.factors:
        if factor.data_quality < 0.35:
            missing.append(
                f"{factor.name} data quality is low ({factor.data_quality:.0%})."
            )
    return missing[:5]


def _count_stale_mentions(opinions: list[AgentOpinion]) -> int:
    stale_terms = ("stale", "unknown freshness", "freshness is unknown")
    return sum(
        1
        for opinion in opinions
        if any(term in opinion.raw_text.lower() for term in stale_terms)
    )
