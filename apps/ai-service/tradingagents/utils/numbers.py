"""Numeric text extraction helpers."""

from __future__ import annotations

import re

NUMBER_RE = re.compile(r"(?<![A-Za-z])[-+]?\d+(?:,\d{3})*(?:\.\d+)?")


def extract_numbers(value: str | None) -> list[float]:
    """Extract decimal numbers from free text, tolerating thousands separators."""
    numbers: list[float] = []
    for match in NUMBER_RE.findall(value or ""):
        try:
            numbers.append(float(match.replace(",", "")))
        except ValueError:
            continue
    return numbers
