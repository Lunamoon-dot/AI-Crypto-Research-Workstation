"""Research graph run lifecycle orchestration."""

from __future__ import annotations

import asyncio
import logging
from contextlib import nullcontext
from typing import Any

from tradingagents.agents.utils.rating import (
    assert_consistent_ratings,
    ensure_no_conflicting_rating_mentions,
    parse_rating_label,
)
from tradingagents.agents.utils.thesis_json import extract_trade_thesis_json
from tradingagents.dataflows.config import config_context
from tradingagents.domain import ResearchRun, ResearchRunStatus
from tradingagents.observability import (
    bind_observability_context,
    log_event,
    observability_context,
    observability_run_event_persistence,
    start_span,
)

from .checkpointer import checkpoint_step, clear_checkpoint, get_checkpointer, thread_id
from .config_hash import compute_config_hash
from .thesis_builder import parse_structured_summary_payload

logger = logging.getLogger(__name__)


def run_quality_payload(run: ResearchRun | None) -> dict[str, Any]:
    if run is None:
        return {}
    return {
        "status": run.status.value,
        "label": run.completion_label(),
        "degradation_reasons": list(run.degradation_reasons),
        "missing_core_data": list(run.missing_core_data),
        "missing_optional_data": list(run.missing_optional_data),
    }


