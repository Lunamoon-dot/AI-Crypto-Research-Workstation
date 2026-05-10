"""Trade-thesis and assisted-planning helpers for the research graph."""

from __future__ import annotations

import logging
from typing import Any, Callable, Optional

from tradingagents.domain import (
    AgentOpinion,
    PlanningStatus,
    ResearchRun,
    ResearchDebate,
    Signal,
    SignalDirection,
    ThesisDirection,
    TradePlanRecommendation,
    TradeThesis,
)
from tradingagents.templates.registry import TemplateRegistry

logger = logging.getLogger(__name__)


def planning_config(config: dict) -> dict:
    """Return unified planning/paper/sizing knobs.

    Starts from legacy ``execution`` defaults (when present), then overlays
    ``planning`` so newer config wins key-by-key. Nested dicts (e.g.
    ``monitoring``) merge with ``planning`` overriding overlapping keys only.
    """
    exec_dict = dict(config.get("execution") or {})
    plan_dict = dict(config.get("planning") or {})
    merged = dict(exec_dict)
    for k, pv in plan_dict.items():
        if k in merged and isinstance(merged[k], dict) and isinstance(pv, dict):
            sub = dict(merged[k])
            sub.update(pv)
            merged[k] = sub
        else:
            merged[k] = pv
    return merged


def make_planning_result(
    status: str,
    symbol: str,
    reason: str,
    *,
    side: str | None = None,
    action: str | None = None,
    rating: str = "",
    confidence: float | None = None,
    alloc_pct: float | None = None,
    last_price: float | None = None,
    order=None,
    sl: float | None = None,
    tp: float | None = None,
    sizing_reasoning: str = "",
    steps: list[dict] | None = None,
) -> dict:
    """Build the legacy dict shape used by the current CLI panel."""
    recommendation = TradePlanRecommendation(
        status=PlanningStatus(status),
        symbol=symbol,
        side=side,
        action=action,
        rating=rating,
        reason=reason,
        confidence=confidence,
        alloc_pct=alloc_pct,
        last_price=last_price,
        order_id=getattr(order, "id", None),
        filled=getattr(order, "filled", None) or 0,
        avg_price=getattr(order, "avg_price", None) or 0,
        sl=sl,
        tp=tp,
        sizing_reasoning=sizing_reasoning,
        steps=steps or [],
    )
    return recommendation.to_legacy_dict()


def planning_result_to_str(result: dict) -> str:
    """Convert a structured planning result to display string."""
    status = result["status"]
    symbol = result.get("symbol", "")
    reason = result.get("reason", "")
    if status == "planned":
        rating = result.get("rating", "")
        action = result.get("action", "watch")
        return f"TRADE PLAN: {symbol} | rating={rating} | action={action} | manual review required"
    return f"{status.upper()}: {reason}" if reason else f"{status.upper()}: no details"


