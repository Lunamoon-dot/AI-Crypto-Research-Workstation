"""Shared retry/backoff utilities for data provider resilience.

Centralises the exponential-backoff, retryable-status detection, and
sleep logic previously duplicated across ``http_utils.py``,
``crypto_news_provider.py``, and ``interface.py``.
"""

from __future__ import annotations

import time
from typing import FrozenSet

# ---------------------------------------------------------------------------
# Default configuration — mirrors default_config.py provider_runtime values
# ---------------------------------------------------------------------------

DEFAULT_TIMEOUT: float = 10.0
DEFAULT_RETRIES: int = 2
DEFAULT_BACKOFF_BASE: float = 0.5
DEFAULT_BACKOFF_MAX: float = 5.0

# HTTP status codes that are safe to retry.
RETRYABLE_HTTP_STATUSES: FrozenSet[int] = frozenset({429, 500, 502, 503, 504})


# ---------------------------------------------------------------------------
# Backoff helpers
# ---------------------------------------------------------------------------


def compute_backoff(
    attempt: int,
    *,
    base: float = DEFAULT_BACKOFF_BASE,
    cap: float = DEFAULT_BACKOFF_MAX,
) -> float:
    """Compute exponential backoff delay for the given attempt (0-indexed)."""
    return min(cap, base * (2**attempt))


def is_retryable_http_status(code: int) -> bool:
    """Return True when *code* is a transient HTTP status worth retrying."""
    return code in RETRYABLE_HTTP_STATUSES


def retry_sleep(seconds: float) -> None:
    """Thin wrapper around ``time.sleep`` for test mocking."""
    time.sleep(seconds)
