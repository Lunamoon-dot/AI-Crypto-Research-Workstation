"""Execution service for the JSON engine contract."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from tradingagents.config.loader import ConfigLoader
from tradingagents.domain import ResearchRun, ResearchRunStatus
from tradingagents.exceptions import classify_error
from tradingagents.graph.config_hash import compute_config_hash
from tradingagents.services import JournalService, ResearchService

from .schemas import EngineRunRequest, EngineRunResult


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
            loaded.status = ResearchRunStatus.COMPLETED
            loaded.completed_at = loaded.completed_at or datetime.now(timezone.utc)
            saved = journal.update_research_run(loaded)
            journal.add_run_event(
                saved.id or run.id or request.run_id or "",
                "run.completed",
                f"Engine run completed for {request.symbol}",
                {
                    "run_id": saved.id,
                    "workspace_id": request.workspace_id,
                    "summary": result.decision,
                    "engine_contract": "v1",
                },
                thesis_id=saved.thesis_id,
            )
            return self._result(
                journal,
                request,
                saved.id or run.id or "",
                "completed",
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
            "_engine": {
                "run_id": request.run_id,
                "workspace_id": request.workspace_id,
                "contract_version": "v1",
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
            symbol=request.symbol,
            asset_class=request.asset_class,
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
                "analysis_date": request.analysis_date.isoformat(),
                "analysts": request.analysts,
                "config_profile": request.config_profile,
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
        saved = journal.complete_research_run(run)
        journal.add_run_event(
            saved.id or run.id or "",
            "run.completed",
            f"Engine dry run completed for {request.symbol}",
            {
                "run_id": saved.id,
                "workspace_id": request.workspace_id,
                "dry_run": True,
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
