"""Structured logging, redaction, and optional journal persistence."""

from __future__ import annotations

from contextlib import contextmanager
import contextvars
from datetime import date, datetime
import json
import logging
import os
import re
import sys
from typing import Any, Iterator, Mapping


_OBSERVABILITY_CONTEXT = contextvars.ContextVar(
    "tradingagents_observability_context",
    default={},
)

_OBS_RUN_EVENT_PERSIST = contextvars.ContextVar(
    "tradingagents_obs_run_event_persist",
    default=None,
)


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
            key: "[REDACTED]" if _SECRET_KEY_RE.search(str(key)) else redact_secrets(item)
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
                record.msg = json.dumps(redact_secrets(record.msg), default=_json_default)
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
) -> Iterator[None]:
    """When active, ``log_event`` also writes matching rows to journal ``run_events``."""
    if service is None:
        yield
        return

    cfg = {
        "service": service,
        "persist_provider_calls": persist_provider_calls,
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
    symbol = payload.get("symbol") or ""
    if event_name == "research_run_started":
        return f"Research run started ({symbol})".strip()
    if event_name == "research_run_completed":
        sig = payload.get("final_signal")
        suffix = f" → {sig}" if sig else ""
        return f"Research run completed ({symbol}){suffix}".strip()
    if event_name == "research_run_failed":
        err_t = payload.get("error_type", "Error")
        return f"Research run failed: {err_t}"
    if event_name == "data_provider_call":
        method = payload.get("method", "?")
        vendor = payload.get("vendor", "?")
        status = payload.get("status", "?")
        return f"Data provider {method} [{vendor}] {status}"
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

    run_id = payload.get("run_id")
    if not run_id:
        return

    if (
        event == "data_provider_call"
        and not persist_cfg.get("persist_provider_calls", True)
    ):
        return

    safe_payload = redact_secrets(dict(payload))
    message = _timeline_message(event, safe_payload)
    try:
        persist_cfg["service"].add_run_event(
            str(run_id),
            event,
            message,
            safe_payload,
        )
    except Exception as exc:
        _MODULE_LOGGER.debug("Skipping run_events persist for %s: %s", event, exc)
