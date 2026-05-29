"""Shared HTTP fetch utilities with retry/backoff for public API endpoints.

CoinGecko, alternative.me, and CryptoPanic calls flow through here so
they benefit from the same resilience patterns the CCXT layer has via
``_invoke_with_resilience``.
"""

from __future__ import annotations

import json
import logging
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .retry import (
    DEFAULT_BACKOFF_BASE,
    DEFAULT_BACKOFF_MAX,
    DEFAULT_RETRIES,
    DEFAULT_TIMEOUT,
    compute_backoff,
    is_retryable_http_status,
    retry_sleep,
)

logger = logging.getLogger(__name__)

# Re-export for callers that imported these from http_utils.
_DEFAULT_TIMEOUT = DEFAULT_TIMEOUT
_DEFAULT_RETRIES = DEFAULT_RETRIES
_DEFAULT_BACKOFF_BASE = DEFAULT_BACKOFF_BASE
_DEFAULT_BACKOFF_MAX = DEFAULT_BACKOFF_MAX
_RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})


def fetch_json_with_retry(
    url: str,
    *,
    timeout: float = DEFAULT_TIMEOUT,
    max_retries: int = DEFAULT_RETRIES,
    backoff_base: float = DEFAULT_BACKOFF_BASE,
    backoff_max: float = DEFAULT_BACKOFF_MAX,
) -> Optional[dict]:
    """Fetch JSON from *url* with exponential backoff on transient failures.

    Retries on:
    - HTTP 429 (rate-limit), 500/502/503/504 (server errors)
    - Network errors (URLError, OSError, timeout)

    Returns ``None`` when all retries are exhausted or a non-retryable
    status (4xx excluding 429) is received.
    """
    last_error: Optional[Exception] = None
    attempts = max_retries + 1

    for attempt in range(attempts):
        try:
            req = Request(url, headers={"User-Agent": "TradingAgents/0.2"})
            with urlopen(req, timeout=timeout) as resp:
                return json.loads(resp.read().decode())
        except HTTPError as e:
            last_error = e
            if is_retryable_http_status(e.code) and attempt < max_retries:
                wait = compute_backoff(attempt, base=backoff_base, cap=backoff_max)
                logger.warning(
                    "HTTP %s from %s (attempt %s/%s), retrying in %.1fs",
                    e.code,
                    url,
                    attempt + 1,
                    attempts,
                    wait,
                )
                retry_sleep(wait)
                continue
            logger.warning(
                "HTTP %s from %s (non-retryable or retries exhausted)",
                e.code,
                url,
            )
            return None
        except (URLError, OSError) as e:
            last_error = e
            if attempt < max_retries:
                wait = compute_backoff(attempt, base=backoff_base, cap=backoff_max)
                logger.warning(
                    "Network error from %s (attempt %s/%s): %s, retrying in %.1fs",
                    url,
                    attempt + 1,
                    attempts,
                    e,
                    wait,
                )
                retry_sleep(wait)
                continue
            logger.warning("Network error from %s (retries exhausted): %s", url, e)
            return None
        except json.JSONDecodeError as e:
            logger.warning("JSON parse error from %s: %s", url, e)
            return None

    logger.warning("All %s attempts failed for %s: %s", attempts, url, last_error)
    return None
