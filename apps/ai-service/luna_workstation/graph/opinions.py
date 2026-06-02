"""Adapters from graph state to structured agent opinions."""

from __future__ import annotations

import re

from luna_workstation.agents.aggregation import (
    aggregate_confidence,
    consensus_from_opinions,
    detect_contradictions,
)
from luna_workstation.domain import AgentOpinion, AgentStance, ResearchDebate
from luna_workstation.graph.node_names import OpinionSource
from luna_workstation.signals.base import SignalResult, SignalScore
from luna_workstation.utils.collections import dedupe


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
    "no feed",
    "unsupported",
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
_ISO_DATE_RE = re.compile(r"\b20\d{2}-\d{2}-\d{2}\b")
_NEWS_FEED_MISSING_MARKERS = (
    "no third-party crypto news feed",
    "missing primary-source crypto headlines",
    "no feed",
    "do not fabricate headlines",
    "news-derived claims are unsupported",
)
_NEWS_CONTEXT_QUALITY_RE = re.compile(
    r"quality\s*:\s*(?P<status>clean|degraded|insufficient_data|insufficient)"
    r"(?:\s*\((?P<score>\d+(?:\.\d+)?)\))?",
    re.IGNORECASE,
)
_NEWS_REASON_CODES = (
    "missing_news_feed",
    "insufficient_news_evidence",
    "aggregator_only_news",
    "search_only_news",
    "stale_news_window",
    "missing_primary_source_news",
    "conflicting_news_sources",
    "low_relevance_news",
    "workspace_news_source_unavailable",
    "no_material_news_found",
)
_NEWS_SOURCE_TYPES = {"news"}
_SOCIAL_SOURCE_TYPES = {"sentiment", "social"}
_NEWS_CODES_RESCOPED_FOR_SOCIAL = {
    "missing_news_feed",
    "insufficient_news_evidence",
    "missing_primary_source_news",
    "workspace_news_source_unavailable",
}
_GENERIC_MISSING_ITEMS = {
    "missing",
    "missing_data",
    "missing_evidence",
    "data",
    "data_unavailable",
    "no_data",
    "unavailable",
    "none",
}


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
    opinion = AgentOpinion(
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
    return normalize_opinion_quality(
        opinion,
        raw_text=text,
        source_report_type=source_report_type,
        stance_override=stance_override,
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
    opinion = opinion.model_copy(
        update={
            "research_run_id": research_run_id,
            "agent_name": agent_name,
            "role": role,
            "source_report_type": source_report_type,
            "raw_text": opinion.raw_text or raw_text,
        }
    )
    return normalize_opinion_quality(
        opinion,
        raw_text=raw_text,
        source_report_type=source_report_type,
    )


def normalize_opinion_quality(
    opinion: AgentOpinion,
    *,
    raw_text: str,
    source_report_type: str,
    stance_override: AgentStance | None = None,
) -> AgentOpinion:
    """Separate market stance from data confidence for persisted opinions."""

    text = raw_text or opinion.raw_text or ""
    missing_data = _clean_missing_data(
        [
            *opinion.missing_data,
            *_extract_sentences(text, terms=MISSING_DATA_TERMS, limit=5),
        ],
        source_report_type=source_report_type,
    )[:8]
    reason_codes = _source_scoped_reason_codes(
        dedupe(
            [
                *opinion.reason_codes,
                *_reason_codes_from_text(
                    text,
                    source_report_type=source_report_type,
                ),
            ]
        ),
        source_report_type=source_report_type,
    )
    data_quality = opinion.data_quality
    stance = opinion.stance
    confidence = opinion.confidence
    news_quality = _news_context_quality(text) if source_report_type == "news" else None

    if (
        source_report_type in _SOCIAL_SOURCE_TYPES
        and "missing_social_feed" in reason_codes
        and "missing_social_feed" not in missing_data
    ):
        missing_data = [*missing_data, "missing_social_feed"][:8]

    if news_quality is not None:
        status, score, context_codes = news_quality
        reason_codes = dedupe([*reason_codes, *context_codes])
        has_no_material_news = "no_material_news_found" in text.lower()
        if status == "clean":
            data_quality = max(data_quality, max(score, 0.75))
            if has_no_material_news:
                stance = AgentStance.NEUTRAL
                reason_codes = dedupe([*reason_codes, "no_material_news_found"])
            missing_data = _drop_news_context_boilerplate(missing_data)
        elif status == "insufficient_data":
            data_quality = min(data_quality, score if score > 0 else 0.25)
            stance = AgentStance.UNCERTAIN
            confidence = _cap_confidence(confidence, 0.25)
            missing_data = dedupe([*missing_data, *context_codes])[:8]
        else:
            data_quality = min(data_quality, score if score > 0 else 0.6)
            confidence = _cap_confidence(confidence, 0.6)
            missing_data = dedupe([*missing_data, *context_codes])[:8]
    elif source_report_type == "news" and not _has_primary_news_evidence(text):
        data_quality = 0.0
        stance = AgentStance.UNCERTAIN
        confidence = _cap_confidence(confidence, 0.2)
        missing_data = dedupe(
            [
                *missing_data,
                "insufficient_news_evidence",
                "missing primary-source crypto headlines",
            ]
        )[:8]
        reason_codes = dedupe(
            [*reason_codes, "missing_news_feed", "insufficient_news_evidence"]
        )
    elif _missing_data_dominates(text, missing_data):
        data_quality = min(data_quality, 0.25)
        if stance_override is None:
            stance = AgentStance.UNCERTAIN
        confidence = _cap_confidence(confidence, 0.25)
        reason_codes = dedupe([*reason_codes, "insufficient_data"])
    elif missing_data:
        data_quality = min(data_quality, 0.6)
        confidence = _cap_confidence(confidence, 0.6)

    if data_quality < 0.35 and stance_override is None:
        stance = AgentStance.UNCERTAIN

    return opinion.model_copy(
        update={
            "stance": stance,
            "confidence": confidence,
            "data_quality": data_quality,
            "data_quality_label": _data_quality_label(data_quality),
            "missing_data": missing_data,
            "reason_codes": reason_codes,
        }
    )


def _infer_stance(text: str) -> AgentStance:
    lowered = text.lower()
    if _missing_data_dominates(
        text, _extract_sentences(text, terms=MISSING_DATA_TERMS, limit=5)
    ):
        return AgentStance.UNCERTAIN
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


def _clean_missing_data(
    items: list[str],
    *,
    source_report_type: str,
) -> list[str]:
    cleaned: list[str] = []
    for item in items:
        normalized = _clean_missing_data_item(
            item,
            source_report_type=source_report_type,
        )
        if normalized:
            cleaned.append(normalized)
    return dedupe(cleaned)


def _clean_missing_data_item(
    item: str,
    *,
    source_report_type: str,
) -> str | None:
    text = str(item or "").strip()
    if not text:
        return None
    normalized = re.sub(r"[`*_#]+", "", text).strip(" :-").lower()
    code_like = re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")
    if code_like in _GENERIC_MISSING_ITEMS or code_like == "0":
        return None
    if code_like.startswith("final_setup_stance"):
        return None

    is_social = source_report_type in _SOCIAL_SOURCE_TYPES
    if is_social and (
        "missing_news_feed" in code_like
        or "news_feed" in code_like
        or "third_party_crypto_news_feed" in code_like
    ):
        return "missing_social_feed"

    explicit_code = re.fullmatch(
        r"(?:missing|insufficient|exchange)_[a-z0-9_]+",
        normalized,
    )
    if code_like in _NEWS_CODES_RESCOPED_FOR_SOCIAL and is_social:
        return "missing_social_feed"
    if explicit_code:
        return code_like
    if source_report_type in _SOCIAL_SOURCE_TYPES:
        return None
    return text


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


def _has_primary_news_evidence(text: str) -> bool:
    lowered = (text or "").lower()
    quality = _news_context_quality(text)
    if quality is not None:
        status, _score, codes = quality
        if status == "clean":
            return True
        if any(
            code in codes
            for code in (
                "missing_primary_source_news",
                "aggregator_only_news",
                "search_only_news",
            )
        ):
            return False
    if any(marker in lowered for marker in _NEWS_FEED_MISSING_MARKERS):
        return False
    if "cryptopanic" in lowered and _ISO_DATE_RE.search(text or ""):
        return True
    has_source = "source" in lowered or "http://" in lowered or "https://" in lowered
    has_published_date = bool(_ISO_DATE_RE.search(text or ""))
    has_headline_language = "headline" in lowered or "title" in lowered
    return has_source and has_published_date and has_headline_language


def _missing_data_dominates(text: str, missing_data: list[str]) -> bool:
    lowered = (text or "").lower()
    if any(marker in lowered for marker in _NEWS_FEED_MISSING_MARKERS):
        return True
    if not missing_data:
        return False
    evidence_hits = sum(lowered.count(term) for term in EVIDENCE_TERMS)
    missing_hits = sum(lowered.count(term) for term in MISSING_DATA_TERMS)
    return missing_hits >= 2 and evidence_hits <= 1


def _reason_codes_from_text(text: str, *, source_report_type: str) -> list[str]:
    lowered = (text or "").lower()
    codes = []
    is_news = source_report_type in _NEWS_SOURCE_TYPES
    is_social = source_report_type in _SOCIAL_SOURCE_TYPES
    if is_news:
        for code in _NEWS_REASON_CODES:
            if code in lowered:
                codes.append(code)
    elif is_social and any(code in lowered for code in _NEWS_CODES_RESCOPED_FOR_SOCIAL):
        codes.append("missing_social_feed")
    if any(marker in lowered for marker in _NEWS_FEED_MISSING_MARKERS):
        codes.append("missing_news_feed" if is_news else "missing_social_feed")
    if "liquidation" in lowered and any(term in lowered for term in MISSING_DATA_TERMS):
        codes.append("missing_liquidations")
    if (
        "on-chain" in lowered or "onchain" in lowered or "exchange flow" in lowered
    ) and any(term in lowered for term in MISSING_DATA_TERMS):
        codes.append("missing_onchain_flows")
    if "funding" in lowered and any(term in lowered for term in MISSING_DATA_TERMS):
        codes.append("missing_funding_rate")
    if "open interest" in lowered and any(
        term in lowered for term in MISSING_DATA_TERMS
    ):
        codes.append("exchange_oi_unsupported")
    return codes


def _source_scoped_reason_codes(
    codes: list[str],
    *,
    source_report_type: str,
) -> list[str]:
    if source_report_type not in _SOCIAL_SOURCE_TYPES:
        return codes
    return dedupe(
        [
            "missing_social_feed" if code in _NEWS_CODES_RESCOPED_FOR_SOCIAL else code
            for code in codes
        ]
    )


def _news_context_quality(text: str) -> tuple[str, float, list[str]] | None:
    lowered = (text or "").lower()
    if "pre-computed news context" not in lowered:
        return None
    match = _NEWS_CONTEXT_QUALITY_RE.search(text or "")
    if not match:
        return None
    status = match.group("status").lower()
    if status == "insufficient":
        status = "insufficient_data"
    raw_score = match.group("score")
    score = 0.0
    if raw_score:
        try:
            score = max(min(float(raw_score), 1.0), 0.0)
        except ValueError:
            score = 0.0
    elif status == "clean":
        score = 0.85
    elif status == "degraded":
        score = 0.6
    codes = [code for code in _NEWS_REASON_CODES if code in lowered]
    return status, score, codes


def _drop_news_context_boilerplate(values: list[str]) -> list[str]:
    out = []
    for value in values:
        lowered = value.lower().strip()
        if lowered in {"none", "- none"}:
            continue
        if lowered.startswith("missing/degraded data"):
            continue
        out.append(value)
    return out


def _cap_confidence(value: float | None, cap: float) -> float | None:
    if value is None:
        return None
    return min(value, cap)


def _data_quality_label(data_quality: float) -> str:
    if data_quality < 0.35:
        return "insufficient_data"
    if data_quality < 0.75:
        return "degraded"
    return "clean"