def build_trade_thesis(
    final_state: dict,
    *,
    process_signal: Callable[[str], str],
    quant_signal_result,
    current_research_run: ResearchRun | None,
    current_signals: list[Signal],
    current_agent_opinions: list[AgentOpinion] | None = None,
    current_debate: ResearchDebate | None = None,
    ticker: str | None = None,
) -> TradeThesis:
    """Create the journal thesis artifact from the final graph state."""
    final_decision = final_state.get("final_trade_decision", "")
    rating = process_signal(final_decision)
    symbol = final_state.get("company_of_interest", ticker)
    confidence = (
        quant_signal_result.confidence if quant_signal_result is not None else None
    )

    direction = thesis_direction_from_rating(rating)
    supporting_signal_ids, contradicting_signal_ids = classify_thesis_signals(
        current_signals,
        direction,
    )
    supporting_opinion_ids, contradicting_opinion_ids = classify_thesis_opinions(
        current_agent_opinions or [],
        direction,
    )
    missing_data = _missing_data_summary(current_agent_opinions or [], current_debate)

    detected_setup = _detect_setup_type(
        final_state=final_state,
        signals=current_signals,
        opinions=current_agent_opinions or [],
        debate=current_debate,
    )

    return TradeThesis(
        research_run_id=current_research_run.id if current_research_run else None,
        debate_id=current_debate.id if current_debate else None,
        symbol=symbol,
        direction=direction,
        setup_type=detected_setup,
        thesis_text=final_decision,
        confidence=confidence,
        risk_notes=[
            "Manual review required before any exchange action.",
            "Autonomous execution is disabled by product policy.",
        ],
        supporting_signal_ids=supporting_signal_ids,
        contradicting_signal_ids=contradicting_signal_ids,
        agent_opinion_ids=[
            opinion.id for opinion in (current_agent_opinions or []) if opinion.id
        ],
        contradictions=current_debate.contradictions if current_debate else [],
        consensus={
            "stance": current_debate.consensus_stance.value if current_debate else None,
            "confidence": current_debate.consensus_confidence if current_debate else None,
            "conflict_level": current_debate.conflict_level.value if current_debate else None,
            "stance_counts": current_debate.stance_counts if current_debate else {},
        },
        evidence={
            "rating": rating,
            "trader_plan": final_state.get("trader_investment_plan", ""),
            "investment_plan": final_state.get("investment_plan", ""),
            "agent_opinion_ids": [
                opinion.id for opinion in (current_agent_opinions or []) if opinion.id
            ],
            "supporting_opinion_ids": supporting_opinion_ids,
            "contradicting_opinion_ids": contradicting_opinion_ids,
            "missing_data": missing_data,
            "conflict_level": current_debate.conflict_level.value if current_debate else None,
            "confidence_adjustment_reason": _confidence_adjustment_reason(
                current_debate,
                missing_data,
            ),
            "debate_id": current_debate.id if current_debate else None,
        },
    )


def thesis_direction_from_rating(rating: str) -> ThesisDirection:
    rating_lower = rating.strip().lower()
    if rating_lower in ("buy", "overweight"):
        return ThesisDirection.LONG
    if rating_lower in ("sell", "underweight"):
        return ThesisDirection.SHORT
    return ThesisDirection.WATCH


def classify_thesis_signals(
    signals: list[Signal],
    direction: ThesisDirection,
) -> tuple[list[str], list[str]]:
    """Classify saved signal IDs against a thesis direction."""
    if direction not in (ThesisDirection.LONG, ThesisDirection.SHORT):
        return [], []

    supporting = []
    contradicting = []
    for signal in signals:
        if not signal.id:
            continue
        if direction == ThesisDirection.LONG:
            if signal.direction == SignalDirection.BULLISH:
                supporting.append(signal.id)
            elif signal.direction == SignalDirection.BEARISH:
                contradicting.append(signal.id)
        elif direction == ThesisDirection.SHORT:
            if signal.direction == SignalDirection.BEARISH:
                supporting.append(signal.id)
            elif signal.direction == SignalDirection.BULLISH:
                contradicting.append(signal.id)
    return supporting, contradicting


def classify_thesis_opinions(
    opinions: list[AgentOpinion],
    direction: ThesisDirection,
) -> tuple[list[str], list[str]]:
    """Classify saved opinion IDs against a thesis direction."""
    if direction not in (ThesisDirection.LONG, ThesisDirection.SHORT):
        return [], []

    supporting = []
    contradicting = []
    for opinion in opinions:
        if not opinion.id:
            continue
        if direction == ThesisDirection.LONG:
            if opinion.stance.value == "bullish":
                supporting.append(opinion.id)
            elif opinion.stance.value == "bearish":
                contradicting.append(opinion.id)
        elif direction == ThesisDirection.SHORT:
            if opinion.stance.value == "bearish":
                supporting.append(opinion.id)
            elif opinion.stance.value == "bullish":
                contradicting.append(opinion.id)
    return supporting, contradicting


def _missing_data_summary(
    opinions: list[AgentOpinion],
    debate: ResearchDebate | None,
) -> list[str]:
    missing = []
    if debate:
        missing.extend(debate.missing_data)
    for opinion in opinions:
        missing.extend(opinion.missing_data)
    seen = set()
    result = []
    for item in missing:
        key = item.lower()
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result[:10]


def _confidence_adjustment_reason(
    debate: ResearchDebate | None,
    missing_data: list[str],
) -> str:
    if not debate:
        return "No persisted debate summary was available."
    reasons = []
    if debate.conflict_level.value != "low":
        reasons.append(f"conflict level is {debate.conflict_level.value}")
    if missing_data:
        reasons.append(f"{len(missing_data)} missing-data item(s)")
    if not reasons:
        return "No material confidence penalty from debate conflict or missing data."
    return "Consensus confidence adjusted because " + " and ".join(reasons) + "."


