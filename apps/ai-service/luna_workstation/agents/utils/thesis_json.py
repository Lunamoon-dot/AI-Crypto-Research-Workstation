"""Helpers for embedding and extracting the UI thesis summary JSON block."""

from __future__ import annotations

import json
import re
from typing import Any

TRADE_THESIS_JSON_MARKER = "TRADE_THESIS_JSON"

_TRADE_THESIS_JSON_BLOCK_RE = re.compile(
    rf"{TRADE_THESIS_JSON_MARKER}\s*:?\s*```(?:json)?\s*(.*?)```",
    re.IGNORECASE | re.DOTALL,
)
_FENCED_CODE_BLOCK_RE = re.compile(
    r"```(?:json)?\s*(.*?)```",
    re.IGNORECASE | re.DOTALL,
)
_THESIS_JSON_KEY_RE = re.compile(
    r'"(?:rating|direction|action_summary|confirmation_condition|invalidation)"\s*:',
    re.IGNORECASE,
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
        return _extract_json_object_text(match.group(1))
    marker_index = text.upper().find(TRADE_THESIS_JSON_MARKER)
    if marker_index >= 0:
        tail = text[marker_index + len(TRADE_THESIS_JSON_MARKER) :]
        return _extract_json_object_text(tail)
    for block in _FENCED_CODE_BLOCK_RE.finditer(text):
        candidate = _extract_json_object_text(block.group(1))
        if _looks_like_thesis_json(candidate):
            return candidate
    return ""


def strip_trade_thesis_json_block(text: str | None) -> str:
    """Remove the embedded UI summary block from user-facing markdown."""
    if not text:
        return ""
    stripped = _TRADE_THESIS_JSON_BLOCK_RE.sub("", text).strip()
    marker_index = stripped.upper().find(TRADE_THESIS_JSON_MARKER)
    if marker_index >= 0:
        stripped = stripped[:marker_index].strip()
    stripped = _FENCED_CODE_BLOCK_RE.sub(_strip_thesis_json_code_block, stripped).strip()
    return stripped


def _strip_thesis_json_code_block(match: re.Match[str]) -> str:
    candidate = _extract_json_object_text(match.group(1))
    return "" if _looks_like_thesis_json(candidate) else match.group(0)


def _extract_json_object_text(raw: str | None) -> str:
    if not raw:
        return ""
    decoder = json.JSONDecoder()
    for index, char in enumerate(raw):
        if char != "{":
            continue
        try:
            loaded, end = decoder.raw_decode(raw[index:])
        except json.JSONDecodeError:
            continue
        if isinstance(loaded, dict):
            return raw[index : index + end].strip()
    return _extract_balanced_json_object_text(raw)


def _extract_balanced_json_object_text(raw: str) -> str:
    start = raw.find("{")
    if start < 0:
        return ""
    depth = 0
    in_string = False
    escaped = False
    for index in range(start, len(raw)):
        char = raw[index]
        if escaped:
            escaped = False
            continue
        if char == "\\" and in_string:
            escaped = True
            continue
        if char == '"':
            in_string = not in_string
            continue
        if in_string:
            continue
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return raw[start : index + 1].strip()
    return ""


def _looks_like_thesis_json(raw: str | None) -> bool:
    return bool(raw and _THESIS_JSON_KEY_RE.search(raw))
