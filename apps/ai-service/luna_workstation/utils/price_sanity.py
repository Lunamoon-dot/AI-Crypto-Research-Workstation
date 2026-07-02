"""Small helpers for validating prose price triggers against current price."""

from __future__ import annotations

import re
import unicodedata


_CURRENT_PRICE_RE = re.compile(r"\bPrice:\s*\$?\s*([\d,]+(?:\.\d+)?)", re.I)
_TRIGGER_LEVEL_RE = re.compile(
    r"\b(?P<direction>above|below)\s+(?P<currency>\$?)\s*"
    r"(?P<level>\d[\d,]*(?:\.\d+)?)",
    re.I,
)
_LOCALIZED_TRIGGER_LEVEL_RE = re.compile(
    r"\b(?P<direction>"
    r"gi\u1ea3m\s+d\u01b0\u1edbi|giam\s+duoi|d\u01b0\u1edbi|duoi|"
    r"ph\u00e1\s+v\u1ee1\s+tr\u00ean|pha\s+vo\s+tren|"
    r"v\u01b0\u1ee3t\s+tr\u00ean|vuot\s+tren|tr\u00ean|tren"
    r")\s+(?P<currency>\$?)\s*(?P<level>\d[\d,]*(?:\.\d+)?)",
    re.I,
)
_UPSIDE_REFERENCE_LEVEL_RE = re.compile(
    r"\b(?P<label>breakout(?:\s+level)?|reclaim|recent\s+high|resistance|"
    r"upside\s+target|profit\s+target)"
    r"\b[^\n$]{0,40}?\$?\s*(?P<level>\d[\d,]*(?:\.\d+)?)",
    re.I,
)
_PRICE_CONTEXT_RE = re.compile(
    r"\b("
    r"price|gia|close|dong cua|daily close|support|resistance|"
    r"khang cu|ho tro|level|zone|vung|break|breakout|reclaim"
    r")\b",
    re.I,
)
_INDICATOR_CONTEXT_RE = re.compile(
    r"\b("
    r"rsi|long/short|l/s|ratio|funding|oi|open interest|atr|"
    r"volume|khoi luong|macd"
    r")\b",
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
    for direction, level_text in _price_trigger_matches(text):
        try:
            level = float(level_text.replace(",", ""))
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
        if not _has_price_trigger_context(text, match):
            continue
        yield match.group("direction").lower(), match.group("level")
    for match in _LOCALIZED_TRIGGER_LEVEL_RE.finditer(text):
        if not _has_price_trigger_context(text, match):
            continue
        raw = match.group("direction").lower()
        direction = "below" if "d\u01b0\u1edbi" in raw or "duoi" in raw else "above"
        yield direction, match.group("level")


def _has_price_trigger_context(text: str, match: re.Match[str]) -> bool:
    if match.group("currency") == "$":
        return True

    start = max(0, match.start() - 48)
    end = min(len(text), match.end() + 48)
    nearby = _normalize_context(text[start:end])
    before = _normalize_context(text[max(0, match.start() - 32) : match.start()])
    if _INDICATOR_CONTEXT_RE.search(before):
        return False
    return bool(_PRICE_CONTEXT_RE.search(nearby))


def _normalize_context(text: str) -> str:
    return (
        unicodedata.normalize("NFD", text)
        .encode("ascii", "ignore")
        .decode("ascii")
        .lower()
    )


def format_price(value: float) -> str:
    """Compact currency formatting for sanity notes."""

    if value >= 100:
        return f"${value:,.0f}"
    return f"${value:,.2f}".rstrip("0").rstrip(".")