class ResearchRunOrchestrator:
    """Owns lifecycle, checkpoint, fallback, status, and budget flow."""

    def propagate(
        self,
        host: Any,
        company_name,
        trade_date,
        node_callback=None,
        *,
        run_callbacks=None,
    ):
        host.ticker = company_name

        if host.config.get("checkpoint_enabled"):
            host._checkpointer_ctx = get_checkpointer(
                host.config["data_cache_dir"],
                company_name,
            )
            saver = host._checkpointer_ctx.__enter__()
            host.graph = host.graph_factory.compile(host.workflow, checkpointer=saver)
            checkpoint_thread_id = getattr(
                host, "_replay_thread_id", None
            ) or thread_id(
                company_name,
                str(trade_date),
            )
            step = checkpoint_step(
                host.config["data_cache_dir"],
                company_name,
                str(trade_date),
                thread_id_override=checkpoint_thread_id,
            )
            if step is not None:
                logger.info(
                    "Resuming from step %d for %s on %s",
                    step,
                    company_name,
                    trade_date,
                )
            else:
                logger.info("Starting fresh for %s on %s", company_name, trade_date)

        obs_cfg = host.config.get("observability") or {}
        persist_run_events = obs_cfg.get("persist_run_events", True)
        journal_service = getattr(host.journal_bridge, "service", None)
        persist_ctx = (
            observability_run_event_persistence(
                journal_service,
                persist_provider_calls=obs_cfg.get("persist_data_provider_calls", True),
                persist_llm_calls=obs_cfg.get("persist_llm_calls", True),
                persist_data_freshness_checks=obs_cfg.get(
                    "persist_data_freshness_checks",
                    True,
                ),
                persist_snapshot_health=obs_cfg.get("persist_snapshot_health", True),
                data_provider_call_sample_rate=obs_cfg.get(
                    "data_provider_call_sample_rate",
                    1.0,
                ),
            )
            if persist_run_events and journal_service is not None
            else nullcontext()
        )

        try:
            with config_context(host.config):
                with observability_context(
                    symbol=company_name,
                    timeframe=str(trade_date),
                    asset_class=host.config.get("asset_class", "crypto"),
                ):
                    with persist_ctx:
                        try:
                            with start_span(
                                "research.propagate",
                                symbol=company_name,
                                trade_date=str(trade_date),
                            ):
                                with host.budget_tracker.stage(
                                    "total",
                                    symbol=company_name,
                                    trade_date=str(trade_date),
                                ):
                                    result = host._run_graph(
                                        company_name,
                                        trade_date,
                                        node_callback=node_callback,
                                        run_callbacks=run_callbacks,
                                    )
                                current_run = getattr(
                                    host, "current_research_run", None
                                )
                                host.budget_tracker.log_summary(
                                    run_id=getattr(current_run, "id", None),
                                    decision_id=getattr(
                                        current_run, "decision_id", None
                                    ),
                                    symbol=company_name,
                                    trade_date=str(trade_date),
                                )
                                return result
                        except Exception as exc:
                            host._mark_current_run_failed(exc)
                            log_event(
                                logger,
                                "research_run_failed",
                                level=logging.ERROR,
                                error_type=type(exc).__name__,
                                error=str(exc),
                                run_id=getattr(host.current_research_run, "id", None),
                            )
                            raise
        finally:
            if host._checkpointer_ctx is not None:
                host._checkpointer_ctx.__exit__(None, None, None)
                host._checkpointer_ctx = None
                host.graph = host.graph_factory.compile(host.workflow)

    async def apropagate(
        self,
        host: Any,
        company_name,
        trade_date,
        node_callback=None,
        *,
        run_callbacks=None,
    ):
        return await asyncio.to_thread(
            self.propagate,
            host,
            company_name,
            trade_date,
            node_callback,
            run_callbacks=run_callbacks,
        )

    def run_graph(
        self,
        host: Any,
        company_name,
        trade_date,
        node_callback=None,
        *,
        run_callbacks=None,
    ):
        workspace_id = (
            (host.config.get("_engine") or {}).get("workspace_id")
            or host.config.get("workspace_id")
            or "local"
        )
        host.current_research_run = ResearchRun(
            id=(host.config.get("_engine") or {}).get("run_id")
            or host.config.get("run_id"),
            workspace_id=workspace_id,
            symbol=company_name,
            asset_class=host.config.get("asset_class", "crypto"),
            timeframe=str(trade_date),
            status=ResearchRunStatus.RUNNING,
            deep_think_model=host.config.get("deep_think_llm"),
            quick_think_model=host.config.get("quick_think_llm"),
            llm_provider=host.config.get("llm_provider"),
            config_hash=compute_config_hash(host.config),
        )
        host.current_trade_thesis = None
        host.current_signals = []
        host.current_agent_opinions = []
        host.current_debate = None

        host._start_journal_run()
        bind_observability_context(
            run_id=getattr(host.current_research_run, "id", None)
        )
        log_event(
            logger,
            "research_run_started",
            run_id=getattr(host.current_research_run, "id", None),
            workspace_id=workspace_id,
            symbol=company_name,
            trade_date=str(trade_date),
            asset_class=host.config.get("asset_class", "crypto"),
            llm_provider=host.config.get("llm_provider"),
            checkpoint_enabled=bool(host.config.get("checkpoint_enabled")),
            quick_think_llm=host.config.get("quick_think_llm"),
            deep_think_llm=host.config.get("deep_think_llm"),
        )

        quant_signal_text = host._precompute_quant_signal(company_name, trade_date)
        host._save_journal_quant_signals()

        vendor_list = sorted(host.config.get("data_vendors", {}).values())
        log_event(
            logger,
            "data_fetched",
            run_id=getattr(host.current_research_run, "id", None),
            decision_id=getattr(host.current_research_run, "decision_id", None),
            symbol=company_name,
            trade_date=str(trade_date),
            vendor=", ".join(vendor_list) if vendor_list else "unknown",
        )

        init_agent_state = host.propagator.create_initial_state(
            company_name,
            trade_date,
            past_context=self._build_symbol_past_context(host, company_name),
            market_type=host.config.get("market_type", "spot"),
        )
        init_agent_state["quant_signal"] = quant_signal_text
        args = host.propagator.get_graph_args(callbacks=run_callbacks or None)

        if host.config.get("checkpoint_enabled"):
            tid = getattr(host, "_replay_thread_id", None) or thread_id(
                company_name,
                str(trade_date),
            )
            args.setdefault("config", {}).setdefault("configurable", {})[
                "thread_id"
            ] = tid

        final_state: dict[str, Any] | None = None
        if node_callback is not None:
            for chunk in host.graph.stream(init_agent_state, **args):
                node_callback(chunk)
                final_state = chunk
        elif host.debug:
            trace = []
            for chunk in host.graph.stream(init_agent_state, **args):
                if len(chunk["messages"]) != 0:
                    chunk["messages"][-1].pretty_print()
                    trace.append(chunk)
            final_state = trace[-1]
        else:
            final_state = host.graph.invoke(init_agent_state, **args)

        if final_state is None:
            raise RuntimeError(
                "Research graph completed without returning final state."
            )

        host.curr_state = final_state
        host._save_journal_agent_research(final_state)

        if host.config.get("checkpoint_enabled"):
            tid = getattr(host, "_replay_thread_id", None) or thread_id(
                company_name,
                str(trade_date),
            )
            clear_checkpoint(
                host.config["data_cache_dir"],
                company_name,
                str(trade_date),
                thread_id_override=tid,
            )

        if host.current_research_run:
            host.current_research_run.status = ResearchRunStatus.COMPLETED
        final_signal = host.process_signal(final_state["final_trade_decision"])
        summary_rating = None
        summary_json = final_state.get("final_trade_summary_json") or (
            extract_trade_thesis_json(final_state.get("final_trade_decision", ""))
        )
        if summary_json:
            summary_rating = parse_structured_summary_payload(summary_json).get(
                "rating"
            )
        assert_consistent_ratings(
            [
                (
                    "final_trade_decision.rating",
                    parse_rating_label(final_state["final_trade_decision"]),
                ),
                ("final_trade_summary_json.rating", summary_rating),
                ("final_signal", final_signal),
            ],
            context="research run final decision",
        )
        ensure_no_conflicting_rating_mentions(
            final_state["final_trade_decision"],
            official_rating=final_signal,
            context="final_trade_decision",
        )
        final_state["final_signal"] = final_signal
        log_event(
            logger,
            "research_run_completed",
            run_id=getattr(host.current_research_run, "id", None),
            decision_id=getattr(host.current_research_run, "decision_id", None),
            symbol=company_name,
            trade_date=str(trade_date),
            final_signal=final_signal,
            checkpoint_enabled=bool(host.config.get("checkpoint_enabled")),
            quick_think_llm=host.config.get("quick_think_llm"),
            deep_think_llm=host.config.get("deep_think_llm"),
        )

        host.current_scenario_plan = final_state.get("scenario_plan", "")
        if host.current_trade_thesis is None:
            host.current_trade_thesis = host._build_trade_thesis(final_state)

        host._complete_journal_run()
        final_state["run_quality"] = run_quality_payload(host.current_research_run)
        host._log_state(trade_date, final_state)
        return final_state, final_signal

    def _build_symbol_past_context(self, host: Any, symbol: str) -> str:
        cfg = (getattr(host, "config", None) or {}).get("thesis_stability", {})
        if not cfg.get("enabled", True):
            return ""

        bridge = getattr(host, "journal_bridge", None)
        service = getattr(bridge, "service", None) if bridge is not None else None
        if service is None:
            return ""

        try:
            theses = service.list_theses(limit=max(int(cfg.get("memory_limit", 50)), 1))
        except Exception as exc:
            logger.debug("Could not load previous thesis context: %s", exc)
            return ""

        wanted = str(symbol or "").strip().upper()
        latest = next(
            (
                thesis
                for thesis in theses
                if str(thesis.symbol or "").strip().upper() == wanted
            ),
            None,
        )
        if latest is None:
            return ""

        rating = (
            latest.structured_summary.rating if latest.structured_summary else "Hold"
        )
        confidence = (
            f"{latest.confidence:.0%}" if latest.confidence is not None else "unknown"
        )
        invalidation = latest.invalidation_level or latest.invalidation or "n/a"
        action_summary = (
            latest.structured_summary.action_summary
            if latest.structured_summary
            else latest.why_this_thesis
        )
        return (
            f"Latest same-symbol thesis: id={latest.id}, "
            f"created_at={latest.created_at.isoformat()}, "
            f"direction={latest.direction.value}, rating={rating}, "
            f"confidence={confidence}, invalidation={invalidation}. "
            f"Summary: {action_summary}. "
            f"Stability policy: for reruns within "
            f"{float(cfg.get('cooldown_minutes', 60)):.0f} minutes, treat new "
            "evidence as an update to the prior thesis. Do not change rating, "
            "direction, or confidence materially unless the prior thesis "
            "invalidation/confirmation condition has actually occurred or the "
            "new evidence is strong enough to override the cooldown."
        )
