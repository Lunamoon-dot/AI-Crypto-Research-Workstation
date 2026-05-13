"""Optional OpenTelemetry tracing hooks.

OpenTelemetry is deliberately optional.  When the packages are absent or the
config flag is off, these helpers are no-ops.
"""

from __future__ import annotations

from contextlib import contextmanager
import logging
from typing import Any, Iterator

logger = logging.getLogger(__name__)

_TRACER: Any | None = None
_ENABLED = False


def configure_opentelemetry(config: dict | None = None) -> bool:
    """Configure a process-local tracer when enabled and installed."""
    global _TRACER, _ENABLED
    cfg = (config or {}).get("observability", {}) or {}
    if not cfg.get("opentelemetry_enabled", False):
        _TRACER = None
        _ENABLED = False
        return False

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import (
            ConsoleSpanExporter,
            SimpleSpanProcessor,
        )
    except Exception as exc:
        logger.info("OpenTelemetry disabled: package unavailable (%s)", exc)
        _TRACER = None
        _ENABLED = False
        return False

    service_name = cfg.get("service_name", "lunacrypto")
    provider = TracerProvider(resource=Resource.create({"service.name": service_name}))
    provider.add_span_processor(SimpleSpanProcessor(ConsoleSpanExporter()))
    trace.set_tracer_provider(provider)
    _TRACER = trace.get_tracer("tradingagents")
    _ENABLED = True
    return True


@contextmanager
def start_span(name: str, **attributes: Any) -> Iterator[Any | None]:
    """Start a span if tracing is enabled; otherwise yield ``None``."""
    if not _ENABLED or _TRACER is None:
        yield None
        return
    with _TRACER.start_as_current_span(name) as span:
        for key, value in attributes.items():
            if value is not None:
                span.set_attribute(key, value)
        yield span
