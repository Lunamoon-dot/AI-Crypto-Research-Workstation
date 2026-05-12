"""Compatibility facade for SQLite research journal repositories."""

from __future__ import annotations

from .base import JournalRepositoryBase
from .briefs import BriefsRepositoryMixin
from .evaluations import EvaluationsRepositoryMixin
from .observability import ObservabilityRepositoryMixin
from .runs import RunsRepositoryMixin
from .signals import SignalsRepositoryMixin
from .theses import ThesesRepositoryMixin
from .watchlists import WatchlistsRepositoryMixin


class JournalRepository(
    RunsRepositoryMixin,
    SignalsRepositoryMixin,
    ThesesRepositoryMixin,
    WatchlistsRepositoryMixin,
    BriefsRepositoryMixin,
    EvaluationsRepositoryMixin,
    ObservabilityRepositoryMixin,
    JournalRepositoryBase,
):
    """CRUD boundary for the local decision journal.

    The public class remains import-compatible while aggregate-specific
    behavior lives in smaller repository mixins.
    """

    pass
