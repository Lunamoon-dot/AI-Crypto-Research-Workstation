"""Execution service for the JSON engine contract."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from tradingagents.config.loader import ConfigLoader
from tradingagents.default_config import DEFAULT_CONFIG
from tradingagents.domain import ResearchRun, ResearchRunStatus
from tradingagents.exceptions import classify_error
from tradingagents.graph.config_hash import compute_config_hash
from tradingagents.services import JournalService, ResearchService

from .schemas import (
    EngineMonitorPlanRequest,
    EngineMonitorPlanResult,
    EnginePulseMemoRequest,
    EnginePulseMemoResult,
    EnginePulseRequest,
    EnginePulseResult,
    EngineRunRequest,
    EngineRunResult,
)


class EngineRunner:
    """Run research from a backend/worker JSON request."""

    def __init__(
        self,
        *,
        config_loader: ConfigLoader | None = None,
        journal_service_factory: Callable[[dict[str, Any]], JournalService] = (
            JournalService
        ),
        research_service_factory: Callable[[], ResearchService] = ResearchService,
    ) -> None:
        self.config_loader = config_loader or ConfigLoader()
        self.journal_service_factory = journal_service_factory
        self.research_service_factory = research_service_factory

    def run(self, request: EngineRunRequest) -> EngineRunResult:
        config = self._load_config(request)
        journal = self.journal_service_factory(config)
        run = self._start_run(journal, request, config)

        try:
            if request.dry_run:
                return self._complete_dry_run(journal, request, run)

            service = self.research_service_factory()
            result = service.run(
                ticker=request.symbol,
                analysis_date=request.analysis_date.isoformat(),
                selected_analyst_keys=request.analysts,
                config=config,
                debug=False,
            )
            loaded = journal.get_research_run(run.id or "") or run
            if loaded.status not in {
                ResearchRunStatus.COMPLETED_DEGRADED,
                ResearchRunStatus.FAILED,
            }:
                loaded.status = ResearchRunStatus.COMPLETED
            loaded.completed_at = loaded.completed_at or datetime.now(timezone.utc)
            saved = journal.update_research_run(loaded)
            event_type = (
                "run.failed"
                if saved.status == ResearchRunStatus.FAILED
                else (
                    "run.completed_degraded"
                    if saved.status == ResearchRunStatus.COMPLETED_DEGRADED
                    else "run.completed"
                )
            )
            journal.add_run_event(
                saved.id or run.id or request.run_id or "",
                event_type,
                (
                    f"Engine run failed quality gate for {request.symbol}"
                    if saved.status == ResearchRunStatus.FAILED
                    else f"Engine run completed for {request.symbol}"
                ),
                {
                    "run_id": saved.id,
                    "workspace_id": request.workspace_id,
                    "market_type": request.market_type,
                    "summary": result.decision,
                    "status": saved.status.value,
                    "degradation_reasons": saved.degradation_reasons,
                    "missing_core_data": saved.missing_core_data,
                    "missing_optional_data": saved.missing_optional_data,
                    "engine_contract": "v1",
                },
                thesis_id=saved.thesis_id,
            )
            return self._result(
                journal,
                request,
                saved.id or run.id or "",
                saved.status.value,
                thesis_id=saved.thesis_id,
                summary=result.decision,
            )
        except Exception as exc:
            loaded = journal.get_research_run(run.id or "") or run
            loaded.status = ResearchRunStatus.FAILED
            loaded.completed_at = datetime.now(timezone.utc)
            saved = journal.update_research_run(loaded)
            classification = classify_error(exc)
            journal.add_run_event(
                saved.id or run.id or request.run_id or "",
                "run.failed",
                f"Engine run failed for {request.symbol}: {classification.error_type}",
                {
                    "run_id": saved.id,
                    "workspace_id": request.workspace_id,
                    "market_type": request.market_type,
                    "error_type": classification.error_type,
                    "error": classification.message,
                    "retryable": classification.retryable,
                    "intent": classification.intent.value,
                    "engine_contract": "v1",
                },
            )
            return self._result(
                journal,
                request,
                saved.id or run.id or "",
                "failed",
                error_type=classification.error_type,
                error=classification.message,
            )

    def _load_config(self, request: EngineRunRequest) -> dict[str, Any]:
        profile = request.config_profile
        if profile and profile.lower() == "default":
            profile = None
        overrides: dict[str, Any] = {
            "asset_class": request.asset_class,
            "market_type": request.market_type,
            "_engine": {
                "run_id": request.run_id,
                "workspace_id": request.workspace_id,
                "contract_version": "v1",
                "metadata": request.metadata,
            },
        }
        if request.exchange:
            overrides["crypto_exchange"] = request.exchange
        if request.dry_run:
            overrides["config_validation"] = {"validate_llm_keys": False}
        return self.config_loader.load(
            profile=profile,
            cli_overrides=overrides,
            fail_fast=True,
        )

    def _start_run(
        self,
        journal: JournalService,
        request: EngineRunRequest,
        config: dict[str, Any],
    ) -> ResearchRun:
        run = ResearchRun(
            id=request.run_id,
            workspace_id=request.workspace_id,
            symbol=request.symbol,
            asset_class=request.asset_class,
            market_type=request.market_type,
            timeframe=request.analysis_date.isoformat(),
            status=ResearchRunStatus.RUNNING,
            deep_think_model=config.get("deep_think_llm"),
            quick_think_model=config.get("quick_think_llm"),
            llm_provider=config.get("llm_provider"),
            config_hash=compute_config_hash(config),
        )
        saved = journal.start_research_run(run)
        assert saved.id is not None
        config.setdefault("_engine", {})["run_id"] = saved.id
        journal.add_run_event(
            saved.id,
            "run.started",
            f"Engine run started for {request.symbol}",
            {
                "run_id": saved.id,
                "workspace_id": request.workspace_id,
                "symbol": request.symbol,
                "asset_class": request.asset_class,
                "market_type": request.market_type,
                "analysis_date": request.analysis_date.isoformat(),
                "analysts": request.analysts,
                "config_profile": request.config_profile,
                "exchange": request.exchange,
                "dry_run": request.dry_run,
                "metadata": request.metadata,
                "engine_contract": "v1",
            },
        )
        return saved

    def _complete_dry_run(
        self,
        journal: JournalService,
        request: EngineRunRequest,
        run: ResearchRun,
    ) -> EngineRunResult:
        run.status = ResearchRunStatus.COMPLETED
        saved = journal.complete_research_run(
            run,
            quality_check=False,
            emit_event=False,
        )
        journal.add_run_event(
            saved.id or run.id or "",
            "run.completed",
            f"Engine dry run completed for {request.symbol}",
            {
                "run_id": saved.id,
                "workspace_id": request.workspace_id,
                "dry_run": True,
                "market_type": request.market_type,
                "metadata": request.metadata,
                "engine_contract": "v1",
            },
        )
        return self._result(
            journal,
            request,
            saved.id or run.id or "",
            "completed",
            summary="Dry run validated request and persistence contract.",
        )

    def _result(
        self,
        journal: JournalService,
        request: EngineRunRequest,
        run_id: str,
        status: str,
        *,
        thesis_id: str | None = None,
        summary: str = "",
        error_type: str | None = None,
        error: str | None = None,
    ) -> EngineRunResult:
        events = journal.list_timeline_events(research_run_id=run_id)
        return EngineRunResult(
            run_id=run_id,
            workspace_id=request.workspace_id,
            status=status,
            thesis_id=thesis_id,
            summary=summary,
            events_written=len(events),
            error_type=error_type,
            error=error,
        )


def run_engine_request_file(path: str | Path) -> EngineRunResult:
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    request = EngineRunRequest.model_validate(payload)
    return EngineRunner().run(request)


def run_monitor_plan_request_file(path: str | Path) -> EngineMonitorPlanResult:
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    request = EngineMonitorPlanRequest.model_validate(payload)
    return run_monitor_plan_request(request)


def run_monitor_plan_request(
    request: EngineMonitorPlanRequest,
) -> EngineMonitorPlanResult:
    try:
        journal = JournalService(_monitoring_config(request.workspace_id, request.metadata))
        if request.updates:
            plan = journal.update_monitor_plan(
                request.thesis_id,
                request.updates,
                workspace_id=request.workspace_id,
            )
        else:
            plan = journal.ensure_monitor_plan(
                request.thesis_id,
                workspace_id=request.workspace_id,
            )
        return EngineMonitorPlanResult(
            thesis_id=request.thesis_id,
            workspace_id=request.workspace_id,
            monitor_plan_id=plan.id,
            status=plan.status.value,
            monitor_plan=plan.model_dump(mode="json"),
        )
    except Exception as exc:
        return EngineMonitorPlanResult(
            thesis_id=request.thesis_id,
            workspace_id=request.workspace_id,
            status="error",
            error_type=type(exc).__name__,
            error=str(exc),
        )


def run_pulse_request_file(path: str | Path) -> EnginePulseResult:
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    request = EnginePulseRequest.model_validate(payload)
    return run_pulse_request(request)


def run_pulse_request(request: EnginePulseRequest) -> EnginePulseResult:
    try:
        journal = JournalService(_monitoring_config(request.workspace_id, request.metadata))
        pulse, created = journal.run_thesis_pulse(
            request.thesis_id,
            workspace_id=request.workspace_id,
            observed_at=request.observed_at,
            force=request.force,
        )
        return EnginePulseResult(
            pulse_id=pulse.id,
            workspace_id=pulse.workspace_id,
            thesis_id=pulse.thesis_id,
            monitor_plan_id=pulse.monitor_plan_id,
            status=pulse.status.value,
            suggested_action=pulse.suggested_action.value,
            observed_at=pulse.observed_at.isoformat(),
            bucket_start=pulse.bucket_start.isoformat(),
            current_price=pulse.current_price,
            trigger_reasons=pulse.trigger_reasons,
            score=pulse.score,
            created=created,
            pulse=pulse.model_dump(mode="json"),
        )
    except Exception as exc:
        return EnginePulseResult(
            workspace_id=request.workspace_id,
            thesis_id=request.thesis_id,
            status="error",
            error_type=type(exc).__name__,
            error=str(exc),
        )


def run_pulse_memo_request_file(path: str | Path) -> EnginePulseMemoResult:
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    request = EnginePulseMemoRequest.model_validate(payload)
    return run_pulse_memo_request(request)


def run_pulse_memo_request(request: EnginePulseMemoRequest) -> EnginePulseMemoResult:
    try:
        journal = JournalService(_monitoring_config(request.workspace_id, request.metadata))
        memo, created, skip_reason = journal.run_thesis_pulse_memo(
            request.thesis_id,
            workspace_id=request.workspace_id,
            observed_at=request.observed_at,
            window_minutes=request.window_minutes,
            force=request.force,
        )
        if memo is None:
            return EnginePulseMemoResult(
                workspace_id=request.workspace_id,
                thesis_id=request.thesis_id,
                status="skipped",
                created=False,
                skipped=True,
                skip_reason=skip_reason or "no_pulses",
            )
        return EnginePulseMemoResult(
            memo_id=memo.id,
            workspace_id=memo.workspace_id,
            thesis_id=memo.thesis_id,
            monitor_plan_id=memo.monitor_plan_id,
            window_start=memo.window_start.isoformat(),
            window_end=memo.window_end.isoformat(),
            status=memo.status.value,
            recommended_action=memo.recommended_action.value,
            rerun_full_recommended=memo.rerun_full_recommended,
            referenced_pulse_ids=memo.referenced_pulse_ids,
            created=created,
            memo=memo.model_dump(mode="json"),
        )
    except Exception as exc:
        return EnginePulseMemoResult(
            workspace_id=request.workspace_id,
            thesis_id=request.thesis_id,
            status="error",
            error_type=type(exc).__name__,
            error=str(exc),
        )


def _monitoring_config(workspace_id: str, metadata: dict[str, Any]) -> dict[str, Any]:
    config = dict(DEFAULT_CONFIG)
    config["workspace_id"] = workspace_id
    pulse_memo_config = metadata.get("pulse_memo")
    if isinstance(pulse_memo_config, dict):
        config["pulse_memo"] = dict(pulse_memo_config)
    config["_engine"] = {
        "workspace_id": workspace_id,
        "contract_version": "monitoring.v1",
        "metadata": metadata,
    }
    return config
