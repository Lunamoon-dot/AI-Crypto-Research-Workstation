"""Deterministic config hashing for ResearchRun provenance.

Produces a stable hash of the effective config for a research run so
that later analysis can identify which configuration snapshot produced
which set of results. Secrets are redacted before hashing.
"""

from __future__ import annotations

import hashlib
import json
import re
from typing import Any


# Fields whose values should be redacted before hashing.
# Names match keys at any nesting level, case-insensitive.
_SECRET_KEY_RE = re.compile(
    r"(api[_-]?key|token|secret|password|authorization|auth|credential|client[_-]?secret)",
    re.IGNORECASE,
)

# Top-level keys to exclude entirely from the hash (non-deterministic paths, etc.)
_EXCLUDED_TOP_KEYS: set[str] = {
    "project_dir",
    "results_dir",
    "data_cache_dir",
}


def _redact_secrets(obj: Any) -> Any:
    """Return a copy of *obj* with secret values replaced by '[REDACTED]'."""
    if isinstance(obj, dict):
        return {
            key: "[REDACTED]"
            if _SECRET_KEY_RE.search(str(key))
            else _redact_secrets(value)
            for key, value in obj.items()
        }
    if isinstance(obj, list):
        return [_redact_secrets(item) for item in obj]
    return obj


def _sort_dict(obj: Any) -> Any:
    """Recursively sort dict keys for deterministic serialization."""
    if isinstance(obj, dict):
        return {key: _sort_dict(obj[key]) for key in sorted(obj)}
    if isinstance(obj, list):
        return [_sort_dict(item) for item in obj]
    return obj


def compute_config_hash(config: dict[str, Any]) -> str:
    """Compute a SHA-256 hash of the effective config.

    Secrets are redacted, non-deterministic paths are excluded, and
    keys are sorted before serialization so the hash is stable across
    Python runs and process restarts.

    Returns a 16-character hex string (first 64 bits of SHA-256).
    """
    # Start with a shallow copy, excluding non-deterministic top-level keys
    clean: dict[str, Any] = {
        key: value
        for key, value in config.items()
        if key not in _EXCLUDED_TOP_KEYS
    }
    # Redact secrets
    clean = _redact_secrets(clean)
    # Sort keys for determinism
    clean = _sort_dict(clean)
    # Serialize with sorted keys, no trailing whitespace
    payload = json.dumps(clean, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
    # SHA-256, return first 16 hex chars
    digest = hashlib.sha256(payload.encode("utf-8")).hexdigest()
    return digest[:16]