def build_trade_plan(
    final_state: dict,
    *,
    config: dict,
    process_signal: Callable[[str], str],
    quant_signal_result,
    current_research_run: ResearchRun | None,
    current_signals: list[Signal],
    current_agent_opinions: list[AgentOpinion] | None = None,
    current_debate: ResearchDebate | None = None,
    ticker: str | None = None,
) -> tuple[dict | None, TradeThesis | None]:
    """Build an assisted trade plan and matching thesis artifact."""
    exec_cfg = planning_config(config)
    if not exec_cfg.get("enabled"):
        return None, None

    final_decision = final_state.get("final_trade_decision", "")
    rating = process_signal(final_decision)
    trader_plan = final_state.get("trader_investment_plan", "")
    symbol = final_state.get("company_of_interest", ticker)
    confidence = (
        quant_signal_result.confidence if quant_signal_result is not None else None
    )

    steps: list[dict] = []

    def add_step(phase: str, detail: str, result: str = ""):
        steps.append({"phase": phase, "detail": detail, "result": result})
        logger.info("[%s] %s %s", phase, detail, ("-> " + result) if result else "")

    rating_lower = rating.strip().lower()
    if rating_lower in ("buy", "overweight"):
        side = "buy"
        action = "plan_long"
    elif rating_lower in ("sell", "underweight"):
        side = "sell"
        action = "plan_exit_or_short"
    else:
        side = None
        action = "watch"

    add_step("Mode", "Research workstation safety reset", "No orders are placed")
    add_step("Rating", f"Thesis rating: {rating}", action.replace("_", " ").title())

    thresholds = exec_cfg.get("confidence_thresholds", {})
    force_hold = thresholds.get("force_hold", 0.05)
    if confidence is None:
        add_step("Confidence", "No quantitative confidence available", "Manual review required")
    elif confidence < force_hold:
        add_step(
            "Confidence",
            f"Quant signal confidence: {confidence:.0%}",
            f"Below planning threshold {force_hold:.0%}; treat as watchlist only",
        )
        action = "watch"
        side = None
    else:
        add_step("Confidence", f"Quant signal confidence: {confidence:.0%}", "Use as thesis context")

    thesis = build_trade_thesis(
        final_state,
        process_signal=process_signal,
        quant_signal_result=quant_signal_result,
        current_research_run=current_research_run,
        current_signals=current_signals,
        current_agent_opinions=current_agent_opinions,
        current_debate=current_debate,
        ticker=ticker,
    )
    thesis.direction = {
        "plan_long": ThesisDirection.LONG,
        "plan_exit_or_short": ThesisDirection.SHORT,
        "watch": ThesisDirection.WATCH,
    }[action]
    thesis.supporting_signal_ids, thesis.contradicting_signal_ids = classify_thesis_signals(
        current_signals,
        thesis.direction,
    )

    add_step(
        "Safety",
        "Autonomous execution, bypass blocks, and auto bracket handling are disabled",
        "User approval required outside this graph",
    )

    reason = (
        "AI-generated trade thesis only. Review the analyst evidence, "
        "edit risk levels manually, and confirm outside the research graph "
        "before any exchange action."
    )
    plan = make_planning_result(
        "planned",
        symbol,
        reason,
        side=side,
        action=action,
        rating=rating,
        confidence=confidence,
        alloc_pct=None,
        last_price=None,
        sl=None,
        tp=None,
        sizing_reasoning=trader_plan,
        steps=steps,
    )
    return plan, thesis


