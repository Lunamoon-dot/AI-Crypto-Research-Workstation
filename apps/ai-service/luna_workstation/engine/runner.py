"""Execution service for the JSON engine contract."""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from luna_workstation.config.loader import ConfigLoader
from luna_workstation.default_config import DEFAULT_CONFIG
from luna_workstation.dataflows.config import config_context
from luna_workstation.domain import ResearchRun, ResearchRunStatus
from luna_workstation.exceptions import classify_error
from luna_workstation.graph.config_hash import compute_config_hash
from luna_workstation.services import EvaluationService, JournalService, ResearchService

from .schemas import (
    EngineEvaluateRequest,
    EngineEvaluateResult,
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
        news_context_overrides = _metadata_news_context_overrides(request.metadata)
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
        if news_context_overrides:
            overrides["news_context"] = news_context_overrides
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
            journal_path=str(journal.db_path),
            error_type=error_type,
            error=error,
        )


def run_engine_request_file(path: str | Path) -> EngineRunResult:
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    request = EngineRunRequest.model_validate(payload)
    return EngineRunner().run(request)


def run_evaluate_request_file(path: str | Path) -> EngineEvaluateResult:
    payload = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    request = EngineEvaluateRequest.model_validate(payload)
    return run_evaluate_request(request)


def run_evaluate_request(request: EngineEvaluateRequest) -> EngineEvaluateResult:
    try:
        config = _engine_config(request.workspace_id, request.metadata)
        service = EvaluationService(config=config)
        with config_context(config):
            evaluation = service.evaluate_thesis(
                request.thesis_id,
                window_days=request.window_days,
                record_review=False,
            )
        payload = evaluation.model_dump(mode="json")
        warnings = list(dict.fromkeys([*evaluation.warnings]))
        return EngineEvaluateResult(
            workspace_id=request.workspace_id,
            thesis_id=request.thesis_id,
            evaluation_id=evaluation.id,
            status="completed",
            evaluation={
                **payload,
                "workspace_id": request.workspace_id,
                "warnings": warnings,
            },
            warnings=warnings,
        )
    except Exception as exc:
        return EngineEvaluateResult(
            workspace_id=request.workspace_id,
            thesis_id=request.thesis_id,
            status="failed",
            error_type=type(exc).__name__,
            error=str(exc),
        )


def _engine_config(workspace_id: str, metadata: dict[str, Any]) -> dict[str, Any]:
    config = dict(DEFAULT_CONFIG)
    config["workspace_id"] = workspace_id
    config["_engine"] = {
        "workspace_id": workspace_id,
        "contract_version": "engine.v1",
        "metadata": metadata,
    }
    return config


def _metadata_news_context_overrides(metadata: dict[str, Any]) -> dict[str, Any]:
    context = metadata.get("news_context")
    if isinstance(context, dict):
        catalog_sources = _metadata_news_sources_from_value(
            context.get("catalog_sources")
        )
        workspace_sources = _metadata_news_sources_from_value(
            context.get("workspace_sources")
        )
        overrides: dict[str, Any] = {}
        if catalog_sources:
            overrides["default_sources"] = catalog_sources
        if workspace_sources:
            overrides["workspace_sources"] = workspace_sources
        resolved_pack_ids = _metadata_string_list(context.get("resolved_source_packs"))
        if resolved_pack_ids:
            overrides["selected_source_packs"] = resolved_pack_ids
        if "use_article_cache" in context:
            overrides["use_article_cache"] = bool(context.get("use_article_cache"))
        source_health = context.get("source_health")
        if isinstance(source_health, list):
            overrides["source_health"] = source_health
        if overrides:
            return overrides

    legacy_sources = _metadata_news_sources_from_value(metadata.get("news_sources"))
    if legacy_sources:
        return {"workspace_sources": legacy_sources}
    return {}


def _metadata_news_sources_from_value(raw_sources: Any) -> list[dict[str, Any]]:
    if not isinstance(raw_sources, list):
        return []

    sources: list[dict[str, Any]] = []
    for raw in raw_sources:
        if (
            not isinstance(raw, dict)
            or raw.get("enabled") is False
            or not _metadata_source_targets_news(raw)
        ):
            continue
        source = {
            key: raw[key]
            for key in (
                "id",
                "name",
                "type",
                "url",
                "category",
                "trust_tier",
                "target_analysts",
                "scope",
                "official",
            )
            if key in raw
        }
        if all(source.get(key) for key in ("id", "name", "url", "category")):
            sources.append(source)
    return sources


def _metadata_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        return []
    return [str(item).strip() for item in value if str(item).strip()]


def _metadata_source_targets_news(source: dict[str, Any]) -> bool:
    raw_targets = source.get("target_analysts")
    if raw_targets is None:
        return True
    if isinstance(raw_targets, str):
        raw_targets = raw_targets.split(",")
    if not isinstance(raw_targets, list):
        return False
    return "news" in {str(target).strip().lower() for target in raw_targets}
