"""Structured logging, redaction, and optional journal persistence."""

from __future__ import annotations

from contextlib import contextmanager
import contextvars
from datetime import date, datetime
import json
import logging
import os
import random
import re
import sys
from typing import Any, Iterator, Mapping


_OBSERVABILITY_CONTEXT: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "tradingagents_observability_context",
    default={},
)

_OBS_RUN_EVENT_PERSIST: contextvars.ContextVar[dict[str, Any] | None] = (
    contextvars.ContextVar(
        "tradingagents_obs_run_event_persist",
        default=None,
    )
)

_TIMELINE_EVENT_TYPES = {
    "research_run_started": "run.started",
    "research_run_completed": "run.completed",
    "research_run_failed": "run.failed",
    "data_provider_call": "provider.call",
    "llm_call": "llm.call",
    "data_freshness_check": "data.freshness",
    "snapshot_health": "snapshot.health",
    "stale_data_detected": "data.stale",
    "storage_operation_failed": "storage.failed",
    "rate_limit_hit": "provider.rate_limit",
    "llm_output_failure": "llm.output_failure",
    "health_check_failed": "health.failed",
    "data_fetched": "data.fetched",
    "signal_generated": "signal.generated",
    "analyst_opinions_recorded": "analyst.opinions.recorded",
    "debate_recorded": "debate.recorded",
    "risk_debate_recorded": "risk.debate.recorded",
    "thesis_generated": "thesis.generated",
    "scenario_plan_recorded": "scenario.plan.recorded",
    "decision_created": "decision.created",
    "risk_checked": "risk.checked",
    "plan_recorded": "plan.recorded",
    "budget_exceeded": "budget.exceeded",
    "budget_summary": "budget.summary",
}


_SECRET_KEY_RE = re.compile(
    r"(api[_-]?key|token|secret|password|authorization|auth|credential|client[_-]?secret)",
    re.IGNORECASE,
)
_SECRET_INLINE_RE = re.compile(
    r"((?:api[_-]?key|token|secret|password|authorization|auth)\s*[:=]\s*)([^\s,;]+)",
    re.IGNORECASE,
)


def redact_secrets(value: Any) -> Any:
    """Return *value* with likely secrets replaced by ``[REDACTED]``."""
    if isinstance(value, Mapping):
        return {
            key: "[REDACTED]"
            if _SECRET_KEY_RE.search(str(key))
            else redact_secrets(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_secrets(item) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_secrets(item) for item in value)
    return value


class SecretRedactionFilter(logging.Filter):
    """Best-effort global redaction filter for all logger records."""

    def filter(self, record: logging.LogRecord) -> bool:  # noqa: D401
        try:
            if isinstance(record.msg, Mapping):
                record.msg = json.dumps(
                    redact_secrets(record.msg), default=_json_default
                )
                record.args = ()
            elif isinstance(record.msg, str):
                record.msg = _SECRET_INLINE_RE.sub(r"\1[REDACTED]", record.msg)
                if record.args:
                    record.args = tuple(
                        redact_secrets(arg) if isinstance(arg, Mapping) else arg
                        for arg in record.args
                    )
        except Exception:
            # Logging must never fail because redaction fails.
            pass
        return True


def _json_default(value: Any) -> str:
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


@contextmanager
def observability_context(**fields: Any) -> Iterator[None]:
    """Attach structured fields, such as ``run_id`` and ``symbol``, to events."""
    token = bind_observability_context(**fields)
    try:
        yield
    finally:
        _OBSERVABILITY_CONTEXT.reset(token)


def bind_observability_context(**fields: Any) -> contextvars.Token:
    """Bind fields to the current context and return a reset token."""
    current = dict(_OBSERVABILITY_CONTEXT.get() or {})
    current.update({key: value for key, value in fields.items() if value is not None})
    return _OBSERVABILITY_CONTEXT.set(current)


@contextmanager
def observability_run_event_persistence(
    service: Any | None,
    *,
    persist_provider_calls: bool = True,
    persist_llm_calls: bool = True,
    persist_data_freshness_checks: bool = True,
    persist_snapshot_health: bool = True,
    data_provider_call_sample_rate: float = 1.0,
) -> Iterator[None]:
    """When active, ``log_event`` also writes matching rows to journal ``run_events``."""
    if service is None:
        yield
        return

    cfg = {
        "service": service,
        "persist_provider_calls": persist_provider_calls,
        "persist_llm_calls": persist_llm_calls,
        "persist_data_freshness_checks": persist_data_freshness_checks,
        "persist_snapshot_health": persist_snapshot_health,
        "data_provider_call_sample_rate": max(
            0.0, min(1.0, float(data_provider_call_sample_rate))
        ),
    }
    token = _OBS_RUN_EVENT_PERSIST.set(cfg)
    try:
        yield
    finally:
        _OBS_RUN_EVENT_PERSIST.reset(token)


_MODULE_LOGGER = logging.getLogger(__name__)


def configure_plain_observability_logging(level: int | None = None) -> None:
    """Route ``tradingagents.*`` records to stderr so INFO JSON lines show in ``--plain`` mode.

    Level defaults to ``INFO``, or ``TRADINGAGENTS_LOG_LEVEL`` (e.g. ``DEBUG``, ``WARNING``).
    Idempotent: only one stderr handler with message-only formatting is added per process.
    """
    log = logging.getLogger("tradingagents")
    if level is None:
        raw = os.environ.get("TRADINGAGENTS_LOG_LEVEL", "INFO").upper()
        level = getattr(logging, raw, logging.INFO)

    log.setLevel(level)

    for h in log.handlers:
        if getattr(h, "_tradingagents_plain_stderr", False):
            h.setLevel(level)
            return

    handler = logging.StreamHandler(stream=sys.stderr)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter("%(message)s"))
    handler._tradingagents_plain_stderr = True  # type: ignore[attr-defined]
    handler.addFilter(SecretRedactionFilter())
    log.addHandler(handler)


