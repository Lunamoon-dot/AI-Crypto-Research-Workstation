"""Helpers for embedding and extracting the UI thesis summary JSON block."""

from __future__ import annotations

import json
import re
from typing import Any

TRADE_THESIS_JSON_MARKER = "TRADE_THESIS_JSON"

_TRADE_THESIS_JSON_BLOCK_RE = re.compile(
    rf"{TRADE_THESIS_JSON_MARKER}\s*:?\s*```(?:json)?\s*(\{{.*?\}})\s*```",
    re.IGNORECASE | re.DOTALL,
)


def render_trade_thesis_json_block(payload: dict[str, Any]) -> str:
    """Render a machine-readable summary block for free-text providers."""
    return (
        f"{TRADE_THESIS_JSON_MARKER}:\n"
        "```json\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}\n"
        "```"
    )


def extract_trade_thesis_json(text: str | None) -> str:
    """Return the embedded thesis summary JSON object text, if present."""
    if not text:
        return ""
    match = _TRADE_THESIS_JSON_BLOCK_RE.search(text)
    if match:
        return match.group(1).strip()
    marker_index = text.upper().find(TRADE_THESIS_JSON_MARKER)
    if marker_index < 0:
        return ""
    tail = text[marker_index + len(TRADE_THESIS_JSON_MARKER) :]
    object_match = re.search(r"\{.*\}", tail, re.DOTALL)
    return object_match.group(0).strip() if object_match else ""


def strip_trade_thesis_json_block(text: str | None) -> str:
    """Remove the embedded UI summary block from user-facing markdown."""
    if not text:
        return ""
    stripped = _TRADE_THESIS_JSON_BLOCK_RE.sub("", text).strip()
    marker_index = stripped.upper().find(TRADE_THESIS_JSON_MARKER)
    if marker_index >= 0:
        stripped = stripped[:marker_index].strip()
    return stripped
