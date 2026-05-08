"""Structured logging and redaction helpers.

This module intentionally keeps Phase 11A lightweight: events are emitted as
JSON strings through the standard library logger, so existing CLI/runtime
logging keeps working while downstream code can parse observability records.
"""

from __future__ import annotations

from contextlib import contextmanager
import contextvars
from datetime import date, datetime
import json
import logging
import re
from typing import Any, Iterator, Mapping


_OBSERVABILITY_CONTEXT = contextvars.ContextVar(
    "tradingagents_observability_context",
    default={},
)

_SECRET_KEY_RE = re.compile(
    r"(api[_-]?key|token|secret|password|authorization|auth|credential|client[_-]?secret)",
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
