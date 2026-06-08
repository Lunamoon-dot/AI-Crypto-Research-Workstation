"""Small helpers for validating prose price triggers against current price."""

from __future__ import annotations

import re


_CURRENT_PRICE_RE = re.compile(r"\bPrice:\s*\$?\s*([\d,]+(?:\.\d+)?)", re.I)
_TRIGGER_LEVEL_RE = re.compile(
    r"\b(?P<direction>above|below)\s+\$?\s*(?P<level>\d[\d,]*(?:\.\d+)?)",
    re.I,
)
_LOCALIZED_TRIGGER_LEVEL_RE = re.compile(
    r"(?P<phrase>"
    r"giảm\s+dưới|giam\s+duoi|dưới|duoi|"
    r"phá\s+vỡ\s+trên|pha\s+vo\s+tren|vượt\s+trên|vuot\s+tren|trên|tren"
    r")\s+\$?\s*(?P<level>\d[\d,]*(?:\.\d+)?)",
    re.I,
)
_UPSIDE_REFERENCE_LEVEL_RE = re.compile(
    r"\b(?P<label>breakout(?:\s+level)?|reclaim|recent\s+high|resistance|upside\s+target)"
    r"\b[^\n$]{0,40}?\$?\s*(?P<level>\d[\d,]*(?:\.\d+)?)",
    re.I,
)


def extract_current_price(text: str | None) -> float | None:
    """Extract ``Price: $123.45`` from a quant prompt block."""

    match = _CURRENT_PRICE_RE.search(text or "")
    if not match:
        return None
    try:
        return float(match.group(1).replace(",", ""))
    except ValueError:
        return None


def price_trigger_sanity_notes(
    text: str | None,
    current_price: float | None,
    *,
    source: str = "text",
) -> list[str]:
    """Return notes for price-only triggers already crossed by current price."""

    if current_price is None or not text:
        return []

    notes: list[str] = []
    seen: set[tuple[str, float]] = set()
    for direction, raw_level in _price_trigger_matches(text):
        try:
            level = float(raw_level.replace(",", ""))
        except ValueError:
            continue
        key = (direction, level)
        if key in seen:
            continue
        seen.add(key)

        crossed = (
            current_price > level if direction == "above" else current_price < level
        )
        if not crossed:
            continue
        notes.append(
            f"{source}: price-only {direction} {format_price(level)} has already "
            f"occurred at current price {format_price(current_price)}; require "
            "non-price confirmation such as volume/RSI or update the level before "
            "treating it as a future trigger."
        )
    for match in _UPSIDE_REFERENCE_LEVEL_RE.finditer(text):
        label = re.sub(r"\s+", " ", match.group("label").lower()).strip()
        try:
            level = float(match.group("level").replace(",", ""))
        except ValueError:
            continue
        key = (label, level)
        if key in seen:
            continue
        seen.add(key)
        if current_price <= level:
            continue
        notes.append(
            f"{source}: {label} {format_price(level)} is below current price "
            f"{format_price(current_price)}; update the level or explain why it "
            "remains a current non-price condition."
        )
    return notes


def _price_trigger_matches(text: str):
    for match in _TRIGGER_LEVEL_RE.finditer(text):
        yield match.group("direction").lower(), match.group("level")
    for match in _LOCALIZED_TRIGGER_LEVEL_RE.finditer(text):
        phrase = match.group("phrase").lower()
        direction = "below" if "dưới" in phrase or "duoi" in phrase else "above"
        yield direction, match.group("level")


def format_price(value: float) -> str:
    """Compact currency formatting for sanity notes."""

    if value >= 100:
        return f"${value:,.0f}"
    return f"${value:,.2f}".rstrip("0").rstrip(".")
