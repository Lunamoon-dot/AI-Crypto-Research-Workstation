"""Shared 5-tier rating vocabulary and deterministic rating helpers.

The same five-tier scale (Buy, Overweight, Hold, Underweight, Sell) is used by:
- The Research Manager (investment plan recommendation)
- The Portfolio Manager (final position decision)
- The signal processor (rating extracted for downstream consumers)
- The memory log (rating tag stored alongside each decision entry)

Centralising it here avoids drift between those call sites.
"""

from __future__ import annotations

import re
from typing import Iterable, Tuple


# Canonical, ordered 5-tier scale (most bullish to most bearish).
RATINGS_5_TIER: Tuple[str, ...] = (
    "Buy",
    "Overweight",
    "Hold",
    "Underweight",
    "Sell",
)

_RATING_CANONICAL = {rating.lower(): rating for rating in RATINGS_5_TIER}

# Matches "Rating: X" / "rating - X" / "Rating: **X**" and tolerates
# markdown wrappers around the label or value. Deliberately anchored to the
# start of a line so prose such as "upgrade risk: Overweight" is not parsed as
# the official final rating.
_RATING_LABEL_RE = re.compile(
    r"^\s*(?:[#>*\-\s]*)\*{0,2}rating\*{0,2}\s*[:\-]\s*\*{0,2}"
    r"(buy|overweight|hold|underweight|sell)\b",
    re.IGNORECASE,
)
_RATING_WORD_RE = re.compile(
    r"\b(buy|overweight|hold|underweight|sell)\b",
    re.IGNORECASE,
)


class DecisionConsistencyError(ValueError):
    """Raised when official decision fields disagree."""


def normalize_rating(value: object) -> str | None:
    """Return the canonical 5-tier rating for *value*, or ``None``."""

    if value is None:
        return None
    return _RATING_CANONICAL.get(str(value).strip().lower())


def parse_rating_label(text: str) -> str | None:
    """Extract only an explicit official ``Rating:`` field from text."""

    for line in (text or "").splitlines():
        match = _RATING_LABEL_RE.search(line)
        if match:
            return normalize_rating(match.group(1))
    return None


def parse_rating(text: str, default: str = "Hold") -> str:
    """Extract the official 5-tier rating from rendered decision text.

    This intentionally does not scan arbitrary prose. The final badge and
    downstream signal must come from a machine-readable field or a rendered
    ``Rating:`` header, never from a counterargument that merely mentions a
    rating keyword.
    """

    return parse_rating_label(text) or default


def rating_mentions(text: str) -> set[str]:
    """Return canonical rating words mentioned anywhere in text."""

    return {
        rating
        for rating in (
            normalize_rating(match.group(1))
            for match in _RATING_WORD_RE.finditer(text or "")
        )
        if rating is not None
    }


def ensure_no_conflicting_rating_mentions(
    text: str,
    *,
    official_rating: str | None = None,
    context: str = "decision",
) -> None:
    """Fail fast when a decision artifact contains opposing rating words.

    The production renderer must never choose between ``Underweight`` and
    ``Overweight`` by keyword order. If both appear in the same final decision
    artifact, publishing should stop and the model should regenerate a clean
    decision with one official rating.
    """

    mentions = rating_mentions(text)
    conflicts = (
        {"Overweight", "Underweight"},
        {"Buy", "Sell"},
    )
    for pair in conflicts:
        if pair.issubset(mentions):
            raise DecisionConsistencyError(
                f"{context} contains conflicting rating mentions: "
                f"{', '.join(sorted(pair))}"
            )

    normalized = normalize_rating(official_rating)
    if normalized is not None:
        opposing = _opposing_ratings(normalized)
        found = sorted(mentions.intersection(opposing))
        if found:
            raise DecisionConsistencyError(
                f"{context} official rating {normalized} conflicts with "
                f"rating mention(s): {', '.join(found)}"
            )


def assert_consistent_ratings(
    ratings: Iterable[tuple[str, object]],
    *,
    context: str = "decision",
) -> str | None:
    """Validate that all present official rating fields agree.

    Returns the agreed canonical rating, or ``None`` when no official field is
    available.
    """

    seen: list[tuple[str, str]] = []
    for source, value in ratings:
        rating = normalize_rating(value)
        if rating is not None:
            seen.append((source, rating))

    unique = {rating for _, rating in seen}
    if len(unique) <= 1:
        return seen[0][1] if seen else None

    details = ", ".join(f"{source}={rating}" for source, rating in seen)
    raise DecisionConsistencyError(f"{context} rating mismatch: {details}")


def _opposing_ratings(rating: str) -> set[str]:
    if rating in {"Buy", "Overweight"}:
        return {"Underweight", "Sell"}
    if rating in {"Underweight", "Sell"}:
        return {"Buy", "Overweight"}
    return set()
