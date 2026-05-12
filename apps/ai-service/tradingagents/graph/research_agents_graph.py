# TradingAgents/graph/research_agents_graph.py

import logging
import os
import json
import uuid
import asyncio
from contextlib import nullcontext
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional

from pydantic import ValidationError

logger = logging.getLogger(__name__)


from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.config_validation import validate_and_normalize_config
from tradingagents.dataflows.config import config_context
from tradingagents.dataflows.utils import safe_ticker_component
from .checkpointer import checkpoint_step, clear_checkpoint, get_checkpointer, thread_id
from .conditional_logic import ConditionalLogic
from .quant_signals import precompute_quant_signal
from .propagation import Propagator
from .tooling import create_tool_nodes
from .config_hash import compute_config_hash
from .graph_factory import GraphFactory
from .journal_coordinator import JournalCoordinator
from .report_writer import ReportWriter
from .run_orchestrator import ResearchRunOrchestrator
from .thesis_builder import ThesisBuilder
from .tool_runtime import ToolRuntime

from tradingagents.domain import (
    AgentOpinion,
    ResearchDebate,
    ResearchRun,
    ResearchRunStatus,
    Signal,
    SignalDirection,
    ThesisDirection,
    TradeThesis,
    TradeThesisStructuredSummary,
)
from tradingagents.agents.utils.thesis_json import (
    extract_trade_thesis_json,
    strip_trade_thesis_json_block,
)
from tradingagents.reporting import ReportGenerator
from tradingagents.observability import (
    bind_observability_context,
    configure_opentelemetry,
    log_event,
    observability_context,
    observability_run_event_persistence,
    start_span,
)
from tradingagents.graph.journal_mixin import JournalPersistenceMixin


@dataclass
class GraphRunContext:
    """Mutable per-run state kept out of the graph object's top-level fields."""

    curr_state: dict[str, Any] | None = None
    ticker: str | None = None
    current_research_run: ResearchRun | None = None
    current_trade_thesis: TradeThesis | None = None
    current_signals: list[Signal] = field(default_factory=list)
    current_agent_opinions: list[AgentOpinion] = field(default_factory=list)
    current_debate: ResearchDebate | None = None
    log_states_dict: dict[str, Any] = field(default_factory=dict)
    quant_signal_result: Any = None
    replay_thread_id: str | None = None
    current_scenario_plan: str = ""


# ---------------------------------------------------------------------------
# Thesis text parsing helpers
# ---------------------------------------------------------------------------

import re as _re


def _extract_thesis_field(text: str, field: str) -> str | None:
    """Extract a single value for a named field from thesis text.

    Looks for patterns like:
        **Entry Zone**: $90,500 – $91,200
        Invalidation Level: below $88,000
    """
    pattern = (
        rf"(\*{{0,2}}{field}\s*(?:Zone|Level|Price)?\*{{0,2}}\s*:?\s*)(.+?)(?:\n|$)"
    )
    match = _re.search(pattern, text, _re.IGNORECASE)
    if match:
        return match.group(2).strip()
    return None


def _extract_thesis_list_field(text: str, field: str) -> list[str]:
    """Extract a list of values for a named field from thesis text.

    Looks for patterns like:
        **Target Zones**: $95,000, $100,000, $105,000
    """
    value = _extract_thesis_field(text, field)
    if not value:
        return []
    # Split on commas, semicolons, or bullet points
    parts = _re.split(r"[,;•]|\band\b", value)
    return [p.strip() for p in parts if p.strip()]


def _first_nonempty_line(text: str) -> str:
    for line in (text or "").splitlines():
        clean = line.strip(" -*#\t")
        if clean:
            return clean[:500]
    return ""


def _signal_evidence(signals: list[Signal], signal_ids: list[str]) -> list[str]:
    wanted = set(signal_ids)
    evidence: list[str] = []
    for signal in signals:
        if not signal.id or signal.id not in wanted:
            continue
        detail = signal.summary or str(signal.evidence.get("detail") or "")
        if not detail:
            detail = f"{signal.signal_type}: {signal.direction.value}"
        evidence.append(detail[:500])
    return evidence


def _stale_or_missing_data_notes(signals: list[Signal]) -> list[str]:
    notes: list[str] = []
    for signal in signals:
        freshness = getattr(
            signal.provenance.freshness, "value", signal.provenance.freshness
        )
        if freshness in ("stale", "unknown"):
            notes.append(f"{signal.signal_type}: {freshness}")
    return notes