def install_secret_redaction_filter() -> None:
    """Install a global redaction filter on root and tradingagents loggers."""
    redaction_filter = SecretRedactionFilter()
    for logger_name in ("", "tradingagents"):
        target = logging.getLogger(logger_name)
        has_filter = any(
            isinstance(existing, SecretRedactionFilter)
            for existing in getattr(target, "filters", [])
        )
        if not has_filter:
            target.addFilter(redaction_filter)


def _timeline_message(event_name: str, payload: Mapping[str, Any]) -> str:
    if event_name in _TIMELINE_EVENT_TYPES:
        event_name = _TIMELINE_EVENT_TYPES[event_name]
    symbol = payload.get("symbol") or ""
    if event_name == "run.started":
        return f"Research run started ({symbol})".strip()
    if event_name == "run.completed":
        sig = payload.get("final_signal")
        suffix = f" → {sig}" if sig else ""
        return f"Research run completed ({symbol}){suffix}".strip()
    if event_name == "run.failed":
        err_t = payload.get("error_type", "Error")
        return f"Research run failed: {err_t}"
    if event_name == "provider.call":
        method = payload.get("method", "?")
        vendor = payload.get("vendor", "?")
        status = payload.get("status", "?")
        return f"Data provider {method} [{vendor}] {status}"
    if event_name == "llm.call":
        model = payload.get("model", "?")
        status = payload.get("status", "success")
        return f"LLM call [{model}] {status}"
    if event_name == "data.freshness":
        source = payload.get("source", "?")
        status = payload.get("freshness") or payload.get("status", "unknown")
        return f"Data freshness [{source}] {status}"
    if event_name == "snapshot.health":
        health = payload.get("status", "unknown")
        return f"Snapshot health: {health}"
    if event_name == "data.stale":
        source = payload.get("source", "?")
        age_hours = payload.get("age_hours", "?")
        return f"Stale data [{source}] age={age_hours}h"
    if event_name == "storage.failed":
        op = payload.get("operation", "?")
        err_t = payload.get("error_type", "Error")
        return f"Storage operation failed: {op} ({err_t})"
    if event_name == "provider.rate_limit":
        vendor = payload.get("vendor", "?")
        return f"Rate limit hit [{vendor}]"
    if event_name == "llm.output_failure":
        agent = payload.get("agent_name", "?")
        err_t = payload.get("error_type", "Error")
        return f"LLM output failure [{agent}]: {err_t}"
    if event_name == "health.failed":
        provider = payload.get("provider", "?")
        err_t = payload.get("error_type", "Error")
        return f"Health check failed [{provider}]: {err_t}"
    if event_name == "data.fetched":
        vendor = payload.get("vendor", "?")
        return f"Data fetched [{vendor}]"
    if event_name == "signal.generated":
        score = payload.get("composite_score", "?")
        direction = payload.get("composite_direction", "?")
        return f"Signal generated → {direction} ({score})"
    if event_name == "analyst.opinions.recorded":
        count = payload.get("opinion_count", "?")
        return f"Analyst opinions recorded ({count})"
    if event_name == "debate.recorded":
        stance = payload.get("consensus_stance", "?")
        conflict = payload.get("conflict_level", "?")
        return f"Debate recorded → {stance} (conflict: {conflict})"
    if event_name == "risk.debate.recorded":
        decision = payload.get("judge_decision") or payload.get("risk_decision", "?")
        return f"Risk debate recorded → {decision}"
    if event_name == "thesis.generated":
        direction = payload.get("thesis_direction", "?")
        return f"Thesis generated ({direction})"
    if event_name == "scenario.plan.recorded":
        count = payload.get("scenario_count", "?")
        return f"Scenario plan recorded ({count} scenario(s))"
    if event_name == "decision.created":
        direction = payload.get("thesis_direction", "?")
        return f"Decision created ({direction})"
    if event_name == "risk.checked":
        stance = payload.get("consensus_stance", "?")
        conflict = payload.get("conflict_level", "?")
        return f"Risk checked → {stance} (conflict: {conflict})"
    if event_name == "plan.recorded":
        action = payload.get("action", "?")
        return f"Plan recorded → {action}"
    if event_name == "budget.exceeded":
        stage = payload.get("stage", "?")
        return f"Budget exceeded [{stage}]"
    if event_name == "budget.summary":
        return "Budget summary recorded"
    return event_name


