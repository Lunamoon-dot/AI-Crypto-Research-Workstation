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

# Matches explicit rating declaration lines and tolerates markdown wrappers
# around the label or value. Deliberately anchored to the start of a line so
# prose such as "upgrade risk: Overweight" is not parsed as the official final
# rating. The fallback labels cover providers that ignore the exact
# ``Rating:`` contract but still emit a clear final stance line.
_RATING_DECLARATION_RE = re.compile(
    r"^\s*(?:[#>*\-\s]*)\*{0,2}"
    r"(?P<label>"
    r"(?:final\s+)?rating|"
    r"research\s+stance|"
    r"stance|"
    r"final\s+(?:trade|trading)\s+decision|"
    r"(?:final\s+)?research\s+thesis(?:\s+stance)?"
    r")"
    r"\*{0,2}\s*[:\-]\s*\*{0,2}\s*(?P<value>.+)$",
    re.IGNORECASE,
)
_RATING_WORD_RE = re.compile(
    r"\b(buy|overweight|hold|underweight|sell)\b",
    re.IGNORECASE,
)
_RATING_VALUE_PREFIX_RE = re.compile(
    r"^\s*[\*_`~\[\(]*(buy|overweight|hold|underweight|sell)\b",
    re.IGNORECASE,
)
_AVOID_VALUE_PREFIX_RE = re.compile(
    r"^\s*[\*_`~\[\(]*avoid(?:ance)?\b",
    re.IGNORECASE,
)


class DecisionConsistencyError(ValueError):
    """Raised when official decision fields disagree."""


def normalize_rating(value: object) -> str | None:
    """Return the canonical 5-tier rating for *value*, or ``None``."""

    if value is None:
        return None
    return _RATING_CANONICAL.get(str(value).strip().lower())


def _declared_ratings(text: str) -> list[tuple[str, tuple[str, ...]]]:
    declarations: list[tuple[str, tuple[str, ...]]] = []
    for line in (text or "").splitlines():
        match = _RATING_DECLARATION_RE.search(line)
        if not match:
            continue
        rating = _rating_from_declaration_value(match.group("value"))
        if rating is not None:
            declarations.append((line.strip(), (rating,)))
    return declarations


def _rating_from_declaration_value(value: str) -> str | None:
    """Return only the leading official rating from a declaration value."""

    match = _RATING_VALUE_PREFIX_RE.search(value or "")
    if match:
        return normalize_rating(match.group(1))
    if _AVOID_VALUE_PREFIX_RE.search(value or ""):
        return "Underweight"
    return None


def parse_rating_label(text: str) -> str | None:
    """Extract an explicit official rating declaration from text."""

    for _line, ratings in _declared_ratings(text):
        if ratings:
            return ratings[0]
    return None


def parse_rating(text: str, default: str = "Hold") -> str:
    """Extract the official 5-tier rating from rendered decision text.

    This intentionally does not scan arbitrary prose. The final badge and
    downstream signal must come from a machine-readable field or a rendered
    official declaration line, never from a counterargument that merely
    mentions a rating keyword.
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
    """Fail fast when a decision artifact has opposing official rating fields.

    Counterfactual prose is allowed to mention alternative ratings, e.g.
    "re-evaluate toward Overweight." The production renderer must only fail
    when explicit declaration lines disagree, because those are the fields
    downstream consumers treat as authoritative.
    """

    declarations = _declared_ratings(text)
    mentions = {rating for _line, ratings in declarations for rating in ratings}
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
