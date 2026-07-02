"""Small TOML serialization helpers used for local config files."""

from __future__ import annotations

import json
from typing import Any


def write_toml_section(
    lines: list[str],
    data: dict[str, Any],
    indent: int = 0,
    path: tuple[str, ...] = (),
) -> None:
    """Write a nested dict as valid TOML dotted sections."""
    scalar_items = []
    nested_items = []
    for key, value in data.items():
        if isinstance(value, dict):
            nested_items.append((str(key), value))
        else:
            scalar_items.append((str(key), value))

    if path:
        if lines and lines[-1] != "":
            lines.append("")
        lines.append(f"[{'.'.join(_toml_key(part) for part in path)}]")

    for key, value in scalar_items:
        lines.append(f"{_toml_key(key)} = {_toml_value(value)}")

    for key, value in nested_items:
        write_toml_section(lines, value, indent + 1, (*path, key))


def _toml_key(key: str) -> str:
    if key and all(ch.isalnum() or ch in "_-" for ch in key):
        return key
    return json.dumps(key)


def _toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return str(value).lower()
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, list):
        return "[" + ", ".join(_toml_value(item) for item in value) + "]"
    if value is None:
        return '""'
    return _toml_string(str(value))


def _toml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False).replace("\x7f", "\\u007f")


__all__ = ["write_toml_section"]