def _detect_setup_type(
    *,
    final_state: dict,
    signals: list[Signal],
    opinions: list[AgentOpinion],
    debate: ResearchDebate | None,
) -> str:
    """Build a context dict from agent outputs and detect the best template.

    Falls back to ``"agent_debate"`` when no template-specific keywords are found.
    """
    context: dict[str, Any] = {}

    # Pull keywords from signal types and summaries
    for sig in signals:
        if sig.signal_type:
            context[sig.signal_type] = sig.summary or sig.direction.value

    # Pull keywords from opinion raw_text and key_evidence
    opinion_parts: list[str] = []
    for o in opinions:
        if o.raw_text:
            opinion_parts.append(o.raw_text)
        opinion_parts.extend(o.key_evidence)
    opinion_text = " ".join(opinion_parts).lower()

    # Check for breakout / resistance / support keywords
    breakout_keywords = [
        "breakout", "resistance", "support break", "break above",
        "break below", "level breach", "new high", "new low",
    ]
    if any(kw in opinion_text for kw in breakout_keywords):
        context["resistance_level"] = "detected from analyst context"
        context["volume_confirmation"] = "evaluate from volume profile signal"
        context["funding_state"] = "evaluate from funding/oi signal"
        context["invalidation_level"] = "determined from debate risk assessment"
        context["higher_timeframe_trend"] = "evaluated from regime signal"

    # Range / reversion keywords
    range_keywords = [
        "range", "consolidation", "reversion", "mean revert",
        "oscillation", "channel", "sideways", "range bound",
    ]
    if any(kw in opinion_text for kw in range_keywords):
        context["range_high"] = "detected from analyst context"
        context["range_low"] = "detected from analyst context"
        context["midpoint"] = "range equilibrium"
        context["volume_profile"] = "evaluate from volume profile signal"
        context["funding_state"] = "evaluate from funding/oi signal"

    # Funding / squeeze keywords
    funding_keywords = [
        "funding", "squeeze", "overleveraged", "liquidation cascade",
        "open interest spike", "oi spike", "perp premium",
    ]
    if any(kw in opinion_text for kw in funding_keywords):
        context["funding_rate"] = "evaluate from funding/oi signal"
        context["oi_delta"] = "evaluate from OI change data"
        context["spot_cvd"] = "evaluate from CVD signal"
        context["liquidation_clusters"] = "evaluated from liquidation data"
        context["squeeze_direction"] = "determined from positioning skew"

    # Trend / pullback keywords
    trend_keywords = [
        "pullback", "retracement", "dip buy", "correction in trend",
        "bull trend", "bear trend", "trend continuation",
    ]
    if any(kw in opinion_text for kw in trend_keywords):
        context["trend_direction"] = "evaluated from regime + higher timeframe"
        context["pullback_depth"] = "determined from price action"
        context["support_zone"] = "determined from structure + fib levels"
        context["volume_dry_up"] = "evaluate from volume profile signal"
        context["continuation_trigger"] = "determined from price action setup"

    # News event keywords
    news_keywords = [
        "news", "announcement", "headline", "regulatory",
        "sec", "cftc", "etf", "filing", "partnership",
    ]
    if any(kw in opinion_text for kw in news_keywords):
        context["event_type"] = "news catalyst"
        context["sentiment_shift"] = "evaluate from sentiment signals"
        context["volume_spike"] = "evaluate from volume profile"
        context["initial_reaction"] = "evaluated from price action"
        context["fade_risk"] = "assess based on event significance"

    # Macro event keywords
    macro_keywords = [
        "fomc", "cpi", "nfp", "gdp", "fed", "macro",
        "dxy", "yield", "rate decision", "inflation",
    ]
    if any(kw in opinion_text for kw in macro_keywords):
        context["event_name"] = "macro catalyst"
        context["expected_impact"] = "evaluate from volatility context"
        context["market_reaction"] = "evaluated from cross-asset data"
        context["correlation_break"] = "evaluated from correlation data"
        context["risk_assets_direction"] = "evaluated from broader market"

    # Liquidity sweep keywords
    sweep_keywords = [
        "stop hunt", "liquidity grab", "sweep", "wick",
        "equal lows", "equal highs", "stop run", "fakeout",
    ]
    if any(kw in opinion_text for kw in sweep_keywords):
        context["sweep_level"] = "detected from price structure"
        context["prior_range"] = "detected from prior consolidation"
        context["reclaim_level"] = "determined from sweep reversal level"
        context["volume_signature"] = "evaluated from volume + CVD pattern"
        context["trapped_trader_direction"] = "determined from sweep direction"

    # Include debate contradictions as additional signal
    if debate and debate.contradictions:
        context["contradictions"] = "; ".join(debate.contradictions[:3])

    # Include final decision text for keyword extraction
    final_text = final_state.get("final_trade_decision", "")
    if final_text:
        context["_decision_text"] = final_text[:500]

    return TemplateRegistry.detect(context)
