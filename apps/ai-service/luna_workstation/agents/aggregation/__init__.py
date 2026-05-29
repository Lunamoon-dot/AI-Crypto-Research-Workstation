"""Aggregation helpers for structured agent opinions."""

from .confidence import aggregate_confidence
from .consensus import consensus_from_opinions
from .contradictions import detect_contradictions

__all__ = [
    "aggregate_confidence",
    "consensus_from_opinions",
    "detect_contradictions",
]
