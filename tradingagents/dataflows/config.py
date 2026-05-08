"""Configuration management with per-run context isolation.

The primary config source is a ContextVar bound for each analysis run.
A process-level fallback remains for legacy callers, but every public accessor
returns deep copies to prevent accidental cross-run mutations.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from copy import deepcopy
import threading
from typing import Dict, Iterator, Optional

import tradingagents.default_config as default_config

# Module-level global fallback (legacy callers)
_config: Optional[Dict] = None
_config_lock = threading.RLock()

# Context variable for per-invocation threading.
# Set by tool wrappers in _create_tool_nodes() so that config flows through
# every data-layer call without changing tool signatures.
_config_ctx = contextvars.ContextVar("tradingagents_config", default=None)


def _deep_merge(base: Dict, override: Dict) -> Dict:
    """Recursively merge ``override`` into ``base`` and return a new dict."""
    merged = deepcopy(base)
    for key, value in override.items():
        if (
            key in merged
            and isinstance(merged[key], dict)
            and isinstance(value, dict)
        ):
            merged[key] = _deep_merge(merged[key], value)
        else:
            merged[key] = deepcopy(value)
    return merged


def initialize_config():
    """Initialize the process-level fallback config with defaults."""
    global _config
    with _config_lock:
        if _config is None:
            _config = deepcopy(default_config.DEFAULT_CONFIG)


def set_config(config: Dict):
    """Update process-level fallback config for legacy call sites."""
    global _config
    with _config_lock:
        if _config is None:
            _config = deepcopy(default_config.DEFAULT_CONFIG)
        _config = _deep_merge(_config, config)


def set_context_config(config: Dict):
    """Bind config to current execution context and return token."""
    return _config_ctx.set(deepcopy(config))


def reset_context_config(token) -> None:
    """Reset context-bound config using a previously returned token."""
    _config_ctx.reset(token)


@contextmanager
def config_context(config: Dict) -> Iterator[None]:
    """Temporarily bind config to this run/thread/task context."""
    token = set_context_config(config)
    try:
        yield
    finally:
        reset_context_config(token)


def get_config() -> Dict:
    """Get the current configuration.

    Prefers the context variable (set per-invocation by tool wrappers).
    Falls back to the module-level global for backward compatibility.
    """
    ctx = _config_ctx.get()
    if ctx is not None:
        return deepcopy(ctx)
    with _config_lock:
        if _config is None:
            initialize_config()
        return deepcopy(_config)


# Initialize with default config
initialize_config()
