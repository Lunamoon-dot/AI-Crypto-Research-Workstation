# TradingAgents/graph/research_agents_graph.py

import logging
import os
import json
import uuid
import asyncio
from contextlib import nullcontext
from pathlib import Path
from typing import Dict, Any, List, Optional

logger = logging.getLogger(__name__)

from tradingagents.llm_clients.orchestrator import LLMOrchestrator

from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.config_validation import validate_and_normalize_config
from tradingagents.dataflows.config import config_context
from tradingagents.dataflows.utils import safe_ticker_component
from .checkpointer import checkpoint_step, clear_checkpoint, get_checkpointer, thread_id
from .conditional_logic import ConditionalLogic
from .quant_signals import precompute_quant_signal
from .setup import DEFAULT_ANALYSTS, GraphSetup
from .propagation import Propagator
from .signal_processing import SignalProcessor
from .tooling import create_tool_nodes
from .config_hash import compute_config_hash

from tradingagents.domain import (
    AgentOpinion,
    ResearchDebate,
    ResearchRun,
    ResearchRunStatus,
    Signal,
    SignalDirection,
    ThesisDirection,
    TradeThesis,
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
from tradingagents.observability.budget import BudgetCallbackHandler, BudgetTracker
from tradingagents.graph.journal_bridge import JournalBridge
from tradingagents.graph.journal_mixin import JournalPersistenceMixin


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
        self.budget_tracker = BudgetTracker(self.config)
        self.callbacks = [
            *(callbacks or []),
            BudgetCallbackHandler(self.budget_tracker),
        ]

        os.makedirs(self.config["data_cache_dir"], exist_ok=True)
        os.makedirs(self.config["results_dir"], exist_ok=True)

        # LLM orchestration: creation, circuit breaker, and provider fallback.
        self.orchestrator = LLMOrchestrator(
            config=self.config, callbacks=self.callbacks
        )
        self.deep_thinking_llm, self.quick_thinking_llm = (
            self.orchestrator.create_primary_llms()
        )
        self.orchestrator.on_provider_switched = self._on_llm_provider_switched

        # Create tool nodes
        self.tool_nodes = create_tool_nodes(self.config)

        # Initialize components
        self.conditional_logic = ConditionalLogic(
            max_debate_rounds=self.config["max_debate_rounds"],
            max_risk_discuss_rounds=self.config["max_risk_discuss_rounds"],
        )
        self.graph_setup = GraphSetup(
            self.quick_thinking_llm,
            self.deep_thinking_llm,
            self.tool_nodes,
            self.conditional_logic,
            config=self.config,
            budget_tracker=self.budget_tracker,
        )

        self.propagator = Propagator()
        self.signal_processor = SignalProcessor(self.quick_thinking_llm)

        # State tracking
        self.curr_state: dict[str, Any] | None = None
        self.ticker = None
        self.current_research_run: ResearchRun | None = None
        self.current_trade_thesis: TradeThesis | None = None
        self.current_signals: list[Signal] = []
        self.current_agent_opinions: list[AgentOpinion] = []
        self.current_debate: ResearchDebate | None = None
        self.journal_bridge = JournalBridge(self.config)
        self.log_states_dict: dict[str, Any] = {}
        self.quant_signal_result = None
        self._replay_thread_id: str | None = None
        self.current_scenario_plan: str = ""

        # Set up the graph
        self.workflow = self.graph_setup.setup_graph(
            DEFAULT_ANALYSTS if selected_analysts is None else selected_analysts
        )
        self.graph = self.workflow.compile()
        self._checkpointer_ctx = None

    def _precompute_quant_signal(self, symbol: str, trade_date: str) -> str:
        """Run SignalEngine before graph execution and return the prompt block."""
        quant_prompt, result = precompute_quant_signal(self.config, symbol, trade_date)
        self.quant_signal_result = result
        return quant_prompt

    def _on_llm_provider_switched(self, deep_llm, quick_llm, new_provider):
        """Fan out new LLM references to all graph components after a provider switch."""
        self.deep_thinking_llm = deep_llm
        self.quick_thinking_llm = quick_llm
        self.graph_setup.quick_thinking_llm = quick_llm
        self.graph_setup.deep_thinking_llm = deep_llm
        self.signal_processor = SignalProcessor(quick_llm)

    def _create_tool_nodes(self):
        """Backward-compatible helper kept for older tests/callers."""
        return create_tool_nodes(self.config)

    # _save_journal_agent_research is now provided by JournalPersistenceMixin

    def _build_trade_thesis(self, final_state: dict) -> TradeThesis:
        """Build a simplified thesis artifact for journal persistence."""
        final_decision = final_state.get("final_trade_decision", "")
        rating = self.process_signal(final_decision)

        direction_map = {
            "Buy": ThesisDirection.LONG,
            "Overweight": ThesisDirection.LONG,
            "Sell": ThesisDirection.SHORT,
            "Underweight": ThesisDirection.SHORT,
            "Hold": ThesisDirection.WATCH,
        }
        direction = direction_map.get(rating, ThesisDirection.WATCH)

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

        thesis = TradeThesis(
            id=str(uuid.uuid4()),
            symbol=self.ticker or final_state.get("company_of_interest", ""),
            direction=direction,
            setup_type="agent_debate",
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
        self.current_research_run = ResearchRun(
            id=(self.config.get("_engine") or {}).get("run_id")
            or self.config.get("run_id"),
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
        self._log_state(trade_date, final_state)

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

        return final_state, final_signal

    def _log_state(self, trade_date, final_state):
        """Log the final state to a JSON file."""
        self.log_states_dict[str(trade_date)] = {
            "company_of_interest": final_state["company_of_interest"],
            "trade_date": final_state["trade_date"],
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
