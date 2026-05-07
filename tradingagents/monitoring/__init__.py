"""Thesis monitoring placeholders.

The previous monitoring package tracked exchange positions and could auto-close
orders. That behavior has been removed. Future monitoring should operate on
saved trade theses and emit alerts when invalidation conditions are met.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass
class ThesisAlert:
    """A non-execution alert tied to a saved research thesis."""

    thesis_id: str
    symbol: str
    message: str
    severity: str = "info"
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


__all__ = ["ThesisAlert"]
