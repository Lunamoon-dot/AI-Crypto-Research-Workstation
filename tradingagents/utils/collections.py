"""Collection helpers shared across services and graph adapters."""

from __future__ import annotations

from copy import deepcopy
from typing import Iterable, TypeVar

T = TypeVar("T")


def deep_merge(base: dict, override: dict) -> dict:
    """Recursively merge *override* into *base* without mutating either input."""
    result = deepcopy(base)
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = deepcopy(value)
    return result


def dedupe(values: Iterable[T], *, key=str.lower) -> list[T]:
    """Return values in first-seen order with case-insensitive string keys."""
    seen = set()
    result: list[T] = []
    for value in values:
        marker = key(value) if isinstance(value, str) else value
        if marker in seen:
            continue
        seen.add(marker)
        result.append(value)
    return result