def _parse_structured_summary_payload(raw_json: str | None) -> dict[str, Any]:
    """Parse the UI summary JSON block with a small trailing-comma repair."""
    if not raw_json:
        return {}
    raw = raw_json.strip()
    object_match = _re.search(r"\{.*\}", raw, _re.DOTALL)
    if object_match:
        raw = object_match.group(0)
    candidates = [raw, _re.sub(r",(\s*[}\]])", r"\1", raw)]
    for candidate in candidates:
        try:
            loaded = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(loaded, dict):
            return loaded
    return {}


def _summary_rating(payload: dict[str, Any]) -> str | None:
    ratings = {
        "buy": "Buy",
        "overweight": "Overweight",
        "hold": "Hold",
        "underweight": "Underweight",
        "sell": "Sell",
    }
    raw = payload.get("rating")
    if raw is None:
        return None
    return ratings.get(str(raw).strip().lower())


def _summary_direction(payload: dict[str, Any]) -> ThesisDirection | None:
    aliases = {
        "long": ThesisDirection.LONG,
        "buy": ThesisDirection.LONG,
        "bullish": ThesisDirection.LONG,
        "short": ThesisDirection.SHORT,
        "sell": ThesisDirection.SHORT,
        "bearish": ThesisDirection.SHORT,
        "watch": ThesisDirection.WATCH,
        "hold": ThesisDirection.WATCH,
        "avoid": ThesisDirection.AVOID,
        "neutral": ThesisDirection.NEUTRAL,
    }
    raw = payload.get("direction")
    if raw is None:
        return None
    return aliases.get(str(raw).strip().lower())


def _validated_structured_summary(
    *,
    payload: dict[str, Any],
    rating: str,
    direction: ThesisDirection,
    confidence: float | None,
    thesis_text: str,
    invalidation_level: str | None,
    target_zones: list[str],
    supporting_evidence: list[str],
    contradicting_evidence: list[str],
    stale_or_missing_data: list[str],
    contradictions: list[str],
    why_this_thesis: str,
    market_type: str,
) -> TradeThesisStructuredSummary:
    summary_payload = dict(payload)
    summary_payload["rating"] = rating
    summary_payload["direction"] = direction.value
    summary_payload["market_type"] = summary_payload.get("market_type") or market_type
    if confidence is not None:
        summary_payload["confidence"] = confidence
    else:
        summary_payload.setdefault("confidence", None)

    executive_summary = _extract_thesis_field(thesis_text, "executive summary")
    summary_payload["action_summary"] = (
        summary_payload.get("action_summary") or executive_summary or why_this_thesis
    )
    summary_payload["upside_catalyst"] = summary_payload.get("upside_catalyst") or (
        target_zones[0] if target_zones else ""
    )
    summary_payload["invalidation"] = (
        summary_payload.get("invalidation") or invalidation_level or ""
    )
    summary_payload["key_reasons"] = summary_payload.get("key_reasons") or (
        supporting_evidence[:3]
        or contradicting_evidence[:3]
        or ([why_this_thesis] if why_this_thesis else [])
    )
    summary_payload["risks"] = summary_payload.get("risks") or (
        stale_or_missing_data[:3]
        or contradictions[:3]
        or ["Manual review required before any action."]
    )
    summary_payload["missing_data"] = summary_payload.get("missing_data") or (
        stale_or_missing_data[:3]
    )

    try:
        return TradeThesisStructuredSummary.model_validate(summary_payload)
    except ValidationError:
        return TradeThesisStructuredSummary.model_validate(
            {
                "rating": rating,
                "direction": direction.value,
                "market_type": market_type,
                "confidence": confidence,
                "action_summary": executive_summary or why_this_thesis,
                "upside_catalyst": target_zones[0] if target_zones else "",
                "invalidation": invalidation_level or "",
                "key_reasons": supporting_evidence[:3]
                or contradicting_evidence[:3]
                or ([why_this_thesis] if why_this_thesis else []),
                "risks": stale_or_missing_data[:3]
                or contradictions[:3]
                or ["Manual review required before any action."],
                "missing_data": stale_or_missing_data[:3],
            }
        )


def _run_quality_payload(run: ResearchRun | None) -> dict[str, Any]:
    if run is None:
        return {}
    return {
        "status": run.status.value,
        "label": run.completion_label(),
        "degradation_reasons": list(run.degradation_reasons),
        "missing_core_data": list(run.missing_core_data),
        "missing_optional_data": list(run.missing_optional_data),
    }


