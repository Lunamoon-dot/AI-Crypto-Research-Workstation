"""Trade-thesis and assisted-planning helpers for the research graph."""

from __future__ import annotations

import logging
from typing import Callable, Optional

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

logger = logging.getLogger(__name__)


def planning_config(config: dict) -> dict:
    """Return assisted-planning config with legacy execution-key fallback."""
    planning_cfg = config.get("planning")
    if planning_cfg is not None:
        return planning_cfg
    return config.get("execution", {})


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

    return TradeThesis(
        research_run_id=current_research_run.id if current_research_run else None,
        debate_id=current_debate.id if current_debate else None,
        symbol=symbol,
        direction=direction,
        setup_type="agent_debate",
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
