"""Configuration management with context-variable threading.

Provides both a module-level global (backward-compatible, transitional) and
a ``ContextVar`` for per-invocation config threading.  When the context var
is set, ``get_config()`` returns it; otherwise it falls back to the global.
"""

from __future__ import annotations

import contextvars
from typing import Dict, Optional

import tradingagents.default_config as default_config

# Module-level global (backward compat / transitional)
_config: Optional[Dict] = None

# Context variable for per-invocation threading.
# Set by tool wrappers in _create_tool_nodes() so that config flows through
# every data-layer call without changing tool signatures.
_config_ctx = contextvars.ContextVar("tradingagents_config", default=None)


def initialize_config():
    """Initialize the module-level global with default values."""
    global _config
    if _config is None:
        _config = default_config.DEFAULT_CONFIG.copy()


def set_config(config: Dict):
    """Update the module-level global with custom values."""
    global _config
    if _config is None:
        _config = default_config.DEFAULT_CONFIG.copy()
    _config.update(config)


def get_config() -> Dict:
    """Get the current configuration.

    Prefers the context variable (set per-invocation by tool wrappers).
    Falls back to the module-level global for backward compatibility.
    """
    ctx = _config_ctx.get()
    if ctx is not None:
        return ctx.copy()
    if _config is None:
        initialize_config()
    return _config.copy()


# Initialize with default config
initialize_config()
