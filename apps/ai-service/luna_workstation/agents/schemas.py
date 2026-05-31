"""Pydantic schemas used by agents that produce structured output.

The framework's primary artifact is still prose: each agent's natural-language
reasoning is what users read in the saved markdown reports and what the
downstream agents read as context.  Structured output is layered onto the
three decision-making agents (Research Manager, Setup Planner, Portfolio
Manager) so that:

- Their outputs follow consistent section headers across runs and providers
- Each provider's native structured-output mode is used (json_schema for
  OpenAI/xAI, response_schema for Gemini, tool-use for Anthropic)
- Schema field descriptions become the model's output instructions, freeing
  the prompt body to focus on context and the rating-scale guidance
- A render helper turns the parsed Pydantic instance back into the same
  markdown shape the rest of the system already consumes, so display,
  memory log, and saved reports keep working unchanged
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field, field_validator

from luna_workstation.agents.utils.thesis_json import render_trade_thesis_json_block
from luna_workstation.domain.thesis import (
    ResearchEvidenceItem,
    StructuredResearchItem,
    research_item_texts,
)


# ---------------------------------------------------------------------------
# Shared rating types
# ---------------------------------------------------------------------------


class PortfolioRating(str, Enum):
    """5-tier research stance used by the Research and Portfolio Managers."""

    BUY = "Buy"
    OVERWEIGHT = "Overweight"
    HOLD = "Hold"
    UNDERWEIGHT = "Underweight"
    SELL = "Sell"


class MarketType(str, Enum):
    """Research market type for spot/perp setup planning."""

    SPOT = "spot"
    PERP = "perp"


class SetupAction(str, Enum):
    """3-tier setup direction used by the Setup Planner.

    The Setup Planner translates the Research Manager's investment plan into
    a research setup proposal for manual review: bullish setup, bearish setup,
    or Hold/Watch. Nuanced Overweight / Underweight research stances happen
    later at the Portfolio Manager.
    """

    BUY = "Buy"
    HOLD = "Hold"
    SELL = "Sell"


# Backward-compatible public aliases. Keep these until downstream callers
# have migrated from the old Trader naming.
TraderAction = SetupAction


# ---------------------------------------------------------------------------
# Research Manager
# ---------------------------------------------------------------------------


class ResearchPlan(BaseModel):
    """Structured investment plan produced by the Research Manager.

    Hand-off to the Setup Planner: the recommendation pins the research stance,
    the rationale captures which side of the bull/bear debate carried the
    argument, and the strategic actions translate that into concrete
    setup-planning guidance for manual review.
    """

    recommendation: PortfolioRating = Field(
        description=(
            "The research stance. Exactly one of Buy / Overweight / "
            "Hold / Underweight / Sell. Reserve Hold for situations where the "
            "evidence on both sides is genuinely balanced; otherwise commit to "
            "the side with the stronger arguments."
        ),
    )
    rationale: str = Field(
        description=(
            "Conversational summary of the key points from both sides of the "
            "debate, ending with which arguments led to the recommendation. "
            "Speak naturally, as if to a teammate."
        ),
    )
    strategic_actions: str = Field(
        description=(
            "Concrete review focus for the Setup Planner to convert into a "
            "research setup, including attention/conviction guidance consistent "
            "with the rating."
        ),
    )


def render_research_plan(plan: ResearchPlan) -> str:
    """Render a ResearchPlan to markdown for storage and setup-planner context."""
    return "\n".join(
        [
            f"**Research Stance**: {plan.recommendation.value}",
            "",
            f"**Rationale**: {plan.rationale}",
            "",
            f"**Review Focus**: {plan.strategic_actions}",
        ]
    )


# ---------------------------------------------------------------------------
# Setup Planner
# ---------------------------------------------------------------------------


class SetupProposal(BaseModel):
    """Structured research setup proposal produced by the Setup Planner.

    The Setup Planner reads the Research Manager's investment plan and the
    analyst reports, then turns them into a spot/perp-aware setup proposal
    for manual review. It does not route orders or imply automated execution.
    """

    market_type: MarketType = Field(
        default=MarketType.SPOT,
        description="The market structure being researched. Exactly one of spot or perp.",
    )
    action: SetupAction = Field(
        description=(
            "The setup stance. Exactly one of Buy / Hold / Sell, interpreted as "
            "bullish setup / watch / bearish or avoid setup."
        ),
    )
    reasoning: str = Field(
        description=(
            "The case for this setup stance, anchored in the analysts' reports and "
            "the research plan. Two to four sentences."
        ),
    )
    entry_zone: Optional[str] = Field(
        default=None,
        description="Setup area or trigger zone for manual review.",
    )
    invalidation: Optional[str] = Field(
        default=None,
        description="Condition or level that invalidates the setup.",
    )
    target_zones: list[str] = Field(
        default_factory=list,
        description="Potential thesis confirmation or objective zones for the setup.",
    )
    position_sizing: Optional[str] = Field(
        default=None,
        description="Optional attention or conviction sizing context for manual review.",
    )
    spot_notes: Optional[str] = Field(
        default=None,
        description="Spot-specific research notes such as DCA context or allocation risk.",
    )
    perp_notes: Optional[str] = Field(
        default=None,
        description=(
            "Perp-specific notes such as funding, OI, liquidation risk, "
            "leverage cap, or margin risk."
        ),
    )
    missing_data: list[str] = Field(
        default_factory=list,
        description="Missing data that weakens confidence in the setup.",
    )

    # Legacy field names accepted for backward compatibility with older
    # structured-output tests and external callers.
    entry_price: Optional[float] = Field(
        default=None,
        description="Optional entry price target in the instrument's quote currency.",
    )
    stop_loss: Optional[float] = Field(
        default=None,
        description="Optional stop-loss price in the instrument's quote currency.",
    )
    take_profit: Optional[float] = Field(
        default=None,
        description="Optional take-profit price in the instrument's quote currency.",
    )

    @field_validator("market_type", mode="before")
    @classmethod
    def _normalize_market_type(cls, value: Any) -> MarketType:
        if isinstance(value, MarketType):
            return value
        normalized = str(value or "spot").strip().lower()
        if normalized in {"perp", "perpetual", "futures", "future"}:
            return MarketType.PERP
        return MarketType.SPOT

    @field_validator("target_zones", "missing_data", mode="before")
    @classmethod
    def _normalize_text_list(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            value = list(value) if isinstance(value, tuple) else [value]
        return [str(item).strip() for item in value if str(item).strip()]


TraderProposal = SetupProposal


def render_setup_proposal(proposal: SetupProposal) -> str:
    """Render a SetupProposal to markdown for downstream agents and reports."""
    entry_zone = proposal.entry_zone
    if not entry_zone and proposal.entry_price is not None:
        entry_zone = str(proposal.entry_price)

    invalidation = proposal.invalidation
    if not invalidation and proposal.stop_loss is not None:
        invalidation = str(proposal.stop_loss)

    target_zones = list(proposal.target_zones)
    if not target_zones and proposal.take_profit is not None:
        target_zones = [str(proposal.take_profit)]

    market_label = proposal.market_type.value
    parts = [
        f"**Market Type**: {market_label}",
        "",
        f"**Setup Stance**: {proposal.action.value}",
        "",
        f"**Reasoning**: {proposal.reasoning}",
    ]
    if entry_zone:
        parts.extend(["", f"**Review Zone**: {entry_zone}"])
    if invalidation:
        parts.extend(["", f"**Invalidation**: {invalidation}"])
    if target_zones:
        parts.extend(["", "**Objective Zones**: " + "; ".join(target_zones)])
    if proposal.position_sizing:
        parts.extend(["", f"**Conviction Context**: {proposal.position_sizing}"])
    if proposal.spot_notes:
        parts.extend(["", f"**Spot Notes**: {proposal.spot_notes}"])
    if proposal.perp_notes:
        parts.extend(["", f"**Perp Notes**: {proposal.perp_notes}"])
    if proposal.missing_data:
        parts.extend(["", "**Missing Data**: " + "; ".join(proposal.missing_data)])
    parts.extend(
        [
            "",
            f"FINAL SETUP STANCE: **{proposal.action.value.upper()}**",
        ]
    )
    return "\n".join(parts)


def render_trader_proposal(proposal: TraderProposal) -> str:
    """Backward-compatible alias for render_setup_proposal."""
    return render_setup_proposal(proposal)


# ---------------------------------------------------------------------------
# Portfolio Manager
# ---------------------------------------------------------------------------


class PortfolioDecision(BaseModel):
    """Structured output produced by the Portfolio Manager.

    The model fills every field as part of its primary LLM call; no separate
    extraction pass is required. Field descriptions double as the model's
    output instructions, so the prompt body only needs to convey context and
    the rating-scale guidance.
    """

    rating: PortfolioRating = Field(
        description=(
            "The final position rating. Exactly one of Buy / Overweight / Hold / "
            "Underweight / Sell, interpreted as a research stance based on the "
            "analysts' debate."
        ),
    )
    executive_summary: str = Field(
        description=(
            "A concise research summary covering thesis stance, conviction, key "
            "risk levels, and time horizon. Two to four sentences."
        ),
    )
    investment_thesis: str = Field(
        description=(
            "Detailed reasoning anchored in specific evidence from the analysts' "
            "debate. If prior lessons are referenced in the prompt context, "
            "incorporate them; otherwise rely solely on the current analysis."
        ),
    )
    price_target: Optional[float] = Field(
        default=None,
        description="Optional target price in the instrument's quote currency.",
    )
    time_horizon: Optional[str] = Field(
        default=None,
        description="Optional recommended holding period, e.g. '3-6 months'.",
    )
    market_type: MarketType = Field(
        default=MarketType.SPOT,
        description="Market structure for the final thesis. Exactly spot or perp.",
    )
    confidence: Optional[float] = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description=(
            "Final thesis confidence on a 0.0-1.0 scale. This is the Portfolio "
            "Manager's conviction in the final research stance after weighing "
            "debate consensus, quant baseline, missing data, conflict, and risk. "
            "Do not copy the quant confidence mechanically."
        ),
    )
    action_summary: str = Field(
        default="",
        description=(
            "Short UI-ready research summary. Keep it under 120 characters, e.g. "
            "'Reduce conviction until reclaim confirmation'."
        ),
    )
    upside_catalyst: str = Field(
        default="",
        description=(
            "Concrete condition that would improve the thesis or justify "
            "increased attention. Include a price/volume/event trigger when possible."
        ),
    )
    invalidation: str = Field(
        default="",
        description=(
            "Concrete condition that invalidates the position thesis. Include "
            "specific price levels or event thresholds when possible."
        ),
    )
    key_reasons: list[str | StructuredResearchItem] = Field(
        default_factory=list,
        description=(
            "Three concise reasons behind the final rating. Prefer objects with "
            "text and supporting_evidence evidence items."
        ),
    )
    risks: list[str | StructuredResearchItem] = Field(
        default_factory=list,
        description=(
            "Main risks, missing data, or caveats that could weaken the thesis. "
            "Prefer objects with text and supporting_evidence evidence items."
        ),
    )
    monitor_next: list[str | StructuredResearchItem] = Field(
        default_factory=list,
        description="Watchpoints to monitor next, preferably with supporting_evidence.",
    )
    supporting_evidence: list[ResearchEvidenceItem] = Field(
        default_factory=list,
        description="Global thesis evidence used only when an item lacks its own evidence.",
    )
    spot_notes: str = Field(
        default="",
        description="Spot-specific notes such as DCA, accumulation, or allocation guidance.",
    )
    perp_notes: str = Field(
        default="",
        description=(
            "Perp-specific notes such as funding, OI, liquidation risk, "
            "leverage cap, or margin risk."
        ),
    )
    missing_data: list[str] = Field(
        default_factory=list,
        description="Missing data that weakens confidence in the final thesis.",
    )

    @field_validator("market_type", mode="before")
    @classmethod
    def _normalize_market_type(cls, value: Any) -> MarketType:
        if isinstance(value, MarketType):
            return value
        normalized = str(value or "spot").strip().lower()
        if normalized in {"perp", "perpetual", "futures", "future"}:
            return MarketType.PERP
        return MarketType.SPOT

    @field_validator("confidence", mode="before")
    @classmethod
    def _normalize_confidence(cls, value: Any) -> float | None:
        if value is None or value == "":
            return None
        if isinstance(value, str):
            raw = value.strip()
            is_percent = raw.endswith("%")
            raw = raw.rstrip("%").strip()
            try:
                number = float(raw)
            except ValueError:
                return None
            if is_percent or number > 1:
                number = number / 100
            return max(min(number, 1.0), 0.0)
        return value

    @field_validator("missing_data", mode="before")
    @classmethod
    def _normalize_missing_data(cls, value: Any) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            value = [value]
        if not isinstance(value, list):
            value = list(value) if isinstance(value, tuple) else [value]
        return [str(item).strip()[:500] for item in value if str(item).strip()]


def render_pm_decision(decision: PortfolioDecision) -> str:
    """Render a PortfolioDecision back to the markdown shape the rest of the system expects.

    Memory log, CLI display, and saved report files all read this markdown,
    so the rendered output preserves parseable section headers (``**Rating**``,
    ``**Research Summary**``, ``**Investment Thesis**``) that downstream
    parsers and the report writers already handle.
    """
    parts = [
        f"**Rating**: {decision.rating.value}",
        "",
        f"**Research Summary**: {decision.executive_summary}",
        "",
        f"**Investment Thesis**: {decision.investment_thesis}",
    ]
    if decision.price_target is not None:
        parts.extend(["", f"**Price Target**: {decision.price_target}"])
    if decision.time_horizon:
        parts.extend(["", f"**Time Horizon**: {decision.time_horizon}"])
    parts.extend(["", f"**Market Type**: {decision.market_type.value}"])
    if decision.invalidation:
        parts.extend(["", f"**Invalidation**: {decision.invalidation}"])
    if decision.upside_catalyst:
        parts.extend(["", f"**Upside Catalyst**: {decision.upside_catalyst}"])
    if decision.risks:
        parts.extend(
            ["", "**Risks**: " + "; ".join(research_item_texts(decision.risks))]
        )
    if decision.spot_notes:
        parts.extend(["", f"**Spot Notes**: {decision.spot_notes}"])
    if decision.perp_notes:
        parts.extend(["", f"**Perp Notes**: {decision.perp_notes}"])
    if decision.missing_data:
        parts.extend(["", "**Missing Data**: " + "; ".join(decision.missing_data)])
    parts.extend(["", render_trade_thesis_json_block(_pm_summary_payload(decision))])
    return "\n".join(parts)


def _pm_summary_payload(decision: PortfolioDecision) -> dict[str, Any]:
    direction_by_rating = {
        PortfolioRating.BUY: "long",
        PortfolioRating.OVERWEIGHT: "long",
        PortfolioRating.HOLD: "watch",
        PortfolioRating.UNDERWEIGHT: "avoid",
        PortfolioRating.SELL: "short",
    }
    return {
        "rating": decision.rating.value,
        "direction": direction_by_rating[decision.rating],
        "confidence": decision.confidence,
        "market_type": decision.market_type.value,
        "action_summary": decision.action_summary or decision.executive_summary,
        "upside_catalyst": decision.upside_catalyst,
        "invalidation": decision.invalidation,
        "key_reasons": _json_ready_items(decision.key_reasons),
        "risks": _json_ready_items(decision.risks),
        "monitor_next": _json_ready_items(decision.monitor_next),
        "supporting_evidence": _json_ready_items(decision.supporting_evidence),
        "spot_notes": decision.spot_notes,
        "perp_notes": decision.perp_notes,
        "missing_data": decision.missing_data,
    }


def _json_ready_items(values: list[Any]) -> list[Any]:
    result: list[Any] = []
    for value in values:
        if isinstance(value, BaseModel):
            result.append(value.model_dump(mode="json"))
        else:
            result.append(value)
    return result


# ---------------------------------------------------------------------------
# Scenario Planner
# ---------------------------------------------------------------------------


class ScenarioItem(BaseModel):
    """A single conditional market scenario produced by the Scenario Planner."""

    condition: str = Field(
        description=(
            "Concrete trigger condition with specific price levels, indicator "
            "values, or event thresholds from the reports and debate context. "
            "Do not attach a specific calendar date to a level or event unless "
            "that date appears in the source context; use phrasing like "
            "'prior breakout/support/resistance level' when the source gives "
            "a level without a date. "
            "E.g. 'If BTC breaks above $108,000 resistance with spot CVD "
            "turning positive and funding resetting below 0.01%'."
        ),
    )
    expected_behavior: str = Field(
        description=(
            "Expected market behavior if the condition triggers. Include "
            "likely follow-through, target zones, and timeframe."
        ),
    )
    probability_band: str = Field(
        description="Estimated likelihood: 'high', 'medium', or 'low'.",
    )
    invalidation: str = Field(
        description=(
            "Concrete condition that would invalidate this scenario. Include "
            "specific levels or thresholds from the thesis context."
        ),
    )
    risk_factors: list[str] = Field(
        description=(
            "Key risks that could undermine this scenario. Pull from debate "
            "contradictions, signal staleness, and thesis risk notes."
        ),
    )
    suggested_action: str = Field(
        description=(
            "Suggested user action for this branch: e.g. 'review long thesis', "
            "'stand aside', 'watch', 'reduce confidence and review evidence'."
        ),
    )


class ScenarioPlan(BaseModel):
    """Structured scenario map produced by the Scenario Planner.

    Contains 3-4 conditional market scenarios that together cover the
    directional-confirmation, invalidation, neutral-wait, and (when applicable)
    contradiction branches for the current thesis.
    """

    setup_type: str = Field(
        description=(
            "The detected setup template name: e.g. 'breakout', 'range_reversion', "
            "'trend_pullback', or 'agent_debate'."
        ),
    )
    scenarios: list[ScenarioItem] = Field(
        description="3-4 conditional scenarios covering the thesis decision space.",
    )


def render_scenario_plan(plan: ScenarioPlan) -> str:
    """Render a ScenarioPlan to markdown for storage and downstream display."""
    lines = [f"**Setup Type**: {plan.setup_type}", ""]
    for i, s in enumerate(plan.scenarios, 1):
        lines.extend(
            [
                f"### Scenario {i}: {s.probability_band.upper()} probability",
                "",
                f"**Condition**: {s.condition}",
                "",
                f"**Expected Behavior**: {s.expected_behavior}",
                "",
                f"**Invalidation**: {s.invalidation}",
                "",
                f"**Risk Factors**: {', '.join(s.risk_factors) if s.risk_factors else 'Manual review required.'}",
                "",
                f"**Suggested Action**: {s.suggested_action}",
                "",
            ]
        )
    return "\n".join(lines)