class ResearchAgentsGraph(JournalPersistenceMixin):
    """Main class that orchestrates the research-workstation graph."""

    def __init__(
        self,
        selected_analysts: str | list[str] | tuple[str, ...] | None = None,
        debug=False,
        config: Dict[str, Any] | None = None,
        callbacks: Optional[List] = None,
    ):
        """Initialize the research-workstation graph and components."""
        self.debug = debug
        self.config = validate_and_normalize_config(
            config or DEFAULT_CONFIG,
            source="ResearchAgentsGraph.__init__",
        )
        configure_opentelemetry(self.config)
        os.makedirs(self.config["data_cache_dir"], exist_ok=True)
        os.makedirs(self.config["results_dir"], exist_ok=True)

        self.tool_runtime = ToolRuntime(self.config, callbacks=callbacks)
        self.budget_tracker = self.tool_runtime.budget_tracker
        self.callbacks = self.tool_runtime.callbacks
        self.orchestrator = self.tool_runtime.orchestrator
        self.deep_thinking_llm = self.tool_runtime.deep_thinking_llm
        self.quick_thinking_llm = self.tool_runtime.quick_thinking_llm
        self.orchestrator.on_provider_switched = self._on_llm_provider_switched
        self.tool_nodes = self.tool_runtime.tool_nodes

        # Initialize components
        self.conditional_logic = ConditionalLogic(
            max_debate_rounds=self.config["max_debate_rounds"],
            max_risk_discuss_rounds=self.config["max_risk_discuss_rounds"],
        )
        self.graph_factory = GraphFactory(
            quick_thinking_llm=self.quick_thinking_llm,
            deep_thinking_llm=self.deep_thinking_llm,
            tool_nodes=self.tool_nodes,
            conditional_logic=self.conditional_logic,
            config=self.config,
            budget_tracker=self.budget_tracker,
        )
        self.graph_setup = self.graph_factory.graph_setup

        self.propagator = Propagator()
        self.signal_processor = self.tool_runtime.signal_processor

        # Mutable per-run state.
        self.run_context = GraphRunContext()
        self.journal_coordinator = JournalCoordinator(self.config)
        self.journal_bridge = self.journal_coordinator.bridge
        self.thesis_builder = ThesisBuilder(self)
        self.report_writer = ReportWriter(self)
        self.run_orchestrator = ResearchRunOrchestrator()

        # Set up the graph
        self.workflow = self.graph_factory.build_workflow(selected_analysts)
        self.graph = self.graph_factory.compile(self.workflow)
        self._checkpointer_ctx = None

    def _ensure_run_context(self) -> GraphRunContext:
        if not hasattr(self, "run_context"):
            self.run_context = GraphRunContext()
        return self.run_context

    @property
    def curr_state(self) -> dict[str, Any] | None:
        return self._ensure_run_context().curr_state

    @curr_state.setter
    def curr_state(self, value: dict[str, Any] | None) -> None:
        self._ensure_run_context().curr_state = value

    @property
    def ticker(self) -> str | None:
        return self._ensure_run_context().ticker

    @ticker.setter
    def ticker(self, value: str | None) -> None:
        self._ensure_run_context().ticker = value

    @property
    def current_research_run(self) -> ResearchRun | None:
        return self._ensure_run_context().current_research_run

    @current_research_run.setter
    def current_research_run(self, value: ResearchRun | None) -> None:
        self._ensure_run_context().current_research_run = value

    @property
    def current_trade_thesis(self) -> TradeThesis | None:
        return self._ensure_run_context().current_trade_thesis

    @current_trade_thesis.setter
    def current_trade_thesis(self, value: TradeThesis | None) -> None:
        self._ensure_run_context().current_trade_thesis = value

    @property
    def current_signals(self) -> list[Signal]:
        return self._ensure_run_context().current_signals

    @current_signals.setter
    def current_signals(self, value: list[Signal]) -> None:
        self._ensure_run_context().current_signals = value

    @property
    def current_agent_opinions(self) -> list[AgentOpinion]:
        return self._ensure_run_context().current_agent_opinions

    @current_agent_opinions.setter
    def current_agent_opinions(self, value: list[AgentOpinion]) -> None:
        self._ensure_run_context().current_agent_opinions = value

    @property
    def current_debate(self) -> ResearchDebate | None:
        return self._ensure_run_context().current_debate

    @current_debate.setter
    def current_debate(self, value: ResearchDebate | None) -> None:
        self._ensure_run_context().current_debate = value

    @property
    def log_states_dict(self) -> dict[str, Any]:
        return self._ensure_run_context().log_states_dict

    @log_states_dict.setter
    def log_states_dict(self, value: dict[str, Any]) -> None:
        self._ensure_run_context().log_states_dict = value

    @property
    def quant_signal_result(self) -> Any:
        return self._ensure_run_context().quant_signal_result

    @quant_signal_result.setter
    def quant_signal_result(self, value: Any) -> None:
        self._ensure_run_context().quant_signal_result = value

    @property
    def _replay_thread_id(self) -> str | None:
        return self._ensure_run_context().replay_thread_id

    @_replay_thread_id.setter
    def _replay_thread_id(self, value: str | None) -> None:
        self._ensure_run_context().replay_thread_id = value

    @property
    def current_scenario_plan(self) -> str:
        return self._ensure_run_context().current_scenario_plan

    @current_scenario_plan.setter
    def current_scenario_plan(self, value: str) -> None:
        self._ensure_run_context().current_scenario_plan = value

    def _precompute_quant_signal(self, symbol: str, trade_date: str) -> str:
        """Run SignalEngine before graph execution and return the prompt block."""
        quant_prompt, result = precompute_quant_signal(self.config, symbol, trade_date)
        self.quant_signal_result = result
        return quant_prompt

    def _on_llm_provider_switched(self, deep_llm, quick_llm, new_provider):
        """Fan out new LLM references to all graph components after a provider switch."""
        self.tool_runtime.apply_provider_switch(self, deep_llm, quick_llm)

    def _create_tool_nodes(self):
        """Backward-compatible helper kept for older tests/callers."""
        runtime = getattr(self, "tool_runtime", None)
        if runtime is not None:
            return runtime.create_tool_nodes()
        return create_tool_nodes(self.config)

    # _save_journal_agent_research is now provided by JournalPersistenceMixin

    def _start_journal_run(self) -> None:
        coordinator = getattr(self, "journal_coordinator", None)
        if coordinator is None:
            return super()._start_journal_run()
        self.current_research_run = coordinator.start_run(self.current_research_run)

    def _save_journal_quant_signals(self) -> None:
        coordinator = getattr(self, "journal_coordinator", None)
        if coordinator is None:
            return super()._save_journal_quant_signals()
        self.current_research_run, self.current_signals = (
            coordinator.save_quant_signals(
                self.current_research_run,
                getattr(self, "quant_signal_result", None),
            )
        )

    def _save_journal_agent_research(self, final_state: dict) -> None:
        coordinator = getattr(self, "journal_coordinator", None)
        if coordinator is None:
            return super()._save_journal_agent_research(final_state)
        (
            self.current_research_run,
            self.current_agent_opinions,
            self.current_debate,
        ) = coordinator.save_agent_research(
            self.current_research_run,
            final_state,
            getattr(self, "quant_signal_result", None),
        )

    def _complete_journal_run(self) -> None:
        coordinator = getattr(self, "journal_coordinator", None)
        if coordinator is None:
            return super()._complete_journal_run()
        scenario_json = ""
        if self.curr_state is not None:
            scenario_json = self.curr_state.get("scenario_plan_json", "") or ""
        self.current_research_run, self.current_trade_thesis = coordinator.complete_run(
            self.current_research_run,
            self.current_trade_thesis,
            scenario_plan_text=getattr(self, "current_scenario_plan", "") or "",
            scenario_plan_json=scenario_json,
        )

    def _build_trade_thesis(self, final_state: dict) -> TradeThesis:
        """Build a simplified thesis artifact for journal persistence."""
        builder = getattr(self, "thesis_builder", None)
        if builder is not None:
            return builder.build(final_state)
        return ThesisBuilder(self).build(final_state)
        raw_final_decision = final_state.get("final_trade_decision", "")
        summary_json = final_state.get("final_trade_summary_json") or (
            extract_trade_thesis_json(raw_final_decision)
        )
        summary_payload = _parse_structured_summary_payload(summary_json)
        final_decision = (
            strip_trade_thesis_json_block(raw_final_decision)
            if summary_json
            else raw_final_decision
        ) or raw_final_decision
        rating = _summary_rating(summary_payload) or self.process_signal(final_decision)

        direction_map = {
            "Buy": ThesisDirection.LONG,
            "Overweight": ThesisDirection.LONG,
            "Sell": ThesisDirection.SHORT,
            "Underweight": ThesisDirection.SHORT,
            "Hold": ThesisDirection.WATCH,
        }
        direction = _summary_direction(summary_payload) or direction_map.get(
            rating, ThesisDirection.WATCH
        )

        quant = getattr(self, "quant_signal_result", None)
        confidence = None
        if quant is not None and hasattr(quant, "confidence"):
            confidence = quant.confidence

        # Link thesis to debate, signals, and agent opinions
        debate = getattr(self, "current_debate", None)
        debate_id = debate.id if debate else None

        supporting_ids, contradicting_ids = self._classify_thesis_signals(direction)

        opinions = getattr(self, "current_agent_opinions", []) or []
        opinion_ids = [o.id for o in opinions if o.id]

        # Parse structured fields from thesis text
        entry_zone = _extract_thesis_field(final_decision, "entry")
        invalidation_level = _extract_thesis_field(final_decision, "invalidation")
        target_zones = _extract_thesis_list_field(final_decision, "target")

        # Extract debate artifacts
        contradictions = getattr(debate, "contradictions", None) or []
        consensus = getattr(debate, "consensus", None) or {}
        signals = getattr(self, "current_signals", []) or []
        supporting_evidence = _signal_evidence(signals, supporting_ids)
        contradicting_evidence = _signal_evidence(signals, contradicting_ids)
        stale_or_missing_data = _stale_or_missing_data_notes(signals)
        why_this_thesis = _first_nonempty_line(final_decision) or (
            f"{direction.value} thesis generated from agent debate"
        )
        market_type = (
            summary_payload.get("market_type")
            or final_state.get("market_type")
            or getattr(getattr(self, "current_research_run", None), "market_type", None)
            or (getattr(self, "config", None) or {}).get("market_type", "spot")
        )
        monitor_next = [
            item
            for item in [
                f"entry: {entry_zone}" if entry_zone else "",
                f"invalidation: {invalidation_level}" if invalidation_level else "",
                *[f"target: {target}" for target in target_zones],
            ]
            if item
        ]
        confidence_rationale = (
            f"Quant confidence={confidence:.2f}; "
            f"{len(supporting_ids)} supporting signal(s), "
            f"{len(contradicting_ids)} contradicting signal(s)."
            if confidence is not None
            else (
                f"{len(supporting_ids)} supporting signal(s), "
                f"{len(contradicting_ids)} contradicting signal(s); "
                "quant confidence unavailable."
            )
        )
        structured_summary = _validated_structured_summary(
            payload=summary_payload,
            rating=rating,
            direction=direction,
            confidence=confidence,
            thesis_text=final_decision,
            invalidation_level=invalidation_level,
            target_zones=target_zones,
            supporting_evidence=supporting_evidence,
            contradicting_evidence=contradicting_evidence,
            stale_or_missing_data=stale_or_missing_data,
            contradictions=contradictions,
            why_this_thesis=why_this_thesis,
            market_type=market_type,
        )

        thesis = TradeThesis(
            id=str(uuid.uuid4()),
            symbol=self.ticker or final_state.get("company_of_interest", ""),
            direction=direction,
            setup_type="agent_debate",
            structured_summary=structured_summary,
            thesis_text=final_decision,
            confidence=confidence,
            debate_id=debate_id,
            supporting_signal_ids=supporting_ids,
            contradicting_signal_ids=contradicting_ids,
            agent_opinion_ids=opinion_ids,
            entry_zone=entry_zone,
            invalidation_level=invalidation_level,
            target_zones=target_zones,
            contradictions=contradictions,
            consensus=consensus,
            evidence={
                "signals_supporting": len(supporting_ids),
                "signals_contradicting": len(contradicting_ids),
                "opinions_linked": len(opinion_ids),
                "debate_linked": debate_id is not None,
            },
            why_this_thesis=why_this_thesis,
            supporting_evidence=supporting_evidence,
            contradicting_evidence=contradicting_evidence,
            stale_or_missing_data=stale_or_missing_data,
            invalidation=invalidation_level or "",
            monitor_next=monitor_next,
            confidence_rationale=confidence_rationale,
            risk_notes=["Manual review required before any action."],
        )

        if self.current_research_run and not self.current_research_run.decision_id:
            self.current_research_run.decision_id = str(uuid.uuid4())

        log_event(
            logger,
            "thesis_generated",
            run_id=getattr(self.current_research_run, "id", None),
            thesis_id=thesis.id,
            symbol=self.ticker,
            thesis_direction=thesis.direction.value,
            confidence=thesis.confidence,
            supporting_evidence_count=len(thesis.supporting_evidence),
            contradicting_evidence_count=len(thesis.contradicting_evidence),
            stale_or_missing_data_count=len(thesis.stale_or_missing_data),
        )
        log_event(
            logger,
            "decision_created",
            run_id=getattr(self.current_research_run, "id", None),
            decision_id=getattr(self.current_research_run, "decision_id", None),
            symbol=self.ticker,
            thesis_id=thesis.id,
            thesis_direction=thesis.direction.value,
            setup_type=thesis.setup_type,
            confidence=thesis.confidence,
        )
        return thesis

    def _classify_thesis_signals(
        self, direction: ThesisDirection
    ) -> tuple[list[str], list[str]]:
        """Classify saved signal IDs as supporting or contradicting a thesis direction."""
        signals = getattr(self, "current_signals", []) or []
        if direction not in (ThesisDirection.LONG, ThesisDirection.SHORT):
            return [], []
        if direction == ThesisDirection.LONG:
            supporting = [
                s.id for s in signals if s.direction == SignalDirection.BULLISH and s.id
            ]
            contradicting = [
                s.id for s in signals if s.direction == SignalDirection.BEARISH and s.id
            ]
        elif direction == ThesisDirection.SHORT:
            supporting = [
                s.id for s in signals if s.direction == SignalDirection.BEARISH and s.id
            ]
            contradicting = [
                s.id for s in signals if s.direction == SignalDirection.BULLISH and s.id
            ]
        else:
            supporting, contradicting = [], []
        return supporting, contradicting

    def propagate(
        self,
        company_name,
        trade_date,
        node_callback=None,
        *,
        run_callbacks=None,
    ):
        """Run the research graph for a company on a specific date."""
        orchestrator = getattr(self, "run_orchestrator", None)
        if orchestrator is not None:
            return orchestrator.propagate(
                self,
                company_name,
                trade_date,
                node_callback=node_callback,
                run_callbacks=run_callbacks,
            )
        self.ticker = company_name

        if self.config.get("checkpoint_enabled"):
            self._checkpointer_ctx = get_checkpointer(
                self.config["data_cache_dir"], company_name
            )
            saver = self._checkpointer_ctx.__enter__()
            self.graph = self.workflow.compile(checkpointer=saver)

            step = checkpoint_step(
                self.config["data_cache_dir"], company_name, str(trade_date)
            )
            if step is not None:
                logger.info(
                    "Resuming from step %d for %s on %s", step, company_name, trade_date
                )
            else:
                logger.info("Starting fresh for %s on %s", company_name, trade_date)

        obs_cfg = self.config.get("observability") or {}
        persist_run_events = obs_cfg.get("persist_run_events", True)
        journal_service = getattr(self.journal_bridge, "service", None)
        persist_ctx = (
            observability_run_event_persistence(
                journal_service,
                persist_provider_calls=obs_cfg.get("persist_data_provider_calls", True),
                persist_llm_calls=obs_cfg.get("persist_llm_calls", True),
                persist_data_freshness_checks=obs_cfg.get(
                    "persist_data_freshness_checks", True
                ),
                persist_snapshot_health=obs_cfg.get("persist_snapshot_health", True),
                data_provider_call_sample_rate=obs_cfg.get(
                    "data_provider_call_sample_rate", 1.0
                ),
            )
            if persist_run_events and journal_service is not None
            else nullcontext()
        )

        try:
            with config_context(self.config):
                with observability_context(
                    symbol=company_name,
                    timeframe=str(trade_date),
                    asset_class=self.config.get("asset_class", "crypto"),
                ):
                    with persist_ctx:
                        try:
                            with start_span(
                                "research.propagate",
                                symbol=company_name,
                                trade_date=str(trade_date),
                            ):
                                with self.budget_tracker.stage(
                                    "total",
                                    symbol=company_name,
                                    trade_date=str(trade_date),
                                ):
                                    result = self.orchestrator.execute_with_fallback(
                                        lambda: self._run_graph(
                                            company_name,
                                            trade_date,
                                            node_callback=node_callback,
                                            run_callbacks=run_callbacks,
                                        )
                                    )
                                self.budget_tracker.log_summary(
                                    run_id=getattr(
                                        self.current_research_run, "id", None
                                    ),
                                    decision_id=getattr(
                                        self.current_research_run,
                                        "decision_id",
                                        None,
                                    ),
                                    symbol=company_name,
                                    trade_date=str(trade_date),
                                )
                                return result
                        except Exception as exc:
                            self._mark_current_run_failed(exc)
                            log_event(
                                logger,
                                "research_run_failed",
                                level=logging.ERROR,
                                error_type=type(exc).__name__,
                                error=str(exc),
                                run_id=getattr(self.current_research_run, "id", None),
                            )
                            raise
        finally:
            if self._checkpointer_ctx is not None:
                self._checkpointer_ctx.__exit__(None, None, None)
                self._checkpointer_ctx = None
                self.graph = self.workflow.compile()

    async def apropagate(
        self,
        company_name,
        trade_date,
        node_callback=None,
        *,
        run_callbacks=None,
    ):
        """Async boundary wrapper for :meth:`propagate`."""
        orchestrator = getattr(self, "run_orchestrator", None)
        if orchestrator is not None:
            return await orchestrator.apropagate(
                self,
                company_name,
                trade_date,
                node_callback=node_callback,
                run_callbacks=run_callbacks,
            )
        return await asyncio.to_thread(
            self.propagate,
            company_name,
            trade_date,
            node_callback,
            run_callbacks=run_callbacks,
        )

    def _run_graph(
        self,
        company_name,
        trade_date,
        node_callback=None,
        *,
        run_callbacks=None,
    ):
        """Execute the graph and write the resulting state to disk."""
        orchestrator = getattr(self, "run_orchestrator", None)
        if orchestrator is not None:
            return orchestrator.run_graph(
                self,
                company_name,
                trade_date,
                node_callback=node_callback,
                run_callbacks=run_callbacks,
            )
        self.current_research_run = ResearchRun(
            id=(self.config.get("_engine") or {}).get("run_id")
            or self.config.get("run_id"),
            workspace_id=(self.config.get("_engine") or {}).get("workspace_id")
            or self.config.get("workspace_id")
            or "local",
            symbol=company_name,
            asset_class=self.config.get("asset_class", "crypto"),
            timeframe=str(trade_date),
            status=ResearchRunStatus.RUNNING,
            deep_think_model=self.config.get("deep_think_llm"),
            quick_think_model=self.config.get("quick_think_llm"),
            llm_provider=self.config.get("llm_provider"),
            config_hash=compute_config_hash(self.config),
        )
        self.current_trade_thesis = None
        self.current_signals = []
        self.current_agent_opinions = []
        self.current_debate = None

        self.current_research_run.symbol = company_name
        self._start_journal_run()
        bind_observability_context(
            run_id=getattr(self.current_research_run, "id", None)
        )
        log_event(
            logger,
            "research_run_started",
            run_id=getattr(self.current_research_run, "id", None),
            symbol=company_name,
            trade_date=str(trade_date),
            asset_class=self.config.get("asset_class", "crypto"),
            llm_provider=self.config.get("llm_provider"),
            checkpoint_enabled=bool(self.config.get("checkpoint_enabled")),
            quick_think_llm=self.config.get("quick_think_llm"),
            deep_think_llm=self.config.get("deep_think_llm"),
        )

        quant_signal_text = self._precompute_quant_signal(company_name, trade_date)
        self._save_journal_quant_signals()

        vendor_list = sorted(self.config.get("data_vendors", {}).values())
        log_event(
            logger,
            "data_fetched",
            run_id=getattr(self.current_research_run, "id", None),
            decision_id=getattr(self.current_research_run, "decision_id", None),
            symbol=company_name,
            trade_date=str(trade_date),
            vendor=", ".join(vendor_list) if vendor_list else "unknown",
        )

        init_agent_state = self.propagator.create_initial_state(
            company_name,
            trade_date,
            market_type=self.config.get("market_type", "spot"),
        )
        init_agent_state["quant_signal"] = quant_signal_text
        args = self.propagator.get_graph_args(callbacks=run_callbacks or None)

        if self.config.get("checkpoint_enabled"):
            tid = thread_id(company_name, str(trade_date))
            args.setdefault("config", {}).setdefault("configurable", {})[
                "thread_id"
            ] = tid

        if node_callback is not None:
            final_state = None
            for chunk in self.graph.stream(init_agent_state, **args):
                node_callback(chunk)
                final_state = chunk
        elif self.debug:
            trace = []
            for chunk in self.graph.stream(init_agent_state, **args):
                if len(chunk["messages"]) == 0:
                    pass
                else:
                    chunk["messages"][-1].pretty_print()
                    trace.append(chunk)
            final_state = trace[-1]
        else:
            final_state = self.graph.invoke(init_agent_state, **args)

        self.curr_state = final_state
        self._save_journal_agent_research(final_state)

        if self.config.get("checkpoint_enabled"):
            clear_checkpoint(
                self.config["data_cache_dir"], company_name, str(trade_date)
            )

        if self.current_research_run:
            self.current_research_run.status = ResearchRunStatus.COMPLETED
        final_signal = self.process_signal(final_state["final_trade_decision"])
        log_event(
            logger,
            "research_run_completed",
            run_id=getattr(self.current_research_run, "id", None),
            decision_id=getattr(self.current_research_run, "decision_id", None),
            symbol=company_name,
            trade_date=str(trade_date),
            final_signal=final_signal,
            checkpoint_enabled=bool(self.config.get("checkpoint_enabled")),
            quick_think_llm=self.config.get("quick_think_llm"),
            deep_think_llm=self.config.get("deep_think_llm"),
        )

        # Capture scenario plan from the Scenario Planner node for persistence
        self.current_scenario_plan = final_state.get("scenario_plan", "")

        # Build thesis artifact for journal persistence (research artifact).
        if self.current_trade_thesis is None:
            self.current_trade_thesis = self._build_trade_thesis(final_state)

        self._complete_journal_run()
        final_state["run_quality"] = _run_quality_payload(self.current_research_run)
        self._log_state(trade_date, final_state)

        return final_state, final_signal

    def _mark_current_run_failed(self, exc: Exception) -> None:
        coordinator = getattr(self, "journal_coordinator", None)
        if coordinator is not None:
            coordinator.mark_failed(getattr(self, "current_research_run", None), exc)
            return
        run = getattr(self, "current_research_run", None)
        bridge = getattr(self, "journal_bridge", None)
        service = getattr(bridge, "service", None) if bridge is not None else None
        if not run or not service:
            return
        try:
            run.status = ResearchRunStatus.FAILED
            run.completed_at = datetime.now(timezone.utc)
            saved = service.update_research_run(run)
            if saved.id:
                service.add_run_event(
                    saved.id,
                    "run.failed",
                    f"Research run failed for {saved.symbol}: {type(exc).__name__}",
                    {
                        "error_type": type(exc).__name__,
                        "error": str(exc)[:500],
                    },
                    thesis_id=saved.thesis_id,
                )
        except Exception as persist_exc:
            logger.debug(
                "Could not mark failed research run in journal: %s", persist_exc
            )

    def _log_state(self, trade_date, final_state):
        """Log the final state to a JSON file."""
        writer = getattr(self, "report_writer", None)
        if writer is not None:
            writer.write(trade_date, final_state)
            return
        self.log_states_dict[str(trade_date)] = {
            "company_of_interest": final_state["company_of_interest"],
            "trade_date": final_state["trade_date"],
            "market_type": final_state.get(
                "market_type", self.config.get("market_type", "spot")
            ),
            "market_report": final_state["market_report"],
            "sentiment_report": final_state["sentiment_report"],
            "news_report": final_state["news_report"],
            "fundamentals_report": final_state["fundamentals_report"],
            "investment_debate_state": {
                "bull_history": final_state["investment_debate_state"]["bull_history"],
                "bear_history": final_state["investment_debate_state"]["bear_history"],
                "history": final_state["investment_debate_state"]["history"],
                "current_response": final_state["investment_debate_state"][
                    "current_response"
                ],
                "judge_decision": final_state["investment_debate_state"][
                    "judge_decision"
                ],
            },
            "setup_planner_proposal": final_state["trader_investment_plan"],
            "trader_investment_decision": final_state["trader_investment_plan"],
            "risk_debate_state": {
                "aggressive_history": final_state["risk_debate_state"][
                    "aggressive_history"
                ],
                "conservative_history": final_state["risk_debate_state"][
                    "conservative_history"
                ],
                "neutral_history": final_state["risk_debate_state"]["neutral_history"],
                "history": final_state["risk_debate_state"]["history"],
                "judge_decision": final_state["risk_debate_state"]["judge_decision"],
            },
            "investment_plan": final_state["investment_plan"],
            "final_trade_decision": final_state["final_trade_decision"],
            "scenario_plan": final_state.get("scenario_plan", ""),
            "run_quality": final_state.get("run_quality", {}),
        }

        safe_ticker = safe_ticker_component(self.ticker)
        directory = (
            Path(self.config["results_dir"]) / safe_ticker / "ResearchWorkspace_logs"
        )
        directory.mkdir(parents=True, exist_ok=True)

        log_path = directory / f"full_states_log_{trade_date}.json"
        with open(log_path, "w", encoding="utf-8") as f:
            json.dump(self.log_states_dict[str(trade_date)], f, indent=4)

        try:
            report_gen = ReportGenerator(self.config)
            report_gen.save_report(self.log_states_dict[str(trade_date)])
        except Exception as exc:
            logger.warning(
                "ReportGenerator.save_report failed for %s on %s: %s",
                safe_ticker,
                trade_date,
                exc,
            )

    def process_signal(self, full_signal):
        """Process a signal to extract the core decision."""
        return self.signal_processor.process_signal(full_signal)


class TradingAgentsGraph(ResearchAgentsGraph):
    """Legacy class name kept for backward compatibility."""
