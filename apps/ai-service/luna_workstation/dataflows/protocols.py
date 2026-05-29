"""Typed provider contracts for dataflow routing."""

from __future__ import annotations

from typing import Any, Protocol


class DataProviderCallable(Protocol):
    """Callable shape accepted by the live provider router."""

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Return provider data in the format expected by the requesting tool."""


class HistoricalProviderCallable(DataProviderCallable, Protocol):
    """Provider callable that may accept point-in-time kwargs."""

    def __call__(
        self,
        *args: Any,
        as_of: str | None = None,
        end_time: str | None = None,
        **kwargs: Any,
    ) -> Any:
        """Return data constrained to the supplied historical window."""
