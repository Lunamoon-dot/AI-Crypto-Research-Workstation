"""JSON line output for scripted CLI workflows (Phase 7)."""

from __future__ import annotations

import json
import sys
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from enum import Enum
from typing import Any

import typer
from pydantic import BaseModel


def print_json_stdout(payload: Any) -> None:
    """Pretty-print JSON to stdout with UTF-8 and a trailing newline."""

    def _default(o: Any) -> Any:
        normalized = to_jsonable(o)
        if normalized is not o:
            return normalized
        raise TypeError(f"Unsupported type for JSON serialization: {type(o)!r}")

    sys.stdout.write(json.dumps(payload, indent=2, default=_default) + "\n")


def print_plain_stdout(lines: list[str]) -> None:
    """Print line-oriented plain text without Rich markup."""
    sys.stdout.write("\n".join(lines).rstrip() + "\n")


def ensure_single_output_mode(*, json_out: bool, plain: bool) -> None:
    """Reject mutually exclusive machine-readable and plain modes."""
    if json_out and plain:
        raise typer.BadParameter("Use only one output mode: --json or --plain.")


def to_jsonable(value: Any) -> Any:
    """Convert common app models into JSON-serializable values."""
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if is_dataclass(value) and not isinstance(value, type):
        return {k: to_jsonable(v) for k, v in asdict(value).items()}
    if isinstance(value, Enum):
        return value.value
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {k: to_jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [to_jsonable(v) for v in value]
    return value
