"""Configuration management with per-run context isolation.

Config is threaded via a ContextVar bound for each analysis run.
There is no module-level global fallback — callers must either pass
config explicitly or run within a ``config_context()`` block.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from copy import deepcopy
from typing import Iterator

# Context variable for per-invocation threading.
# Set by tool wrappers in _create_tool_nodes() so that config flows through
# every data-layer call without changing tool signatures.
_config_ctx = contextvars.ContextVar("tradingagents_config", default=None)


def set_context_config(config: dict):
    """Bind config to current execution context and return token."""
    return _config_ctx.set(deepcopy(config))


def reset_context_config(token) -> None:
    """Reset context-bound config using a previously returned token."""
    _config_ctx.reset(token)


@contextmanager
def config_context(config: dict) -> Iterator[None]:
    """Temporarily bind config to this run/thread/task context."""
    token = set_context_config(config)
    try:
        yield
    finally:
        reset_context_config(token)


def get_config() -> dict:
    """Get the current configuration from the context variable.

    Raises RuntimeError if no config context is bound — callers must
    either pass config explicitly or wrap the call in ``config_context()``.
    """
    ctx = _config_ctx.get()
    if ctx is not None:
        return deepcopy(ctx)
    raise RuntimeError(
        "No config context bound. Wrap the call in config_context() or pass config explicitly."
    )
