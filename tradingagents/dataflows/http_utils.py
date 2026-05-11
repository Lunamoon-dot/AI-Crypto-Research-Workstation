"""Shared HTTP fetch utilities with retry/backoff for public API endpoints.

CoinGecko, alternative.me, and CryptoPanic calls flow through here so
they benefit from the same resilience patterns the CCXT layer has via
``_invoke_with_resilience``.
"""

from __future__ import annotations

import json
import logging
import time
from typing import Optional
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

logger = logging.getLogger(__name__)

# Mirrors default_config.py provider_runtime values so callers without
# a config context still get sensible behaviour.
_DEFAULT_TIMEOUT = 10.0
_DEFAULT_RETRIES = 2
_DEFAULT_BACKOFF_BASE = 0.5
_DEFAULT_BACKOFF_MAX = 5.0

# HTTP status codes that are safe to retry.
_RETRYABLE_STATUSES = frozenset({429, 500, 502, 503, 504})


def fetch_json_with_retry(
    url: str,
    *,
    timeout: float = _DEFAULT_TIMEOUT,
    max_retries: int = _DEFAULT_RETRIES,
    backoff_base: float = _DEFAULT_BACKOFF_BASE,
    backoff_max: float = _DEFAULT_BACKOFF_MAX,
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
            if e.code in _RETRYABLE_STATUSES and attempt < max_retries:
                wait = min(backoff_max, backoff_base * (2**attempt))
                logger.warning(
                    "HTTP %s from %s (attempt %s/%s), retrying in %.1fs",
                    e.code,
                    url,
                    attempt + 1,
                    attempts,
                    wait,
                )
                time.sleep(wait)
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
                wait = min(backoff_max, backoff_base * (2**attempt))
                logger.warning(
                    "Network error from %s (attempt %s/%s): %s, retrying in %.1fs",
                    url,
                    attempt + 1,
                    attempts,
                    e,
                    wait,
                )
                time.sleep(wait)
                continue
            logger.warning("Network error from %s (retries exhausted): %s", url, e)
            return None
        except json.JSONDecodeError as e:
            logger.warning("JSON parse error from %s: %s", url, e)
            return None

    logger.warning("All %s attempts failed for %s: %s", attempts, url, last_error)
    return None
