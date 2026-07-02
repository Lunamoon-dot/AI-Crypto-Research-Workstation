"""Compatibility facade for SQLite research journal repositories."""

from __future__ import annotations

from .base import JournalRepositoryBase
from .evaluations import EvaluationsRepositoryMixin
from .observability import ObservabilityRepositoryMixin
from .runs import RunsRepositoryMixin
from .signal_evaluation import SignalEvaluationRepositoryMixin
from .signals import SignalsRepositoryMixin
from .theses import ThesesRepositoryMixin


class JournalRepository(
    RunsRepositoryMixin,
    SignalsRepositoryMixin,
    SignalEvaluationRepositoryMixin,
    ThesesRepositoryMixin,
    EvaluationsRepositoryMixin,
    ObservabilityRepositoryMixin,
    JournalRepositoryBase,
):
    """CRUD boundary for the local decision journal.

    The public class remains import-compatible while aggregate-specific
    behavior lives in smaller repository mixins.
    """

    pass