def log_event(
    logger: logging.Logger,
    event: str,
    *,
    level: int = logging.INFO,
    **fields: Any,
) -> None:
    """Emit a redacted structured observability event."""
    payload = {
        "event": event,
        **dict(_OBSERVABILITY_CONTEXT.get() or {}),
        **fields,
    }
    logger.log(
        level,
        json.dumps(redact_secrets(payload), default=_json_default, sort_keys=True),
    )

    persist_cfg = _OBS_RUN_EVENT_PERSIST.get()
    if not persist_cfg or not persist_cfg.get("service"):
        return

    if event == "data_provider_call" and not persist_cfg.get(
        "persist_provider_calls", True
    ):
        return
    if event == "llm_call" and not persist_cfg.get("persist_llm_calls", True):
        return
    if event == "data_freshness_check" and not persist_cfg.get(
        "persist_data_freshness_checks", True
    ):
        return
    if event == "snapshot_health" and not persist_cfg.get(
        "persist_snapshot_health", True
    ):
        return
    safe_payload = redact_secrets(dict(payload))
    _persist_observability_record(persist_cfg["service"], event, safe_payload)

    run_id = safe_payload.get("run_id")
    if not run_id:
        return

    if event == "data_provider_call":
        sample_rate = float(persist_cfg.get("data_provider_call_sample_rate", 1.0))
        if sample_rate < 1.0 and random.random() > sample_rate:
            return

    canonical_event = _TIMELINE_EVENT_TYPES.get(event, event)
    safe_payload.setdefault("timeline_schema", "v1")
    safe_payload.setdefault("timeline_event_type", canonical_event)
    if canonical_event != event:
        safe_payload.setdefault("timeline_event_raw", event)
    message = _timeline_message(canonical_event, safe_payload)
    try:
        persist_cfg["service"].add_run_event(
            str(run_id),
            canonical_event,
            message,
            safe_payload,
        )
    except Exception as exc:
        _MODULE_LOGGER.debug("Skipping run_events persist for %s: %s", event, exc)


def _persist_observability_record(
    service: Any, event: str, payload: dict[str, Any]
) -> None:
    try:
        if event == "data_provider_call" and hasattr(
            service, "record_provider_health_from_payload"
        ):
            service.record_provider_health_from_payload(payload)
        elif event == "llm_call" and hasattr(service, "record_llm_call_from_payload"):
            service.record_llm_call_from_payload(payload)
        elif event == "data_freshness_check" and hasattr(
            service, "record_data_freshness_from_payload"
        ):
            service.record_data_freshness_from_payload(payload)
    except Exception as exc:
        _MODULE_LOGGER.debug(
            "Skipping observability record persist for %s: %s", event, exc
        )
